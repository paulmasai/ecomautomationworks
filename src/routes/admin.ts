import { z } from "zod";
import {
  StaffAuthError,
  authenticateStaff,
  permissionsForRole,
  requirePermission,
  requirePrivilegedMfa,
  staffRoles,
  validateSupabaseUser,
  type StaffSession,
} from "../auth/staff-auth";
import type { AppConfig } from "../config/env";
import { DatabaseError, SupabaseDatabase } from "../database/supabase";
import type { Logger } from "../logging/logger";
import { constantTimeStringEqual } from "../security/constant-time";
import { consumeAdminRequest } from "../security/rate-limit";
import { jsonResponse } from "../utilities/http";
import { completionSchema } from "../privacy/requests";
import { BodyError, readLimitedBody } from "../privacy/body";

const uuid = z.uuid();
const staffRoleSchema = z.enum(staffRoles);

const postDraftSchema = z.object({
  caption: z.string().trim().min(1).max(5_000),
  postType: z.enum(["text", "single_image"]),
  productId: z.uuid().nullable().optional(),
  imageUrl: z.url().nullable().optional(),
  scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
}).superRefine((value, context) => {
  if (value.postType === "single_image" && value.imageUrl == null) {
    context.addIssue({ code: "custom", message: "An image URL is required" });
  }
});

const automationSchema = z.object({
  enabled: z.boolean(),
  confirmation: z.literal("ENABLE").optional(),
});

const inviteSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  role: staffRoleSchema,
});

const teamUpdateSchema = z.object({
  role: staffRoleSchema.optional(),
  status: z.enum(["active", "suspended"]).optional(),
}).refine((value) => value.role !== undefined || value.status !== undefined);

const pageRowSchema = z.object({
  active: z.boolean(),
  id: z.uuid(),
  meta_page_id: z.string(),
  name: z.string(),
});
const productRowSchema = z.object({
  active: z.boolean(),
  category: z.string().nullable(),
  currency: z.string(),
  id: z.uuid(),
  name: z.string(),
  price: z.union([z.number(), z.string()]),
  stock_quantity: z.number(),
  stock_status: z.string(),
});
const postRowSchema = z.object({
  approval_status: z.string(),
  caption: z.string(),
  id: z.uuid(),
  post_type: z.enum(["text", "single_image"]),
  product_id: z.uuid().nullable(),
  scheduled_at: z.string().nullable(),
  status: z.string(),
});
const failureRowSchema = z.object({
  created_at: z.string(),
  error_category: z.string(),
  human_review_required: z.boolean(),
  id: z.uuid(),
  operation: z.string(),
  retry_count: z.number(),
  retryable: z.boolean(),
});
const auditRowSchema = z.object({
  action: z.string(),
  actor_identifier: z.string().nullable(),
  actor_type: z.string(),
  created_at: z.string(),
  entity_type: z.string().nullable(),
  id: z.uuid(),
  metadata: z.record(z.string(), z.unknown()),
});
const staffRowSchema = z.object({
  display_name: z.string(),
  email: z.string(),
  id: z.uuid(),
  last_signed_in_at: z.string().nullable(),
  role: staffRoleSchema,
  status: z.enum(["invited", "active", "suspended"]),
  user_id: z.uuid(),
});

const automationKeys = [
  "global_automation_enabled",
  "posting_enabled",
  "comment_replies_enabled",
  "messenger_replies_enabled",
] as const;

class AdminRouteError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 503, readonly code: string) {
    super(code);
    this.name = "AdminRouteError";
  }
}

interface AdminDependencies {
  config: AppConfig;
  database: SupabaseDatabase;
  logger: Logger;
  requestId: string;
}

function capabilities() {
  return {
    scheduledPublishing: true,
    commentAutomation: false,
    messengerAutomation: false,
    manualPublish: true,
  };
}

function sessionPayload(session: StaffSession) {
  return {
    profile: session.profile,
    permissions: session.permissions,
    assuranceLevel: session.assuranceLevel,
    capabilities: capabilities(),
  };
}

function parseRows<T>(rows: unknown[], schema: z.ZodType<T>): T[] {
  const result = z.array(schema).safeParse(rows);
  if (!result.success) throw new AdminRouteError(503, "dashboard_data_invalid");
  return result.data;
}

function mapProducts(rows: unknown[]) {
  return parseRows(rows, productRowSchema).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    currency: row.currency,
    stockQuantity: row.stock_quantity,
    stockStatus: row.stock_status,
    active: row.active,
  }));
}

function mapPosts(rows: unknown[], productNames: ReadonlyMap<string, string>) {
  return parseRows(rows, postRowSchema).map((row) => ({
    id: row.id,
    caption: row.caption,
    productName: row.product_id === null ? null : productNames.get(row.product_id) ?? null,
    postType: row.post_type,
    status: row.status,
    approvalStatus: row.approval_status,
    scheduledAt: row.scheduled_at,
  }));
}

function mapFailures(rows: unknown[]) {
  return parseRows(rows, failureRowSchema).map((row) => ({
    id: row.id,
    operation: row.operation,
    errorCategory: row.error_category,
    retryable: row.retryable,
    retryCount: row.retry_count,
    humanReviewRequired: row.human_review_required,
    createdAt: row.created_at,
  }));
}

function activityTone(action: string): "danger" | "info" | "success" | "warning" {
  if (/fail|reject|suspend/i.test(action)) return "danger";
  if (/pause|retry|handoff/i.test(action)) return "warning";
  if (/publish|approve|resolve|create/i.test(action)) return "success";
  return "info";
}

function mapAudit(rows: unknown[]) {
  return parseRows(rows, auditRowSchema).map((row) => ({
    id: row.id,
    action: row.action.replaceAll("_", " "),
    actor: row.actor_identifier ?? row.actor_type,
    detail: row.entity_type === null ? "Administrative operation" : `Updated ${row.entity_type.replaceAll("_", " ")}`,
    createdAt: row.created_at,
    tone: activityTone(row.action),
  }));
}

function mapTeam(rows: unknown[]) {
  return parseRows(rows, staffRowSchema).map((row) => ({
    id: row.id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    lastSignedInAt: row.last_signed_in_at,
  }));
}

async function writeAudit(
  database: SupabaseDatabase,
  session: StaffSession,
  requestId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await database.insert("audit_logs", {
    action,
    actor_type: "administrator",
    actor_identifier: session.profile.userId,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
    request_id: requestId,
  });
}

async function readProducts(database: SupabaseDatabase): Promise<ReturnType<typeof mapProducts>> {
  return mapProducts(await database.select("products", {
    select: "id,name,category,price,currency,stock_quantity,stock_status,active",
    order: "updated_at.desc",
    limit: "100",
  }));
}

async function readPosts(database: SupabaseDatabase): Promise<ReturnType<typeof mapPosts>> {
  const [postRows, productRows] = await Promise.all([
    database.select("facebook_posts", {
      select: "id,product_id,caption,post_type,status,approval_status,scheduled_at",
      order: "created_at.desc",
      limit: "100",
    }),
    database.select("products", { select: "id,name", limit: "500" }),
  ]);
  const productResult = z.array(z.object({ id: z.uuid(), name: z.string() })).safeParse(productRows);
  if (!productResult.success) throw new AdminRouteError(503, "dashboard_data_invalid");
  return mapPosts(postRows, new Map(productResult.data.map((row) => [row.id, row.name])));
}

async function readFailures(database: SupabaseDatabase): Promise<ReturnType<typeof mapFailures>> {
  return mapFailures(await database.select("automation_failures", {
    select: "id,operation,error_category,retryable,retry_count,human_review_required,created_at",
    resolved_at: "is.null",
    order: "created_at.desc",
    limit: "100",
  }));
}

async function readAudit(database: SupabaseDatabase): Promise<ReturnType<typeof mapAudit>> {
  return mapAudit(await database.select("audit_logs", {
    select: "id,action,actor_type,actor_identifier,entity_type,metadata,created_at",
    order: "created_at.desc",
    limit: "100",
  }));
}

async function readTeam(database: SupabaseDatabase): Promise<ReturnType<typeof mapTeam>> {
  return mapTeam(await database.select("staff_profiles", {
    select: "id,user_id,email,display_name,role,status,last_signed_in_at",
    order: "created_at.asc",
    limit: "100",
  }));
}

async function handleOverview(dependencies: AdminDependencies, session: StaffSession): Promise<Response> {
  requirePermission(session, "overview.read");
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString();
  const [pageRows, settingRows, posts, failures, audit, commentRows, conversationRows, eventRows] = await Promise.all([
    dependencies.database.select("facebook_pages", { select: "id,meta_page_id,name,active", order: "created_at.asc", limit: "1" }),
    dependencies.database.select("automation_settings", { select: "key,value" }),
    readPosts(dependencies.database),
    readFailures(dependencies.database),
    readAudit(dependencies.database),
    dependencies.database.select("facebook_comments", { select: "id,commenter_name,handoff_reason,created_at", human_handoff_required: "eq.true", order: "created_at.desc", limit: "10" }),
    dependencies.database.select("messenger_conversations", { select: "id,handoff_reason,handoff_at,created_at", human_handoff_required: "eq.true", order: "created_at.desc", limit: "10" }),
    dependencies.database.select("meta_webhook_events", { select: "received_at", received_at: `gte.${since}`, order: "received_at.desc", limit: "500" }),
  ]);

  const pageResult = pageRows.length === 0 ? null : pageRowSchema.safeParse(pageRows[0]);
  if (pageResult !== null && !pageResult.success) throw new AdminRouteError(503, "dashboard_data_invalid");
  const settingsResult = z.array(z.object({ key: z.string(), value: z.unknown() })).safeParse(settingRows);
  const commentsResult = z.array(z.object({ id: z.uuid(), commenter_name: z.string().nullable(), handoff_reason: z.string().nullable(), created_at: z.string() })).safeParse(commentRows);
  const conversationsResult = z.array(z.object({ id: z.uuid(), handoff_reason: z.string().nullable(), handoff_at: z.string().nullable(), created_at: z.string() })).safeParse(conversationRows);
  const eventsResult = z.array(z.object({ received_at: z.string() })).safeParse(eventRows);
  if (!settingsResult.success || !commentsResult.success || !conversationsResult.success || !eventsResult.success) {
    throw new AdminRouteError(503, "dashboard_data_invalid");
  }
  const settings = new Map(settingsResult.data.map((row) => [row.key, row.value]));
  const boolSetting = (key: string) => settings.get(key) === true;
  const trend = new Map<string, number>();
  const formatter = new Intl.DateTimeFormat("en-KE", { weekday: "short", timeZone: "Africa/Nairobi" });
  for (let day = 6; day >= 0; day -= 1) {
    trend.set(formatter.format(new Date(Date.now() - day * 86_400_000)), 0);
  }
  for (const event of eventsResult.data) {
    const label = formatter.format(new Date(event.received_at));
    trend.set(label, (trend.get(label) ?? 0) + 1);
  }
  const handoffs = [
    ...commentsResult.data.map((row) => ({ id: row.id, channel: "comment" as const, customer: row.commenter_name ?? "Facebook commenter", reason: row.handoff_reason ?? "Human review requested", createdAt: row.created_at })),
    ...conversationsResult.data.map((row) => ({ id: row.id, channel: "messenger" as const, customer: "Messenger customer", reason: row.handoff_reason ?? "Human assistance requested", createdAt: row.handoff_at ?? row.created_at })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 10);

  return jsonResponse({
    system: { status: "healthy", environment: dependencies.config.ENVIRONMENT, lastCheckedAt: new Date().toISOString() },
    page: pageResult === null ? null : { id: pageResult.data.id, name: pageResult.data.name, metaPageId: pageResult.data.meta_page_id, active: pageResult.data.active },
    automation: {
      outboundActionsEnabled: dependencies.config.OUTBOUND_ACTIONS_ENABLED,
      globalEnabled: boolSetting("global_automation_enabled"),
      maintenanceMode: boolSetting("maintenance_mode"),
      postingEnabled: boolSetting("posting_enabled"),
      commentRepliesEnabled: boolSetting("comment_replies_enabled"),
      messengerRepliesEnabled: boolSetting("messenger_replies_enabled"),
    },
    counts: {
      awaitingApproval: posts.filter((post) => post.approvalStatus === "pending").length,
      scheduledPosts: posts.filter((post) => ["approved", "scheduled"].includes(post.status)).length,
      failuresReview: failures.filter((failure) => failure.humanReviewRequired).length,
      humanHandoffs: handoffs.length,
    },
    trend: Array.from(trend, ([label, events]) => ({ label, events })),
    scheduledPosts: posts.filter((post) => post.scheduledAt !== null).slice(0, 6),
    failures: failures.slice(0, 6),
    handoffs,
    activity: audit.slice(0, 8),
  });
}

async function handleInvite(request: Request, dependencies: AdminDependencies, session: StaffSession): Promise<Response> {
  requirePermission(session, "team.manage");
  requirePrivilegedMfa(session);
  const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new AdminRouteError(400, "invalid_team_invitation");

  const inviteUrl = new URL(`${dependencies.config.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/invite`);
  inviteUrl.searchParams.set("redirect_to", `${new URL(request.url).origin}/settings`);
  const invitation = await fetch(inviteUrl, {
    method: "POST",
    headers: {
      apikey: dependencies.config.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${dependencies.config.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: parsed.data.email, data: { display_name: parsed.data.displayName } }),
  });
  if (!invitation.ok) throw new AdminRouteError(invitation.status === 422 ? 409 : 503, invitation.status === 422 ? "staff_already_invited" : "staff_invitation_failed");
  const invited = z.object({ id: z.uuid(), email: z.string().optional() }).safeParse(await invitation.json());
  if (!invited.success) throw new AdminRouteError(503, "staff_invitation_failed");

  try {
    const rows = await dependencies.database.insert("staff_profiles", {
      user_id: invited.data.id,
      email: parsed.data.email,
      display_name: parsed.data.displayName,
      role: parsed.data.role,
      status: "invited",
      invited_by_staff_id: session.profile.id,
    });
    const profile = mapTeam(rows)[0];
    if (profile === undefined) throw new AdminRouteError(503, "staff_profile_creation_failed");
    await writeAudit(dependencies.database, session, dependencies.requestId, "staff_invited", "staff_profile", profile.id, { role: profile.role });
    return jsonResponse({ profile }, 201);
  } catch (error) {
    await fetch(`${dependencies.config.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/admin/users/${invited.data.id}`, {
      method: "DELETE",
      headers: { apikey: dependencies.config.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${dependencies.config.SUPABASE_SERVICE_ROLE_KEY}` },
    }).catch(() => undefined);
    throw error;
  }
}

async function routeAuthenticated(request: Request, dependencies: AdminDependencies, session: StaffSession): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice("/api/admin".length) || "/";
  if (!consumeAdminRequest(session.profile.userId)) throw new StaffAuthError(429, "rate_limited");

  if (path === "/privacy/requests" || path.startsWith("/privacy/requests/")) {
    requirePermission(session, "privacy.manage");
    requirePrivilegedMfa(session);
    if (request.method === "GET" && path === "/privacy/requests") {
      const items = await dependencies.database.select("data_deletion_requests", {
        select: "id,source,contact,reference,meta_user_id,meta_app_id,status,created_at,completed_at",
        status: "eq.pending", order: "created_at.asc", limit: "100",
      });
      return jsonResponse({ items });
    }
    const match = path.match(/^\/privacy\/requests\/([0-9a-f-]+)\/complete$/i);
    if (request.method === "POST" && match !== null) {
      const id = uuid.safeParse(match[1]);
      const body = await readLimitedBody(request);
      const parsed = completionSchema.safeParse(JSON.parse(body));
      if (!id.success || !parsed.success) throw new AdminRouteError(400, "invalid_deletion_confirmation");
      if (parsed.data.subjectIds.includes(dependencies.config.META_PAGE_ID)) throw new AdminRouteError(400, "page_id_is_not_a_person");
      const rawResult = await dependencies.database.rpc<unknown>("complete_data_deletion_request", {
        p_request_id: id.data, p_subject_ids: [...new Set(parsed.data.subjectIds)],
        p_verification: parsed.data.verification, p_actor_id: session.profile.userId,
      });
      const result = z.object({ status: z.enum(["completed", "not_found"]) }).parse(rawResult);
      if (result.status === "not_found") throw new AdminRouteError(404, "deletion_request_not_found");
      return jsonResponse({ status: result.status });
    }
    throw new AdminRouteError(404, "not_found");
  }

  if (request.method === "GET" && path === "/session") return jsonResponse(sessionPayload(session));
  if (request.method === "GET" && path === "/overview") return handleOverview(dependencies, session);
  if (request.method === "GET" && path === "/products") {
    requirePermission(session, "products.read");
    return jsonResponse({ items: await readProducts(dependencies.database) });
  }
  if (request.method === "GET" && path === "/posts") {
    requirePermission(session, "posts.read");
    return jsonResponse({ items: await readPosts(dependencies.database) });
  }
  if (request.method === "GET" && path === "/failures") {
    requirePermission(session, "failures.read");
    return jsonResponse({ items: await readFailures(dependencies.database) });
  }
  if (request.method === "GET" && path === "/audit") {
    requirePermission(session, "audit.read");
    return jsonResponse({ items: await readAudit(dependencies.database) });
  }
  if (request.method === "GET" && path === "/team") {
    requirePermission(session, "team.read");
    return jsonResponse({ items: await readTeam(dependencies.database) });
  }
  if (request.method === "POST" && path === "/team/invite") return handleInvite(request, dependencies, session);

  if (request.method === "POST" && path === "/posts") {
    requirePermission(session, "posts.write");
    const parsed = postDraftSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AdminRouteError(400, "invalid_post_draft");
    const pages = parseRows(await dependencies.database.select("facebook_pages", { select: "id,meta_page_id,name,active", active: "eq.true", limit: "1" }), pageRowSchema);
    const page = pages[0];
    if (page === undefined) throw new AdminRouteError(409, "facebook_page_not_configured");
    const inserted = await dependencies.database.insert("facebook_posts", {
      facebook_page_id: page.id,
      product_id: parsed.data.productId ?? null,
      caption: parsed.data.caption,
      image_url: parsed.data.imageUrl ?? null,
      post_type: parsed.data.postType,
      status: "draft",
      approval_status: "pending",
      scheduled_at: parsed.data.scheduledAt ?? null,
      meta_page_id: page.meta_page_id,
      created_by_staff_id: session.profile.id,
    });
    const created = parseRows(inserted, postRowSchema)[0];
    if (created === undefined) throw new AdminRouteError(503, "post_creation_failed");
    await writeAudit(dependencies.database, session, dependencies.requestId, "post_created", "facebook_post", created.id);
    return jsonResponse({ id: created.id }, 201);
  }

  const approveMatch = path.match(/^\/posts\/([0-9a-f-]+)\/approve$/i);
  if (request.method === "POST" && approveMatch !== null) {
    requirePermission(session, "posts.approve");
    requirePrivilegedMfa(session);
    const id = uuid.safeParse(approveMatch[1]);
    if (!id.success) throw new AdminRouteError(404, "not_found");
    const current = parseRows(await dependencies.database.select("facebook_posts", { select: "id,product_id,caption,post_type,status,approval_status,scheduled_at", id: `eq.${id.data}`, limit: "1" }), postRowSchema)[0];
    if (current === undefined) throw new AdminRouteError(404, "post_not_found");
    if (current.approval_status !== "pending" || !["draft", "pending_approval"].includes(current.status)) throw new AdminRouteError(409, "post_not_approvable");
    await dependencies.database.update("facebook_posts", { id: `eq.${id.data}` }, {
      approval_status: "approved",
      status: current.scheduled_at === null ? "approved" : "scheduled",
      approved_by_staff_id: session.profile.id,
      approved_at: new Date().toISOString(),
    });
    await writeAudit(dependencies.database, session, dependencies.requestId, "post_approved", "facebook_post", id.data);
    return jsonResponse({ status: "approved" });
  }

  const publishMatch = path.match(/^\/posts\/([0-9a-f-]+)\/publish$/i);
  if (request.method === "POST" && publishMatch !== null) {
    requirePermission(session, "posts.approve");
    requirePrivilegedMfa(session);
    const id = uuid.safeParse(publishMatch[1]);
    if (!id.success) throw new AdminRouteError(404, "not_found");
    const now = new Date().toISOString();
    const rows = await dependencies.database.updateReturning("facebook_posts", {
      id: `eq.${id.data}`,
      approval_status: "eq.approved",
      status: "in.(approved,scheduled,failed)",
      meta_post_id: "is.null",
      processing_lock: "is.null",
    }, {
      status: "scheduled",
      scheduled_at: now,
      next_retry_at: now,
      last_error: null,
    });
    if (rows.length !== 1) throw new AdminRouteError(409, "post_not_publishable");
    await writeAudit(dependencies.database, session, dependencies.requestId, "post_publish_requested", "facebook_post", id.data);
    return jsonResponse({ status: "publish_requested" }, 202);
  }

  const postRetryMatch = path.match(/^\/posts\/([0-9a-f-]+)\/retry$/i);
  if (request.method === "POST" && postRetryMatch !== null) {
    requirePermission(session, "posts.approve");
    requirePrivilegedMfa(session);
    const id = uuid.safeParse(postRetryMatch[1]);
    if (!id.success) throw new AdminRouteError(404, "not_found");
    const now = new Date().toISOString();
    const rows = await dependencies.database.updateReturning("facebook_posts", {
      id: `eq.${id.data}`,
      approval_status: "eq.approved",
      status: "eq.failed",
      meta_post_id: "is.null",
      processing_lock: "is.null",
    }, {
      status: "scheduled",
      scheduled_at: now,
      next_retry_at: now,
      last_error: null,
    });
    if (rows.length !== 1) throw new AdminRouteError(409, "post_not_retryable");
    await writeAudit(dependencies.database, session, dependencies.requestId, "post_retry_requested", "facebook_post", id.data);
    return jsonResponse({ status: "retry_requested" }, 202);
  }

  const cancelMatch = path.match(/^\/posts\/([0-9a-f-]+)\/cancel$/i);
  if (request.method === "POST" && cancelMatch !== null) {
    requirePermission(session, "posts.approve");
    requirePrivilegedMfa(session);
    const id = uuid.safeParse(cancelMatch[1]);
    if (!id.success) throw new AdminRouteError(404, "not_found");
    const now = new Date().toISOString();
    const rows = await dependencies.database.updateReturning("facebook_posts", {
      id: `eq.${id.data}`,
      status: "in.(draft,pending_approval,approved,scheduled,failed)",
      meta_post_id: "is.null",
      processing_lock: "is.null",
    }, {
      status: "cancelled",
      next_retry_at: null,
      processing_lock: null,
      locked_at: null,
    });
    if (rows.length !== 1) throw new AdminRouteError(409, "post_not_cancellable");
    await dependencies.database.update("automation_failures", {
      related_entity_type: "eq.facebook_post",
      related_entity_id: `eq.${id.data}`,
      resolved_at: "is.null",
    }, {
      resolved_at: now,
      resolved_by_staff_id: session.profile.id,
      human_review_required: false,
    });
    await writeAudit(dependencies.database, session, dependencies.requestId, "post_cancelled", "facebook_post", id.data);
    return jsonResponse({ status: "cancelled" });
  }

  const automationMatch = path.match(/^\/automation\/([a-z_]+)$/);
  if (request.method === "PATCH" && automationMatch !== null) {
    requirePermission(session, "automation.manage");
    requirePrivilegedMfa(session);
    const key = automationKeys.find((candidate) => candidate === automationMatch[1]);
    if (key === undefined) throw new AdminRouteError(404, "automation_setting_not_found");
    const parsed = automationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || (key === "global_automation_enabled" && parsed.data.enabled && parsed.data.confirmation !== "ENABLE")) {
      throw new AdminRouteError(400, "automation_confirmation_required");
    }
    await dependencies.database.update("automation_settings", { key: `eq.${key}` }, { value: parsed.data.enabled, updated_by: session.profile.userId });
    await writeAudit(dependencies.database, session, dependencies.requestId, parsed.data.enabled ? "automation_enabled" : "automation_disabled", "automation_setting", null, { key });
    return jsonResponse({ enabled: parsed.data.enabled, key });
  }

  const retryMatch = path.match(/^\/failures\/([0-9a-f-]+)\/retry$/i);
  if (request.method === "POST" && retryMatch !== null) {
    requirePermission(session, "failures.retry");
    requirePrivilegedMfa(session);
    const id = uuid.safeParse(retryMatch[1]);
    if (!id.success) throw new AdminRouteError(404, "not_found");
    const rows = await dependencies.database.updateReturning("automation_failures", { id: `eq.${id.data}`, retryable: "eq.true", resolved_at: "is.null" }, { next_retry_at: new Date().toISOString(), human_review_required: false });
    if (rows.length === 0) throw new AdminRouteError(409, "failure_not_retryable");
    await writeAudit(dependencies.database, session, dependencies.requestId, "failure_retry_requested", "automation_failure", id.data);
    return jsonResponse({ status: "retry_requested" });
  }

  const teamMatch = path.match(/^\/team\/([0-9a-f-]+)$/i);
  if (request.method === "PATCH" && teamMatch !== null) {
    requirePermission(session, "team.manage");
    requirePrivilegedMfa(session);
    const id = uuid.safeParse(teamMatch[1]);
    const parsed = teamUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!id.success || !parsed.success) throw new AdminRouteError(400, "invalid_team_update");
    if (id.data === session.profile.id) throw new AdminRouteError(409, "cannot_change_own_access");
    const current = parseRows(await dependencies.database.select("staff_profiles", { select: "id,user_id,email,display_name,role,status,last_signed_in_at", id: `eq.${id.data}`, limit: "1" }), staffRowSchema)[0];
    if (current === undefined) throw new AdminRouteError(404, "staff_profile_not_found");
    if (current.role === "owner" && (parsed.data.role !== undefined || parsed.data.status === "suspended")) {
      const owners = parseRows(await dependencies.database.select("staff_profiles", { select: "id,user_id,email,display_name,role,status,last_signed_in_at", role: "eq.owner", status: "eq.active", limit: "2" }), staffRowSchema);
      if (owners.length <= 1) throw new AdminRouteError(409, "last_owner_must_remain_active");
    }
    await dependencies.database.update("staff_profiles", { id: `eq.${id.data}` }, parsed.data);
    await writeAudit(dependencies.database, session, dependencies.requestId, "staff_access_changed", "staff_profile", id.data, parsed.data);
    return jsonResponse({ status: "updated" });
  }

  throw new AdminRouteError(404, "not_found");
}

export function handleDashboardConfig(config: AppConfig): Response {
  return jsonResponse({
    supabaseUrl: config.SUPABASE_URL,
    supabasePublishableKey: config.SUPABASE_PUBLISHABLE_KEY,
  });
}

export async function handleStaffBootstrap(request: Request, dependencies: AdminDependencies): Promise<Response> {
  const suppliedSecret = request.headers.get("x-bootstrap-secret");
  if (suppliedSecret === null || !constantTimeStringEqual(suppliedSecret, dependencies.config.INTERNAL_ADMIN_SECRET)) {
    return jsonResponse({ error: "bootstrap_rejected" }, 403);
  }
  try {
    const existing = await dependencies.database.select("staff_profiles", { select: "id", limit: "1" });
    if (existing.length > 0) throw new AdminRouteError(409, "bootstrap_already_completed");
    const user = await validateSupabaseUser(request, dependencies.config);
    const body = z.object({ displayName: z.string().trim().min(2).max(120) }).safeParse(await request.json().catch(() => null));
    if (!body.success) throw new AdminRouteError(400, "invalid_bootstrap_request");
    const rows = await dependencies.database.insert("staff_profiles", { user_id: user.id, email: user.email, display_name: body.data.displayName, role: "owner", status: "active", last_signed_in_at: user.lastSignedInAt });
    const profile = mapTeam(rows)[0];
    if (profile === undefined) throw new AdminRouteError(503, "bootstrap_failed");
    return jsonResponse({ profile }, 201);
  } catch (error) {
    return errorResponse(error, dependencies.logger);
  }
}

function errorResponse(error: unknown, logger: Logger): Response {
  if (error instanceof BodyError) return jsonResponse({ error: "invalid_request_body" }, error.status);
  if (error instanceof SyntaxError) return jsonResponse({ error: "invalid_json" }, 400);
  if (error instanceof StaffAuthError) return jsonResponse({ error: error.code }, error.status);
  if (error instanceof AdminRouteError) return jsonResponse({ error: error.code }, error.status);
  if (error instanceof DatabaseError) {
    logger.error("dashboard.database_failed", { error_category: "database_transient", upstream_status: error.status });
    return jsonResponse({ error: "dashboard_unavailable" }, 503);
  }
  logger.error("dashboard.request_failed", { error_category: "internal" });
  return jsonResponse({ error: "dashboard_unavailable" }, 503);
}

export async function handleAdminApi(request: Request, dependencies: AdminDependencies): Promise<Response> {
  try {
    const session = await authenticateStaff(request, dependencies.config, dependencies.database);
    return await routeAuthenticated(request, dependencies, session);
  } catch (error) {
    return errorResponse(error, dependencies.logger);
  }
}
