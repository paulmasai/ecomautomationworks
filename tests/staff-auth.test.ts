import { describe, expect, it } from "vitest";
import {
  StaffAuthError,
  permissionsForRole,
  requirePermission,
  requirePrivilegedMfa,
  type StaffSession,
} from "../src/auth/staff-auth";

function makeSession(
  role: StaffSession["profile"]["role"],
  assuranceLevel: StaffSession["assuranceLevel"] = "aal1",
): StaffSession {
  return {
    accessToken: "header.payload.signature",
    assuranceLevel,
    permissions: permissionsForRole(role),
    profile: {
      id: "10000000-0000-4000-8000-000000000001",
      userId: "20000000-0000-4000-8000-000000000001",
      email: "staff@example.com",
      displayName: "Staff Member",
      role,
      status: "active",
      lastSignedInAt: null,
    },
  };
}

describe("staff permissions", () => {
  it("allows a content editor to create drafts but not approve them", () => {
    const session = makeSession("content_editor");
    expect(() => requirePermission(session, "posts.write")).not.toThrow();
    expect(() => requirePermission(session, "posts.approve")).toThrowError(
      StaffAuthError,
    );
  });

  it("requires MFA before owners use privileged mutations", () => {
    expect(() => requirePrivilegedMfa(makeSession("owner", "aal1"))).toThrowError(
      StaffAuthError,
    );
    expect(() =>
      requirePrivilegedMfa(makeSession("owner", "aal2")),
    ).not.toThrow();
  });

  it("keeps auditors read-only", () => {
    const session = makeSession("auditor", "aal2");
    expect(() => requirePermission(session, "audit.read")).not.toThrow();
    expect(() => requirePermission(session, "automation.manage")).toThrowError(
      StaffAuthError,
    );
  });
});
