import { test } from "node:test";
import assert from "node:assert/strict";
import { seal, unseal, fieldPackages } from "../src/offline-vault.js";
test("offline vault authenticates encrypted drafts, rejects tampering and never stores supplier or payroll fields", async () => {
  const ws = {
    actor: {
      id: "worker-user",
      org: "tenant",
      name: "Field worker",
      role: "worker",
    },
    data: {
      assignment: [
        {
          id: "a",
          version: 1,
          projectId: "p",
          taskId: "t",
          workerId: "w",
          date: "2026-12-01",
          hours: 8,
          status: "Planned",
        },
      ],
      task: [
        {
          id: "t",
          version: 1,
          name: "Install",
          unit: "ea",
          target: 10,
          instructions: "Work safely",
          privateCost: 12345,
        },
      ],
      project: [{ id: "p", name: "Job", fieldBudget: 9000 }],
      worker: [{ id: "w", name: "Field worker", hourlyRate: 92 }],
      quote: [{ unitCost: 999 }],
      payroll: ["private"],
    },
    readiness: [
      {
        taskId: "t",
        lines: [
          {
            partNumber: "PART",
            quantity: 10,
            coverage: 2,
            unit: "ea",
            risk: "Blocked",
            supplierUnitCost: 777,
          },
        ],
      },
    ],
  };
  const kit = {
      ...fieldPackages(ws),
      drafts: [{ notes: "private field evidence", quantity: 2 }],
    },
    passphrase = "synthetic-test-offline-passphrase";
  const first = await seal(kit, passphrase),
    second = await seal(kit, passphrase);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.ok(!JSON.stringify(first).includes("private field evidence"));
  assert.deepEqual(await unseal(first, passphrase), kit);
  assert.ok(!JSON.stringify(kit).includes("12345"));
  assert.ok(!JSON.stringify(kit).includes("hourlyRate"));
  assert.ok(!JSON.stringify(kit).includes("supplierUnitCost"));
  await assert.rejects(
    unseal(first, "incorrect-offline-passphrase"),
    /Cannot unlock/,
  );
  await assert.rejects(
    unseal(
      {
        ...first,
        ciphertext:
          (first.ciphertext[0] === "A" ? "B" : "A") + first.ciphertext.slice(1),
      },
      passphrase,
    ),
    /Cannot unlock/,
  );
  await assert.rejects(seal(kit, "short"), /12 characters/);
  assert.throws(
    () => fieldPackages({ ...ws, actor: { ...ws.actor, role: "vendor" } }),
    /permission/,
  );
});
