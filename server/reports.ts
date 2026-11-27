import { receiptValuation } from "./valuation.js";
import { workforceData } from "./workforce.js";
import { Operations, canCost, addDays } from "./domain.js";
import { type Actor, type RecordData as R, requireThat } from "./store.js";
import { payrollAccess } from "./access.js";
import { date } from "./schemas.js";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
export function reportData(o: Operations, a: Actor, q: any) {
  requireThat(
    a.role !== "worker",
    "Detailed reports require operations staff",
    403,
  );
  const project = String(q.projectId || ""),
    section = String(q.section || ""),
    from = q.from ? date.parse(q.from) : "",
    to = q.to ? date.parse(q.to) : "";
  requireThat(!from || !to || from <= to, "Invalid report date range");
  if (project) o.ref(a, "project", project);
  const snapshot = o.snapshot(a);
  const taskIds = new Set(
    (snapshot.data.task || [])
      .filter(
        (t: R) =>
          (!project || t.projectId === project) &&
          (!section || t.section === section),
      )
      .map((t: R) => t.id),
  );
  const inDate = (d: string) => (!from || d >= from) && (!to || d <= to),
    scope = (r: R) =>
      (!project || r.projectId === project) &&
      (!section || taskIds.has(r.taskId)),
    all = (kind: string) => o.all(a, kind).filter(scope),
    name = (kind: string, id: string) => {
      const r = o.all(a, kind).find((x) => x.id === id);
      return r?.name || r?.partNumber || r?.number || id;
    };
  const tables: Record<string, any[]> = {
    Readiness: snapshot.readiness
      .filter((f: any) => taskIds.has(f.taskId))
      .map(({ lines, holds, ...r }: any) => r),
    Labor: snapshot.forecast.filter((f: any) => taskIds.has(f.taskId)),
  };
  if (a.role === "viewer")
    return { filters: { project, section, from, to }, tables };
  const movements = all("movement").filter((m) =>
    inDate(m.createdAt.slice(0, 10)),
  );
  const time = all("time").filter(
    (t) =>
      inDate(t.date) &&
      ["Approved", "Locked", "Correction requested"].includes(t.status),
  );
  const assignment = all("assignment").filter(
    (t) => inDate(t.date) && t.status !== "Cancelled",
  );
  const forecast = o.forecast(a, project).filter((f) => taskIds.has(f.taskId));
  tables.Productivity = forecast.map((f) => {
    const times = time.filter((t) => t.taskId === f.taskId),
      hours = times.reduce((s, t) => s + t.regular + t.overtime, 0),
      production = all("production")
        .filter(
          (p) =>
            p.taskId === f.taskId && p.status === "Approved" && inDate(p.date),
        )
        .reduce((s, p) => s + p.quantity, 0);
    return {
      task: f.name,
      section: f.section,
      laborType: f.laborType,
      periodHours: hours,
      periodQuantity: production,
      unitsPerHour: hours ? production / hours : null,
      cumulativeActual: f.actual,
      cumulativeEarned: f.earned,
      efficiency: f.actual ? f.earned / f.actual : null,
      remaining: f.remaining,
      estimateAtCompletion: f.estimateAtCompletion,
    };
  });
  tables.Materials = all("requirement").map((r) => {
    const m = movements.filter(
        (m) => m.partId === r.partId && m.taskId === r.taskId,
      ),
      ready = o
        .readiness(a, r.projectId)
        .find((x) => x.taskId === r.taskId)!
        .lines.find((l: any) => l.id === r.id) as any;
    return {
      task: name("task", r.taskId),
      part: name("part", r.partId),
      unit: r.unit,
      required: r.quantity,
      allocated: ready.coverage,
      shortage: ready.shortage,
      needBy: r.needBy,
      risk: ready.risk,
      issuedInPeriod: m.reduce((s, m) => s + m.issued, 0),
      installedInPeriod: m.reduce((s, m) => s + m.installed, 0),
      source: r.source,
      revision: r.sourceVersion,
    };
  });
  tables.Deliveries = o
    .all(a, "po")
    .filter(
      (p) =>
        (!project || p.projectId === project) &&
        ["Issued", "Acknowledged"].includes(p.status),
    )
    .flatMap((p) =>
      p.lines
        .filter((l: any) => !section || taskIds.has(l.taskId))
        .map((l: any) => {
          const part = o.ref(a, "part", l.partId),
            ms = movements.filter((m) => m.poId === p.id && m.lineId === l.id),
            received = o.receiptTotal(a, p.id, l.id);
          return {
            project: name("project", p.projectId),
            po: p.number,
            supplier: name("supplier", p.supplierId),
            part: part.partNumber,
            category: part.csi || part.trade || "Unclassified",
            unit: part.unit,
            ordered: l.quantity,
            netReceived: received,
            receivedInPeriod: ms.reduce((s, m) => s + m.received, 0),
            remaining: l.quantity - received,
            backordered: l.backordered || 0,
            confirmedETA: l.confirmedETA || "",
            status:
              l.quantity === received
                ? "Received"
                : l.backordered
                  ? "Backordered"
                  : received
                    ? "Partially received"
                    : "Ordered",
          };
        }),
    )
    .filter((r) => (!from && !to) || !r.confirmedETA || inDate(r.confirmedETA));
  tables.Workforce = o.all(a, "worker").map((w) => {
    const planned = assignment.filter((x) => x.workerId === w.id),
      actual = time.filter((x) => x.workerId === w.id);
    const days = [...new Set(planned.map((x) => x.date))];
    let capacity = 0;
    for (const day of days) {
      const p = o.ref(
        a,
        "project",
        planned.find((x) => x.date === day)!.projectId,
      );
      capacity += o.workerCapacity(a, p, w, day);
    }
    const plannedHours = planned.reduce((s, x) => s + x.hours, 0);
    return {
      worker: w.name,
      crew: w.crew,
      trade: w.trade,
      planned: plannedHours,
      regular: actual.reduce((s, x) => s + x.regular, 0),
      overtime: actual.reduce((s, x) => s + x.overtime, 0),
      scheduledDayCapacity: capacity,
      utilization: capacity ? plannedHours / capacity : null,
      absences: all("checkin").filter(
        (x) => x.workerId === w.id && x.status === "Absent" && inDate(x.date),
      ).length,
      certifications: w.skills
        .map((s: any) => s.name + (s.expires ? " through " + s.expires : ""))
        .join("; "),
    };
  });
  tables.Certifications = o.all(a, "worker").flatMap((w) =>
    w.skills.map((s: any) => ({
      worker: w.name,
      trade: w.trade,
      certification: s.name,
      expires: s.expires || "",
      status:
        s.expires && s.expires < new Date().toISOString().slice(0, 10)
          ? "Expired"
          : "Current",
    })),
  );
  tables.Warranty = all("asset").map((s) => ({
    part: name("part", s.partId),
    serial: s.serial,
    status: s.status,
    location: name("location", s.locationId),
    task: s.taskId ? name("task", s.taskId) : "",
    warrantyUntil: s.warrantyUntil,
    condition: s.condition,
  }));
  tables.Substitutions = all("substitution").map((s) => ({
    task: name("task", s.taskId),
    original: name("part", s.originalPartId),
    replacement: name("part", s.replacementPartId),
    status: s.status,
    reason: s.reason,
  }));
  tables.Reliability = movements
    .filter((m) => m.action === "receive")
    .map((m) => {
      const po = o.ref(a, "po", m.poId);
      const prior = o.store.db
        .prepare(
          "SELECT body FROM revisions WHERE org=? AND kind='po' AND id=? AND json_extract(body,'$.updatedAt')<=? ORDER BY version DESC LIMIT 1",
        )
        .get(a.org, po.id, m.createdAt) as any;
      const original = prior ? JSON.parse(prior.body) : po,
        line = original.lines.find((l: any) => l.id === m.lineId),
        actual = m.createdAt.slice(0, 10),
        eta = line?.confirmedETA;
      return {
        supplier: name("supplier", po.supplierId),
        po: po.number,
        part: name("part", m.partId),
        quantity: m.quantity,
        promisedAtReceipt: eta || "",
        received: actual,
        daysLate: eta
          ? Math.max(0, (Date.parse(actual) - Date.parse(eta)) / 86400000)
          : null,
      };
    });
  tables.Closeout = forecast.map((f) => ({
    task: f.name,
    laborType: f.laborType,
    target: f.target,
    approvedProduction: f.installed,
    remainingQuantity: Math.max(0, f.target - f.installed),
    plannedHours: f.planned,
    approvedHours: f.actual,
    earnedHours: f.earned,
    remainingHours: f.remaining,
    openHolds: all("hold").filter(
      (h) =>
        h.taskId === f.taskId && !["Resolved", "Rejected"].includes(h.status),
    ).length,
    unapprovedTime: all("time").filter(
      (t) =>
        t.taskId === f.taskId &&
        !["Approved", "Locked", "Rejected"].includes(t.status),
    ).length,
  }));
  tables.Exceptions = tables.Materials.filter((r) => r.shortage > 0).map(
    (r) => ({
      ...r,
      daysPastNeedBy: r.needBy
        ? Math.max(
            0,
            Math.floor((Date.now() - Date.parse(r.needBy)) / 86400000),
          )
        : null,
    }),
  );
  const dates =
    from && to && to <= addDays(from, 730)
      ? Array.from(
          {
            length:
              Math.floor((Date.parse(to) - Date.parse(from)) / 86400000) + 1,
          },
          (_, i) => addDays(from, i),
        )
      : [...new Set(assignment.map((x) => x.date))].sort();
  tables.Headcount = dates.map((day) => ({
    date: day,
    plannedWorkers: new Set(
      assignment.filter((x) => x.date === day).map((x) => x.workerId),
    ).size,
    approvedWorkers: new Set(
      time.filter((x) => x.date === day).map((x) => x.workerId),
    ).size,
    plannedHours: assignment
      .filter((x) => x.date === day)
      .reduce((n, x) => n + x.hours, 0),
    approvedHours: time
      .filter((x) => x.date === day)
      .reduce((n, x) => n + x.regular + x.overtime, 0),
  }));
  tables.Availability = o.all(a, "worker").flatMap((w) =>
    dates.map((day) => {
      const projectRecord = project
        ? o.ref(a, "project", project)
        : o.all(a, "project")[0];
      const planned = assignment
          .filter((x) => x.workerId === w.id && x.date === day)
          .reduce((n, x) => n + x.hours, 0),
        available = projectRecord
          ? o.workerCapacity(a, projectRecord, w, day)
          : 0;
      return {
        worker: w.name,
        crew: w.crew,
        date: day,
        calendarProject: projectRecord?.name || "",
        capacity: available,
        planned,
        remaining: Math.max(0, available - planned),
        overallocated: Math.max(0, planned - available),
      };
    }),
  );
  if (from && to && to <= addDays(from, 366))
    Object.assign(tables, workforceData(o, a, { project, from, to, section }));
  tables.Schedule = o
    .all(a, "task")
    .filter((t) => taskIds.has(t.id))
    .map((t) => ({
      task: t.name,
      section: t.section,
      baselineStart: t.baselineStart,
      baselineFinish: t.baselineEnd,
      forecastStart: t.forecastStart || "",
      forecastFinish: t.forecastEnd || "",
      changeId: t.changeId || "",
      revision: t.scheduleRevisionId || "",
    }));
  if (canCost(a)) {
    tables.Spend = o
      .all(a, "po")
      .filter(
        (p) =>
          (!project || p.projectId === project) &&
          ["Issued", "Acknowledged"].includes(p.status),
      )
      .flatMap((p) =>
        p.lines
          .filter((l: any) => !section || taskIds.has(l.taskId))
          .map((l: any) => {
            const part = o.ref(a, "part", l.partId),
              received = o.receiptTotal(a, p.id, l.id);
            return {
              project: name("project", p.projectId),
              supplier: name("supplier", p.supplierId),
              po: p.number,
              category: part.csi || part.trade || "Unclassified",
              part: part.partNumber,
              currency: p.currency,
              committedMaterial: l.quantity * l.unitCost,
              receivedMaterialValue: receiptValuation(o, a, p, l.id).value,
              receivedValueInPeriod: [
                ...receiptValuation(o, a, p, l.id).entries,
              ]
                .filter(([id]) => movements.some((m) => m.id === id))
                .reduce((n, [, v]) => n + v, 0),
              openMaterialCommitment: (l.quantity - received) * l.unitCost,
            };
          }),
      );
    const grouped = new Map<string, any>();
    for (const line of tables.Spend) {
      const key = [
        line.project,
        line.supplier,
        line.category,
        line.currency,
      ].join("|");
      const row = grouped.get(key) || {
        project: line.project,
        supplier: line.supplier,
        category: line.category,
        currency: line.currency,
        committedMaterial: 0,
        receivedMaterialValue: 0,
        receivedValueInPeriod: 0,
        openMaterialCommitment: 0,
      };
      for (const key of [
        "committedMaterial",
        "receivedMaterialValue",
        "receivedValueInPeriod",
        "openMaterialCommitment",
      ])
        row[key] += line[key];
      grouped.set(key, row);
    }
    tables.SpendTotals = [...grouped.values()];
    tables.OrderCosts = o
      .all(a, "po")
      .filter((p) => (!project || p.projectId === project) && !section)
      .map((p) => ({
        po: p.number,
        status: p.status,
        currency: p.currency,
        freight: p.freight,
        tax: p.tax,
        approvedCredits: all("credit")
          .filter((c) => c.poId === p.id && c.status === "Approved")
          .reduce((n, c) => n + c.amount, 0),
      }));
  }
  if (q.payroll === "true") {
    requireThat(
      payrollAccess(o.store, a),
      "Explicit payroll permission required",
      403,
    );
    requireThat(
      q.consent === "confirmed",
      "Confirm this payroll export explicitly",
    );
    requireThat(from && to, "Payroll requires a date range");
    tables.Payroll = time.map((t) => {
      requireThat(
        t.status !== "Correction requested",
        "Resolve requested time corrections before payroll export",
      );
      const rate = o.store.db
        .prepare(
          "SELECT * FROM labor_rates WHERE org=? AND worker_id=? AND effective<=? ORDER BY effective DESC LIMIT 1",
        )
        .get(a.org, t.workerId, t.date) as any;
      requireThat(
        rate,
        "Missing effective labor rate for " + name("worker", t.workerId),
      );
      requireThat(
        t.costCodeId,
        "Every payroll timecard requires a validated cost code",
      );
      return {
        timeId: t.id,
        workerId: t.workerId,
        worker: name("worker", t.workerId),
        project: name("project", t.projectId),
        task: name("task", t.taskId),
        date: t.date,
        costCode: o.ref(a, "costCode", t.costCodeId).code,
        regular: t.regular,
        overtime: t.overtime,
        rate: rate.rate,
        overtimeMultiplier: rate.overtime_multiplier,
        currency: rate.currency,
        modeledGross:
          t.regular * rate.rate +
          t.overtime * rate.rate * rate.overtime_multiplier,
      };
    });
  }
  // Date filters apply to period measures; inventory balances and forecasts remain explicitly cumulative.
  return {
    filters: { project, section, from, to },
    notes: [
      "Inventory and forecasts are cumulative; period columns use the selected dates.",
      "Section filters use explicit task allocations, including optional taskId on PO lines; unallocated order lines are excluded from section reports. Freight/tax stay in project-only OrderCosts because no section allocation is assumed. Receipt value uses the PO revision at receipt and weighted-average returns. Committed/open totals are current; receivedValueInPeriod follows the date filter.",
      "Received material value is a receipt-based valuation, not a supplier invoice or payment.",
      "No taxes, deductions or automatic payroll transmission.",
    ],
    tables,
  };
}
export async function renderReport(
  report: ReturnType<typeof reportData>,
  format: string,
  table?: string,
) {
  const tables = table ? { [table]: report.tables[table] } : report.tables;
  requireThat(
    Object.values(tables).every(Boolean),
    "Report table not found",
    404,
  );
  if (format === "json")
    return {
      body: Buffer.from(JSON.stringify({ ...report, tables }, null, 2)),
      mime: "application/json",
    };
  if (format === "csv") {
    const rows = Object.values(tables)[0] || [],
      cols = Object.keys(rows[0] || {}),
      clean = (v: any) =>
        '"' +
        String(v ?? "")
          .replace(/^[=+@\-\t\r]/, "'$&")
          .replaceAll('"', '""') +
        '"';
    return {
      body: Buffer.from(
        [cols, ...rows.map((r) => cols.map((c) => r[c]))]
          .map((r) => r.map(clean).join(","))
          .join("\r\n"),
      ),
      mime: "text/csv",
    };
  }
  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    for (const [name, rows] of Object.entries(tables)) {
      const ws = wb.addWorksheet(name);
      ws.columns = Object.keys(rows[0] || { result: "" }).map((key) => ({
        key,
        header: key,
        width: 24,
      }));
      for (const row of rows) ws.addRow(row);
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
    }
    return {
      body: Buffer.from(await wb.xlsx.writeBuffer()),
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }
  requireThat(format === "pdf", "Unknown report format", 404);
  const pdf = new PDFDocument({ size: "A4", margin: 40, bufferPages: true }),
    chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (c) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  const heading = (name: string) =>
    name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (c) => c.toUpperCase());
  pdf
    .fillColor("#173c34")
    .font("Helvetica-Bold")
    .fontSize(23)
    .text("CAS FieldOps");
  pdf
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#52675d")
    .text("Operations report | " + new Date().toISOString().slice(0, 10));
  pdf
    .moveDown(0.5)
    .fontSize(9)
    .text(
      `Section: ${report.filters.section || "All"}    Period: ${report.filters.from || "All dates"} to ${report.filters.to || "current"}`,
    );
  for (const note of report.notes || []) pdf.text(note);
  let first = true;
  for (const [name, rows] of Object.entries(tables)) {
    if (!first) pdf.addPage();
    first = false;
    pdf
      .moveDown()
      .font("Helvetica-Bold")
      .fontSize(17)
      .fillColor("#173c34")
      .text(heading(name));
    pdf.moveDown(0.4);
    if (!rows.length)
      pdf.font("Helvetica").fontSize(10).text("No matching records.");
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index],
        fields = Object.entries(row),
        title = String(
          row.task ||
            row.worker ||
            row.part ||
            row.po ||
            row.serial ||
            "Record " + (index + 1),
        );
      if (pdf.y > pdf.page.height - 130) pdf.addPage();
      pdf.font("Helvetica-Bold").fontSize(11).fillColor("#173c34").text(title);
      pdf.moveDown(0.25);
      for (const [key, value] of fields) {
        const text =
          heading(key) +
          ": " +
          (value == null
            ? "Not recorded"
            : typeof value === "number"
              ? Number(value.toFixed(3)).toLocaleString()
              : String(value));
        pdf.font("Helvetica").fontSize(9).fillColor("#243d33");
        if (pdf.y + pdf.heightOfString(text) > pdf.page.height - 55)
          pdf.addPage();
        pdf.text(text, { width: 515 });
      }
      pdf.moveDown(0.5);
      pdf.strokeColor("#dce4dc").moveTo(40, pdf.y).lineTo(555, pdf.y).stroke();
      pdf.moveDown(0.7);
    }
  }
  const pages = pdf.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    pdf.switchToPage(i);
    pdf
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#52675d")
      .text(
        `CAS FieldOps | ${i + 1} / ${pages.count}`,
        40,
        pdf.page.height - 28,
        { lineBreak: false },
      );
  }
  pdf.end();
  return { body: await done, mime: "application/pdf" };
}
