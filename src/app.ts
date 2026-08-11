import { ConfigurationError, loadConfig } from "./config/env";
import {
  SupabaseWebhookEventStore,
  type WebhookEventStore,
} from "./database/webhook-events";
import { SupabaseDatabase } from "./database/supabase";
import { createLogger } from "./logging/logger";
import {
  handleAdminApi,
  handleDashboardConfig,
  handleStaffBootstrap,
} from "./routes/admin";
import { handleHealth } from "./routes/health";
import {
  handleMetaWebhookDelivery,
  handleMetaWebhookVerification,
} from "./routes/meta-webhooks";
import type { Env } from "./types/env";
import { jsonResponse } from "./utilities/http";

export interface AppDependencies {
  database?: SupabaseDatabase;
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
      const database = dependencies.database ?? new SupabaseDatabase(config);

      if (request.method === "GET" && url.pathname === "/health") {
        return handleHealth(config);
      }

      if (request.method === "GET" && url.pathname === "/api/config") {
        return handleDashboardConfig(config);
      }

      if (request.method === "POST" && url.pathname === "/api/bootstrap") {
        return await handleStaffBootstrap(request, {
          config,
          database,
          logger,
          requestId,
        });
      }

      if (url.pathname.startsWith("/api/admin/")) {
        return await handleAdminApi(request, {
          config,
          database,
          logger,
          requestId,
        });
      }

      if (url.pathname === "/webhooks/meta" && request.method === "GET") {
        return handleMetaWebhookVerification(request, config);
      }

      if (url.pathname === "/webhooks/meta" && request.method === "POST") {
        const store =
          dependencies.webhookEventStore ??
          new SupabaseWebhookEventStore(database);

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
