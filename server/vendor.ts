import {
  type Actor,
  type Store,
  type RecordData as R,
  requireThat,
} from "./store.js";
export function vendorRecords(
  s: Store,
  a: Actor,
  kind: string,
  rows: R[],
  scope: Set<string>,
): R[] {
  if (!a.supplierId) return [];
  const own = (r: R) => r.supplierId === a.supplierId && scope.has(r.projectId);
  const pos = s
      .list(a.org, "po")
      .filter(
        (r) =>
          own(r) && ["Issued", "Acknowledged", "Cancelled"].includes(r.status),
      ),
    rfqs = s
      .list(a.org, "rfq")
      .filter((r) => own(r) && r.status === "Recorded"),
    quotes = s.list(a.org, "quote").filter(own),
    poIds = new Set(pos.map((p) => p.id));
  if (kind === "project")
    return rows.filter(
      (r) =>
        scope.has(r.id) &&
        (pos.some((p) => p.projectId === r.id) ||
          rfqs.some((p) => p.projectId === r.id)),
    );
  if (kind === "supplier") return rows.filter((r) => r.id === a.supplierId);
  if (kind === "po") return rows.filter((r) => poIds.has(r.id));
  if (kind === "rfq")
    return rows.filter((r) => rfqs.some((q) => q.id === r.id));
  if (kind === "quote") return rows.filter(own);
  if (kind === "shipment")
    return rows.filter((r) => scope.has(r.projectId) && poIds.has(r.poId));
  if (kind === "part") {
    const ids = new Set([
      ...pos.flatMap((p) => p.lines.map((l: R) => l.partId)),
      ...rfqs.map((r) => r.partId),
      ...quotes.map((r) => r.partId),
    ]);
    return rows.filter((r) => ids.has(r.id));
  }
  return [];
}
const pick = (r: R, keys: string[]) =>
  Object.fromEntries(
    ["id", "version", "createdAt", "updatedAt", ...keys].map((k) => [k, r[k]]),
  );
export function vendorWorkspace(s: Store, a: Actor, scope: Set<string>) {
  const data: Record<string, any> = {};
  const fields: Record<string, string[]> = {
    project: ["name"],
    supplier: ["name"],
    part: ["partNumber", "manufacturer", "description", "unit"],
    rfq: ["projectId", "supplierId", "partId", "quantity", "needBy", "status"],
    quote: [
      "projectId",
      "supplierId",
      "partId",
      "quantity",
      "unit",
      "unitCost",
      "currency",
      "freight",
      "tax",
      "leadMin",
      "leadMax",
      "ackDate",
      "validUntil",
      "rfqId",
      "requestDate",
      "responseDate",
      "status",
      "tiers",
    ],
    po: [
      "projectId",
      "supplierId",
      "number",
      "currency",
      "freight",
      "tax",
      "status",
      "lines",
    ],
    shipment: [
      "projectId",
      "poId",
      "reference",
      "carrier",
      "tracking",
      "expectedDate",
      "actualDate",
      "status",
      "lines",
    ],
  };
  for (const [kind, keys] of Object.entries(fields))
    data[kind] = vendorRecords(s, a, kind, s.list(a.org, kind), scope).map(
      (r) => pick(r, keys),
    );
  data.po = data.po.map((p: any) => ({
    ...p,
    lines: p.lines.map((l: any) => ({
      ...l,
      netReceived: s
        .list(a.org, "movement")
        .filter((m) => m.poId === p.id && m.lineId === l.id)
        .reduce((n, m) => n + (m.received || 0), 0),
    })),
  }));
  return { actor: a, data, readiness: [], forecast: [], audit: [] };
}
export function vendorRouteAllowed(method: string, path: string) {
  if (method === "GET")
    return (
      path === "/workspace" ||
      path === "/tenants" ||
      path === "/attachments" ||
      /^\/attachments\/[^/]+$/.test(path)
    );
  if (method === "POST")
    return (
      [
        "/tenants/switch",
        "/records/quote",
        "/records/shipment",
        "/operations/vendorPromise",
        "/attachments",
        "/me/password",
      ].includes(path) || /^\/records\/shipment\/[^/]+\/transition$/.test(path)
    );
  return false;
}
