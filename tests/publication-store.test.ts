import { describe, expect, it } from "vitest";
import { DatabaseError, type SupabaseDatabase } from "../src/database/supabase";
import type { PublicationPost } from "../src/publishing/contracts";
import { parsePublicationSettings } from "../src/publishing/settings";
import { SupabasePublicationStore } from "../src/publishing/supabase-store";

const post: PublicationPost = {
  approvalStatus: "approved",
  caption: "Scheduled post",
  facebookPageId: "10000000-0000-4000-8000-000000000001",
  id: "20000000-0000-4000-8000-000000000001",
  imageUrl: null,
  metaPageId: "page-123",
  postType: "text",
  processingLock: "30000000-0000-4000-8000-000000000001",
  productId: null,
  retryCount: 1,
  scheduledAt: "2026-08-26T11:00:00.000Z",
  status: "processing",
};

class AttemptDatabase {
  readonly keys = new Set<string>();

  async insert(_table: string, body: unknown): Promise<unknown[]> {
    const input = body as { attempt_number: number; idempotency_key: string };
    if (this.keys.has(input.idempotency_key)) throw new DatabaseError(409);
    this.keys.add(input.idempotency_key);
    return [{
      attempt_number: input.attempt_number,
      id: "40000000-0000-4000-8000-000000000001",
      idempotency_key: input.idempotency_key,
    }];
  }
}

describe("publication settings", () => {
  it("accepts typed JSON safety controls and limits", () => {
    expect(parsePublicationSettings([
      { key: "global_automation_enabled", value: true },
      { key: "maintenance_mode", value: false },
      { key: "maximum_daily_posts", value: 4 },
      { key: "maximum_image_size_bytes", value: 8_388_608 },
      { key: "posting_enabled", value: true },
    ])).toEqual({
      globalEnabled: true,
      maintenanceMode: false,
      maximumDailyPosts: 4,
      maximumImageSizeBytes: 8_388_608,
      postingEnabled: true,
    });
  });

  it("fails closed when a database switch has the wrong JSON type", () => {
    expect(() => parsePublicationSettings([
      { key: "global_automation_enabled", value: "true" },
      { key: "maintenance_mode", value: false },
      { key: "maximum_daily_posts", value: 4 },
      { key: "maximum_image_size_bytes", value: 8_388_608 },
      { key: "posting_enabled", value: true },
    ])).toThrowError(expect.objectContaining({ code: "automation_setting_invalid" }));
  });
});

describe("publication attempt ledger", () => {
  it("uses a deterministic unique key and blocks the same attempt twice", async () => {
    const database = new AttemptDatabase();
    const store = new SupabasePublicationStore(database as unknown as SupabaseDatabase);

    await expect(store.beginAttempt(post, new Date("2026-08-26T12:00:00.000Z"))).resolves.toMatchObject({
      attemptNumber: 2,
      idempotencyKey: `facebook-post:${post.id}:attempt:2`,
    });
    await expect(store.beginAttempt(post, new Date("2026-08-26T12:00:01.000Z"))).rejects.toMatchObject({
      status: 409,
    });
  });
});
