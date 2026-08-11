export type StaffRole =
  | "owner"
  | "automation_manager"
  | "content_editor"
  | "support_agent"
  | "auditor";

export interface StaffProfile {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: StaffRole;
  status: "invited" | "active" | "suspended";
  lastSignedInAt: string | null;
}

export interface SessionPayload {
  profile: StaffProfile;
  permissions: string[];
  assuranceLevel: "aal1" | "aal2";
  capabilities: {
    scheduledPublishing: boolean;
    commentAutomation: boolean;
    messengerAutomation: boolean;
    manualPublish: boolean;
  };
}

export interface PostSummary {
  id: string;
  caption: string;
  productName: string | null;
  postType: "text" | "single_image";
  status: string;
  approvalStatus: string;
  scheduledAt: string | null;
}

export interface FailureSummary {
  id: string;
  operation: string;
  errorCategory: string;
  retryable: boolean;
  retryCount: number;
  humanReviewRequired: boolean;
  createdAt: string;
}

export interface HandoffSummary {
  id: string;
  channel: "comment" | "messenger";
  customer: string;
  reason: string;
  createdAt: string;
}

export interface ActivitySummary {
  id: string;
  action: string;
  actor: string;
  detail: string;
  createdAt: string;
  tone: "success" | "warning" | "info" | "danger";
}

export interface ProductSummary {
  id: string;
  name: string;
  category: string | null;
  price: number;
  currency: string;
  stockQuantity: number;
  stockStatus: string;
  active: boolean;
}

export interface OverviewPayload {
  system: {
    status: "healthy" | "degraded";
    environment: string;
    lastCheckedAt: string;
  };
  page: {
    name: string;
    metaPageId: string;
    active: boolean;
  } | null;
  automation: {
    outboundActionsEnabled: boolean;
    globalEnabled: boolean;
    maintenanceMode: boolean;
    postingEnabled: boolean;
    commentRepliesEnabled: boolean;
    messengerRepliesEnabled: boolean;
  };
  counts: {
    awaitingApproval: number;
    scheduledPosts: number;
    failuresReview: number;
    humanHandoffs: number;
  };
  trend: Array<{ label: string; events: number }>;
  scheduledPosts: PostSummary[];
  failures: FailureSummary[];
  handoffs: HandoffSummary[];
  activity: ActivitySummary[];
}

export interface CollectionPayload<T> {
  items: T[];
}
