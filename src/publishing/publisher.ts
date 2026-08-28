import type { AppConfig } from "../config/env";
import type {
  MetaPostPublisher,
  PublicationAttempt,
  PublicationPost,
  PublicationStore,
  PublishingLogger,
  ScheduledPublishingResult,
} from "./contracts";
import { PublicationError } from "./contracts";

const MAX_BATCH_SIZE = 10;
const MAX_PUBLICATION_ATTEMPTS = 3;
const retryDelaysMs = [5 * 60_000, 30 * 60_000] as const;

export interface PublishingDependencies {
  config: Pick<AppConfig, "OUTBOUND_ACTIONS_ENABLED">;
  logger: PublishingLogger;
  metaPublisher: MetaPostPublisher;
  store: PublicationStore;
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function nextUtcDay(now: Date): Date {
  const start = startOfUtcDay(now);
  return new Date(start.getTime() + 24 * 60 * 60_000 + 60_000);
}

function retryAt(post: PublicationPost, error: PublicationError, now: Date): Date | null {
  const failedAttempts = post.retryCount + 1;
  if (!error.retryable || failedAttempts >= MAX_PUBLICATION_ATTEMPTS) return null;
  const delay = retryDelaysMs[Math.min(failedAttempts - 1, retryDelaysMs.length - 1)];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

function validateClaimedPost(post: PublicationPost, now: Date): void {
  if (
    post.status !== "processing" ||
    post.approvalStatus !== "approved" ||
    post.caption.trim().length === 0 ||
    post.caption.length > 5_000 ||
    new Date(post.scheduledAt).getTime() > now.getTime()
  ) {
    throw new PublicationError("facebook_post_invalid", "validation", false, true);
  }
}

export async function runScheduledPublishing(
  dependencies: PublishingDependencies,
  now = new Date(),
): Promise<ScheduledPublishingResult> {
  const result: ScheduledPublishingResult = {
    claimed: 0,
    deferred: 0,
    failed: 0,
    published: 0,
    recovered: await dependencies.store.recoverStaleClaims(now),
    skipped: null,
  };

  if (!dependencies.config.OUTBOUND_ACTIONS_ENABLED) {
    result.skipped = "environment_disabled";
    dependencies.logger.info("publishing.skipped", { reason: result.skipped });
    return result;
  }

  const initialSettings = await dependencies.store.loadSettings();
  if (
    !initialSettings.globalEnabled ||
    !initialSettings.postingEnabled ||
    initialSettings.maintenanceMode
  ) {
    result.skipped = "database_disabled";
    dependencies.logger.info("publishing.skipped", { reason: result.skipped });
    return result;
  }

  const posts = await dependencies.store.claimDuePosts(
    Math.min(initialSettings.maximumDailyPosts, MAX_BATCH_SIZE),
    now,
  );
  result.claimed = posts.length;

  for (const post of posts) {
    let attempt: PublicationAttempt | null = null;
    try {
      // Re-read kill switches for every post. This intentionally avoids a
      // cross-invocation cache delaying an emergency stop.
      const settings = await dependencies.store.loadSettings();
      if (!settings.globalEnabled || !settings.postingEnabled || settings.maintenanceMode) {
        await dependencies.store.deferPost(post, null, "automation_disabled", now);
        result.deferred += 1;
        continue;
      }

      validateClaimedPost(post, now);
      const page = await dependencies.store.loadPage(post.facebookPageId);
      if (page === null || !page.active) {
        throw new PublicationError("facebook_page_inactive", "configuration", false, true);
      }
      if (post.productId !== null) {
        const product = await dependencies.store.loadProduct(post.productId);
        if (
          product === null ||
          !product.active ||
          product.stockQuantity <= 0 ||
          !["in_stock", "low_stock"].includes(product.stockStatus)
        ) {
          throw new PublicationError("product_unavailable", "validation", false, true);
        }
      }

      const dayStart = startOfUtcDay(now);
      const publishedToday = await dependencies.store.countPublishedPosts(
        post.facebookPageId,
        dayStart,
        new Date(dayStart.getTime() + 24 * 60 * 60_000),
        settings.maximumDailyPosts,
      );
      if (publishedToday >= settings.maximumDailyPosts) {
        await dependencies.store.deferPost(post, nextUtcDay(now), "daily_limit", now);
        result.deferred += 1;
        continue;
      }

      attempt = await dependencies.store.beginAttempt(post, now);
      const published = await dependencies.metaPublisher.publish(
        post,
        page,
        settings.maximumImageSizeBytes,
      );
      await dependencies.store.completeSuccess(post, attempt, published, now);
      result.published += 1;
      dependencies.logger.info("publishing.post_published", {
        attempt_number: attempt.attemptNumber,
        post_id: post.id,
      });
    } catch (error) {
      if (!(error instanceof PublicationError)) throw error;
      const nextAttemptAt = retryAt(post, error, now);
      await dependencies.store.completeFailure(post, attempt, error, nextAttemptAt, now);
      result.failed += 1;
      dependencies.logger.warn("publishing.post_failed", {
        error_category: error.category,
        post_id: post.id,
        retryable: nextAttemptAt !== null,
      });
    }
  }

  return result;
}
