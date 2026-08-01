import type { AppConfig } from "../config/env";
import type { WebhookEventStore } from "../database/webhook-events";
import type { Logger } from "../logging/logger";
import { constantTimeStringEqual } from "../security/constant-time";
import { sha256Hex, verifyMetaSignature } from "../security/crypto";
import type { MetaEventQueueMessage } from "../types/env";
import { jsonResponse, textResponse } from "../utilities/http";
import {
  classifyWebhookPayload,
  metaWebhookPayloadSchema,
} from "../validation/meta-webhook";

const MAX_WEBHOOK_BYTES = 256 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

interface WebhookRouteDependencies {
  config: AppConfig;
  context: ExecutionContext;
  logger: Logger;
  queue?: Queue<MetaEventQueueMessage>;
  store: WebhookEventStore;
}

export function handleMetaWebhookVerification(
  request: Request,
  config: AppConfig,
): Response {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (
    mode !== "subscribe" ||
    token === null ||
    challenge === null ||
    !constantTimeStringEqual(token, config.META_VERIFY_TOKEN)
  ) {
    return jsonResponse({ error: "verification_rejected" }, 403);
  }

  return textResponse(challenge);
}

async function dispatchToQueue(
  queue: Queue<MetaEventQueueMessage>,
  store: WebhookEventStore,
  eventId: string,
  externalEventId: string,
  logger: Logger,
): Promise<void> {
  try {
    await queue.send({ eventId, externalEventId });
    await store.markQueued(eventId);
    logger.info("meta.webhook.queued", { webhook_event_id: eventId });
  } catch {
    logger.error("meta.webhook.queue_failed", {
      error_category: "queue_transient",
      webhook_event_id: eventId,
    });

    try {
      await store.markQueueFailure(eventId);
    } catch {
      logger.error("meta.webhook.queue_failure_record_failed", {
        error_category: "database_transient",
        webhook_event_id: eventId,
      });
    }
  }
}

export async function handleMetaWebhookDelivery(
  request: Request,
  dependencies: WebhookRouteDependencies,
): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) {
    return jsonResponse({ error: "payload_too_large" }, 413);
  }

  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength === 0 || rawBody.byteLength > MAX_WEBHOOK_BYTES) {
    return jsonResponse(
      { error: rawBody.byteLength === 0 ? "empty_payload" : "payload_too_large" },
      rawBody.byteLength === 0 ? 400 : 413,
    );
  }

  const signatureValid = await verifyMetaSignature(
    rawBody,
    request.headers.get("x-hub-signature-256"),
    dependencies.config.META_APP_SECRET,
  );
  if (!signatureValid) {
    dependencies.logger.warn("meta.webhook.signature_rejected");
    return jsonResponse({ error: "invalid_signature" }, 401);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(decoder.decode(rawBody));
  } catch {
    return jsonResponse({ error: "malformed_payload" }, 400);
  }

  const validation = metaWebhookPayloadSchema.safeParse(parsedJson);
  if (!validation.success) {
    return jsonResponse({ error: "invalid_payload" }, 400);
  }

  const externalEventId = `delivery:${await sha256Hex(rawBody)}`;
  let ingestion;
  try {
    ingestion = await dependencies.store.ingest({
      externalEventId,
      category: classifyWebhookPayload(validation.data),
      payload: validation.data,
      payloadBytes: rawBody.byteLength,
    });
  } catch {
    dependencies.logger.error("meta.webhook.persistence_failed", {
      error_category: "database_transient",
    });
    return jsonResponse({ error: "event_storage_unavailable" }, 503);
  }

  if (ingestion.duplicate) {
    dependencies.logger.info("meta.webhook.duplicate", {
      webhook_event_id: ingestion.eventId,
    });
    return textResponse("EVENT_RECEIVED");
  }

  if (dependencies.queue !== undefined) {
    dependencies.context.waitUntil(
      dispatchToQueue(
        dependencies.queue,
        dependencies.store,
        ingestion.eventId,
        externalEventId,
        dependencies.logger,
      ),
    );
  } else {
    dependencies.logger.info("meta.webhook.database_queued", {
      webhook_event_id: ingestion.eventId,
    });
  }

  return textResponse("EVENT_RECEIVED");
}
