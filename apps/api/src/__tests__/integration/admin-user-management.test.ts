import { describe, it, expect, beforeEach } from "vitest";
import { adminService } from "@/services/admin.service";
import { ForbiddenError } from "@/errors/app-error";
import { buildAuthUser, buildSuperAdmin } from "@/__tests__/factories";
import { db, COLLECTIONS } from "@/config/firebase";
import { clearFirestore, clearAuth, createAuthUser, createUserDoc, readAuthUser } from "./helpers";

/**
 * Regression coverage for the super admin "user management" console —
 * role changes and suspend/activate. Each operation MUST sync both
 * Firestore (for reads) and Firebase Auth custom claims / disabled flag
 * (for the JWT that middleware trusts). If these drift, a "demoted"
 * user keeps their old permissions until their token refreshes, which
 * is a silent security regression.
 */
describe("Integration: admin user management (Firestore + Auth)", () => {
  beforeEach(async () => {
    await clearFirestore();
    await clearAuth();
  });

  it("updateUserRoles writes Firestore doc AND Firebase Auth custom claims", async () => {
    const admin = buildSuperAdmin();
    const targetAuth = await createAuthUser({
      uid: "target-uid",
      email: "target@teranga.sn",
      roles: ["participant"],
      organizationId: "org-x",
    });
    await createUserDoc({
      uid: targetAuth.uid,
      email: targetAuth.email,
      roles: ["participant"],
      organizationId: "org-x",
    });

    await adminService.updateUserRoles(admin, targetAuth.uid, ["organizer", "staff"]);

    // Firestore reflected
    const doc = await db.collection(COLLECTIONS.USERS).doc(targetAuth.uid).get();
    expect(doc.data()?.roles).toEqual(["organizer", "staff"]);

    // Firebase Auth claims reflected — this is the source of truth the
    // middleware reads on every request.
    const authState = await readAuthUser(targetAuth.uid);
    expect(authState.customClaims.roles).toEqual(["organizer", "staff"]);
    expect(authState.customClaims.organizationId).toBe("org-x");
  });

  it("prevents a super admin from removing their own super_admin role", async () => {
    // The admin doc lives in both Firestore and Auth so the service
    // can read it for context.
    const adminAuth = await createAuthUser({
      uid: "admin-uid",
      email: "admin@teranga.sn",
      roles: ["super_admin"],
    });
    await createUserDoc({
      uid: adminAuth.uid,
      email: adminAuth.email,
      roles: ["super_admin"],
    });
    const admin = buildSuperAdmin({ uid: adminAuth.uid, email: adminAuth.email });

    await expect(
      adminService.updateUserRoles(admin, admin.uid, ["organizer"]),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Auth + Firestore untouched.
    const authState = await readAuthUser(admin.uid);
    expect(authState.customClaims.roles).toEqual(["super_admin"]);
    const doc = await db.collection(COLLECTIONS.USERS).doc(admin.uid).get();
    expect(doc.data()?.roles).toEqual(["super_admin"]);
  });

  it("updateUserStatus toggles isActive in Firestore AND disabled in Auth", async () => {
    const admin = buildSuperAdmin();
    const targetAuth = await createAuthUser({
      uid: "suspend-me",
      email: "suspend@teranga.sn",
      roles: ["organizer"],
    });
    await createUserDoc({
      uid: targetAuth.uid,
      email: targetAuth.email,
      roles: ["organizer"],
      isActive: true,
    });

    // Suspend
    await adminService.updateUserStatus(admin, targetAuth.uid, false);
    let doc = await db.collection(COLLECTIONS.USERS).doc(targetAuth.uid).get();
    expect(doc.data()?.isActive).toBe(false);
    let authState = await readAuthUser(targetAuth.uid);
    expect(authState.disabled).toBe(true);

    // Reactivate
    await adminService.updateUserStatus(admin, targetAuth.uid, true);
    doc = await db.collection(COLLECTIONS.USERS).doc(targetAuth.uid).get();
    expect(doc.data()?.isActive).toBe(true);
    authState = await readAuthUser(targetAuth.uid);
    expect(authState.disabled).toBe(false);
  });

  it("prevents self-suspension", async () => {
    const adminAuth = await createAuthUser({
      uid: "admin-uid",
      email: "admin@teranga.sn",
      roles: ["super_admin"],
    });
    await createUserDoc({
      uid: adminAuth.uid,
      email: adminAuth.email,
      roles: ["super_admin"],
    });
    const admin = buildSuperAdmin({ uid: adminAuth.uid, email: adminAuth.email });

    await expect(adminService.updateUserStatus(admin, admin.uid, false)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await readAuthUser(admin.uid)).disabled).toBe(false);
  });

  it("forbids non-super-admin from changing roles", async () => {
    const organizer = buildAuthUser({ roles: ["organizer"], organizationId: "org-x" });
    const targetAuth = await createAuthUser({
      uid: "target-uid",
      email: "target@teranga.sn",
      roles: ["participant"],
    });
    await createUserDoc({
      uid: targetAuth.uid,
      email: targetAuth.email,
      roles: ["participant"],
    });

    await expect(
      adminService.updateUserRoles(organizer, targetAuth.uid, ["organizer"]),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Target's claims never changed.
    expect((await readAuthUser(targetAuth.uid)).customClaims.roles).toEqual(["participant"]);
  });
});
