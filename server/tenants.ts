import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Store, type Actor, requireThat } from "./store.js";
import { roles } from "./schemas.js";
import type { Operations } from "./domain.js";
export function owns(s: Store, a: Actor) {
  return !!s.db
    .prepare("SELECT 1 FROM org_owners WHERE org=? AND user_id=?")
    .get(a.org, a.id);
}
export function tenantList(s: Store, a: Actor) {
  return s.db
    .prepare(
      "SELECT o.id,o.name,m.role FROM memberships m JOIN organizations o ON o.id=m.org WHERE m.user_id=? AND m.active=1 ORDER BY o.name",
    )
    .all(a.id);
}
export function createTenant(s: Store, a: Actor, name: unknown) {
  requireThat(
    !["vendor", "viewer"].includes(a.role),
    "Workspace creation requires an internal account",
    403,
  );
  const org = randomUUID(),
    label = z.string().trim().min(1).max(200).parse(name);
  s.db.prepare("INSERT INTO organizations VALUES(?,?)").run(org, label);
  s.db
    .prepare("INSERT INTO memberships VALUES(?,?,?,?,?,?,?)")
    .run(org, a.id, "admin", null, null, 1, new Date().toISOString());
  s.db.prepare("INSERT INTO org_owners VALUES(?,?)").run(org, a.id);
  const next = s.user(a.id, org);
  s.add(next, "settings", { separation: false });
  s.audit(next, "organization.created", org);
  return next;
}
export function addMember(o: Operations, a: Actor, raw: any) {
  requireThat(a.role === "admin", "Administrator required", 403);
  const b = z
    .object({
      email: z.email(),
      role: z.enum(roles),
      workerId: z.string().default(""),
      supplierId: z.string().default(""),
    })
    .parse(raw);
  const user = o.store.db
    .prepare("SELECT id FROM users WHERE email=? AND active=1")
    .get(b.email.toLowerCase()) as any;
  requireThat(
    user,
    "Account must exist on this installation before adding membership",
    404,
  );
  requireThat(
    !o.store.db
      .prepare("SELECT 1 FROM memberships WHERE org=? AND user_id=?")
      .get(a.org, user.id),
    "Membership already exists",
  );
  if (b.workerId) o.ref(a, "worker", b.workerId);
  if (b.supplierId) o.ref(a, "supplier", b.supplierId);
  requireThat(b.role !== "worker" || b.workerId, "Worker record required");
  requireThat(b.role !== "vendor" || b.supplierId, "Supplier record required");
  o.store.db
    .prepare("INSERT INTO memberships VALUES(?,?,?,?,?,?,?)")
    .run(
      a.org,
      user.id,
      b.role,
      b.workerId || null,
      b.supplierId || null,
      1,
      new Date().toISOString(),
    );
  o.store.audit(a, "membership.added", user.id, { role: b.role });
  return o.store.user(user.id, a.org);
}
export function entitlements(s: Store, a: Actor) {
  const commercial = process.env.FIELDOPS_COMMERCIAL === "true";
  const row = s.db
    .prepare("SELECT body FROM entitlements WHERE org=?")
    .get(a.org) as any;
  const configured = row ? JSON.parse(row.body) : null;
  const effective = commercial
    ? configured || {
        plan: "unsubscribed",
        status: "inactive",
        materials: false,
        manpower: false,
        maxProjects: 0,
        maxMembers: 1,
        maxStorageMB: 0,
      }
    : {
        plan: "community",
        status: "active",
        materials: true,
        manpower: true,
        maxProjects: null,
        maxMembers: null,
        maxStorageMB: null,
      };
  const usage = {
    projects: s.list(a.org, "project").length,
    members: Number(
      (
        s.db
          .prepare(
            "SELECT count(*) AS n FROM memberships WHERE org=? AND active=1",
          )
          .get(a.org) as any
      ).n,
    ),
    storageBytes: Number(
      (
        s.db
          .prepare(
            "SELECT coalesce(sum(length(bytes)),0) AS n FROM attachments WHERE org=?",
          )
          .get(a.org) as any
      ).n,
    ),
  };
  return { ...effective, commercial, owner: owns(s, a), usage };
}
export function guardEntitlement(
  s: Store,
  a: Actor,
  kind: string,
  extraBytes = 0,
) {
  const e = entitlements(s, a);
  if (!e.commercial) return;
  const materials = [
    "part",
    "supplier",
    "location",
    "requirement",
    "quote",
    "rfq",
    "po",
    "movement",
    "asset",
    "shipment",
    "poAmendment",
    "credit",
    "adjustment",
    "conversion",
    "substitution",
    "external-po",
  ];
  const manpower = [
    "worker",
    "leave",
    "calendar",
    "crew",
    "crewMembership",
    "crewTemplate",
    "assignment",
    "time",
    "timer",
    "production",
    "reforecast",
    "productionCorrection",
    "checkin",
    "availability",
    "costCode",
    "fieldEntry",
    "fieldSync",
  ];
  requireThat(
    e.status === "active" || e.status === "trialing",
    "Subscription is read-only; existing records and exports remain available",
    402,
  );
  if (materials.includes(kind))
    requireThat(
      e.materials,
      "Materials module is not included in this workspace subscription",
      402,
    );
  if (manpower.includes(kind))
    requireThat(
      e.manpower,
      "Manpower module is not included in this workspace subscription",
      402,
    );
  if (kind === "project" && e.maxProjects != null)
    requireThat(e.usage.projects < e.maxProjects, "Project limit reached", 402);
  if (kind === "member" && e.maxMembers != null)
    requireThat(e.usage.members < e.maxMembers, "Member limit reached", 402);
  if (extraBytes && e.maxStorageMB != null)
    requireThat(
      e.usage.storageBytes + extraBytes <= e.maxStorageMB * 1000000,
      "Attachment storage limit reached",
      402,
    );
}
