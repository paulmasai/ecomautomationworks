import { z } from "zod";
import type { AppConfig } from "../config/env";
import type { SupabaseDatabase } from "../database/supabase";

export const staffRoles = [
  "owner",
  "automation_manager",
  "content_editor",
  "support_agent",
  "auditor",
] as const;

export type StaffRole = (typeof staffRoles)[number];
export type AssuranceLevel = "aal1" | "aal2";

const permissionsByRole = {
  owner: [
    "overview.read",
    "products.read",
    "posts.read",
    "posts.write",
    "posts.approve",
    "automation.manage",
    "failures.read",
    "failures.retry",
    "audit.read",
    "team.read",
    "team.manage",
  ],
  automation_manager: [
    "overview.read",
    "products.read",
    "posts.read",
    "posts.write",
    "posts.approve",
    "automation.manage",
    "failures.read",
    "failures.retry",
    "audit.read",
    "team.read",
  ],
  content_editor: [
    "overview.read",
    "products.read",
    "posts.read",
    "posts.write",
  ],
  support_agent: ["overview.read", "products.read", "failures.read"],
  auditor: [
    "overview.read",
    "products.read",
    "posts.read",
    "failures.read",
    "audit.read",
    "team.read",
  ],
} as const satisfies Record<StaffRole, readonly string[]>;

export type Permission = (typeof permissionsByRole)[StaffRole][number];

const authUserSchema = z.object({
  id: z.uuid(),
  email: z.email().optional(),
  last_sign_in_at: z.string().nullable().optional(),
});

const staffRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  email: z.email(),
  display_name: z.string(),
  role: z.enum(staffRoles),
  status: z.enum(["invited", "active", "suspended"]),
  last_signed_in_at: z.string().nullable(),
});

export interface StaffProfile {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: StaffRole;
  status: "invited" | "active" | "suspended";
  lastSignedInAt: string | null;
}

export interface StaffSession {
  accessToken: string;
  assuranceLevel: AssuranceLevel;
  permissions: readonly string[];
  profile: StaffProfile;
}

export class StaffAuthError extends Error {
  constructor(
    readonly status: 401 | 403 | 429 | 503,
    readonly code:
      | "authentication_required"
      | "authentication_unavailable"
      | "mfa_required"
      | "permission_denied"
      | "rate_limited"
      | "staff_access_inactive",
  ) {
    super(code);
    this.name = "StaffAuthError";
  }
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization");
  if (header === null || !header.startsWith("Bearer ")) {
    throw new StaffAuthError(401, "authentication_required");
  }
  const token = header.slice(7).trim();
  if (token.length < 20 || token.length > 8192) {
    throw new StaffAuthError(401, "authentication_required");
  }
  return token;
}

function decodeAssuranceLevel(token: string): AssuranceLevel {
  try {
    const encoded = token.split(".")[1];
    if (encoded === undefined) return "aal1";
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(normalized + padding)) as { aal?: unknown };
    return payload.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    return "aal1";
  }
}

export async function validateSupabaseUser(
  request: Request,
  config: Pick<AppConfig, "SUPABASE_PUBLISHABLE_KEY" | "SUPABASE_URL">,
): Promise<{ accessToken: string; email: string; id: string; lastSignedInAt: string | null; assuranceLevel: AssuranceLevel }> {
  const accessToken = bearerToken(request);
  let response: Response;
  try {
    response = await fetch(`${config.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        apikey: config.SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new StaffAuthError(503, "authentication_unavailable");
  }

  if (!response.ok) throw new StaffAuthError(401, "authentication_required");
  const result = authUserSchema.safeParse(await response.json());
  if (!result.success || result.data.email === undefined) {
    throw new StaffAuthError(401, "authentication_required");
  }

  return {
    accessToken,
    assuranceLevel: decodeAssuranceLevel(accessToken),
    email: result.data.email,
    id: result.data.id,
    lastSignedInAt: result.data.last_sign_in_at ?? null,
  };
}

function mapProfile(row: z.infer<typeof staffRowSchema>): StaffProfile {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    lastSignedInAt: row.last_signed_in_at,
  };
}

export async function authenticateStaff(
  request: Request,
  config: Pick<AppConfig, "SUPABASE_PUBLISHABLE_KEY" | "SUPABASE_URL">,
  database: SupabaseDatabase,
): Promise<StaffSession> {
  const user = await validateSupabaseUser(request, config);
  const rows = await database.select<unknown>("staff_profiles", {
    select: "id,user_id,email,display_name,role,status,last_signed_in_at",
    user_id: `eq.${user.id}`,
    limit: "1",
  });
  const result = staffRowSchema.safeParse(rows[0]);
  if (!result.success || result.data.status === "suspended") {
    throw new StaffAuthError(403, "staff_access_inactive");
  }

  let profile = mapProfile(result.data);
  if (
    profile.status === "invited" ||
    (user.lastSignedInAt !== null && user.lastSignedInAt !== profile.lastSignedInAt)
  ) {
    const activated = await database.updateReturning<unknown>(
      "staff_profiles",
      { id: `eq.${profile.id}` },
      {
        status: profile.status === "invited" ? "active" : profile.status,
        last_signed_in_at: user.lastSignedInAt ?? new Date().toISOString(),
      },
    );
    const activatedResult = staffRowSchema.safeParse(activated[0]);
    if (activatedResult.success) profile = mapProfile(activatedResult.data);
  }

  return {
    accessToken: user.accessToken,
    assuranceLevel: user.assuranceLevel,
    permissions: permissionsByRole[profile.role],
    profile,
  };
}

export function requirePermission(
  session: StaffSession,
  permission: Permission,
): void {
  if (!session.permissions.includes(permission)) {
    throw new StaffAuthError(403, "permission_denied");
  }
}

export function requirePrivilegedMfa(session: StaffSession): void {
  if (
    (session.profile.role === "owner" || session.profile.role === "automation_manager") &&
    session.assuranceLevel !== "aal2"
  ) {
    throw new StaffAuthError(403, "mfa_required");
  }
}

export function permissionsForRole(role: StaffRole): readonly string[] {
  return permissionsByRole[role];
}
