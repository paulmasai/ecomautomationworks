import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { SupabaseDatabase } from "../src/database/supabase";
import { metaReceipt, verifyDeletionRequest } from "../src/privacy/requests";
import { makeEnv, makeExecutionContext } from "./helpers";

const identity = { PRIVACY_CONTROLLER_NAME: "Example Controller", PRIVACY_CONTACT_EMAIL: "privacy@example.com", PRIVACY_POSTAL_ADDRESS: "Example postal address, Kenya" };
const env = makeEnv(identity);
const encode = (value: string) => Buffer.from(value).toString("base64url");
async function signed(payload: unknown, secret = env.META_APP_SECRET) {
  const body = encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${Buffer.from(signature).toString("base64url")}.${body}`;
}
function setup() {
  const database = { rpc: vi.fn().mockResolvedValue({ status: "received" }), select: vi.fn().mockResolvedValue([]) };
  const app = createApp({ database: database as unknown as SupabaseDatabase });
  const call = (request: Request, environment = env) => app(request, environment, makeExecutionContext().context);
  return { database, call };
}
afterEach(() => vi.unstubAllGlobals());

describe("public privacy and deletion", () => {
  it.each(["/privacy-policy", "/privacy-policy/", "/privacy", "/data-deletion", "/terms", "/terms-of-service"])("serves %s without Auth or database configuration", async (path) => {
    const { call, database } = setup();
    const response = await call(new Request(`https://worker.example${path}`), makeEnv({ ...identity, SUPABASE_URL: "" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Example Controller");
    expect(database.rpc).not.toHaveBeenCalled();
    expect(response.headers.get("content-security-policy")).toContain("form-action 'self'");
  });
  it("labels incomplete controller details as a draft, with a non-success HTTP status", async () => {
    const { call } = setup();
    const response = await call(new Request("https://worker.example/privacy-policy"), makeEnv());
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Draft notice");
  });
  it("escapes configured content", async () => {
    const { call } = setup();
    const response = await call(new Request("https://worker.example/privacy-policy"), makeEnv({ ...identity, PRIVACY_CONTROLLER_NAME: '<script>alert("x")</script>' }));
    expect(await response.text()).not.toContain('<script>alert("x")</script>');
  });
  it("records an unverified request and redirects to a private status link", async () => {
    const { call, database } = setup();
    const response = await call(new Request("https://worker.example/data-deletion", { method: "POST", headers: { origin: "https://worker.example" }, body: new URLSearchParams({ contact: "person@example.com", reference: "Comment on Tuesday" }) }));
    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toMatch(/^\/data-deletion\/status\/[a-f0-9]{64}$/);
    expect(database.rpc).toHaveBeenCalledWith("register_data_deletion_request", expect.objectContaining({ p_source: "website", p_contact: "person@example.com" }));
    expect(database.rpc.mock.calls[0]?.[1].p_receipt_hash).not.toBe(location.split("/").at(-1));
  });
  it("rejects cross-origin submissions", async () => {
    const { call, database } = setup();
    const response = await call(new Request("https://worker.example/data-deletion", { method: "POST", headers: { origin: "https://attacker.example" }, body: new URLSearchParams({ contact: "person@example.com", reference: "Reference" }) }));
    expect(response.status).toBe(403);
    expect(database.rpc).not.toHaveBeenCalled();
  });
  it("shows pending status without disclosing identifiers or contact data", async () => {
    const { call, database } = setup();
    database.select.mockResolvedValue([{ status: "pending", created_at: "2026-09-10T00:00:00Z", completed_at: null, contact: "secret@example.com" }]);
    const response = await call(new Request(`https://worker.example/data-deletion/status/${"a".repeat(64)}`));
    const html = await response.text();
    expect(html).toContain("awaiting verification");
    expect(html).not.toContain("secret@example.com");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("returns 404 for an unknown receipt", async () => {
    const { call } = setup();
    expect((await call(new Request(`https://worker.example/data-deletion/status/${"b".repeat(64)}`))).status).toBe(404);
  });
});

describe("Meta deletion callback", () => {
  const callback = (value: string) => new Request("https://worker.example/webhooks/meta/data-deletion", { method: "POST", body: new URLSearchParams({ signed_request: value }) });
  it("verifies the signature and returns Meta's required response with a stable receipt", async () => {
    const { call, database } = setup();
    const value = await signed({ algorithm: "HMAC-SHA256", user_id: "123456789" });
    const first = await call(callback(value));
    const second = await call(callback(value));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    expect(database.rpc).toHaveBeenCalledWith("register_data_deletion_request", expect.objectContaining({ p_meta_user_id: "123456789", p_meta_app_id: env.META_APP_ID, p_source: "meta" }));
    const receipt = await metaReceipt(value, env.META_APP_SECRET);
    expect(receipt).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects a valid-looking callback signed by the wrong app before storage", async () => {
    const { call, database } = setup();
    expect((await call(callback(await signed({ algorithm: "HMAC-SHA256", user_id: "123456789" }, "wrong-secret")))).status).toBe(401);
    expect(database.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { algorithm: "HMAC-SHA1", user_id: "123" },
    { algorithm: "HMAC-SHA256", user_id: 123 },
    { algorithm: "HMAC-SHA256", user_id: "" },
    { algorithm: "HMAC-SHA256", user_id: "123", issued_at: 99999999999 },
  ])("rejects invalid signed claims %j", async (payload) => {
    expect(await verifyDeletionRequest(await signed(payload), env.META_APP_SECRET)).toBeNull();
  });
  it("rejects malformed encoding and extra segments", async () => {
    for (const value of ["", "a.b.c", "!.!", "a.b"]) expect(await verifyDeletionRequest(value, env.META_APP_SECRET)).toBeNull();
  });
  it("does not acknowledge success when persistence fails", async () => {
    const { call, database } = setup();
    database.rpc.mockRejectedValue(new Error("private database detail"));
    const response = await call(callback(await signed({ algorithm: "HMAC-SHA256", user_id: "123" })));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
  });
  it("caps streamed input without trusting Content-Length", async () => {
    const { call, database } = setup();
    const response = await call(callback("x".repeat(9000)));
    expect(response.status).toBe(413);
    expect(database.rpc).not.toHaveBeenCalled();
  });
});

describe("staff deletion permissions", () => {
  it.each([['owner', 'aal1', 403], ['support_agent', 'aal2', 403], ['owner', 'aal2', 200]])("requires an owner with MFA (%s, %s)", async (role, aal, status) => {
    const { call, database } = setup();
    const userId = "10000000-0000-4000-8000-000000000001";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id: userId, email: "owner@example.com" })));
    database.select.mockResolvedValue([{ id: "20000000-0000-4000-8000-000000000001", user_id: userId, email: "owner@example.com", display_name: "Owner", role, status: "active", last_signed_in_at: null }]);
    database.rpc.mockResolvedValue({ status: "completed" });
    const token = `header.${encode(JSON.stringify({ aal }))}.signature-padding-for-tests`;
    const response = await call(new Request("https://worker.example/api/admin/privacy/requests/30000000-0000-4000-8000-000000000001/complete", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ subjectIds: ["123"], verification: "existing_channel", confirmation: "DELETE VERIFIED DATA" }) }));
    expect(response.status).toBe(status);
    if (status === 200) expect(database.rpc).toHaveBeenCalledWith("complete_data_deletion_request", expect.objectContaining({ p_actor_id: userId, p_subject_ids: ["123"] }));
    else expect(database.rpc).not.toHaveBeenCalled();
  });
});
