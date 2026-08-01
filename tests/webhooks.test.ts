import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { MetaEventQueueMessage } from "../src/types/env";
import {
  InMemoryWebhookEventStore,
  makeEnv,
  makeExecutionContext,
  makeQueue,
  signBody,
  validCommentPayload,
} from "./helpers";

describe("Worker routes", () => {
  it("returns a minimal health response", async () => {
    const app = createApp();
    const execution = makeExecutionContext();
    const response = await app(
      new Request("https://worker.example/health"),
      makeEnv(),
      execution.context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "mobdeals-meta-automation-suite",
      environment: "development",
    });
  });

  it("returns the Meta challenge for a valid verification request", async () => {
    const app = createApp();
    const execution = makeExecutionContext();
    const url = new URL("https://worker.example/webhooks/meta");
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", "test-verify-token-123456789");
    url.searchParams.set("hub.challenge", "challenge-value");

    const response = await app(new Request(url), makeEnv(), execution.context);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge-value");
  });

  it("rejects an invalid webhook verification token", async () => {
    const app = createApp();
    const execution = makeExecutionContext();
    const url = new URL("https://worker.example/webhooks/meta");
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", "wrong-token-value-123456789");
    url.searchParams.set("hub.challenge", "challenge-value");

    const response = await app(new Request(url), makeEnv(), execution.context);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "verification_rejected" });
  });
});

describe("Meta webhook delivery", () => {
  it("stores a valid signed webhook and dispatches it once", async () => {
    const store = new InMemoryWebhookEventStore();
    const sent: MetaEventQueueMessage[] = [];
    const env = makeEnv({ META_EVENTS_QUEUE: makeQueue(sent) });
    const app = createApp({ webhookEventStore: store });
    const execution = makeExecutionContext();
    const body = JSON.stringify(validCommentPayload);
    const signature = await signBody(body, env.META_APP_SECRET);
    const request = new Request("https://worker.example/webhooks/meta", {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    const response = await app(request, env, execution.context);
    await execution.flush();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("EVENT_RECEIVED");
    expect(store.inputs).toHaveLength(1);
    expect(store.inputs[0]?.category).toBe("comment");
    expect(store.inputs[0]?.externalEventId).toMatch(/^delivery:[a-f\d]{64}$/);
    expect(sent).toHaveLength(1);
    expect(store.queued).toHaveLength(1);
  });

  it("rejects an invalid signature before parsing or storage", async () => {
    const store = new InMemoryWebhookEventStore();
    const app = createApp({ webhookEventStore: store });
    const execution = makeExecutionContext();
    const request = new Request("https://worker.example/webhooks/meta", {
      method: "POST",
      headers: { "x-hub-signature-256": `sha256=${"0".repeat(64)}` },
      body: JSON.stringify(validCommentPayload),
    });

    const response = await app(request, makeEnv(), execution.context);

    expect(response.status).toBe(401);
    expect(store.inputs).toHaveLength(0);
  });

  it("rejects malformed JSON with a valid signature", async () => {
    const store = new InMemoryWebhookEventStore();
    const env = makeEnv();
    const app = createApp({ webhookEventStore: store });
    const execution = makeExecutionContext();
    const body = "{not-json";
    const request = new Request("https://worker.example/webhooks/meta", {
      method: "POST",
      headers: {
        "x-hub-signature-256": await signBody(body, env.META_APP_SECRET),
      },
      body,
    });

    const response = await app(request, env, execution.context);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "malformed_payload" });
    expect(store.inputs).toHaveLength(0);
  });

  it("rejects a signed payload that does not match the Meta schema", async () => {
    const store = new InMemoryWebhookEventStore();
    const env = makeEnv();
    const app = createApp({ webhookEventStore: store });
    const execution = makeExecutionContext();
    const body = JSON.stringify({ object: "instagram", entry: [] });
    const request = new Request("https://worker.example/webhooks/meta", {
      method: "POST",
      headers: {
        "x-hub-signature-256": await signBody(body, env.META_APP_SECRET),
      },
      body,
    });

    const response = await app(request, env, execution.context);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_payload" });
    expect(store.inputs).toHaveLength(0);
  });

  it("does not dispatch the same delivery twice", async () => {
    const store = new InMemoryWebhookEventStore();
    const sent: MetaEventQueueMessage[] = [];
    const env = makeEnv({ META_EVENTS_QUEUE: makeQueue(sent) });
    const app = createApp({ webhookEventStore: store });
    const body = JSON.stringify(validCommentPayload);
    const signature = await signBody(body, env.META_APP_SECRET);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const execution = makeExecutionContext();
      const request = new Request("https://worker.example/webhooks/meta", {
        method: "POST",
        headers: { "x-hub-signature-256": signature },
        body,
      });
      const response = await app(request, env, execution.context);
      await execution.flush();
      expect(response.status).toBe(200);
    }

    expect(store.inputs).toHaveLength(2);
    expect(sent).toHaveLength(1);
  });

  it("keeps a valid event in the database queue when no Queue is bound", async () => {
    const store = new InMemoryWebhookEventStore();
    const env = makeEnv();
    const app = createApp({ webhookEventStore: store });
    const execution = makeExecutionContext();
    const body = JSON.stringify(validCommentPayload);
    const request = new Request("https://worker.example/webhooks/meta", {
      method: "POST",
      headers: {
        "x-hub-signature-256": await signBody(body, env.META_APP_SECRET),
      },
      body,
    });

    const response = await app(request, env, execution.context);

    expect(response.status).toBe(200);
    expect(store.inputs).toHaveLength(1);
    expect(store.queued).toHaveLength(0);
  });
});
