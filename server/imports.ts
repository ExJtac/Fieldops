import ExcelJS from "exceljs";
import { Operations } from "./domain.js";
import { type Actor, requireThat } from "./store.js";
export type ImportRow = {
  partNumber: string;
  manufacturer: string;
  description: string;
  unit: string;
  quantity: number;
  taskId: string;
  source: string;
};
export function previewImport(
  ops: Operations,
  a: Actor,
  projectId: string,
  rows: any[],
) {
  ops.allowed(a, "requirement");
  ops.ref(a, "project", projectId);
  requireThat(
    Array.isArray(rows) && rows.length > 0 && rows.length <= 5000,
    "Import 1–5000 rows",
  );
  const seen = new Set<string>();
  return rows.map((raw, index) => {
    const row: ImportRow = {
      partNumber: String(raw.partNumber ?? raw.part_number ?? "").trim(),
      manufacturer: String(raw.manufacturer ?? "").trim(),
      description: String(raw.description ?? "").trim(),
      unit: String(raw.unit ?? "").trim(),
      quantity: Number(raw.quantity),
      taskId: String(raw.taskId ?? "").trim(),
      source: String(raw.source ?? "").slice(0, 3000),
    };
    const errors: string[] = [];
    if (!row.partNumber) errors.push("Missing part number");
    if (!Number.isFinite(row.quantity) || row.quantity <= 0)
      errors.push("Quantity must be positive");
    const matches = ops
      .all(a, "part")
      .filter(
        (p) =>
          p.manufacturer.toLowerCase() === row.manufacturer.toLowerCase() &&
          [p.partNumber, ...p.aliases].some(
            (s: string) => s.toLowerCase() === row.partNumber.toLowerCase(),
          ),
      );
    if (matches.length !== 1)
      errors.push(
        matches.length
          ? "Ambiguous part alias"
          : "Catalog part not found; create it first",
      );
    const part = matches[0];
    if (part && part.unit !== row.unit)
      errors.push(
        `Unit mismatch: catalog uses ${part.unit}, source uses ${row.unit}`,
      );
    const task = ops
      .all(a, "task")
      .find((t) => t.id === row.taskId && t.projectId === projectId);
    if (!task) errors.push("Task not found in this project");
    const key = (part?.id || row.partNumber) + "|" + row.taskId;
    if (seen.has(key)) errors.push("Duplicate part / task (including aliases)");
    seen.add(key);
    const existing =
      part &&
      ops
        .all(a, "requirement")
        .find((r) => r.partId === part.id && r.taskId === row.taskId);
    return {
      index: index + 1,
      original: raw,
      row,
      partId: part?.id,
      existingId: existing?.id,
      previousQuantity: existing?.quantity,
      errors,
    };
  });
}
export function commitImport(ops: Operations, a: Actor, raw: any) {
  const preview = previewImport(ops, a, raw.projectId, raw.rows);
  requireThat(
    preview.every((r) => !r.errors.length),
    "Resolve all import review errors",
  );
  requireThat(
    typeof raw.sourceVersion === "string" &&
      raw.sourceVersion.trim().length > 0,
    "Source version is required",
  );
  const results = preview.map((p) => {
    const body = {
      projectId: raw.projectId,
      partId: p.partId!,
      taskId: p.row.taskId,
      quantity: p.row.quantity,
      source: p.row.source || raw.source || "Imported BOM",
      sourceVersion: raw.sourceVersion,
      needBy: "",
    };
    if (p.existingId) {
      const old = ops.ref(a, "requirement", p.existingId);
      return ops.edit(a, "requirement", old.id, {
        ...body,
        version: old.version,
        reason: "Reviewed BOM import " + raw.sourceVersion,
      });
    }
    return ops.create(a, "requirement", body);
  });
  ops.store.add(a, "import", {
    projectId: raw.projectId,
    source: raw.source || "",
    sourceVersion: raw.sourceVersion,
    rows: preview.map((p) => ({
      original: p.original,
      partId: p.partId,
      taskId: p.row.taskId,
    })),
  });
  return { count: results.length };
}
export async function decodeWorkbook(base64: string, format: string) {
  requireThat(base64.length < 12_000_000, "File too large");
  const wb = new ExcelJS.Workbook();
  if (format === "xlsx")
    await wb.xlsx.load(Buffer.from(base64, "base64") as any);
  else {
    const { Readable } = await import("node:stream");
    await wb.csv.read(Readable.from(Buffer.from(base64, "base64")));
  }
  const sheet = wb.worksheets[0];
  requireThat(
    sheet && sheet.rowCount <= 5001,
    "Workbook requires a first sheet with at most 5000 data rows",
  );
  const headers = (sheet.getRow(1).values as any[]).slice(1).map(String);
  return Array.from({ length: sheet.rowCount - 1 }, (_, i) =>
    Object.fromEntries(
      headers.map((h, j) => {
        const v = sheet.getRow(i + 2).getCell(j + 1).value;
        return [h, typeof v === "object" && v !== null ? "" : (v ?? "")];
      }),
    ),
  );
}
