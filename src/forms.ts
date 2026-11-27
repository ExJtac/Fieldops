export type Field = {
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
