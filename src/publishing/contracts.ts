import type { Logger } from "../logging/logger";

export interface PublicationSettings {
  globalEnabled: boolean;
  maintenanceMode: boolean;
  maximumDailyPosts: number;
  maximumImageSizeBytes: number;
  postingEnabled: boolean;
}

export interface PublicationPost {
  approvalStatus: string;
  caption: string;
  facebookPageId: string;
  id: string;
  imageUrl: string | null;
  metaPageId: string | null;
  postType: "single_image" | "text";
  processingLock: string;
  productId: string | null;
  retryCount: number;
  scheduledAt: string;
  status: string;
}

export interface PublicationPage {
  active: boolean;
  id: string;
  metaPageId: string;
}

export interface PublicationProduct {
  active: boolean;
  id: string;
  stockQuantity: number;
  stockStatus: string;
}

export interface PublicationAttempt {
  attemptNumber: number;
  id: string;
  idempotencyKey: string;
}

export interface MetaPublicationResult {
  metaPostId: string;
}

export type PublicationErrorCategory =
  | "authentication"
  | "configuration"
  | "image_access"
  | "meta_rate_limit"
  | "meta_rejected"
  | "meta_response"
  | "meta_transient"
  | "meta_transport_unknown"
  | "validation";

export class PublicationError extends Error {
  constructor(
    readonly code: string,
    readonly category: PublicationErrorCategory,
    readonly retryable: boolean,
    readonly humanReviewRequired: boolean,
    message = code,
  ) {
    super(message);
    this.name = "PublicationError";
  }
}

export interface PublicationStore {
  beginAttempt(post: PublicationPost, now: Date): Promise<PublicationAttempt>;
  completeFailure(
    post: PublicationPost,
    attempt: PublicationAttempt | null,
    error: PublicationError,
    nextRetryAt: Date | null,
    now: Date,
  ): Promise<void>;
  completeSuccess(
    post: PublicationPost,
    attempt: PublicationAttempt,
    result: MetaPublicationResult,
    now: Date,
  ): Promise<void>;
  countPublishedPosts(
    facebookPageId: string,
    start: Date,
    end: Date,
    stopAfter: number,
  ): Promise<number>;
  claimDuePosts(limit: number, now: Date): Promise<PublicationPost[]>;
  deferPost(
    post: PublicationPost,
    nextAttemptAt: Date | null,
    reason: string,
    now: Date,
  ): Promise<void>;
  loadPage(id: string): Promise<PublicationPage | null>;
  loadProduct(id: string): Promise<PublicationProduct | null>;
  loadSettings(): Promise<PublicationSettings>;
  recoverStaleClaims(now: Date): Promise<number>;
}

export interface MetaPostPublisher {
  publish(
    post: PublicationPost,
    page: PublicationPage,
    maximumImageSizeBytes: number,
  ): Promise<MetaPublicationResult>;
}

export interface ScheduledPublishingResult {
  claimed: number;
  deferred: number;
  failed: number;
  published: number;
  recovered: number;
  skipped: "database_disabled" | "environment_disabled" | null;
}

export interface PublishingLogger extends Pick<Logger, "error" | "info" | "warn"> {}
