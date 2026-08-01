import { ConfigurationError, loadConfig } from "./config/env";
import {
  SupabaseWebhookEventStore,
  type WebhookEventStore,
} from "./database/webhook-events";
import { SupabaseDatabase } from "./database/supabase";
import { createLogger } from "./logging/logger";
import { handleHealth } from "./routes/health";
import {
  handleMetaWebhookDelivery,
  handleMetaWebhookVerification,
} from "./routes/meta-webhooks";
import type { Env } from "./types/env";
import { jsonResponse } from "./utilities/http";

export interface AppDependencies {
  webhookEventStore?: WebhookEventStore;
}

export function createApp(dependencies: AppDependencies = {}) {
  return async function handleRequest(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Promise<Response> {
    const requestId = crypto.randomUUID();

    try {
      const config = loadConfig(env);
      const logger = createLogger(config, { request_id: requestId });
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return handleHealth(config);
      }

      if (url.pathname === "/webhooks/meta" && request.method === "GET") {
        return handleMetaWebhookVerification(request, config);
      }

      if (url.pathname === "/webhooks/meta" && request.method === "POST") {
        const store =
          dependencies.webhookEventStore ??
          new SupabaseWebhookEventStore(new SupabaseDatabase(config));

        return await handleMetaWebhookDelivery(request, {
          config,
          context,
          logger,
          store,
          ...(env.META_EVENTS_QUEUE === undefined
            ? {}
            : { queue: env.META_EVENTS_QUEUE }),
        });
      }

      return jsonResponse({ error: "not_found" }, 404);
    } catch (error) {
      if (error instanceof ConfigurationError) {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "error",
            operation: "service.configuration_invalid",
            request_id: requestId,
          }),
        );
      } else {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "error",
            operation: "request.unhandled_error",
            request_id: requestId,
          }),
        );
      }

      return jsonResponse({ error: "service_unavailable" }, 500);
    }
  };
}
