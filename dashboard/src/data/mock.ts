import type {
  ActivitySummary,
  FailureSummary,
  OverviewPayload,
  PostSummary,
  ProductSummary,
  SessionPayload,
  StaffProfile,
} from "../types";

const now = new Date();
const isoAt = (hours: number) =>
  new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();

export const mockSession: SessionPayload = {
  profile: {
    id: "staff-owner",
    userId: "demo-user",
    email: "owner@mobdeals.co.ke",
    displayName: "Paul Admin",
    role: "owner",
    status: "active",
    lastSignedInAt: isoAt(-1),
  },
  permissions: [
    "privacy.manage",
    "overview.read",
    "products.read",
    "posts.read",
    "posts.write",
    "posts.approve",
    "automation.manage",
    "failures.retry",
    "audit.read",
    "team.manage",
  ],
  assuranceLevel: "aal2",
  capabilities: {
    scheduledPublishing: true,
    commentAutomation: false,
    messengerAutomation: false,
    manualPublish: true,
  },
};

export const mockPosts: PostSummary[] = [
  {
    id: "post-1",
    caption: "Fresh MacBook Air M2 stock is ready for viewing.",
    productName: "Apple MacBook Air M2",
    postType: "single_image",
    status: "pending_approval",
    approvalStatus: "pending",
    scheduledAt: isoAt(25),
  },
  {
    id: "post-2",
    caption: "Power and portability for the week ahead.",
    productName: "HP EliteBook 840 G8",
    postType: "single_image",
    status: "scheduled",
    approvalStatus: "approved",
    scheduledAt: isoAt(49),
  },
  {
    id: "post-3",
    caption: "Ask us about the current ThinkPad offers.",
    productName: "Lenovo ThinkPad T14",
    postType: "text",
    status: "draft",
    approvalStatus: "pending",
    scheduledAt: null,
  },
];

export const mockFailures: FailureSummary[] = [
  {
    id: "failure-1",
    operation: "facebook_post.publish",
    errorCategory: "meta_token_invalid",
    retryable: false,
    retryCount: 1,
    humanReviewRequired: true,
    createdAt: isoAt(-3),
  },
  {
    id: "failure-2",
    operation: "meta_webhook.process",
    errorCategory: "database_transient",
    retryable: true,
    retryCount: 2,
    humanReviewRequired: false,
    createdAt: isoAt(-7),
  },
];

export const mockActivity: ActivitySummary[] = [
  {
    id: "activity-1",
    action: "Post submitted",
    actor: "Content editor",
    detail: "MacBook Air M2 campaign is awaiting approval.",
    createdAt: isoAt(-0.4),
    tone: "info",
  },
  {
    id: "activity-2",
    action: "Automation paused",
    actor: "System",
    detail: "Outbound actions remain safely disabled in this environment.",
    createdAt: isoAt(-2),
    tone: "warning",
  },
  {
    id: "activity-3",
    action: "Webhook stored",
    actor: "Meta",
    detail: "A signed comment delivery was accepted once.",
    createdAt: isoAt(-4),
    tone: "success",
  },
];

export const mockProducts: ProductSummary[] = [
  {
    id: "product-1",
    name: "Apple MacBook Air M2",
    category: "Laptops",
    price: 118000,
    currency: "KES",
    stockQuantity: 4,
    stockStatus: "in_stock",
    active: true,
  },
  {
    id: "product-2",
    name: "HP EliteBook 840 G8",
    category: "Laptops",
    price: 58500,
    currency: "KES",
    stockQuantity: 2,
    stockStatus: "low_stock",
    active: true,
  },
  {
    id: "product-3",
    name: "Lenovo ThinkPad T14",
    category: "Laptops",
    price: 69000,
    currency: "KES",
    stockQuantity: 0,
    stockStatus: "out_of_stock",
    active: false,
  },
];

export const mockTeam: StaffProfile[] = [
  mockSession.profile,
  {
    id: "staff-editor",
    userId: "demo-editor",
    email: "content@mobdeals.co.ke",
    displayName: "Content Editor",
    role: "content_editor",
    status: "active",
    lastSignedInAt: isoAt(-18),
  },
  {
    id: "staff-support",
    userId: "demo-support",
    email: "support@mobdeals.co.ke",
    displayName: "Support Agent",
    role: "support_agent",
    status: "invited",
    lastSignedInAt: null,
  },
];

export const mockOverview: OverviewPayload = {
  system: {
    status: "healthy",
    environment: "demonstration",
    lastCheckedAt: now.toISOString(),
  },
  page: {
    name: "MobDeals Kenya",
    metaPageId: "configured-page",
    active: true,
  },
  automation: {
    outboundActionsEnabled: false,
    globalEnabled: false,
    maintenanceMode: true,
    postingEnabled: false,
    commentRepliesEnabled: false,
    messengerRepliesEnabled: false,
  },
  counts: {
    awaitingApproval: 3,
    scheduledPosts: 6,
    failuresReview: 2,
    humanHandoffs: 4,
  },
  trend: [
    { label: "Mon", events: 18 },
    { label: "Tue", events: 26 },
    { label: "Wed", events: 21 },
    { label: "Thu", events: 34 },
    { label: "Fri", events: 29 },
    { label: "Sat", events: 39 },
    { label: "Sun", events: 45 },
  ],
  scheduledPosts: mockPosts,
  failures: mockFailures,
  handoffs: [
    {
      id: "handoff-1",
      channel: "messenger",
      customer: "Customer 1042",
      reason: "Requested a human agent",
      createdAt: isoAt(-1),
    },
    {
      id: "handoff-2",
      channel: "comment",
      customer: "Facebook commenter",
      reason: "Delivery complaint",
      createdAt: isoAt(-5),
    },
  ],
  activity: mockActivity,
};
