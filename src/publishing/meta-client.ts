import { z } from "zod";
import type { AppConfig } from "../config/env";
import type {
  MetaPostPublisher,
  MetaPublicationResult,
  PublicationPage,
  PublicationPost,
} from "./contracts";
import { PublicationError } from "./contracts";

const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const metaSuccessSchema = z.object({
  id: z.string().min(1),
  post_id: z.string().min(1).optional(),
});
const metaErrorSchema = z.object({
  error: z.object({
    code: z.union([z.number(), z.string()]).optional(),
    error_subcode: z.union([z.number(), z.string()]).optional(),
  }),
});

type Fetcher = typeof fetch;

function contentType(response: Response): string | null {
  const value = response.headers.get("content-type");
  return value === null ? null : value.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function parseContentLength(response: Response): number | null {
  const contentRange = response.headers.get("content-range");
  const totalFromRange = contentRange?.match(/\/(\d+)$/)?.[1];
  if (totalFromRange !== undefined) {
    const total = Number(totalFromRange);
    if (Number.isSafeInteger(total)) return total;
  }
  const raw = response.headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function classifyMetaFailure(status: number, body: unknown): PublicationError {
  const parsed = metaErrorSchema.safeParse(body);
  const upstreamCode = parsed.success
    ? String(parsed.data.error.error_subcode ?? parsed.data.error.code ?? status)
    : String(status);

  if (status === 429) {
    return new PublicationError(
      `meta_rate_limited_${upstreamCode}`,
      "meta_rate_limit",
      true,
      false,
    );
  }
  if (status === 401 || status === 403) {
    return new PublicationError(
      `meta_authentication_${upstreamCode}`,
      "authentication",
      false,
      true,
    );
  }
  if (status >= 500) {
    return new PublicationError(
      `meta_transient_${upstreamCode}`,
      "meta_transient",
      true,
      false,
    );
  }
  return new PublicationError(
    `meta_rejected_${upstreamCode}`,
    "meta_rejected",
    false,
    true,
  );
}

export class MetaGraphPostPublisher implements MetaPostPublisher {
  private readonly graphBaseUrl: string;

  constructor(
    private readonly config: Pick<
      AppConfig,
      "META_GRAPH_API_VERSION" | "META_PAGE_ACCESS_TOKEN" | "META_PAGE_ID" | "SUPABASE_URL"
    >,
    private readonly fetcher: Fetcher = fetch,
  ) {
    this.graphBaseUrl = `https://graph.facebook.com/${config.META_GRAPH_API_VERSION}`;
  }

  private async validateImage(imageUrl: string, maximumImageSizeBytes: number): Promise<void> {
    let url: URL;
    try {
      url = new URL(imageUrl);
    } catch {
      throw new PublicationError("image_url_invalid", "validation", false, true);
    }
    if (url.protocol !== "https:") {
      throw new PublicationError("image_url_must_use_https", "validation", false, true);
    }
    const storageOrigin = new URL(this.config.SUPABASE_URL).origin;
    if (
      url.origin !== storageOrigin ||
      !url.pathname.startsWith("/storage/v1/object/public/product-images/")
    ) {
      throw new PublicationError("image_url_not_approved_storage", "validation", false, true);
    }

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 405 || response.status === 501) {
        response = await this.fetcher(url, {
          headers: { range: "bytes=0-0" },
          redirect: "follow",
          signal: AbortSignal.timeout(10_000),
        });
        await response.body?.cancel();
      }
    } catch {
      throw new PublicationError("image_unreachable", "image_access", true, false);
    }

    if (!response.ok) {
      throw new PublicationError("image_unreachable", "image_access", true, false);
    }
    if (response.url !== "" && new URL(response.url).protocol !== "https:") {
      throw new PublicationError("image_redirect_insecure", "validation", false, true);
    }
    const mimeType = contentType(response);
    if (mimeType === null || !supportedImageTypes.has(mimeType)) {
      throw new PublicationError("image_type_unsupported", "validation", false, true);
    }
    const size = parseContentLength(response);
    if (size === null) {
      throw new PublicationError("image_size_unknown", "validation", false, true);
    }
    if (size <= 0 || size > maximumImageSizeBytes) {
      throw new PublicationError("image_size_invalid", "validation", false, true);
    }
  }

  async publish(
    post: PublicationPost,
    page: PublicationPage,
    maximumImageSizeBytes: number,
  ): Promise<MetaPublicationResult> {
    if (page.metaPageId !== this.config.META_PAGE_ID || post.metaPageId !== page.metaPageId) {
      throw new PublicationError("meta_page_mismatch", "configuration", false, true);
    }

    const fields = new URLSearchParams({
      access_token: this.config.META_PAGE_ACCESS_TOKEN,
    });
    let endpoint: string;
    if (post.postType === "single_image") {
      if (post.imageUrl === null) {
        throw new PublicationError("image_url_missing", "validation", false, true);
      }
      await this.validateImage(post.imageUrl, maximumImageSizeBytes);
      endpoint = `${this.graphBaseUrl}/${encodeURIComponent(page.metaPageId)}/photos`;
      fields.set("caption", post.caption);
      fields.set("published", "true");
      fields.set("url", post.imageUrl);
    } else {
      endpoint = `${this.graphBaseUrl}/${encodeURIComponent(page.metaPageId)}/feed`;
      fields.set("message", post.caption);
    }

    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: fields,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // A transport failure after the request starts has an unknown publication
      // outcome. Automatic retry could create a duplicate post.
      throw new PublicationError(
        "meta_transport_outcome_unknown",
        "meta_transport_unknown",
        false,
        true,
      );
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) throw classifyMetaFailure(response.status, body);
    const parsed = metaSuccessSchema.safeParse(body);
    if (!parsed.success) {
      throw new PublicationError(
        "meta_success_response_invalid",
        "meta_response",
        false,
        true,
      );
    }
    return { metaPostId: parsed.data.post_id ?? parsed.data.id };
  }
}
