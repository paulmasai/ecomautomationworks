import { loadConfig } from "./config/env";
import { SupabaseDatabase } from "./database/supabase";
import { createLogger } from "./logging/logger";
import { MetaGraphPostPublisher } from "./publishing/meta-client";
import { runScheduledPublishing } from "./publishing/publisher";
import { SupabasePublicationStore } from "./publishing/supabase-store";
import type { Env } from "./types/env";

export async function handleScheduledPublishing(
  env: Env,
  scheduledTime: number,
): Promise<void> {
  const config = loadConfig(env);
  const database = new SupabaseDatabase(config);
  const logger = createLogger(config, { trigger: "cron" });
  const result = await runScheduledPublishing({
    config,
    logger,
    metaPublisher: new MetaGraphPostPublisher(config),
    store: new SupabasePublicationStore(database),
  }, new Date(scheduledTime));
  logger.info("publishing.batch_completed", {
    claimed: result.claimed,
    deferred: result.deferred,
    failed: result.failed,
    published: result.published,
    recovered: result.recovered,
    skipped: result.skipped,
  });
}
