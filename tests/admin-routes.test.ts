import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/env";
import type { SupabaseDatabase } from "../src/database/supabase";
import type { Logger } from "../src/logging/logger";
import { handleAdminApi } from "../src/routes/admin";
import { makeEnv } from "./helpers";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const STAFF_ID = "20000000-0000-4000-8000-000000000001";
const POST_ID = "30000000-0000-4000-8000-000000000001";

function accessToken(aal: "aal1" | "aal2"): string {
  const payload = btoa(JSON.stringify({ aal })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `header.${payload}.signature-padding-for-tests`;
}

class FakeAdminDatabase {
  readonly updates: Array<{ body: unknown; query: Readonly<Record<string, string>>; table: string }> = [];
  readonly inserts: Array<{ body: unknown; table: string }> = [];
  updateResult: unknown[] = [{ id: POST_ID }];

  async select(table: string): Promise<unknown[]> {
    if (table === "staff_profiles") {
      return [{
        display_name: "Owner",
        email: "owner@example.com",
        id: STAFF_ID,
        last_signed_in_at: "2026-08-26T10:00:00.000Z",
        role: "owner",
        status: "active",
        user_id: USER_ID,
      }];
    }
    return [];
  }

  async updateReturning(
    table: string,
    query: Readonly<Record<string, string>>,
    body: unknown,
  ): Promise<unknown[]> {
    this.updates.push({ body, query, table });
    return this.updateResult;
  }

  async insert(table: string, body: unknown): Promise<unknown[]> {
    this.inserts.push({ body, table });
    return [{ id: "40000000-0000-4000-8000-000000000001" }];
  }
}

const logger: Logger = {
  debug() {},
  error() {},
  info() {},
  warn() {},
};

function mockAuthenticatedUser(): void {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    email: "owner@example.com",
    id: USER_ID,
    last_sign_in_at: "2026-08-26T10:00:00.000Z",
  })));
}

function request(operation: string, aal: "aal1" | "aal2"): Request {
  return new Request(`https://worker.example/api/admin/posts/${POST_ID}/${operation}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken(aal)}` },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("protected post operations", () => {
  it("queues an approved post for immediate publication and writes an audit event", async () => {
    mockAuthenticatedUser();
    const database = new FakeAdminDatabase();
    const response = await handleAdminApi(request("publish", "aal2"), {
      config: loadConfig(makeEnv()),
      database: database as unknown as SupabaseDatabase,
      logger,
      requestId: "request-1",
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "publish_requested" });
    expect(database.updates).toHaveLength(1);
    expect(database.updates[0]).toMatchObject({
      query: {
        approval_status: "eq.approved",
        id: `eq.${POST_ID}`,
        processing_lock: "is.null",
      },
      table: "facebook_posts",
    });
    expect(database.inserts).toContainEqual(expect.objectContaining({
      body: expect.objectContaining({ action: "post_publish_requested", entity_id: POST_ID }),
      table: "audit_logs",
    }));
  });

  it("requires an aal2 session before changing publication state", async () => {
    mockAuthenticatedUser();
    const database = new FakeAdminDatabase();
    const response = await handleAdminApi(request("cancel", "aal1"), {
      config: loadConfig(makeEnv()),
      database: database as unknown as SupabaseDatabase,
      logger,
      requestId: "request-2",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "mfa_required" });
    expect(database.updates).toHaveLength(0);
    expect(database.inserts).toHaveLength(0);
  });

  it("rejects a retry when the post is no longer in a retryable state", async () => {
    mockAuthenticatedUser();
    const database = new FakeAdminDatabase();
    database.updateResult = [];
    const response = await handleAdminApi(request("retry", "aal2"), {
      config: loadConfig(makeEnv()),
      database: database as unknown as SupabaseDatabase,
      logger,
      requestId: "request-3",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "post_not_retryable" });
    expect(database.inserts).toHaveLength(0);
  });
});
