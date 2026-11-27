import { test } from "node:test";
import assert from "node:assert/strict";
import { materialCoverage } from "../server/material-coverage.js";
test("fractional and tiny material balances conserve stock without inventing readiness", () => {
  const needs = [
      { id: "a", partId: "A", quantity: 0.1 },
      { id: "b", partId: "B", quantity: 0.2 },
    ],
    subs = [
      { originalPartId: "A", replacementPartId: "C" },
      { originalPartId: "B", replacementPartId: "C" },
    ];
  const covered = materialCoverage(needs, subs, new Map([["C", 0.3]]));
  assert.equal(covered.get("a")!.coverage, 0.1);
  assert.equal(covered.get("b")!.coverage, 0.2);
  const tiny = [{ id: "t", partId: "T", quantity: 1e-10 }];
  assert.equal(
    materialCoverage(tiny, [], new Map([["T", 0]])).get("t")!.coverage,
    0,
  );
  assert.equal(
    materialCoverage(tiny, [], new Map([["T", 1e-10]])).get("t")!.coverage,
    1e-10,
  );
});
