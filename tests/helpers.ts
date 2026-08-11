import type {
  IngestedWebhookEvent,
  WebhookEventInput,
  WebhookEventStore,
} from "../src/database/webhook-events";
import type { Env, MetaEventQueueMessage } from "../src/types/env";

const EVENT_ID = "90000000-0000-4000-8000-000000000001";

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-123456789",
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key-123456789",
    META_APP_ID: "test-app-id",
    META_APP_SECRET: "test-app-secret-123456789",
    META_PAGE_ID: "test-page-id",
    META_PAGE_ACCESS_TOKEN: "test-page-access-token-123456789",
    META_VERIFY_TOKEN: "test-verify-token-123456789",
    META_GRAPH_API_VERSION: "v99.0",
    INTERNAL_ADMIN_SECRET: "test-admin-secret-123456789",
    ENVIRONMENT: "development",
    LOG_LEVEL: "error",
    OUTBOUND_ACTIONS_ENABLED: "false",
    ...overrides,
  };
}

export class InMemoryWebhookEventStore implements WebhookEventStore {
  readonly inputs: WebhookEventInput[] = [];
  readonly queued: string[] = [];
  readonly queueFailures: string[] = [];
  private readonly externalIds = new Set<string>();

  async ingest(input: WebhookEventInput): Promise<IngestedWebhookEvent> {
    this.inputs.push(input);
    const duplicate = this.externalIds.has(input.externalEventId);
    this.externalIds.add(input.externalEventId);
    return { eventId: EVENT_ID, duplicate };
  }

  async markQueued(eventId: string): Promise<void> {
    this.queued.push(eventId);
  }

  async markQueueFailure(eventId: string): Promise<void> {
    this.queueFailures.push(eventId);
  }
}

export interface TestExecutionContext {
  context: ExecutionContext;
  flush(): Promise<void>;
}

export function makeExecutionContext(): TestExecutionContext {
  const pending: Promise<unknown>[] = [];
  const context = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
  } as ExecutionContext;

  return {
    context,
    async flush() {
      while (pending.length > 0) {
        await Promise.all(pending.splice(0));
      }
    },
  };
}

export function makeQueue(
  sent: MetaEventQueueMessage[],
): Queue<MetaEventQueueMessage> {
  return {
    async send(message: MetaEventQueueMessage) {
      sent.push(message);
    },
    async sendBatch(messages: Iterable<MessageSendRequest<MetaEventQueueMessage>>) {
      for (const message of messages) sent.push(message.body);
    },
  } as unknown as Queue<MetaEventQueueMessage>;
}

export async function signBody(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(body)),
  );
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256=${hex}`;
}

export const validCommentPayload = {
  object: "page",
  entry: [
    {
      id: "page-123",
      time: 1_700_000_000,
      changes: [
        {
          field: "feed",
          value: {
            item: "comment",
            comment_id: "comment-123",
            post_id: "post-123",
            verb: "add",
            message: "Price?",
          },
        },
      ],
    },
  ],
} as const;
