import {
  externalPoPreview,
  externalPoCommit,
  adaptEstimate,
  estimatePreview,
  estimateCommit,
} from "./intake.js";
import { decodeWorkbook } from "./imports.js";
import { adapterView } from "./adapters.js";
import type { Express } from "express";
import { z } from "zod";
import { Operations, canCost } from "./domain.js";
import { Advanced } from "./advanced.js";
import { Planning } from "./planning.js";
import { type Actor, requireThat, hash } from "./store.js";
import { payrollAccess } from "./access.js";
import { reportData, renderReport } from "./reports.js";
import { financialView, commercialAccess } from "./financial.js";
import { workforceData } from "./workforce.js";
import {
  materialWorkspace,
  materialTimeline,
  compareQuotes,
} from "./material-views.js";
export function advancedRoutes(app: Express, o: Operations) {
  const advanced = new Advanced(o),
    planning = new Planning(o),
    s = o.store;
  const write = (q: any, r: any, fn: () => any) =>
    r.json(
      o.write(
        r.locals.actor,
        String(q.get("Idempotency-Key") || ""),
        { method: q.method, path: q.path, body: q.body },
        fn,
      ),
    );
  app.post("/api/v1/intake/decode", async (q, r) => {
    const a = r.locals.actor;
    requireThat(
      ["admin", "pm", "purchasing"].includes(a.role),
      "Import permission required",
      403,
    );
    if (q.body.mode === "estimate-json")
      return void r.json(adaptEstimate(q.body.source));
    r.json({
      rows: await decodeWorkbook(
        z.string().parse(q.body.base64),
        z.enum(["csv", "xlsx"]).parse(q.body.format),
      ),
    });
  });
  app.post("/api/v1/intake/:mode/preview", (q, r) =>
    r.json(
      q.params.mode === "po"
        ? externalPoPreview(o, r.locals.actor, q.body)
        : q.params.mode === "estimate"
          ? estimatePreview(o, r.locals.actor, q.body)
          : requireThat(false, "Unknown intake", 404),
    ),
  );
  app.post("/api/v1/intake/:mode/commit", (q, r) =>
    write(q, r, () =>
      q.params.mode === "po"
        ? externalPoCommit(o, r.locals.actor, q.body)
        : q.params.mode === "estimate"
          ? estimateCommit(o, r.locals.actor, q.body)
          : requireThat(false, "Unknown intake", 404),
    ),
  );
  app.get("/api/v1/workforce", (q, r) =>
    r.json(
      workforceData(o, r.locals.actor, {
        project: String(q.query.projectId || ""),
        from: z.string().parse(q.query.from),
        to: z.string().parse(q.query.to),
      }),
    ),
  );
  app.get("/api/v1/materials/workspace", (q, r) =>
    r.json(
      materialWorkspace(o, r.locals.actor, String(q.query.projectId || "")),
    ),
  );
  app.get("/api/v1/materials/timeline", (q, r) =>
    r.json(
      materialTimeline(
        o,
        r.locals.actor,
        z.string().parse(q.query.projectId),
        z.string().parse(q.query.partId),
      ),
    ),
  );
  app.get("/api/v1/materials/compare", (q, r) =>
    r.json(
      compareQuotes(o, r.locals.actor, {
        ...q.query,
        quantity: Number(q.query.quantity),
      }),
    ),
  );
  app.get("/api/v1/adapters", (_q, r) =>
    r.json(adapterView(s, r.locals.actor)),
  );
  app.get("/api/v1/financial", (q, r) =>
    r.json(financialView(o, r.locals.actor, String(q.query.projectId || ""))),
  );
  app.get("/api/v1/financial/export", (q, r) => {
    const data = financialView(
      o,
      r.locals.actor,
      String(q.query.projectId || ""),
    );
    requireThat(
      data.commercial || data.payroll,
      "Explicit financial permission required",
      403,
    );
    s.audit(r.locals.actor, "financial.exported", r.locals.actor.id, {
      projectId: q.query.projectId || null,
    });
    r.attachment("fieldops-private-financials.json").json({
      schemaVersion: 1,
      ...data,
    });
  });
  app.get("/api/v1/operations", (_q, r) => {
    const a = r.locals.actor as Actor;
    r.json({
      payroll: payrollAccess(s, a),
      commercial: commercialAccess(o, a),
      commercialGrants:
        a.role === "admin"
          ? s.db
              .prepare(
                "SELECT user_id AS userId FROM commercial_access WHERE org=?",
              )
              .all(a.org)
          : [],
      grants:
        a.role === "admin"
          ? s.db
              .prepare(
                "SELECT user_id AS userId,project_id AS projectId FROM project_access WHERE org=?",
              )
              .all(a.org)
          : [],
      payrollGrants:
        a.role === "admin"
          ? s.db
              .prepare(
                "SELECT user_id AS userId FROM financial_access WHERE org=? AND payroll=1",
              )
              .all(a.org)
          : [],
      events:
        a.role === "admin"
          ? s.db
              .prepare(
                "SELECT id,kind,entity,event_type,state,attempts,error,created_at FROM outbox WHERE org=? ORDER BY created_at DESC LIMIT 200",
              )
              .all(a.org)
          : [],
      rates: payrollAccess(s, a) ? financialView(o, a).rates : [],
    });
  });
  app.post("/api/v1/operations/:name", (q, r) =>
    write(q, r, () => advanced.command(r.locals.actor, q.params.name, q.body)),
  );
  app.post("/api/v1/planning/:name", (q, r) => {
    const a = r.locals.actor as Actor;
    if (q.params.name === "scenario") {
      r.json(planning.scenario(a, q.body));
      return;
    }
    if (q.params.name === "range-preview") {
      r.json(planning.range(a, q.body));
      return;
    }
    if (q.params.name === "level-preview") {
      r.json(planning.level(a, q.body));
      return;
    }
    write(q, r, () => {
      switch (q.params.name) {
        case "range":
          return planning.range(a, q.body, true);
        case "level-apply":
          return planning.apply(a, q.body);
        case "level-undo":
          return planning.undo(a, q.body);
        case "template":
          return planning.template(a, q.body);
        default:
          requireThat(false, "Unknown planning action", 404);
      }
    });
  });
  app.get("/api/v1/timeline/:kind/:id", (q, r) => {
    const a = r.locals.actor as Actor;
    requireThat(
      !["viewer", "worker"].includes(a.role),
      "Operations staff only",
      403,
    );
    const record = o.ref(a, q.params.kind, q.params.id);
    requireThat(
      ![
        "po",
        "quote",
        "poAmendment",
        "credit",
        "supplier",
        "import",
        "estimateImport",
      ].includes(q.params.kind) || canCost(a),
      "Supplier history is restricted",
      403,
    );
    requireThat(
      q.params.kind !== "settings" || a.role === "admin",
      "Administrator required",
      403,
    );
    const revisions = (
      s.db
        .prepare(
          "SELECT version,body FROM revisions WHERE org=? AND kind=? AND id=? ORDER BY version",
        )
        .all(a.org, q.params.kind, record.id) as any[]
    ).map((x) => ({ version: x.version, record: JSON.parse(x.body) }));
    r.json({
      record,
      revisions,
      audit: s.db
        .prepare(
          "SELECT at,action,actor,detail FROM audit WHERE org=? AND entity=? ORDER BY seq",
        )
        .all(a.org, record.id),
    });
  });
  app.get("/api/v1/analytics/:format", async (q, r) => {
    const a = r.locals.actor as Actor,
      report = reportData(o, a, q.query);
    if (q.params.format === "view") {
      r.json(report);
      return;
    }
    const result = await renderReport(
      report,
      q.params.format,
      typeof q.query.table === "string" ? q.query.table : undefined,
    );
    if (q.query.payroll === "true")
      s.audit(a, "payroll.exported", a.id, {
        from: q.query.from,
        to: q.query.to,
        project: q.query.projectId,
        count: report.tables.Payroll?.length,
      });
    r.type(result.mime)
      .attachment(
        "fieldops-" + (q.query.table || "operations") + "." + q.params.format,
      )
      .send(result.body);
  });
  app.get("/api/v1/organization/export", (_q, r) => {
    const a = r.locals.actor as Actor;
    advanced.admin(a);
    const records = (
      s.db
        .prepare("SELECT kind,body FROM records WHERE org=?")
        .all(a.org) as any[]
    ).map((x) => ({ kind: x.kind, record: JSON.parse(x.body) }));
    const revisions = (
      s.db
        .prepare("SELECT kind,id,version,body FROM revisions WHERE org=?")
        .all(a.org) as any[]
    ).map((x) => ({ ...x, body: JSON.parse(x.body) }));
    const audit = s.db
      .prepare("SELECT * FROM audit WHERE org=? ORDER BY seq")
      .all(a.org);
    s.audit(a, "organization.exported", a.org);
    r.attachment("fieldops-organization.json").json({
      schemaVersion: 7,
      memberships: s.db
        .prepare(
          "SELECT m.user_id,m.role,m.active,u.name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org=?",
        )
        .all(a.org),
      projectGrants: s.db
        .prepare("SELECT user_id,project_id FROM project_access WHERE org=?")
        .all(a.org),
      organization: s.db
        .prepare("SELECT * FROM organizations WHERE id=?")
        .get(a.org),
      records,
      revisions,
      audit,
      notes:
        "Operational data export; private pricing/rates, attachments and login credentials are excluded. Export authorized private financials separately. Use the SQLite backup command for a complete recovery copy.",
    });
  });
  function retention(a: Actor, days: number) {
    advanced.admin(a);
    z.number().int().min(30).max(36500).parse(days);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const attachments = s.db
      .prepare(
        "SELECT id,name,created_at,kind,entity,length(bytes) AS bytes FROM attachments WHERE org=? AND created_at<? ORDER BY id",
      )
      .all(a.org, cutoff);
    return {
      days,
      attachments,
      token: hash(JSON.stringify({ days, attachments })),
    };
  }
  app.post("/api/v1/retention/preview", (q, r) =>
    r.json(retention(r.locals.actor, z.number().parse(q.body.days))),
  );
  app.post("/api/v1/retention/apply", (q, r) =>
    write(q, r, () => {
      const a = r.locals.actor as Actor,
        preview = retention(a, z.number().parse(q.body.days));
      requireThat(
        q.body.token === preview.token &&
          q.body.confirm === "DELETE ATTACHMENTS",
        "Confirm the exact retention preview before deleting files",
        409,
      );
      for (const attachment of preview.attachments as any[])
        s.db
          .prepare("DELETE FROM attachments WHERE org=? AND id=?")
          .run(a.org, attachment.id);
      s.add(a, "retention", {
        days: preview.days,
        deleted: preview.attachments.length,
        deletedIds: (preview.attachments as any[]).map((x) => x.id),
        status: "Applied",
      });
      return { deleted: preview.attachments.length };
    }),
  );
}
