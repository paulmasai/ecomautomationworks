import { z } from "zod";
import { DatabaseError, type SupabaseDatabase } from "../database/supabase";
import type {
  MetaPublicationResult,
  PublicationAttempt,
  PublicationError,
  PublicationPage,
  PublicationPost,
  PublicationProduct,
  PublicationSettings,
  PublicationStore,
} from "./contracts";
import { parsePublicationSettings } from "./settings";

const publicationPostRowSchema = z.object({
  approval_status: z.string(),
  caption: z.string(),
  facebook_page_id: z.uuid(),
  id: z.uuid(),
  image_url: z.string().nullable(),
  meta_page_id: z.string().nullable(),
  post_type: z.enum(["text", "single_image"]),
  processing_lock: z.uuid(),
  product_id: z.uuid().nullable(),
  retry_count: z.number().int().nonnegative(),
  scheduled_at: z.string(),
  status: z.string(),
});
const pageRowSchema = z.object({
  active: z.boolean(),
  id: z.uuid(),
  meta_page_id: z.string(),
});
const productRowSchema = z.object({
  active: z.boolean(),
  id: z.uuid(),
  stock_quantity: z.number().int().nonnegative(),
  stock_status: z.string(),
});
const attemptRowSchema = z.object({
  attempt_number: z.number().int().positive(),
  id: z.uuid(),
  idempotency_key: z.string(),
});

function mapPost(row: z.infer<typeof publicationPostRowSchema>): PublicationPost {
  return {
    approvalStatus: row.approval_status,
    caption: row.caption,
    facebookPageId: row.facebook_page_id,
    id: row.id,
    imageUrl: row.image_url,
    metaPageId: row.meta_page_id,
    postType: row.post_type,
    processingLock: row.processing_lock,
    productId: row.product_id,
    retryCount: row.retry_count,
    scheduledAt: row.scheduled_at,
    status: row.status,
  };
}

function expectUpdated(rows: unknown[]): void {
  const parsed = z.array(z.object({ id: z.uuid() })).safeParse(rows);
  if (!parsed.success || parsed.data.length !== 1) throw new DatabaseError(409);
}

export class SupabasePublicationStore implements PublicationStore {
  constructor(private readonly database: SupabaseDatabase) {}

  async loadSettings(): Promise<PublicationSettings> {
    // Safety switches are deliberately read fresh before every batch and post.
    // Cross-invocation caching could delay an emergency shutdown.
    const rows = await this.database.select<unknown>("automation_settings", {
      select: "key,value",
      key: "in.(global_automation_enabled,maintenance_mode,maximum_daily_posts,maximum_image_size_bytes,posting_enabled)",
    });
    return parsePublicationSettings(rows);
  }

  async recoverStaleClaims(now: Date): Promise<number> {
    const result = await this.database.rpc<unknown>(
      "recover_stale_facebook_post_claims",
      { p_now: now.toISOString() },
    );
    const parsed = z.number().int().nonnegative().safeParse(result);
    if (!parsed.success) throw new DatabaseError(502);
    return parsed.data;
  }

  async claimDuePosts(limit: number, now: Date): Promise<PublicationPost[]> {
    const result = await this.database.rpc<unknown>("claim_due_facebook_posts", {
      p_limit: limit,
      p_now: now.toISOString(),
    });
    const parsed = z.array(publicationPostRowSchema).safeParse(result);
    if (!parsed.success) throw new DatabaseError(502);
    return parsed.data.map(mapPost);
  }

  async loadPage(id: string): Promise<PublicationPage | null> {
    const rows = await this.database.select<unknown>("facebook_pages", {
      select: "id,meta_page_id,active",
      id: `eq.${id}`,
      limit: "1",
    });
    if (rows.length === 0) return null;
    const parsed = pageRowSchema.safeParse(rows[0]);
    if (!parsed.success) throw new DatabaseError(502);
    return {
      active: parsed.data.active,
      id: parsed.data.id,
      metaPageId: parsed.data.meta_page_id,
    };
  }

  async loadProduct(id: string): Promise<PublicationProduct | null> {
    const rows = await this.database.select<unknown>("products", {
      select: "id,active,stock_quantity,stock_status",
      id: `eq.${id}`,
      limit: "1",
    });
    if (rows.length === 0) return null;
    const parsed = productRowSchema.safeParse(rows[0]);
    if (!parsed.success) throw new DatabaseError(502);
    return {
      active: parsed.data.active,
      id: parsed.data.id,
      stockQuantity: parsed.data.stock_quantity,
      stockStatus: parsed.data.stock_status,
    };
  }

  async countPublishedPosts(
    facebookPageId: string,
    start: Date,
    end: Date,
    stopAfter: number,
  ): Promise<number> {
    const rows = await this.database.select<unknown>("facebook_posts", {
      select: "id",
      facebook_page_id: `eq.${facebookPageId}`,
      status: "eq.published",
      and: `(published_at.gte.${start.toISOString()},published_at.lt.${end.toISOString()})`,
      limit: String(stopAfter),
    });
    const parsed = z.array(z.object({ id: z.uuid() })).safeParse(rows);
    if (!parsed.success) throw new DatabaseError(502);
    return parsed.data.length;
  }

  async beginAttempt(post: PublicationPost, now: Date): Promise<PublicationAttempt> {
    const attemptNumber = post.retryCount + 1;
    const idempotencyKey = `facebook-post:${post.id}:attempt:${attemptNumber}`;
    const rows = await this.database.insert<unknown>("post_publication_attempts", {
      facebook_post_id: post.id,
      attempt_number: attemptNumber,
      idempotency_key: idempotencyKey,
      status: "started",
      started_at: now.toISOString(),
    });
    const parsed = z.array(attemptRowSchema).length(1).safeParse(rows);
    if (!parsed.success) throw new DatabaseError(502);
    const row = parsed.data[0];
    if (row === undefined) throw new DatabaseError(502);
    return {
      attemptNumber: row.attempt_number,
      id: row.id,
      idempotencyKey: row.idempotency_key,
    };
  }

  async completeSuccess(
    post: PublicationPost,
    attempt: PublicationAttempt,
    result: MetaPublicationResult,
    now: Date,
  ): Promise<void> {
    await this.database.update("post_publication_attempts", { id: `eq.${attempt.id}` }, {
      status: "succeeded",
      meta_post_id: result.metaPostId,
      completed_at: now.toISOString(),
    });
    const rows = await this.database.updateReturning<unknown>("facebook_posts", {
      id: `eq.${post.id}`,
      processing_lock: `eq.${post.processingLock}`,
      status: "eq.processing",
    }, {
      status: "published",
      published_at: now.toISOString(),
      meta_post_id: result.metaPostId,
      last_error: null,
      next_retry_at: null,
      processing_lock: null,
      locked_at: null,
    });
    expectUpdated(rows);
    await this.database.update("automation_failures", {
      related_entity_type: "eq.facebook_post",
      related_entity_id: `eq.${post.id}`,
      resolved_at: "is.null",
    }, {
      resolved_at: now.toISOString(),
      human_review_required: false,
    });
    await this.database.insert("audit_logs", {
      action: "facebook_post_published",
      actor_type: "system",
      entity_type: "facebook_post",
      entity_id: post.id,
      metadata: { attempt_number: attempt.attemptNumber },
    });
  }

  async completeFailure(
    post: PublicationPost,
    attempt: PublicationAttempt | null,
    error: PublicationError,
    nextRetryAt: Date | null,
    now: Date,
  ): Promise<void> {
    if (attempt !== null) {
      await this.database.update("post_publication_attempts", { id: `eq.${attempt.id}` }, {
        status: "failed",
        error_code: error.code,
        error_category: error.category,
        redacted_error_message: error.code,
        completed_at: now.toISOString(),
      });
    }
    const rows = await this.database.updateReturning<unknown>("facebook_posts", {
      id: `eq.${post.id}`,
      processing_lock: `eq.${post.processingLock}`,
      status: "eq.processing",
    }, {
      status: "failed",
      retry_count: post.retryCount + 1,
      last_error: error.code,
      next_retry_at: nextRetryAt?.toISOString() ?? null,
      processing_lock: null,
      locked_at: null,
    });
    expectUpdated(rows);

    const retryable = error.retryable && nextRetryAt !== null;
    const humanReviewRequired = error.humanReviewRequired || !retryable;
    await this.database.insert("automation_failures", {
      operation: "facebook_post.publish",
      related_entity_type: "facebook_post",
      related_entity_id: post.id,
      retryable,
      retry_count: post.retryCount + 1,
      maximum_retries: 3,
      last_retry_at: post.retryCount === 0 ? null : now.toISOString(),
      next_retry_at: nextRetryAt?.toISOString() ?? null,
      error_code: error.code,
      error_category: error.category,
      redacted_error_message: error.code,
      human_review_required: humanReviewRequired,
    });
    await this.database.insert("audit_logs", {
      action: retryable ? "facebook_post_retry_scheduled" : "facebook_post_publication_failed",
      actor_type: "system",
      entity_type: "facebook_post",
      entity_id: post.id,
      metadata: {
        attempt_number: attempt?.attemptNumber ?? null,
        error_category: error.category,
        retryable,
      },
    });
  }

  async deferPost(
    post: PublicationPost,
    nextAttemptAt: Date | null,
    reason: string,
    now: Date,
  ): Promise<void> {
    const rows = await this.database.updateReturning<unknown>("facebook_posts", {
      id: `eq.${post.id}`,
      processing_lock: `eq.${post.processingLock}`,
      status: "eq.processing",
    }, {
      status: "scheduled",
      next_retry_at: nextAttemptAt?.toISOString() ?? null,
      processing_lock: null,
      locked_at: null,
    });
    expectUpdated(rows);
    await this.database.insert("audit_logs", {
      action: "facebook_post_publication_deferred",
      actor_type: "system",
      entity_type: "facebook_post",
      entity_id: post.id,
      metadata: {
        next_attempt_at: nextAttemptAt?.toISOString() ?? null,
        reason,
        deferred_at: now.toISOString(),
      },
    });
  }
}
