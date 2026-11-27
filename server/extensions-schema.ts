import { z } from "zod";
const id = z.string().trim().min(1).max(120),
  text = z.string().trim().min(1).max(300),
  notes = z.string().max(5000).default("");
const day = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
      new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v,
    "Use a valid date",
  );
const optionalDay = z.union([day, z.literal("")]).default(""),
  positive = z.coerce.number().finite().positive().max(1e9),
  money = z.coerce.number().finite().min(0).max(1e9);
export const extraSchemas = {
  conversion: z.object({
    partId: id,
    fromUnit: text,
    toUnit: text,
    factor: positive,
    reason: text,
  }),
  poAmendment: z.object({
    projectId: id,
    poId: id,
    poVersion: z.number().int().positive(),
    reason: text,
    freight: money,
    tax: money,
    lines: z
      .array(
        z.object({
          id,
          partId: id,
          quantity: positive,
          unitCost: money,
          confirmedETA: optionalDay,
          ackDate: optionalDay,
          leadMin: z.number().int().min(0).max(3650),
          leadMax: z.number().int().min(0).max(3650),
        }),
      )
      .min(1)
      .max(100),
  }),
  credit: z.object({
    projectId: id,
    poId: id,
    returnMovementId: id,
    amount: positive,
    reference: text,
    reason: text,
  }),
  shipment: z.object({
    projectId: id,
    poId: id,
    reference: text,
    carrier: notes,
    tracking: notes,
    expectedDate: optionalDay,
    lines: z
      .array(z.object({ lineId: id, quantity: positive }))
      .min(1)
      .max(100),
    notes,
  }),
  asset: z.object({
    projectId: id,
    partId: id,
    receiptId: id,
    serial: text,
    warrantyUntil: optionalDay,
    manufacturer: notes,
    notes,
  }),
  adjustment: z.object({
    assetId: z.string().default(""),
    projectId: id,
    partId: id,
    locationId: id,
    action: z.enum(["damage", "adjust"]),
    quantity: z.coerce
      .number()
      .finite()
      .min(-1e9)
      .max(1e9)
      .refine((v) => v !== 0),
    reason: text,
  }),
  crewTemplate: z.object({
    name: text,
    trade: text,
    size: z.number().int().min(1).max(100),
    roles: z
      .array(
        z.object({
          role: text,
          count: z.number().int().positive(),
          skill: notes,
        }),
      )
      .default([]),
    notes,
  }),
  calendar: z
    .object({
      workerId: id,
      workdays: z.array(z.number().int().min(0).max(6)).min(1),
      shiftStart: z.number().min(0).max(23),
      shiftHours: z.number().positive().max(16),
      unpaidBreak: z.number().min(0).max(4).default(0),
      holidays: z.array(day).default([]),
      weeklyLimit: z.number().positive().max(112).default(40),
      overtimeAllowed: z.boolean().default(false),
    })
    .refine(
      (v) => v.unpaidBreak < v.shiftHours && v.shiftStart + v.shiftHours <= 24,
      "Invalid shift/break",
    ),
  equipment: z.object({
    projectId: id,
    name: text,
    availableFrom: optionalDay,
    availableUntil: optionalDay,
    notes,
  }),
  scheduleRevision: z.object({
    mode: z.enum(["forecast", "baseline"]).default("forecast"),
    projectId: id,
    name: text,
    reason: text,
    changeId: z.string().default(""),
    dates: z
      .array(z.object({ taskId: id, start: day, finish: day }))
      .min(1)
      .max(5000),
  }),
  checkin: z.object({
    projectId: id,
    taskId: id,
    workerId: id,
    date: day,
    status: z.enum(["Present", "Absent", "Delayed"]),
    notes,
  }),
  costCode: z.object({
    projectId: id,
    code: text,
    description: text,
    laborType: z.enum(["field", "pm"]),
  }),
  notice: z.object({
    projectId: id,
    recipientId: id,
    title: text,
    message: notes,
  }),
  productionCorrection: z.object({
    projectId: id,
    productionId: id,
    quantity: money,
    reason: text,
  }),
  retention: z.object({ days: z.number().int().min(30).max(36500), notes }),
};
export type ExtraKind = keyof typeof extraSchemas;
