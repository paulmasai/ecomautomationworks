import { describe, expect, it, vi } from "vitest";
import { MetaGraphPostPublisher } from "../src/publishing/meta-client";
import {
  PublicationError,
  type MetaPostPublisher,
  type MetaPublicationResult,
  type PublicationAttempt,
  type PublicationPage,
  type PublicationPost,
  type PublicationProduct,
  type PublicationSettings,
  type PublicationStore,
} from "../src/publishing/contracts";
import { runScheduledPublishing } from "../src/publishing/publisher";

const now = new Date("2026-08-26T12:00:00.000Z");
const page: PublicationPage = {
  active: true,
  id: "10000000-0000-4000-8000-000000000001",
  metaPageId: "page-123",
};
const post: PublicationPost = {
  approvalStatus: "approved",
  caption: "A safe scheduled post",
  facebookPageId: page.id,
  id: "20000000-0000-4000-8000-000000000001",
  imageUrl: null,
  metaPageId: page.metaPageId,
  postType: "text",
  processingLock: "30000000-0000-4000-8000-000000000001",
  productId: null,
  retryCount: 0,
  scheduledAt: "2026-08-26T11:00:00.000Z",
  status: "processing",
};
const enabledSettings: PublicationSettings = {
  globalEnabled: true,
  maintenanceMode: false,
  maximumDailyPosts: 4,
  maximumImageSizeBytes: 8 * 1024 * 1024,
  postingEnabled: true,
};
const attempt: PublicationAttempt = {
  attemptNumber: 1,
  id: "40000000-0000-4000-8000-000000000001",
  idempotencyKey: `facebook-post:${post.id}:attempt:1`,
};

class FakePublicationStore implements PublicationStore {
  settings = enabledSettings;
  posts = [post];
  page: PublicationPage | null = page;
  product: PublicationProduct | null = null;
  publishedToday = 0;
  recovered = 0;
  settingsReads = 0;
  claims = 0;
  readonly successes: MetaPublicationResult[] = [];
  readonly failures: Array<{ error: PublicationError; nextRetryAt: Date | null }> = [];
  readonly deferrals: Array<{ nextAttemptAt: Date | null; reason: string }> = [];

  async loadSettings() {
    this.settingsReads += 1;
    return this.settings;
  }
  async recoverStaleClaims() {
    return this.recovered;
  }
  async claimDuePosts() {
    this.claims += 1;
    return this.posts;
  }
  async loadPage() {
    return this.page;
  }
  async loadProduct() {
    return this.product;
  }
  async countPublishedPosts() {
    return this.publishedToday;
  }
  async beginAttempt() {
    return attempt;
  }
  async completeSuccess(
    _post: PublicationPost,
    _attempt: PublicationAttempt,
    result: MetaPublicationResult,
  ) {
    this.successes.push(result);
  }
  async completeFailure(
    _post: PublicationPost,
    _attempt: PublicationAttempt | null,
    error: PublicationError,
    nextRetryAt: Date | null,
  ) {
    this.failures.push({ error, nextRetryAt });
  }
  async deferPost(
    _post: PublicationPost,
    nextAttemptAt: Date | null,
    reason: string,
  ) {
    this.deferrals.push({ nextAttemptAt, reason });
  }
}

class FakeMetaPublisher implements MetaPostPublisher {
  error: PublicationError | null = null;
  calls = 0;

  async publish(): Promise<MetaPublicationResult> {
    this.calls += 1;
    if (this.error !== null) throw this.error;
    return { metaPostId: "page-123_987" };
  }
}

const logger = {
  error() {},
  info() {},
  warn() {},
};

describe("scheduled publishing", () => {
  it("recovers stale claims but does not claim posts when the environment gate is off", async () => {
    const store = new FakePublicationStore();
    store.recovered = 2;
    const result = await runScheduledPublishing({
      config: { OUTBOUND_ACTIONS_ENABLED: false },
      logger,
      metaPublisher: new FakeMetaPublisher(),
      store,
    }, now);

    expect(result).toMatchObject({ recovered: 2, skipped: "environment_disabled" });
    expect(store.settingsReads).toBe(0);
    expect(store.claims).toBe(0);
  });

  it("honors fresh database kill switches before claiming", async () => {
    const store = new FakePublicationStore();
    store.settings = { ...enabledSettings, maintenanceMode: true };
    const result = await runScheduledPublishing({
      config: { OUTBOUND_ACTIONS_ENABLED: true }, logger, metaPublisher: new FakeMetaPublisher(), store,
    }, now);

    expect(result.skipped).toBe("database_disabled");
    expect(store.claims).toBe(0);
  });

  it("publishes an eligible post and records success", async () => {
    const store = new FakePublicationStore();
    const metaPublisher = new FakeMetaPublisher();
    const result = await runScheduledPublishing({
      config: { OUTBOUND_ACTIONS_ENABLED: true }, logger, metaPublisher, store,
    }, now);

    expect(result).toMatchObject({ claimed: 1, published: 1, failed: 0 });
    expect(metaPublisher.calls).toBe(1);
    expect(store.settingsReads).toBe(2);
    expect(store.successes).toEqual([{ metaPostId: "page-123_987" }]);
  });

  it("defers a post to the next UTC day after reaching the daily limit", async () => {
    const store = new FakePublicationStore();
    store.publishedToday = enabledSettings.maximumDailyPosts;
    const metaPublisher = new FakeMetaPublisher();
    const result = await runScheduledPublishing({
      config: { OUTBOUND_ACTIONS_ENABLED: true }, logger, metaPublisher, store,
    }, now);

    expect(result.deferred).toBe(1);
    expect(metaPublisher.calls).toBe(0);
    expect(store.deferrals[0]?.reason).toBe("daily_limit");
    expect(store.deferrals[0]?.nextAttemptAt?.toISOString()).toBe("2026-08-27T00:01:00.000Z");
  });

  it("rejects an unavailable linked product without calling Meta", async () => {
    const store = new FakePublicationStore();
    store.posts = [{ ...post, productId: "50000000-0000-4000-8000-000000000001" }];
    store.product = {
      active: true,
      id: "50000000-0000-4000-8000-000000000001",
      stockQuantity: 0,
      stockStatus: "out_of_stock",
    };
    const metaPublisher = new FakeMetaPublisher();
    const result = await runScheduledPublishing({
      config: { OUTBOUND_ACTIONS_ENABLED: true }, logger, metaPublisher, store,
    }, now);

    expect(result.failed).toBe(1);
    expect(metaPublisher.calls).toBe(0);
    expect(store.failures[0]?.error.code).toBe("product_unavailable");
    expect(store.failures[0]?.nextRetryAt).toBeNull();
  });

  it("uses bounded backoff for retryable Meta failures", async () => {
    const store = new FakePublicationStore();
    const metaPublisher = new FakeMetaPublisher();
    metaPublisher.error = new PublicationError("meta_rate_limited_4", "meta_rate_limit", true, false);
    await runScheduledPublishing({
      config: { OUTBOUND_ACTIONS_ENABLED: true }, logger, metaPublisher, store,
    }, now);

    expect(store.failures[0]?.nextRetryAt?.toISOString()).toBe("2026-08-26T12:05:00.000Z");
  });

  it("stops automatic retries after the third failed attempt", async () => {
    const store = new FakePublicationStore();
    store.posts = [{ ...post, retryCount: 2 }];
    const metaPublisher = new FakeMetaPublisher();
    metaPublisher.error = new PublicationError("meta_transient_500", "meta_transient", true, false);
    await runScheduledPublishing({
      config: { OUTBOUND_ACTIONS_ENABLED: true }, logger, metaPublisher, store,
    }, now);

    expect(store.failures[0]?.nextRetryAt).toBeNull();
  });
});

describe("Meta Graph post publisher", () => {
  const config = {
    META_GRAPH_API_VERSION: "v99.0",
    META_PAGE_ACCESS_TOKEN: "secret-page-token-123456789",
    META_PAGE_ID: page.metaPageId,
    SUPABASE_URL: "https://project.supabase.co",
  };

  it("publishes a text post through the Page feed endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ id: "page-123_987" }),
    );
    const publisher = new MetaGraphPostPublisher(config, fetcher);

    await expect(publisher.publish(post, page, 8 * 1024 * 1024)).resolves.toEqual({
      metaPostId: "page-123_987",
    });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://graph.facebook.com/v99.0/page-123/feed");
    expect(init?.method).toBe("POST");
    expect((init?.body as URLSearchParams).get("message")).toBe(post.caption);
  });

  it("validates a single image before using the Page photos endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: { "content-length": "2048", "content-type": "image/jpeg" },
      }))
      .mockResolvedValueOnce(Response.json({ id: "photo-1", post_id: "page-123_456" }));
    const publisher = new MetaGraphPostPublisher(config, fetcher);
    const imagePost = {
      ...post,
      imageUrl: "https://project.supabase.co/storage/v1/object/public/product-images/product.jpg",
      postType: "single_image" as const,
    };

    await expect(publisher.publish(imagePost, page, 4096)).resolves.toEqual({
      metaPostId: "page-123_456",
    });
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("HEAD");
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://graph.facebook.com/v99.0/page-123/photos");
  });

  it("blocks unsupported image types before any Meta request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "content-length": "2048", "content-type": "image/svg+xml" },
      }),
    );
    const publisher = new MetaGraphPostPublisher(config, fetcher);

    await expect(publisher.publish({
      ...post,
      imageUrl: "https://project.supabase.co/storage/v1/object/public/product-images/product.svg",
      postType: "single_image",
    }, page, 4096)).rejects.toMatchObject({ code: "image_type_unsupported" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses the total Content-Range size when HEAD falls back to a ranged GET", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0]), {
        status: 206,
        headers: {
          "content-length": "1",
          "content-range": "bytes 0-0/9000",
          "content-type": "image/jpeg",
        },
      }));
    const publisher = new MetaGraphPostPublisher(config, fetcher);

    await expect(publisher.publish({
      ...post,
      imageUrl: "https://project.supabase.co/storage/v1/object/public/product-images/product.jpg",
      postType: "single_image",
    }, page, 4096)).rejects.toMatchObject({ code: "image_size_invalid" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("marks a transport failure as an unknown outcome instead of auto-retrying", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("network"));
    const publisher = new MetaGraphPostPublisher(config, fetcher);

    await expect(publisher.publish(post, page, 4096)).rejects.toMatchObject({
      code: "meta_transport_outcome_unknown",
      humanReviewRequired: true,
      retryable: false,
    });
  });
});
