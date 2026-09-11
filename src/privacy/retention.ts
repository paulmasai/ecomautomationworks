import { loadConfig } from "../config/env";
import { SupabaseDatabase } from "../database/supabase";
import { createLogger } from "../logging/logger";
import type { Env } from "../types/env";

export async function handlePrivacyRetention(env: Env): Promise<void> {
  const config = loadConfig(env);
  const logger = createLogger(config, { trigger: "cron" });
  const result = await new SupabaseDatabase(config).rpc<{ overdue_requests: number }>("apply_privacy_retention", {});
  logger.info("privacy.retention_completed");
  if (result.overdue_requests > 0) logger.warn("privacy.requests_overdue", { count: result.overdue_requests });
}
