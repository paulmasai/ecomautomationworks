import { createApp } from "./app";
import { handleScheduledPublishing } from "./scheduled";
import type { Env } from "./types/env";
import { handlePrivacyRetention } from "./privacy/retention";

const handleRequest = createApp();

export default {
  fetch(request: Request, env: Env, context: ExecutionContext) {
    return handleRequest(request, env, context);
  },
  scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(handlePrivacyRetention(env).catch(() => {
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", operation: "privacy.retention_failed" }));
    }));
    context.waitUntil(
      handleScheduledPublishing(env, controller.scheduledTime).catch(() => {
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          operation: "publishing.batch_failed",
        }));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
