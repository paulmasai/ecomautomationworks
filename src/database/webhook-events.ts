import { z } from "zod";
import type { MetaWebhookPayload } from "../validation/meta-webhook";
import type { SupabaseDatabase } from "./supabase";

export interface WebhookEventInput {
  externalEventId: string;
  category: "comment" | "messenger" | "mixed" | "page_event";
  payload: MetaWebhookPayload;
  payloadBytes: number;
}

export interface IngestedWebhookEvent {
  eventId: string;
  duplicate: boolean;
}

export interface WebhookEventStore {
  ingest(input: WebhookEventInput): Promise<IngestedWebhookEvent>;
  markQueued(eventId: string): Promise<void>;
  markQueueFailure(eventId: string): Promise<void>;
}

const ingestionResultSchema = z
  .array(
    z.object({
      event_id: z.uuid(),
      is_duplicate: z.boolean(),
    }),
  )
  .length(1);

export class SupabaseWebhookEventStore implements WebhookEventStore {
  constructor(private readonly database: SupabaseDatabase) {}

  async ingest(input: WebhookEventInput): Promise<IngestedWebhookEvent> {
    const rawResult = await this.database.rpc<unknown>(
      "ingest_meta_webhook_event",
      {
        p_external_event_id: input.externalEventId,
        p_event_category: input.category,
        p_raw_payload: input.payload,
        p_payload_bytes: input.payloadBytes,
      },
    );
    const result = ingestionResultSchema.parse(rawResult)[0];

    if (result === undefined) {
      throw new Error("Missing webhook ingestion result");
    }

    return {
      eventId: result.event_id,
      duplicate: result.is_duplicate,
    };
  }

  async markQueued(eventId: string): Promise<void> {
    await this.database.update(
      "meta_webhook_events",
      { id: `eq.${eventId}`, processing_status: "eq.received" },
      { processing_status: "queued", queued_at: new Date().toISOString() },
    );
  }

  async markQueueFailure(eventId: string): Promise<void> {
    await this.database.update(
      "meta_webhook_events",
      { id: `eq.${eventId}` },
      {
        last_error: "Queue dispatch failed; database fallback retained",
        next_retry_at: new Date(Date.now() + 60_000).toISOString(),
      },
    );
  }
}
