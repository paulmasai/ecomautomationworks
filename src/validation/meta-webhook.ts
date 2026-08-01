import { z } from "zod";

const webhookChangeSchema = z
  .object({
    field: z.string().min(1).max(128),
    value: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const messagingEventSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (event) => typeof event.sender === "object" && event.sender !== null,
    "A messaging event must include a sender",
  );

const webhookEntrySchema = z
  .object({
    id: z.string().min(1).max(256),
    time: z.number().int().nonnegative().optional(),
    changes: z.array(webhookChangeSchema).max(100).optional(),
    messaging: z.array(messagingEventSchema).max(100).optional(),
  })
  .passthrough()
  .refine(
    (entry) =>
      (entry.changes?.length ?? 0) > 0 || (entry.messaging?.length ?? 0) > 0,
    "A webhook entry must contain at least one event",
  );

export const metaWebhookPayloadSchema = z
  .object({
    object: z.literal("page"),
    entry: z.array(webhookEntrySchema).min(1).max(100),
  })
  .passthrough();

export type MetaWebhookPayload = z.infer<typeof metaWebhookPayloadSchema>;

export function classifyWebhookPayload(
  payload: MetaWebhookPayload,
): "comment" | "messenger" | "mixed" | "page_event" {
  const hasMessenger = payload.entry.some(
    (entry) => (entry.messaging?.length ?? 0) > 0,
  );
  const hasComment = payload.entry.some((entry) =>
    entry.changes?.some(
      (change) =>
        change.field === "feed" &&
        typeof change.value.item === "string" &&
        change.value.item === "comment",
    ),
  );

  if (hasMessenger && hasComment) return "mixed";
  if (hasMessenger) return "messenger";
  if (hasComment) return "comment";
  return "page_event";
}
