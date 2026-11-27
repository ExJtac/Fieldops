import type { Operations } from "./domain.js";
import { type Actor, requireThat } from "./store.js";
export function validateExtra(o: Operations, a: Actor, kind: string, b: any) {
  if (
    [
      "conversion",
      "poAmendment",
      "credit",
      "adjustment",
      "scheduleRevision",
      "productionCorrection",
    ].includes(kind)
  )
    b.status = "Proposed";
  if (kind === "quote") {
    b.status = "Quoted";
    if (b.rfqId) {
      const rfq = o.ref(a, "rfq", b.rfqId);
      requireThat(
        rfq.partId === b.partId &&
          rfq.projectId === b.projectId &&
          rfq.supplierId === b.supplierId,
        "Quote must match RFQ",
      );
    }
    requireThat(
      new Set(b.tiers.map((t: any) => t.minimum)).size === b.tiers.length,
      "Duplicate quote quantity tier",
    );
  }
  if (kind === "part") for (const id of b.accessoryIds) o.ref(a, "part", id);
  if (b.changeId) {
    const c = o.ref(a, "change", b.changeId);
    requireThat(
      c.projectId === b.projectId,
      "Change belongs to another project",
    );
  }
  if (kind === "task") {
    for (const dep of b.dependencies) {
      const t = o.ref(a, "task", dep);
      requireThat(
        t.projectId === b.projectId,
        "Dependency belongs to another project",
      );
    }
    for (const id of b.equipmentIds) {
      const e = o.ref(a, "equipment", id);
      requireThat(
        e.projectId === b.projectId,
        "Equipment belongs to another project",
      );
    }
  }
  if (kind === "time" && b.costCodeId) {
    const c = o.ref(a, "costCode", b.costCodeId);
    requireThat(
      c.projectId === b.projectId &&
        c.laborType === o.ref(a, "task", b.taskId).laborType,
      "Cost code must match project and labor type",
    );
  }
  if (kind === "conversion") {
    const p = o.ref(a, "part", b.partId);
    requireThat(
      b.toUnit === p.unit && b.fromUnit !== p.unit,
      "Conversion must end in the catalog unit",
    );
    requireThat(
      !o
        .all(a, "conversion")
        .some(
          (r) =>
            r.partId === b.partId &&
            r.fromUnit === b.fromUnit &&
            r.status !== "Rejected",
        ),
      "Conversion already exists",
    );
  }
  if (kind === "poAmendment") {
    const po = o.ref(a, "po", b.poId);
    requireThat(
      po.projectId === b.projectId &&
        ["Issued", "Acknowledged"].includes(po.status),
      "An issued PO in this project is required",
    );
    requireThat(
      po.version === b.poVersion,
      "PO changed; reload before proposing amendment",
      409,
    );
    requireThat(
      new Set(b.lines.map((l: any) => l.id)).size === b.lines.length,
      "Duplicate line IDs",
    );
    for (const l of po.lines) {
      const n = b.lines.find((x: any) => x.id === l.id);
      requireThat(
        n && n.partId === l.partId,
        "Existing line identities must be retained",
      );
      requireThat(
        n.quantity >= o.receiptTotal(a, po.id, l.id),
        "Cannot reduce below net received quantity",
      );
    }
    for (const l of b.lines) {
      o.ref(a, "part", l.partId);
      requireThat(l.leadMax >= l.leadMin, "Invalid lead-time range");
    }
  }
  if (kind === "credit") {
    const po = o.ref(a, "po", b.poId),
      m = o.ref(a, "movement", b.returnMovementId);
    requireThat(
      po.projectId === b.projectId && m.poId === po.id && m.action === "return",
      "Credit requires a return from this PO",
    );
    const line = po.lines.find((l: any) => l.id === m.lineId);
    const allocated = o
      .all(a, "credit")
      .filter((c) => c.returnMovementId === m.id && c.status !== "Rejected")
      .reduce((s, c) => s + c.amount, 0);
    requireThat(
      b.amount + allocated <= m.quantity * line.unitCost + 0.01,
      "Credit exceeds returned material value",
    );
    b.currency = po.currency;
  }
  if (kind === "shipment") {
    const po = o.ref(a, "po", b.poId);
    requireThat(
      po.projectId === b.projectId &&
        ["Issued", "Acknowledged"].includes(po.status),
      "Shipment needs an issued PO",
    );
    requireThat(
      new Set(b.lines.map((l: any) => l.lineId)).size === b.lines.length,
      "Duplicate shipment line",
    );
    for (const l of b.lines) {
      const p = po.lines.find((x: any) => x.id === l.lineId);
      const planned = o
        .all(a, "shipment")
        .filter((s) => s.poId === po.id && s.status !== "Cancelled")
        .flatMap((s) => s.lines)
        .filter((x: any) => x.lineId === l.lineId)
        .reduce((s: number, x: any) => s + x.quantity, 0);
      requireThat(
        p && planned + l.quantity <= p.quantity,
        "Split shipment exceeds ordered quantity",
      );
    }
    b.status = "Planned";
  }
  if (kind === "asset") {
    const m = o.ref(a, "movement", b.receiptId);
    requireThat(
      m.projectId === b.projectId &&
        m.partId === b.partId &&
        ["receive", "inspect"].includes(m.action) &&
        m.condition === "Good",
      "Asset requires a matching receipt",
    );
    requireThat(
      !o.store
        .list(a.org, "movement")
        .some((x) => x.action === "reverse" && x.referenceId === m.id),
      "Receipt was reversed",
    );
    requireThat(
      o.balance(a, b.partId, m.locationId).available >
        o.store
          .list(a.org, "asset")
          .filter(
            (x) =>
              x.partId === b.partId &&
              x.locationId === m.locationId &&
              x.status === "Received",
          ).length,
      "No unallocated received units remain to serialize",
    );
    requireThat(
      !o.store
        .list(a.org, "asset")
        .some((s) => s.serial === b.serial && s.partId === b.partId),
      "Serial number already registered",
    );
    requireThat(
      o.store.list(a.org, "asset").filter((s) => s.receiptId === m.id).length <
        m.quantity,
      "More serials than units received",
    );
    b.locationId = m.locationId;
    b.status = "Received";
    b.taskId = "";
    b.condition = "Good";
  }
  if (kind === "adjustment") {
    if (b.assetId) {
      const asset = o.ref(a, "asset", b.assetId);
      requireThat(
        asset.projectId === b.projectId &&
          asset.partId === b.partId &&
          asset.locationId === b.locationId &&
          ["Received", "Reserved", "Issued", "Installed"].includes(
            asset.status,
          ) &&
          b.quantity === -1 &&
          b.action === "damage",
        "Asset damage must match active custody and remove one unit",
      );
      b.assetVersion = asset.version;
    }
    o.ref(a, "location", b.locationId);
    requireThat(
      b.action !== "damage" || b.quantity < 0,
      "Damage removes stock; use a negative quantity",
    );
  }
  if (kind === "calendar")
    requireThat(
      !o.all(a, "calendar").some((c) => c.workerId === b.workerId),
      "Calendar exists; edit the existing calendar",
    );
  if (kind === "scheduleRevision") {
    requireThat(
      new Set(b.dates.map((d: any) => d.taskId)).size === b.dates.length,
      "Duplicate task",
    );
    for (const d of b.dates) {
      const t = o.ref(a, "task", d.taskId);
      requireThat(
        t.projectId === b.projectId && d.finish >= d.start,
        "Invalid schedule dates",
      );
    }
    b.taskVersions = Object.fromEntries(
      b.dates.map((d: any) => [d.taskId, o.ref(a, "task", d.taskId).version]),
    );
  }
  if (kind === "productionCorrection") {
    const p = o.ref(a, "production", b.productionId);
    requireThat(
      p.projectId === b.projectId && p.status === "Approved",
      "Correction requires approved production",
    );
    requireThat(
      b.quantity <= p.quantity,
      "Correction can reduce/reverse production; record new production for increases",
    );
    b.originalVersion = p.version;
  }
  if (kind === "notice") {
    const user = o.store.user(b.recipientId);
    requireThat(
      user.org === a.org,
      "Recipient belongs to another organization",
    );
    o.ref(user, "project", b.projectId);
    b.status = "Unread";
  }
  if (kind === "crewTemplate")
    requireThat(
      b.roles.reduce((n: number, r: any) => n + r.count, 0) === b.size,
      "Role counts must equal crew size",
    );
  if (kind === "equipment")
    requireThat(
      !b.availableFrom ||
        !b.availableUntil ||
        b.availableUntil >= b.availableFrom,
      "Equipment date range invalid",
    );
  if (kind === "checkin" && a.role === "worker")
    requireThat(b.workerId === a.workerId, "Own check-in only", 403);
  if (kind === "po" && b.replacesPoId) {
    const original = o.ref(a, "po", b.replacesPoId);
    requireThat(
      original.projectId === b.projectId,
      "Replacement project must match",
    );
  }
}
