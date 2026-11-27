import { z } from "zod";
import { extraSchemas } from "./extensions-schema.js";
export function validDate(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    s >= "1900-01-01" &&
    s <= "2199-12-31" &&
    Number.isFinite(Date.parse(s + "T00:00:00Z")) &&
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s
  );
}
export const date = z.string().refine(validDate, "Enter a real calendar date");
export const optionalDate = z.union([date, z.literal("")]).default("");
const text = z.string().trim().min(1).max(300),
  optional = z.string().max(3000).default(""),
  id = z.string().min(1).max(100);
export const qty = z.coerce.number().finite().positive().max(1e9);
const nonnegative = z.coerce.number().finite().min(0).max(1e9);
export const unit = z.enum(["ea", "ft", "m", "box", "roll", "hr"]);
export const schemas = {
  ...extraSchemas,
  project: z.object({
    name: text,
    customer: optional,
    timezone: z
      .string()
      .default("America/Denver")
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
    fieldBudget: nonnegative.default(0),
    pmBudget: nonnegative.default(0),
    stagingDays: z.number().int().min(0).max(60).default(2),
    closures: z.array(date).default([]),
    holidays: z.array(date).default([]),
    workdays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .default([1, 2, 3, 4, 5]),
    notes: optional,
  }),
  task: z
    .object({
      projectId: id,
      name: text,
      section: text,
      unit: unit.default("ea"),
      target: nonnegative.default(0),
      unitHours: nonnegative.default(0),
      laborType: z.enum(["field", "pm"]).default("field"),
      baselineStart: optionalDate,
      baselineEnd: optionalDate,
      requiredSkill: optional,
      materialRequired: z.boolean().default(true),
      dependencies: z.array(z.string()).default([]),
      equipmentIds: z.array(z.string()).default([]),
      permits: optional,
      instructions: optional,
      allocatedHours: nonnegative.nullable().default(null),
      priority: z.number().int().min(1).max(5).default(3),
      changeId: optional,
      released: z.boolean().default(true),
      notes: optional,
    })
    .refine(
      (x) =>
        !x.baselineStart || !x.baselineEnd || x.baselineEnd >= x.baselineStart,
      "Finish must follow start",
    ),
  part: z.object({
    partNumber: text,
    manufacturer: optional,
    description: text,
    unit,
    trade: optional,
    csi: optional,
    unspsc: optional,
    accessoryIds: z.array(z.string()).default([]),
    barcode: optional,
    aliases: z.array(z.string().min(1).max(100)).max(50).default([]),
    notes: optional,
  }),
  supplier: z.object({
    name: text,
    email: z.union([z.email(), z.literal("")]).default(""),
    phone: optional,
    notes: optional,
  }),
  location: z.object({ name: text, bin: optional }),
  requirement: z.object({
    projectId: id,
    taskId: id,
    partId: id,
    quantity: qty,
    needBy: optionalDate,
    source: optional,
    sourceVersion: optional,
    changeId: optional,
    criticality: z.enum(["normal", "critical"]).default("normal"),
  }),
  quote: z
    .object({
      projectId: id,
      partId: id,
      supplierId: id,
      quantity: qty,
      unit,
      unitCost: nonnegative,
      currency: z.enum(["USD", "CAD", "EUR", "GBP"]).default("USD"),
      freight: nonnegative.default(0),
      tax: nonnegative.default(0),
      leadMin: z.coerce.number().int().min(0).max(3650).default(0),
      leadMax: z.coerce.number().int().min(0).max(3650).default(0),
      ackDate: optionalDate,
      validUntil: optionalDate,
      rfqId: optional,
      requestDate: optionalDate,
      responseDate: optionalDate,
      originalText: optional,
      tiers: z
        .array(z.object({ minimum: qty, unitCost: nonnegative }))
        .default([]),
      source: optional,
      notes: optional,
    })
    .refine(
      (x) => x.leadMax >= x.leadMin,
      "Maximum lead time must be at least minimum",
    ),
  rfq: z.object({
    projectId: id,
    supplierId: id,
    partId: id,
    quantity: qty,
    needBy: optionalDate,
    notes: optional,
  }),
  po: z.object({
    projectId: id,
    supplierId: id,
    number: text,
    source: optional,
    externalReference: optional,
    replacesPoId: optional,
    receivingLocationId: optional,
    currency: z.enum(["USD", "CAD", "EUR", "GBP"]).default("USD"),
    freight: nonnegative.default(0),
    tax: nonnegative.default(0),
    notes: optional,
    lines: z
      .array(
        z.object({
          partId: id,
          quantity: qty,
          unitCost: nonnegative,
          confirmedETA: optionalDate,
          leadMin: z.coerce.number().int().min(0).max(3650).default(0),
          leadMax: z.coerce.number().int().min(0).max(3650).default(0),
          ackDate: optionalDate,
        }),
      )
      .min(1)
      .max(100),
  }),
  worker: z.object({
    name: text,
    trade: text,
    kind: z.enum(["employee", "contractor"]).default("employee"),
    crew: optional,
    region: optional,
    supervisor: optional,
    vendorReference: optional,
    employmentReference: optional,
    qualifications: optional,
    dailyHours: z.coerce.number().min(0.5).max(16).default(8),
    skills: z
      .array(z.object({ name: text, expires: optionalDate }))
      .default([]),
    active: z.boolean().default(true),
  }),
  leave: z.object({
    workerId: id,
    date,
    hours: z.coerce.number().positive().max(24),
    reason: optional,
  }),
  assignment: z.object({
    projectId: id,
    taskId: id,
    workerId: id,
    date,
    start: z.coerce.number().min(0).max(23.75).default(7),
    hours: z.coerce.number().positive().max(16),
    override: optional,
    role: optional,
    priority: z.number().int().min(1).max(5).default(3),
    allocation: z.number().min(1).max(100).default(100),
  }),
  time: z
    .object({
      projectId: id,
      taskId: id,
      workerId: id,
      date,
      start: z.coerce.number().min(0).max(23.75).default(7),
      costCodeId: optional,
      workerReviewed: z.boolean().default(false),
      regular: z.coerce.number().min(0).max(16),
      overtime: z.coerce.number().min(0).max(16).default(0),
      notes: optional,
    })
    .refine(
      (x) =>
        x.regular + x.overtime > 0 && x.start + x.regular + x.overtime <= 24,
      "Hours must be positive and end within the day",
    ),
  production: z.object({
    projectId: id,
    taskId: id,
    date,
    quantity: qty,
    unit,
    notes: optional,
  }),
  reforecast: z.object({
    projectId: id,
    taskId: id,
    remainingHours: nonnegative,
    reason: text,
    changeId: optional,
  }),
  hold: z.object({
    projectId: id,
    taskId: id,
    reason: text,
    proposedStart: optionalDate,
    changeId: optional,
  }),
  substitution: z.object({
    projectId: id,
    taskId: id,
    originalPartId: id,
    replacementPartId: id,
    reason: text,
  }),
  change: z.object({
    projectId: id,
    title: text,
    description: text,
    source: optional,
  }),
};
export type Kind = keyof typeof schemas;
export const roles = [
  "admin",
  "pm",
  "purchasing",
  "foreman",
  "worker",
  "viewer",
] as const;
