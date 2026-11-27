type R = Record<string, any>;
/** Cards describe source records; task allocation cards never imply a PO-to-task allocation. */
export function procurementStages(data: R, project: string) {
  const scoped = (k: string) =>
    (data[k] || []).filter((r: R) => !project || r.projectId === project);
  const part = (id: string) => (data.part || []).find((p: R) => p.id === id);
  const columns: Record<string, R[]> = {
    Requested: [],
    RFQ: [],
    Quoted: [],
    Approved: [],
    Ordered: [],
    Acknowledged: [],
    "Partially received": [],
    Received: [],
    Allocated: [],
    Installed: [],
    Backordered: [],
    Cancelled: [],
    Returned: [],
  };
  for (const r of scoped("requirement")) {
    const movements = scoped("movement").filter(
        (m: R) => m.taskId === r.taskId && m.partId === r.partId,
      ),
      sum = (k: string) =>
        movements.reduce((n: number, m: R) => n + (m[k] || 0), 0),
      covered = sum("reserved") + sum("issued") + sum("installed");
    const label =
      (part(r.partId)?.partNumber || "Part") +
      " · " +
      ((data.task || []).find((t: R) => t.id === r.taskId)?.name || "Task");
    const unit = part(r.partId)?.unit || r.unit;
    if (covered < r.quantity)
      columns.Requested.push({
        id: r.id,
        label,
        quantity: Math.max(0, r.quantity - covered),
        unit,
        status: "Unallocated requirement",
      });
    if (covered > 0)
      columns.Allocated.push({
        id: r.id,
        label,
        quantity: covered,
        unit,
        status: "Task coverage: reserved, issued or installed",
      });
    if (sum("installed") > 0)
      columns.Installed.push({
        id: r.id,
        label,
        quantity: sum("installed"),
        unit,
        status: "Verified installation ledger",
      });
  }
  for (const r of scoped("rfq"))
    columns.RFQ.push({
      ...r,
      label: part(r.partId)?.partNumber || "RFQ",
      unit: part(r.partId)?.unit,
    });
  for (const r of scoped("quote"))
    if (r.status !== "Rejected")
      columns[r.status === "Approved" ? "Approved" : "Quoted"].push({
        ...r,
        id: "quote:" + r.id,
        label: part(r.partId)?.partNumber || "Quote",
        status: "Quote · " + (r.status || "Quoted"),
      });
  for (const po of scoped("po"))
    for (const l of po.lines) {
      const ms = scoped("movement").filter(
          (m: R) => m.poId === po.id && m.lineId === l.id,
        ),
        received = ms.reduce((n: number, m: R) => n + (m.received || 0), 0),
        returned = ms
          .filter((m: R) => m.action === "return")
          .reduce((n: number, m: R) => n + m.quantity, 0);
      const stage =
        po.status === "Cancelled"
          ? "Cancelled"
          : po.status === "Approved"
            ? "Approved"
            : ["Draft", "Submitted"].includes(po.status)
              ? "Requested"
              : received >= l.quantity
                ? "Received"
                : received > 0
                  ? "Partially received"
                  : po.status === "Acknowledged"
                    ? "Acknowledged"
                    : "Ordered";
      const card = {
        id: po.id + l.id,
        label: po.number + " · " + (part(l.partId)?.partNumber || ""),
        quantity: l.quantity,
        unit: part(l.partId)?.unit,
        received,
        eta: l.confirmedETA || "Unconfirmed ETA",
        status: po.status,
      };
      columns[stage].push(card);
      if (l.backordered)
        columns.Backordered.push({
          ...card,
          quantity: l.backordered,
          received: undefined,
        });
      if (returned)
        columns.Returned.push({
          ...card,
          quantity: returned,
          received: undefined,
        });
    }
  return columns;
}
