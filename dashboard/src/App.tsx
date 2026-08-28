import {
  Activity,
  AlertTriangle,
  Archive,
  Bot,
  Boxes,
  CalendarClock,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  FileClock,
  Gauge,
  LogOut,
  Menu,
  MessageCircleMore,
  PauseCircle,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  mockActivity,
  mockFailures,
  mockOverview,
  mockPosts,
  mockProducts,
  mockSession,
  mockTeam,
} from "./data/mock";
import { apiRequest, getSupabaseClient } from "./lib/api";
import type {
  ActivitySummary,
  CollectionPayload,
  FailureSummary,
  OverviewPayload,
  PostSummary,
  ProductSummary,
  SessionPayload,
  StaffProfile,
  StaffRole,
} from "./types";

type View =
  | "overview"
  | "catalogue"
  | "publishing"
  | "automation"
  | "failures"
  | "audit"
  | "team"
  | "settings";

const navItems: Array<{
  id: View;
  label: string;
  icon: typeof Gauge;
}> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "catalogue", label: "Catalogue", icon: Boxes },
  { id: "publishing", label: "Publishing", icon: CalendarClock },
  { id: "automation", label: "Automation", icon: Bot },
  { id: "failures", label: "Failures", icon: AlertTriangle },
  { id: "audit", label: "Audit", icon: Activity },
  { id: "team", label: "Team & access", icon: Users },
  { id: "settings", label: "Settings", icon: Settings },
];

const viewPermissions: Partial<Record<View, string>> = {
  catalogue: "products.read",
  publishing: "posts.read",
  automation: "automation.manage",
  failures: "failures.read",
  audit: "audit.read",
  team: "team.read",
};

const roleLabels: Record<StaffRole, string> = {
  owner: "Owner",
  automation_manager: "Automation manager",
  content_editor: "Content editor",
  support_agent: "Support agent",
  auditor: "Auditor",
};

function pretty(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function shortTime(value: string | null): string {
  if (value === null) return "Not scheduled";
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(new Date(value));
}

export function nairobiScheduleToIso(value: string): string | null {
  if (value === "") return null;
  const parsed = new Date(`${value}:00+03:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid publication schedule");
  return parsed.toISOString();
}

function relativeTime(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone =
    normalized.includes("fail") || normalized.includes("suspend") || normalized === "out_of_stock"
      ? "danger"
      : normalized.includes("pending") || normalized.includes("low") || normalized === "invited"
        ? "warning"
        : normalized.includes("active") || normalized.includes("approved") || normalized.includes("healthy")
          ? "success"
          : "neutral";
  return <span className={`status-pill status-${tone}`}>{pretty(value)}</span>;
}

function TrendChart({ data }: { data: OverviewPayload["trend"] }) {
  const max = Math.max(...data.map((point) => point.events), 1);
  const points = data
    .map((point, index) => {
      const x = 12 + (index * 276) / Math.max(data.length - 1, 1);
      const y = 92 - (point.events / max) * 72;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="trend-chart" aria-label="Seven day inbound event trend">
      <svg viewBox="0 0 300 105" role="img">
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`M ${points.replaceAll(" ", " L ")} L 288,100 L 12,100 Z`} fill="url(#trend-fill)" />
        <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((point, index) => {
          const x = 12 + (index * 276) / Math.max(data.length - 1, 1);
          const y = 92 - (point.events / max) * 72;
          return <circle key={point.label} cx={x} cy={y} r="3.5" fill="#fff" stroke="#2563eb" strokeWidth="2" />;
        })}
      </svg>
      <div className="trend-labels">
        {data.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
    </div>
  );
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const client = await getSupabaseClient();
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await onAuthenticated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (email.trim() === "") {
      setMessage("Enter your email address first.");
      return;
    }
    try {
      const client = await getSupabaseClient();
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/settings`,
      });
      if (error) throw error;
      setMessage("Check your email for the recovery link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to request recovery");
    }
  }

  return (
    <main className="login-layout">
      <section className="login-story">
        <div className="brand-lockup brand-lockup-light">
          <span className="brand-mark"><Bot size={24} /></span>
          <span>MobDeals Automation</span>
        </div>
        <div className="login-message">
          <span className="eyebrow">Staff operations</span>
          <h1>Keep every automated action visible and controlled.</h1>
          <p>Review content, watch failures, and hand sensitive conversations back to the MobDeals team.</p>
        </div>
        <div className="login-signal">
          <ShieldCheck size={20} /> Invite-only access · audited changes · outbound-safe by default
        </div>
      </section>
      <section className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <div>
            <span className="eyebrow">Welcome back</span>
            <h2>Sign in to the console</h2>
            <p>Use the staff account invited by your MobDeals owner.</p>
          </div>
          <label>
            Email address
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {message && <div className="form-message" role="status">{message}</div>}
          <button className="primary-button full-button" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}<ChevronRight size={17} />
          </button>
          <button className="text-button" type="button" onClick={() => void resetPassword()}>Forgot password?</button>
          {import.meta.env.DEV && (
            <a className="demo-link" href="/?demo=1">Open local UI preview</a>
          )}
        </form>
      </section>
    </main>
  );
}

function Metric({ label, value, note, icon: Icon, tone }: { label: string; value: number | string; note: string; icon: typeof Gauge; tone: string }) {
  return (
    <article className="metric">
      <div className={`metric-icon metric-${tone}`}><Icon size={19} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}

function Overview({ overview, onNavigate }: { overview: OverviewPayload; onNavigate: (view: View) => void }) {
  const outboundSafe = !overview.automation.outboundActionsEnabled || !overview.automation.globalEnabled;
  return (
    <>
      <section className={`control-strip ${outboundSafe ? "safe" : "live"}`}>
        <div>
          {outboundSafe ? <PauseCircle size={20} /> : <Send size={20} />}
          <div>
            <strong>{outboundSafe ? "Outbound automation is safely paused" : "Outbound automation is active"}</strong>
            <span>{outboundSafe ? "Inbound events can still be stored while publishing and replies remain blocked." : "Approved actions may be sent to Meta within configured limits."}</span>
          </div>
        </div>
        <StatusPill value={overview.automation.maintenanceMode ? "maintenance mode" : "operational"} />
      </section>

      <section className="metric-row" aria-label="Operational totals">
        <Metric label="Awaiting approval" value={overview.counts.awaitingApproval} note="Content decisions" icon={ClipboardCheck} tone="blue" />
        <Metric label="Scheduled posts" value={overview.counts.scheduledPosts} note="Upcoming queue" icon={CalendarClock} tone="violet" />
        <Metric label="Failures for review" value={overview.counts.failuresReview} note="Operator attention" icon={AlertTriangle} tone="amber" />
        <Metric label="Human handoffs" value={overview.counts.humanHandoffs} note="Continue in Meta" icon={MessageCircleMore} tone="rose" />
      </section>

      <section className="overview-grid">
        <article className="workspace-panel trend-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Inbound activity</span><h2>Seven-day event flow</h2></div>
            <span className="quiet-label">Webhook deliveries</span>
          </div>
          <TrendChart data={overview.trend} />
        </article>
        <article className="workspace-panel health-panel">
          <div className="panel-heading"><div><span className="eyebrow">Connections</span><h2>Service health</h2></div></div>
          <div className="health-list">
            <div><span className="health-icon"><Activity size={17} /></span><div><strong>Automation Worker</strong><small>{overview.system.environment} · checked {relativeTime(overview.system.lastCheckedAt)}</small></div><StatusPill value={overview.system.status} /></div>
            <div><span className="health-icon"><Send size={17} /></span><div><strong>{overview.page?.name ?? "Facebook Page"}</strong><small>{overview.page?.active ? "Configured for webhook events" : "Page connection needs attention"}</small></div><StatusPill value={overview.page?.active ? "active" : "inactive"} /></div>
            <div><span className="health-icon"><Archive size={17} /></span><div><strong>Supabase ledger</strong><small>Durable events and automation records</small></div><StatusPill value="healthy" /></div>
          </div>
        </article>
      </section>

      <section className="triple-grid">
        <article className="workspace-panel list-panel">
          <div className="panel-heading"><div><span className="eyebrow">Publishing</span><h2>Upcoming posts</h2></div><button className="text-button" onClick={() => onNavigate("publishing")}>View all</button></div>
          <div className="compact-list">
            {overview.scheduledPosts.slice(0, 4).map((post) => (
              <div key={post.id}><span className="list-icon"><FileClock size={17} /></span><div><strong>{post.productName ?? "General post"}</strong><small>{shortTime(post.scheduledAt)}</small></div><StatusPill value={post.status} /></div>
            ))}
          </div>
        </article>
        <article className="workspace-panel list-panel">
          <div className="panel-heading"><div><span className="eyebrow">Attention</span><h2>Human handoffs</h2></div><a className="text-button" href="https://business.facebook.com/" target="_blank" rel="noreferrer">Open Meta</a></div>
          <div className="compact-list">
            {overview.handoffs.length === 0 ? <EmptyState label="No active handoffs" /> : overview.handoffs.map((handoff) => (
              <div key={handoff.id}><span className="list-icon"><MessageCircleMore size={17} /></span><div><strong>{handoff.customer}</strong><small>{handoff.reason} · {relativeTime(handoff.createdAt)}</small></div><ChevronRight size={16} /></div>
            ))}
          </div>
        </article>
        <article className="workspace-panel list-panel">
          <div className="panel-heading"><div><span className="eyebrow">Audit trail</span><h2>Recent activity</h2></div><button className="text-button" onClick={() => onNavigate("audit")}>View all</button></div>
          <div className="activity-list">
            {overview.activity.slice(0, 4).map((activity) => <ActivityRow key={activity.id} activity={activity} />)}
          </div>
        </article>
      </section>
    </>
  );
}

function ActivityRow({ activity }: { activity: ActivitySummary }) {
  return (
    <div className="activity-row">
      <span className={`activity-dot tone-${activity.tone}`} />
      <div><strong>{activity.action}</strong><small>{activity.detail}</small><em>{activity.actor} · {relativeTime(activity.createdAt)}</em></div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="empty-state"><CircleHelp size={20} /><span>{label}</span></div>;
}

function DataTable({ children }: { children: ReactNode }) {
  return <div className="table-scroll"><table>{children}</table></div>;
}

function CatalogueView({ products }: { products: ProductSummary[] }) {
  return (
    <section className="workspace-panel page-panel">
      <div className="panel-heading"><div><span className="eyebrow">Inventory source</span><h2>Product catalogue</h2><p>Only active, in-stock products are eligible for automation.</p></div><button className="secondary-button" disabled><Plus size={16} /> Add in Supabase</button></div>
      <DataTable>
        <thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead>
        <tbody>{products.map((product) => <tr key={product.id}><td><strong>{product.name}</strong></td><td>{product.category ?? "—"}</td><td>{new Intl.NumberFormat("en-KE", { style: "currency", currency: product.currency, maximumFractionDigits: 0 }).format(product.price)}</td><td>{product.stockQuantity}</td><td><StatusPill value={product.active ? product.stockStatus : "inactive"} /></td></tr>)}</tbody>
      </DataTable>
    </section>
  );
}

function PublishingView({ posts, canWrite, canApprove, manualPublish, demo, onChanged }: { posts: PostSummary[]; canWrite: boolean; canApprove: boolean; manualPublish: boolean; demo: boolean; onChanged: () => Promise<void> }) {
  const [showComposer, setShowComposer] = useState(false);
  const [caption, setCaption] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    if (demo) {
      setMessage("Demo draft validated. Live mode stores it in Supabase.");
      setShowComposer(false);
      return;
    }
    const scheduledAtIso = nairobiScheduleToIso(scheduledAt);
    await apiRequest("/posts", { method: "POST", body: JSON.stringify({ caption, postType: "text", scheduledAt: scheduledAtIso }) });
    setShowComposer(false);
    setCaption("");
    setScheduledAt("");
    await onChanged();
  }

  async function approve(id: string) {
    if (demo) {
      setMessage("Approval recorded in demo mode.");
      return;
    }
    await apiRequest(`/posts/${id}/approve`, { method: "POST" });
    await onChanged();
  }

  async function requestPostOperation(id: string, operation: "cancel" | "publish" | "retry") {
    if (demo) {
      setMessage(`${pretty(operation)} requested in demo mode.`);
      return;
    }
    await apiRequest(`/posts/${id}/${operation}`, { method: "POST" });
    await onChanged();
  }

  function actions(post: PostSummary) {
    if (!canApprove) return <span className="muted">—</span>;
    if (post.approvalStatus === "pending") {
      return <button className="small-button" onClick={() => void approve(post.id)}><Check size={14} /> Approve</button>;
    }
    if (post.approvalStatus !== "approved" || ["published", "cancelled", "processing"].includes(post.status)) {
      return <span className="muted">—</span>;
    }
    return (
      <div className="table-actions">
        <button className="small-button" disabled={!manualPublish} onClick={() => void requestPostOperation(post.id, post.status === "failed" ? "retry" : "publish")}>
          {post.status === "failed" ? <RefreshCcw size={14} /> : <Send size={14} />}
          {post.status === "failed" ? "Retry" : "Publish"}
        </button>
        <button className="small-button" onClick={() => void requestPostOperation(post.id, "cancel")}><X size={14} /> Cancel</button>
      </div>
    );
  }

  return (
    <section className="workspace-panel page-panel">
      <div className="panel-heading"><div><span className="eyebrow">Content queue</span><h2>Publishing</h2><p>Draft, review and schedule Facebook Page posts in Africa/Nairobi time.</p></div>{canWrite && <button className="primary-button" onClick={() => setShowComposer(true)}><Plus size={16} /> New draft</button>}</div>
      {message && <div className="inline-notice">{message}<button onClick={() => setMessage(null)} aria-label="Dismiss"><X size={15} /></button></div>}
      {showComposer && (
        <form className="composer" onSubmit={(event) => void createDraft(event)}>
          <div className="composer-heading"><div><h3>Create a text-post draft</h3><p>Publishing remains blocked until an approver reviews the draft.</p></div><button type="button" className="icon-button" onClick={() => setShowComposer(false)}><X size={18} /></button></div>
          <label>Caption<textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={5000} required /></label>
          <label>Proposed schedule<input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>
          <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowComposer(false)}>Cancel</button><button className="primary-button" type="submit">Save draft</button></div>
        </form>
      )}
      <DataTable>
        <thead><tr><th>Post</th><th>Type</th><th>Schedule</th><th>Approval</th><th>Status</th><th aria-label="Actions" /></tr></thead>
        <tbody>{posts.map((post) => <tr key={post.id}><td className="wide-cell"><strong>{post.productName ?? "General Page update"}</strong><small>{post.caption}</small></td><td>{pretty(post.postType)}</td><td>{shortTime(post.scheduledAt)}</td><td><StatusPill value={post.approvalStatus} /></td><td><StatusPill value={post.status} /></td><td>{actions(post)}</td></tr>)}</tbody>
      </DataTable>
    </section>
  );
}

function AutomationView({ overview, canManage, demo, onChanged }: { overview: OverviewPayload; canManage: boolean; demo: boolean; onChanged: () => Promise<void> }) {
  const controls = [
    ["global_automation_enabled", "Global automation", overview.automation.globalEnabled, "Master database kill switch for all outbound actions."],
    ["posting_enabled", "Scheduled publishing", overview.automation.postingEnabled, "Allows approved, due posts to reach the publisher."],
    ["comment_replies_enabled", "Comment replies", overview.automation.commentRepliesEnabled, "Allows approved deterministic comment replies."],
    ["messenger_replies_enabled", "Messenger replies", overview.automation.messengerRepliesEnabled, "Allows the guided Messenger sales flow."],
  ] as const;
  const [message, setMessage] = useState<string | null>(null);

  async function toggle(key: string, enabled: boolean) {
    if (demo) {
      setMessage(`${pretty(key)} would be ${enabled ? "enabled" : "disabled"} after server confirmation.`);
      return;
    }
    if (key === "global_automation_enabled" && enabled && !window.confirm("Enable the global database automation switch? The Worker environment gate still applies.")) return;
    await apiRequest(`/automation/${key}`, { method: "PATCH", body: JSON.stringify({ enabled, ...(key === "global_automation_enabled" && enabled ? { confirmation: "ENABLE" } : {}) }) });
    await onChanged();
  }

  return (
    <section className="workspace-panel page-panel">
      <div className="panel-heading"><div><span className="eyebrow">Safety controls</span><h2>Automation</h2><p>Every outbound action requires both an environment gate and its database switch.</p></div></div>
      {message && <div className="inline-notice">{message}</div>}
      {!overview.automation.outboundActionsEnabled && <div className="safety-callout"><ShieldCheck size={20} /><div><strong>Environment gate is off</strong><span>Database switches cannot override the Worker-level outbound safety setting.</span></div></div>}
      <div className="settings-list">
        {controls.map(([key, label, enabled, description]) => (
          <div key={key}><div><strong>{label}</strong><span>{description}</span></div><button className={`switch ${enabled ? "on" : ""}`} role="switch" aria-checked={enabled} disabled={!canManage} onClick={() => void toggle(key, !enabled)}><span /></button></div>
        ))}
      </div>
    </section>
  );
}

function FailuresView({ failures, canRetry, demo, onChanged }: { failures: FailureSummary[]; canRetry: boolean; demo: boolean; onChanged: () => Promise<void> }) {
  const [message, setMessage] = useState<string | null>(null);
  async function retry(id: string) {
    if (demo) {
      setMessage("Retry requested in demo mode.");
      return;
    }
    await apiRequest(`/failures/${id}/retry`, { method: "POST" });
    await onChanged();
  }
  return (
    <section className="workspace-panel page-panel">
      <div className="panel-heading"><div><span className="eyebrow">Operations queue</span><h2>Failures</h2><p>Error text is redacted before it reaches this console.</p></div></div>
      {message && <div className="inline-notice">{message}</div>}
      <DataTable>
        <thead><tr><th>Operation</th><th>Category</th><th>Retry count</th><th>Review</th><th>Created</th><th aria-label="Actions" /></tr></thead>
        <tbody>{failures.map((failure) => <tr key={failure.id}><td><strong>{failure.operation}</strong></td><td>{pretty(failure.errorCategory)}</td><td>{failure.retryCount}</td><td><StatusPill value={failure.humanReviewRequired ? "review required" : "automatic"} /></td><td>{relativeTime(failure.createdAt)}</td><td>{canRetry && failure.retryable ? <button className="small-button" onClick={() => void retry(failure.id)}><RefreshCcw size={14} /> Retry</button> : <span className="muted">—</span>}</td></tr>)}</tbody>
      </DataTable>
    </section>
  );
}

function AuditView({ activity }: { activity: ActivitySummary[] }) {
  return (
    <section className="workspace-panel page-panel">
      <div className="panel-heading"><div><span className="eyebrow">Accountability</span><h2>Audit activity</h2><p>Administrative changes and automation decisions are recorded here.</p></div></div>
      <div className="audit-timeline">{activity.map((item) => <ActivityRow key={item.id} activity={item} />)}</div>
    </section>
  );
}

function TeamView({ team, canManage, demo, onChanged }: { team: StaffProfile[]; canManage: boolean; demo: boolean; onChanged: () => Promise<void> }) {
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<StaffRole>("support_agent");
  const [message, setMessage] = useState<string | null>(null);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (demo) {
      setMessage(`Demo invitation prepared for ${email}.`);
      setShowInvite(false);
      return;
    }
    await apiRequest("/team/invite", { method: "POST", body: JSON.stringify({ email, displayName, role }) });
    setShowInvite(false);
    await onChanged();
  }

  async function changeStatus(profile: StaffProfile) {
    const status = profile.status === "suspended" ? "active" : "suspended";
    if (demo) {
      setMessage(`${profile.displayName} would be marked ${status}.`);
      return;
    }
    await apiRequest(`/team/${profile.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await onChanged();
  }

  return (
    <section className="workspace-panel page-panel">
      <div className="panel-heading"><div><span className="eyebrow">Access control</span><h2>Team & access</h2><p>Invite staff and apply least-privilege roles.</p></div>{canManage && <button className="primary-button" onClick={() => setShowInvite(true)}><Plus size={16} /> Invite staff</button>}</div>
      {message && <div className="inline-notice">{message}</div>}
      {showInvite && <form className="composer compact-composer" onSubmit={(event) => void invite(event)}><div className="composer-heading"><div><h3>Invite a staff member</h3><p>Supabase sends a time-limited account setup link.</p></div><button type="button" className="icon-button" onClick={() => setShowInvite(false)}><X size={18} /></button></div><div className="form-grid"><label>Name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="form-actions"><button className="primary-button" type="submit">Send invitation</button></div></form>}
      <DataTable><thead><tr><th>Staff member</th><th>Role</th><th>Status</th><th>Last sign-in</th><th aria-label="Actions" /></tr></thead><tbody>{team.map((profile) => <tr key={profile.id}><td><div className="person-cell"><span className="avatar">{profile.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div><strong>{profile.displayName}</strong><small>{profile.email}</small></div></div></td><td>{roleLabels[profile.role]}</td><td><StatusPill value={profile.status} /></td><td>{profile.lastSignedInAt ? relativeTime(profile.lastSignedInAt) : "Never"}</td><td>{canManage && profile.role !== "owner" ? <button className="small-button" onClick={() => void changeStatus(profile)}>{profile.status === "suspended" ? <Check size={14} /> : <XCircle size={14} />}{profile.status === "suspended" ? "Reactivate" : "Suspend"}</button> : <span className="muted">—</span>}</td></tr>)}</tbody></DataTable>
    </section>
  );
}

function SettingsView({ session, onChanged }: { session: SessionPayload; onChanged: () => Promise<void> }) {
  const [message, setMessage] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  async function beginMfa() {
    try {
      const client = await getSupabaseClient();
      const listed = await client.auth.mfa.listFactors();
      const verified = listed.data?.totp.find((factor) => factor.status === "verified");
      if (verified !== undefined) {
        setFactorId(verified.id);
        setMessage("Enter the current code from your authenticator app.");
        return;
      }
      const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "MobDeals console" });
      if (error) throw error;
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setMessage("Scan the QR code, then enter the six-digit authenticator code.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to begin MFA setup");
    }
  }

  async function verifyMfa(event: FormEvent) {
    event.preventDefault();
    if (factorId === null) return;
    try {
      const client = await getSupabaseClient();
      const challenge = await client.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;
      const verified = await client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
      if (verified.error) throw verified.error;
      setMessage("MFA verified. Protected controls are now available.");
      setCode("");
      setQrCode(null);
      setSecret(null);
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to verify MFA");
    }
  }
  return (
    <section className="workspace-panel page-panel">
      <div className="panel-heading"><div><span className="eyebrow">Account security</span><h2>Settings</h2><p>Review your account and authentication strength.</p></div></div>
      <div className="settings-list">
        <div><div><strong>Signed-in account</strong><span>{session.profile.email} · {roleLabels[session.profile.role]}</span></div><StatusPill value={session.profile.status} /></div>
        <div><div><strong>Authenticator assurance</strong><span>Protected changes require a verified second factor for privileged roles.</span></div><StatusPill value={session.assuranceLevel === "aal2" ? "MFA verified" : "MFA required"} /></div>
      </div>
      {session.assuranceLevel !== "aal2" && <button className="primary-button settings-action" onClick={() => void beginMfa()}><ShieldCheck size={16} /> Set up authenticator</button>}
      {message && <div className="inline-notice sensitive-notice">{message}</div>}
      {qrCode && <div className="mfa-setup"><img src={qrCode} alt="Authenticator QR code" /><p>Manual secret: <code>{secret}</code></p></div>}
      {factorId && session.assuranceLevel !== "aal2" && <form className="mfa-code" onSubmit={(event) => void verifyMfa(event)}><label>Authenticator code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value)} required /></label><button className="primary-button" type="submit">Verify MFA</button></form>}
    </section>
  );
}

function LoadingScreen() {
  return <main className="loading-screen"><span className="brand-mark"><Bot size={24} /></span><div className="loading-line" /><p>Loading operations console…</p></main>;
}

export function App() {
  const demo = import.meta.env.DEV && new URLSearchParams(window.location.search).get("demo") === "1";
  const [session, setSession] = useState<SessionPayload | null>(demo ? mockSession : null);
  const [overview, setOverview] = useState<OverviewPayload>(mockOverview);
  const [products, setProducts] = useState<ProductSummary[]>(mockProducts);
  const [posts, setPosts] = useState<PostSummary[]>(mockPosts);
  const [failures, setFailures] = useState<FailureSummary[]>(mockFailures);
  const [activity, setActivity] = useState<ActivitySummary[]>(mockActivity);
  const [team, setTeam] = useState<StaffProfile[]>(mockTeam);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(!demo);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (demo) return;
    setError(null);
    try {
      const sessionResult = await apiRequest<SessionPayload>("/session");
      const allowed = new Set(sessionResult.permissions);
      const [overviewResult, productResult, postResult, failureResult, auditResult, teamResult] = await Promise.all([
        apiRequest<OverviewPayload>("/overview"),
        apiRequest<CollectionPayload<ProductSummary>>("/products"),
        allowed.has("posts.read") ? apiRequest<CollectionPayload<PostSummary>>("/posts") : Promise.resolve({ items: [] }),
        allowed.has("failures.read") ? apiRequest<CollectionPayload<FailureSummary>>("/failures") : Promise.resolve({ items: [] }),
        allowed.has("audit.read") ? apiRequest<CollectionPayload<ActivitySummary>>("/audit") : Promise.resolve({ items: [] }),
        allowed.has("team.read") ? apiRequest<CollectionPayload<StaffProfile>>("/team") : Promise.resolve({ items: [] }),
      ]);
      setSession(sessionResult);
      setOverview(overviewResult);
      setProducts(productResult.items);
      setPosts(postResult.items);
      setFailures(failureResult.items);
      setActivity(auditResult.items);
      setTeam(teamResult.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load dashboard");
      throw cause;
    }
  }, [demo]);

  useEffect(() => {
    if (demo) return;
    let active = true;
    void getSupabaseClient()
      .then(async (client) => {
        const { data } = await client.auth.getSession();
        if (!active || data.session === null) return;
        await refresh();
      })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [demo, refresh]);

  const can = useCallback((permission: string) => session?.permissions.includes(permission) ?? false, [session]);
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => viewPermissions[item.id] === undefined || can(viewPermissions[item.id]!)),
    [can],
  );
  const filteredPosts = useMemo(() => posts.filter((post) => `${post.caption} ${post.productName ?? ""}`.toLowerCase().includes(search.toLowerCase())), [posts, search]);
  const filteredProducts = useMemo(() => products.filter((product) => product.name.toLowerCase().includes(search.toLowerCase())), [products, search]);

  async function logout() {
    if (!demo) {
      const client = await getSupabaseClient();
      await client.auth.signOut();
    }
    window.history.replaceState({}, "", "/");
    setSession(null);
  }

  if (loading) return <LoadingScreen />;
  if (session === null) return <LoginScreen onAuthenticated={async () => { setLoading(true); await refresh().finally(() => setLoading(false)); }} />;

  const pageTitle = navItems.find((item) => item.id === view)?.label ?? "Overview";
  const content = view === "overview"
    ? <Overview overview={overview} onNavigate={setView} />
    : view === "catalogue"
      ? <CatalogueView products={filteredProducts} />
      : view === "publishing"
        ? <PublishingView posts={filteredPosts} canWrite={can("posts.write")} canApprove={can("posts.approve")} manualPublish={session.capabilities.manualPublish} demo={demo} onChanged={refresh} />
        : view === "automation"
          ? <AutomationView overview={overview} canManage={can("automation.manage")} demo={demo} onChanged={refresh} />
          : view === "failures"
            ? <FailuresView failures={failures} canRetry={can("failures.retry")} demo={demo} onChanged={refresh} />
            : view === "audit"
              ? <AuditView activity={activity} />
              : view === "team"
                ? <TeamView team={team} canManage={can("team.manage")} demo={demo} onChanged={refresh} />
                : <SettingsView session={session} onChanged={refresh} />;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand-lockup"><span className="brand-mark"><Bot size={22} /></span><span>MobDeals<br /><small>Automation</small></span></div>
        <nav aria-label="Primary navigation">{visibleNavItems.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => { setView(id); setMenuOpen(false); }}><Icon size={18} /><span>{label}</span>{id === "failures" && overview.counts.failuresReview > 0 && <em>{overview.counts.failuresReview}</em>}</button>)}</nav>
        <div className="sidebar-foot"><div className="environment-block"><span className="status-light" /><div><strong>{overview.system.environment}</strong><small>Outbound {overview.automation.outboundActionsEnabled ? "enabled" : "disabled"}</small></div></div><button onClick={() => void logout()}><LogOut size={17} /> Sign out</button></div>
      </aside>
      {menuOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <main className="main-workspace">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div className="page-context"><span className="eyebrow">MobDeals Kenya</span><h1>{pageTitle}</h1></div>
          <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products and posts" /></label>
          <div className="account-chip"><span className="avatar">{session.profile.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div><strong>{session.profile.displayName}</strong><small>{roleLabels[session.profile.role]}</small></div></div>
        </header>
        <div className="workspace-content">
          {demo && <div className="demo-banner"><span>Local preview data</span><a href="/">Return to login</a></div>}
          {session.assuranceLevel !== "aal2" && ["owner", "automation_manager"].includes(session.profile.role) && <button className="mfa-banner" onClick={() => setView("settings")}><ShieldCheck size={18} /><span><strong>Complete MFA to unlock protected changes.</strong> Read-only access remains available.</span><ChevronRight size={17} /></button>}
          {error && <div className="error-banner"><AlertTriangle size={18} /><span>{error}</span><button onClick={() => void refresh()}><RefreshCcw size={15} /> Retry</button></div>}
          {content}
        </div>
      </main>
      <nav className="mobile-tabs" aria-label="Mobile navigation">{visibleNavItems.slice(0, 4).map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}><Icon size={19} /><span>{label}</span></button>)}<button onClick={() => setMenuOpen(true)}><Menu size={19} /><span>More</span></button></nav>
    </div>
  );
}
