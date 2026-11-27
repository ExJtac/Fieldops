import type { Operations } from "./domain.js";
import type { Actor, RecordData as R } from "./store.js";
// PO revisions are the private price source. Ledger records retain only the revision ID.
// Returns remove the current weighted-average receipt value; reversals undo the exact original value.
export function receiptValuation(
  o: Operations,
  a: Actor,
  po: R,
  lineId: string,
) {
  const entries = new Map<string, number>();
  let quantity = 0,
    value = 0;
  for (const m of o
    .all(a, "movement")
    .filter((m) => m.poId === po.id && m.lineId === lineId && m.received)) {
    let amount = 0;
    if (m.action === "reverse") amount = -(entries.get(m.referenceId) || 0);
    else if (m.received < 0)
      amount = quantity ? (m.received * value) / quantity : 0;
    else {
      const revision = o.store.db
        .prepare(
          m.poVersion
            ? "SELECT body FROM revisions WHERE org=? AND kind='po' AND id=? AND version=?"
            : "SELECT body FROM revisions WHERE org=? AND kind='po' AND id=? AND json_extract(body,'$.updatedAt')<=? ORDER BY version DESC LIMIT 1",
        )
        .get(a.org, po.id, m.poVersion || m.createdAt) as any;
      const source = revision ? JSON.parse(revision.body) : po,
        line = source.lines.find((l: R) => l.id === lineId);
      amount = m.received * (line?.unitCost || 0);
    }
    entries.set(m.id, amount);
    quantity += m.received;
    value += amount;
  }
  return { quantity, value: Math.abs(value) < 1e-8 ? 0 : value, entries };
}
