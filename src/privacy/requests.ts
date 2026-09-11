import { z } from "zod";
import type { AppConfig } from "../config/env";
import type { SupabaseDatabase } from "../database/supabase";
import { sha256Hex } from "../security/crypto";

const encoder = new TextEncoder();
const signedPayload = z.object({
  algorithm: z.literal("HMAC-SHA256"),
  user_id: z.string().regex(/^\d{1,100}$/),
  issued_at: z.number().int().nonnegative().optional(),
});

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error("Invalid encoding");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)), (c) => c.charCodeAt(0));
}

export async function verifyDeletionRequest(value: string, secret: string): Promise<string | null> {
  try {
    const parts = value.split(".");
    if (parts.length !== 2) return null;
    const [signature, payload] = parts as [string, string];
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const bytes = decodeBase64Url(signature);
    if (bytes.length !== 32 || !await crypto.subtle.verify("HMAC", key, bytes, encoder.encode(payload))) return null;
    const parsed = signedPayload.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64Url(payload))));
    if (!parsed.success || (parsed.data.issued_at !== undefined && parsed.data.issued_at > Date.now() / 1000 + 300)) return null;
    return parsed.data.user_id;
  } catch { return null; }
}

export async function receiptHash(code: string): Promise<string> {
  return sha256Hex(encoder.encode(code).buffer);
}

export function randomReceipt(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Stable across Meta retries, with a separate MAC domain from signature verification.
export async function metaReceipt(signedRequest: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`deletion-receipt:${signedRequest}`)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requesterHash(request: Request, secret: string): Promise<string> {
  // Cloudflare supplies this header. Keep neither the address nor a reversible copy.
  const address = request.headers.get("cf-connecting-ip") ?? "local-or-unknown";
  return metaReceipt(`request-rate:${new Date().toISOString().slice(0, 10)}:${address}`, secret);
}

export async function registerDeletion(
  database: SupabaseDatabase,
  config: AppConfig,
  input: { code: string; source: "website" | "meta"; contact?: string; reference?: string; metaUserId?: string; requesterHash?: string },
): Promise<boolean> {
  const rawResult = await database.rpc<unknown>("register_data_deletion_request", {
    p_receipt_hash: await receiptHash(input.code),
    p_source: input.source,
    p_contact: input.contact ?? null,
    p_reference: input.reference ?? null,
    p_meta_user_id: input.metaUserId ?? null,
    p_meta_app_id: input.source === "meta" ? config.META_APP_ID : null,
    p_requester_hash: input.requesterHash ?? null,
  });
  const result = z.object({ status: z.enum(["received", "rate_limited"]) }).parse(rawResult);
  return result.status !== "rate_limited";
}

export const completionSchema = z.object({
  subjectIds: z.array(z.string().regex(/^\d{1,100}$/)).min(1).max(20),
  verification: z.enum(["existing_channel", "verified_meta_mapping"]),
  confirmation: z.literal("DELETE VERIFIED DATA"),
});
