export type Field = {
  fields?: Field[];
  key: string;
  label: string;
  type?: string;
  ref?: string;
  options?: string[];
  required?: boolean;
  default?: any;
  help?: string;
};
const f = (
  key: string,
  label: string,
  type = "text",
  extra: Partial<Field> = {},
): Field => ({ key, label, type, ...extra });
const project = f("projectId", "Project", "select", {
    ref: "project",
    required: true,
  }),
  task = f("taskId", "Task", "select", { ref: "task", required: true }),
  part = f("partId", "Part", "select", { ref: "part", required: true }),
  worker = f("workerId", "Worker", "select", { ref: "worker", required: true }),
  supplier = f("supplierId", "Supplier", "select", {
    ref: "supplier",
    required: true,
  });
const unit = f("unit", "Unit", "select", {
    options: ["ea", "ft", "m", "box", "roll", "hr"],
    default: "ea",
  }),
  note = f("notes", "Notes", "textarea");
export const forms: Record<string, { title: string; fields: Field[] }> = {
  password: {
    title: "Change your password",
    fields: [
      f("currentPassword", "Current password", "password", { required: true }),
      f("password", "New password (12+ characters)", "password", {
        required: true,
      }),
    ],
  },
  promise: { title: "Supplier promises", fields: [] },
  project: {
    title: "Project",
    fields: [
      f("name", "Project name", "text", { required: true }),
      f("customer", "Customer"),
      f("timezone", "Time zone", "text", { default: "America/Denver" }),
      f("fieldBudget", "Quoted field hours", "number", { default: 0 }),
      f("pmBudget", "Quoted PM hours", "number", { default: 0 }),
      f("holidays", "Holidays (dates, separated by commas)", "list"),
      note,
    ],
  },
  task: {
    title: "Task",
    fields: [
      project,
      f("name", "Task name", "text", { required: true }),
      f("section", "Section", "text", { default: "Section 1", required: true }),
      unit,
      f("target", "Approved quantity", "number", { default: 0 }),
      f("unitHours", "Approved labor hours per unit", "number", { default: 0 }),
      f("laborType", "Labor budget", "select", {
        options: ["field", "pm"],
        default: "field",
      }),
      f("baselineStart", "Baseline start", "date"),
      f("baselineEnd", "Baseline finish", "date"),
      f("requiredSkill", "Required certification"),
      f("released", "Section released", "checkbox", { default: true }),
      note,
    ],
  },
  part: {
    title: "Catalog part",
    fields: [
      f("partNumber", "Manufacturer part number", "text", { required: true }),
      f("manufacturer", "Manufacturer"),
      f("description", "Description", "text", { required: true }),
      unit,
      f("aliases", "Exact aliases (comma-separated)", "list"),
      note,
    ],
  },
  supplier: {
    title: "Supplier",
    fields: [
      f("name", "Supplier name", "text", { required: true }),
      f("email", "Email", "email"),
      f("phone", "Phone"),
      note,
    ],
  },
  location: {
    title: "Storage location",
    fields: [
      f("name", "Location", "text", { required: true }),
      f("bin", "Bin"),
    ],
  },
  requirement: {
    title: "BOM requirement",
    fields: [
      project,
      task,
      part,
      f("quantity", "Required quantity", "number", { required: true }),
      f("needBy", "Need by", "date"),
      f("source", "Source estimate or file"),
      f("sourceVersion", "Source revision"),
    ],
  },
  rfq: {
    title: "Request for quote",
    fields: [
      project,
      supplier,
      part,
      f("quantity", "Quantity", "number", { required: true }),
      f("needBy", "Need by", "date"),
      note,
    ],
  },
  quote: {
    title: "Supplier quote",
    fields: [
      project,
      supplier,
      part,
      f("quantity", "Quoted quantity", "number", { required: true }),
      unit,
      f("unitCost", "Supplier unit price", "number", { required: true }),
      f("currency", "Currency", "select", {
        options: ["USD", "CAD", "EUR", "GBP"],
        default: "USD",
      }),
      f("freight", "Freight", "number", { default: 0 }),
      f("tax", "Tax", "number", { default: 0 }),
      f("leadMin", "Lead time minimum (days ARO)", "number", { default: 0 }),
      f("leadMax", "Lead time maximum (days ARO)", "number", { default: 0 }),
      f("ackDate", "Acknowledged order date", "date", {
        help: "Leave blank when unconfirmed. No forecast arrival is inferred.",
      }),
      f("validUntil", "Quote valid through", "date"),
      f("source", "Quote source"),
      note,
    ],
  },
  po: {
    title: "Purchase order",
    fields: [
      project,
      supplier,
      f("number", "PO number", "text", { required: true }),
      f("currency", "Currency", "select", {
        options: ["USD", "CAD", "EUR", "GBP"],
        default: "USD",
      }),
      f("freight", "Freight", "number", { default: 0 }),
      f("tax", "Tax", "number", { default: 0 }),
      note,
    ],
  },
  worker: {
    title: "Worker",
    fields: [
      f("name", "Name", "text", { required: true }),
      f("trade", "Trade", "text", { required: true }),
      f("kind", "Employment type", "select", {
        options: ["employee", "contractor"],
        default: "employee",
      }),
      f("crew", "Crew"),
      f("dailyHours", "Daily capacity (hours)", "number", { default: 8 }),
      f("skills", "Certifications", "skills", {
        help: "One per line: Low voltage | 2027-12-31. Omit expiry only for non-expiring skills.",
      }),
      f("active", "Active", "checkbox", { default: true }),
    ],
  },
  leave: {
    title: "Leave or absence",
    fields: [
      worker,
      f("date", "Date", "date", { required: true }),
      f("hours", "Unavailable hours", "number", { default: 8 }),
      f("reason", "Reason", "textarea"),
    ],
  },
  assignment: {
    title: "Crew assignment",
    fields: [
      project,
      task,
      worker,
      f("date", "Date", "date", { required: true }),
      f("start", "Start hour (24h, e.g. 7.5)", "number", { default: 7 }),
      f("hours", "Planned hours", "number", { default: 8 }),
      f("override", "Manager override justification", "textarea", {
        help: "Leave blank normally. At least 10 characters required to override a capacity or certification warning.",
      }),
    ],
  },
  time: {
    title: "Time entry",
    fields: [
      project,
      task,
      worker,
      f("date", "Work date", "date", { required: true }),
      f("start", "Start hour (24h)", "number", { default: 7 }),
      f("regular", "Regular hours", "number", { default: 8 }),
      f("overtime", "Overtime hours", "number", { default: 0 }),
      note,
    ],
  },
  production: {
    title: "Daily production",
    fields: [
      project,
      task,
      f("date", "Date", "date", { required: true }),
      f("quantity", "Installed quantity", "number", { required: true }),
      unit,
      note,
    ],
  },
  reforecast: {
    title: "Labor reforecast",
    fields: [
      project,
      task,
      f("remainingHours", "Estimated remaining hours", "number", {
        required: true,
      }),
      f("reason", "Reason for reforecast", "textarea", { required: true }),
    ],
  },
  hold: {
    title: "Schedule hold",
    fields: [
      project,
      task,
      f("reason", "Hold reason", "textarea", { required: true }),
      f("proposedStart", "Proposed forecast date", "date", {
        help: "Proposals do not overwrite approved baseline dates.",
      }),
    ],
  },
  substitution: {
    title: "Material substitution",
    fields: [
      project,
      task,
      { ...part, key: "originalPartId", label: "Original part" },
      { ...part, key: "replacementPartId", label: "Replacement part" },
      f("reason", "Equivalence and reason", "textarea", { required: true }),
    ],
  },
  change: {
    title: "Change record",
    fields: [
      project,
      f("title", "Change title", "text", { required: true }),
      f("description", "Scope / schedule / cost impact", "textarea", {
        required: true,
      }),
      f("source", "Source or change ID"),
    ],
  },
  user: {
    title: "Team access",
    fields: [
      f("name", "Name", "text", { required: true }),
      f("email", "Email", "email", { required: true }),
      f("password", "Temporary password (12+ characters)", "password", {
        required: true,
      }),
      f("role", "Role", "select", {
        options: ["pm", "purchasing", "foreman", "worker", "viewer", "admin"],
        default: "viewer",
      }),
      { ...worker, required: false, help: "Required for worker accounts." },
    ],
  },
};

forms.crewTime = {
  title: "Crew time entry",
  fields: [
    ...forms.time.fields.filter((f) => f.key !== "workerId"),
    f("crew", "Crew name (exact)", "text", { required: true }),
  ],
};
forms.crewAssignment = {
  title: "Assign a crew",
  fields: [
    ...forms.assignment.fields.filter((f) => f.key !== "workerId"),
    f("crew", "Crew name (exact)", "text", { required: true }),
  ],
};
const ref = (key: string, label: string, kind: string, required = true) =>
  f(key, label, "select", { ref: kind, required });
const num = (key: string, label: string, value = 0) =>
  f(key, label, "number", { default: value, required: true });
const day = (key: string, label: string) => f(key, label, "date");
const reason = f("reason", "Reason", "textarea", { required: true });
const multi = (key: string, label: string, kind: string) =>
  f(key, label, "multi", { ref: kind, default: [] });
const repeat = (key: string, label: string, fields: Field[]) => ({
  ...f(key, label, "rows", { default: [] }),
  fields,
});
forms.project.fields.push(
  num("stagingDays", "Delivery staging buffer (days)", 2),
  f("closures", "Site closures (dates, comma-separated)", "list"),
  f("workdays", "Working weekdays (0 Sunday – 6 Saturday)", "days", {
    default: [1, 2, 3, 4, 5],
  }),
);
forms.task.fields.push(
  f("materialRequired", "Material requirements must be verified", "checkbox", {
    default: true,
  }),
  f(
    "allocatedHours",
    "Explicit task budget hours (blank = unallocated)",
    "optionalNumber",
    { default: null },
  ),
  multi("dependencies", "Finish-to-start dependencies", "task"),
  multi("equipmentIds", "Required equipment", "equipment"),
  f("permits", "Permits and access instructions", "textarea"),
  f("instructions", "Work package instructions", "textarea"),
  num("priority", "Priority (1 highest – 5 lowest)", 3),
  ref("changeId", "Related change", "change", false),
);
forms.part.fields.push(
  f("trade", "Trade"),
  f("csi", "CSI classification"),
  f("unspsc", "UNSPSC classification"),
  f("barcode", "Barcode / QR value"),
  multi("accessoryIds", "Accessories", "part"),
);
forms.worker.fields.push(
  f("region", "Coarse region / service area"),
  f("supervisor", "Supervisor"),
  f("vendorReference", "Contractor vendor reference"),
  f("employmentReference", "Employment reference"),
  f("qualifications", "Qualification notes", "textarea"),
);
forms.requirement.fields.push(
  ref("changeId", "Related change", "change", false),
  f("criticality", "Criticality", "select", {
    options: ["normal", "critical"],
    default: "normal",
  }),
);
forms.quote.fields.push(
  ref("rfqId", "Source RFQ", "rfq", false),
  day("requestDate", "Request date"),
  day("responseDate", "Response date"),
  f("originalText", "Original supplier wording", "textarea"),
  repeat("tiers", "Quantity price breaks", [
    num("minimum", "Minimum quantity", 1),
    num("unitCost", "Unit price"),
  ]),
);
forms.po.fields.push(
  f("source", "Order source"),
  f("externalReference", "External PO reference"),
  ref("replacesPoId", "Replaces PO", "po", false),
  ref("receivingLocationId", "Receiving location", "location", false),
);
forms.assignment.fields.push(
  f("role", "Crew role"),
  num("priority", "Priority (1–5)", 3),
  num("allocation", "Allocation percentage", 100),
);
forms.time.fields.push(ref("costCodeId", "Job cost code", "costCode", false));
for (const kind of ["hold", "reforecast"])
  forms[kind].fields.push(ref("changeId", "Related change", "change", false));
Object.assign(forms, {
  conversion: {
    title: "Propose a unit conversion",
    fields: [
      part,
      f("fromUnit", "Source unit", "text", { required: true }),
      f("toUnit", "Catalog unit", "text", { required: true }),
      num("factor", "Catalog units per source unit", 1),
      reason,
    ],
  },
  poAmendment: {
    title: "Propose an issued PO amendment",
    fields: [
      reason,
      num("freight", "Revised freight"),
      num("tax", "Revised tax"),
    ],
  },
  credit: {
    title: "Return credit",
    fields: [
      project,
      ref("poId", "Purchase order", "po"),
      ref("returnMovementId", "Returned movement", "movement"),
      num("amount", "Credit amount"),
      f("reference", "Supplier credit reference", "text", { required: true }),
      reason,
    ],
  },
  shipment: {
    title: "Split shipment",
    fields: [
      project,
      ref("poId", "Purchase order", "po"),
      f("reference", "Shipment reference", "text", { required: true }),
      f("carrier", "Carrier"),
      f("tracking", "Tracking reference"),
      day("expectedDate", "Expected arrival"),
      repeat("lines", "Shipment lines", [
        ref("lineId", "PO line", "poLine"),
        num("quantity", "Quantity", 1),
      ]),
      note,
    ],
  },
  asset: {
    title: "Register a serialized unit",
    fields: [
      project,
      part,
      ref("receiptId", "Receipt", "movement"),
      f("serial", "Serial number", "text", { required: true }),
      day("warrantyUntil", "Warranty through"),
      f("manufacturer", "Manufacturer"),
      note,
    ],
  },
  adjustment: {
    title: "Propose inventory adjustment",
    fields: [
      project,
      part,
      ref("assetId", "Specific serialized asset (damage only)", "asset", false),
      ref("locationId", "Location", "location"),
      f("action", "Action", "select", {
        options: ["adjust", "damage"],
        default: "adjust",
      }),
      f("quantity", "Signed quantity (negative removes stock)", "signed", {
        default: -1,
        required: true,
      }),
      reason,
    ],
  },
  calendar: {
    title: "Worker calendar",
    fields: [
      worker,
      f("workdays", "Working weekdays", "days", { default: [1, 2, 3, 4, 5] }),
      num("shiftStart", "Shift start hour", 7),
      num("shiftHours", "Shift window (including break)", 9),
      num("unpaidBreak", "Unpaid break hours", 1),
      num("weeklyLimit", "Weekly regular-hour limit", 40),
      f("overtimeAllowed", "Overtime authorized", "checkbox"),
      f("holidays", "Holidays (dates, comma-separated)", "list"),
    ],
  },
  crewTemplate: {
    title: "Crew template",
    fields: [
      f("name", "Template name", "text", { required: true }),
      f("trade", "Trade", "text", { required: true }),
      num("size", "Crew size", 4),
      repeat("roles", "Crew roles", [
        f("role", "Role", "text", { required: true }),
        num("count", "Count", 1),
        f("skill", "Required certification"),
      ]),
      note,
    ],
  },
  equipment: {
    title: "Equipment availability",
    fields: [
      project,
      f("name", "Equipment", "text", { required: true }),
      day("availableFrom", "Available from"),
      day("availableUntil", "Available through"),
      note,
    ],
  },
  costCode: {
    title: "Job cost code",
    fields: [
      project,
      f("code", "Cost code", "text", { required: true }),
      f("description", "Description", "text", { required: true }),
      f("laborType", "Labor budget", "select", {
        options: ["field", "pm"],
        default: "field",
      }),
    ],
  },
  checkin: {
    title: "Daily check-in",
    fields: [
      project,
      task,
      worker,
      day("date", "Date"),
      f("status", "Attendance", "select", {
        options: ["Present", "Absent", "Delayed"],
        default: "Present",
      }),
      note,
    ],
  },
  scheduleRevision: {
    title: "Propose a schedule revision",
    fields: [
      project,
      f("mode", "Revision type", "select", {
        options: ["forecast", "baseline"],
        default: "forecast",
      }),
      f("name", "Revision name", "text", { required: true }),
      reason,
      ref("changeId", "Related change", "change", false),
      repeat("dates", "Revised forecast dates", [
        task,
        day("start", "Forecast start"),
        day("finish", "Forecast finish"),
      ]),
    ],
  },
  productionCorrection: {
    title: "Correct approved production",
    fields: [
      project,
      ref("productionId", "Approved production", "production"),
      num("quantity", "Corrected total quantity"),
      reason,
    ],
  },
  "op:assetMove": {
    title: "Serialized custody movement",
    fields: [
      f("action", "Movement", "select", {
        options: [
          "reserve",
          "release",
          "issue",
          "install",
          "return",
          "transfer",
        ],
        default: "reserve",
      }),
      project,
      { ...task, required: false },
      ref("toLocationId", "Transfer destination", "location", false),
      f("note", "Custody evidence / reason", "textarea", { required: true }),
    ],
  },
  "op:shortageRfqs": {
    title: "Create RFQs from shortages",
    fields: [project, supplier],
  },
  "op:quoteToPo": {
    title: "Create PO from approved quote",
    fields: [
      f("number", "Unique PO number", "text", { required: true }),
      num("quantity", "Quantity", 1),
    ],
  },
  "op:backorder": {
    title: "Record a line backorder",
    fields: [
      ref("lineId", "PO line", "poLine"),
      num("quantity", "Quantity backordered"),
      reason,
    ],
  },
  "op:timer": {
    title: "Start a field timer",
    fields: [
      project,
      task,
      worker,
      ref("costCodeId", "Job cost code", "costCode", false),
    ],
  },
  "op:rate": {
    title: "Restricted labor rate",
    fields: [
      worker,
      day("effective", "Effective date"),
      num("rate", "Hourly rate"),
      num("overtimeMultiplier", "Overtime multiplier", 1.5),
      f("currency", "Currency", "select", {
        options: ["USD", "CAD", "EUR", "GBP"],
        default: "USD",
      }),
    ],
  },
  "op:grants": {
    title: "Account project and payroll access",
    fields: [
      multi("projectIds", "Granted projects", "project"),
      f(
        "payroll",
        "Explicit labor-rate and payroll export permission",
        "checkbox",
      ),
    ],
  },
  "plan:range": {
    title: "Assign workers over a date range",
    fields: [
      project,
      task,
      multi("workerIds", "Workers", "worker"),
      day("from", "From"),
      day("to", "Through"),
      num("start", "Start hour", 7),
      num("hours", "Hours per working day", 8),
      f("role", "Crew role"),
      num("priority", "Priority (1–5)", 3),
      num("allocation", "Allocation %", 100),
      f("override", "Manager conflict justification", "textarea"),
    ],
  },
  "plan:template": {
    title: "Build a crew from a template",
    fields: [
      f("crew", "Crew name", "text", { required: true }),
      multi("workerIds", "Selected workers", "worker"),
      day("date", "Certification valid on"),
    ],
  },
});
