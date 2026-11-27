import { Operations } from "./domain.js";
import { type Actor, requireThat } from "./store.js";
// Additive synthetic examples only. Never called automatically for a writable installation.
export function seedExtensions(o: Operations, a: Actor) {
  if (o.store.list(a.org, "demoExpansion").length) return;
  const p = o.all(a, "project").find((p) => p.name === "EPCC · Valle Verde"),
    other = o
      .all(a, "project")
      .find((p) => p.name === "Westside · Service work");
  requireThat(p && other, "Synthetic base fixture is required");
  for (const w of o.all(a, "worker"))
    if (!o.all(a, "calendar").some((c) => c.workerId === w.id))
      o.create(a, "calendar", {
        workerId: w.id,
        workdays: [1, 2, 3, 4, 5],
        shiftStart: 7,
        shiftHours: 9,
        unpaidBreak: 1,
        weeklyLimit: 40,
        overtimeAllowed: false,
      });
  o.create(a, "crewTemplate", {
    name: "Low-voltage installation crew (demo)",
    trade: "Low voltage",
    size: 4,
    roles: [
      { role: "Lead installer", count: 1, skill: "Low voltage" },
      { role: "Installer", count: 3, skill: "Low voltage" },
    ],
    notes: "Synthetic staffing template; no automatic worker selection.",
  });
  o.create(a, "costCode", {
    projectId: p.id,
    code: "LV-FIELD",
    description: "Low-voltage installation",
    laborType: "field",
  });
  o.create(a, "costCode", {
    projectId: p.id,
    code: "PM-COORD",
    description: "Project coordination",
    laborType: "pm",
  });
  const po = o.all(a, "po")[0],
    line = po.lines.find(
      (l: any) => o.ref(a, "part", l.partId).partNumber === "CAT6A-BL",
    );
  if (line) {
    o.create(a, "quote", {
      projectId: p.id,
      supplierId: po.supplierId,
      partId: line.partId,
      quantity: 100,
      unit: "ea",
      unitCost: 42,
      currency: "USD",
      tiers: [{ minimum: 100, unitCost: 39 }],
      leadMin: 20,
      leadMax: 20,
      originalText:
        "Synthetic quote for demonstrating reviewed price tiers; ARO start unconfirmed.",
      source: "Synthetic v0.2 example",
    });
    o.create(a, "shipment", {
      projectId: p.id,
      poId: po.id,
      reference: "DEMO-SPLIT-REMAINING",
      lines: [{ lineId: line.id, quantity: 40 }],
      notes:
        "Remaining synthetic order quantity; ETA intentionally unconfirmed.",
    });
  }
  const part = o.create(a, "part", {
      partNumber: "DEMO-TEST-KIT",
      manufacturer: "Synthetic Equipment",
      description: "Serialized field test kit (demonstration only)",
      unit: "ea",
      trade: "Low voltage",
      barcode: "CAS-DEMO-KIT-001",
    }),
    loc = o.all(a, "location")[0];
  let order = o.create(a, "po", {
    projectId: other.id,
    supplierId: po.supplierId,
    number: "DEMO-EQUIPMENT-002",
    source: "Synthetic custody/warranty example",
    lines: [{ partId: part.id, quantity: 1, unitCost: 250 }],
  });
  for (const status of ["Submitted", "Approved", "Issued"])
    order = o.transition(a, "po", order.id, { status, version: order.version });
  const receipt = o.movement(a, {
    action: "receive",
    projectId: other.id,
    partId: part.id,
    locationId: loc.id,
    poId: order.id,
    lineId: order.lines[0].id,
    quantity: 1,
    note: "Synthetic accepted test-kit receipt",
  });
  o.create(a, "asset", {
    projectId: other.id,
    partId: part.id,
    receiptId: receipt.id,
    serial: "CAS-DEMO-KIT-001",
    manufacturer: "Synthetic Equipment",
    warrantyUntil: "2028-12-31",
    notes:
      "Fictional unit for demonstrating custody. No real equipment record.",
  });
  o.create(a, "equipment", {
    projectId: other.id,
    name: "Field test kit (demo)",
    availableFrom: "2026-12-01",
    availableUntil: "2027-12-31",
  });
  o.store.add(a, "demoExpansion", { release: "0.2", synthetic: true });
}
