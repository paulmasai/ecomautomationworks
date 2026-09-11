import { z } from "zod";
import type { AppConfig } from "../config/env";
import type { SupabaseDatabase } from "../database/supabase";
import { BodyError, readLimitedBody } from "../privacy/body";
import { escapeHtml, legalPage } from "../privacy/pages";
import { metaReceipt, randomReceipt, receiptHash, registerDeletion, requesterHash, verifyDeletionRequest } from "../privacy/requests";
import { jsonResponse } from "../utilities/http";

const websiteRequest = z.object({ contact: z.email().max(254), reference: z.string().trim().min(3).max(1000) });
const statusRow = z.object({ status: z.enum(["pending", "completed"]), created_at: z.string(), completed_at: z.string().nullable() });

export async function handlePrivacyRequest(request: Request, config: AppConfig, database: SupabaseDatabase): Promise<Response> {
  const url = new URL(request.url);
  const isCallback = url.pathname === "/webhooks/meta/data-deletion";
  try {
    if (request.method === "GET" && url.pathname.startsWith("/data-deletion/status/")) {
      const code = url.pathname.slice("/data-deletion/status/".length);
      if (!/^[a-f0-9]{64}$/.test(code)) return legalPage("Request not found", "<p>Check your saved link. Completed receipts expire after 90 days.</p>", 404);
      const rows = await database.select("data_deletion_requests", { select: "status,created_at,completed_at", receipt_hash: `eq.${await receiptHash(code)}`, limit: "1" });
      const result = statusRow.safeParse(rows[0]);
      if (!result.success) return legalPage("Request not found", "<p>Check your saved link. Completed receipts expire after 90 days.</p>", 404);
      return legalPage("Deletion request status", `<p><strong>${result.data.status === "completed" ? "Completed for verified application records" : "Received — awaiting verification and review"}</strong></p><p>Received: ${escapeHtml(result.data.created_at.slice(0, 10))}</p>${result.data.completed_at === null ? "<p>Your request has been saved. The team must verify the records associated with you before deleting them. A response is due within one calendar month of receipt.</p>" : `<p>Completed: ${escapeHtml(result.data.completed_at.slice(0, 10))}</p><p>Verified matching records have been deleted from the active application database. This does not remove data held independently by Meta. Backup copies and minimal receipts follow the retention limits in our <a href="/privacy-policy">privacy policy</a>.</p>`}<p>Keep this link private. Contact us through the <a href="/data-deletion">deletion page</a> if you need help.</p>`);
    }
    if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return jsonResponse({ error: "form_encoding_required" }, 415);
    if (!isCallback && request.headers.get("origin") !== url.origin) return jsonResponse({ error: "request_origin_rejected" }, 403);
    const form = new URLSearchParams(await readLimitedBody(request));
    if (isCallback) {
      const signedRequest = form.get("signed_request") ?? "";
      if (form.getAll("signed_request").length !== 1) return jsonResponse({ error: "invalid_signed_request" }, 400);
      const userId = await verifyDeletionRequest(signedRequest, config.META_APP_SECRET);
      if (userId === null) return jsonResponse({ error: "invalid_signed_request" }, 401);
      const code = await metaReceipt(signedRequest, config.META_APP_SECRET);
      await registerDeletion(database, config, { code, source: "meta", metaUserId: userId });
      return jsonResponse({ url: `${url.origin}/data-deletion/status/${code}`, confirmation_code: code });
    }
    const input = websiteRequest.safeParse({ contact: form.get("contact"), reference: form.get("reference") });
    if (!input.success) return legalPage("Check your request", '<p>Enter a valid email and a Facebook or Messenger reference of 3–1,000 characters. <a href="/data-deletion">Return to the form</a>.</p>', 400);
    const code = randomReceipt();
    const accepted = await registerDeletion(database, config, { code, source: "website", ...input.data, requesterHash: await requesterHash(request, config.META_APP_SECRET) });
    if (!accepted) return legalPage("Too many requests", '<p>Please wait an hour before retrying, or use the privacy contact on the <a href="/data-deletion">deletion page</a>.</p>', 429);
    return new Response(null, { status: 303, headers: { location: `/data-deletion/status/${code}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch (error) {
    if (error instanceof BodyError) return jsonResponse({ error: error.status === 413 ? "payload_too_large" : "invalid_request" }, error.status);
    // Neither request text, receipt secrets nor upstream errors belong in logs.
    if (isCallback) return jsonResponse({ error: "deletion_service_unavailable" }, 503);
    return legalPage("Request service unavailable", '<p>We could not save or retrieve your request. Please retry, or use the contact on the <a href="/data-deletion">deletion page</a>.</p>', 503);
  }
}
