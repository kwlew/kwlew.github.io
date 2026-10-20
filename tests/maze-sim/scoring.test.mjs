import { test } from "node:test";
import assert from "node:assert/strict";
import { score } from "../../assets/js/maze-sim/scoring.js";

const sim = phase => ({
  identified: new Set([0, 1, 2]),
  kits: [2, 1, 0],
  rampTraversals: 2,
  phase
});

test("score counts identifications, kits, ramps and the exit bonus", () => {
  assert.equal(score(sim("COMPLETE")), 5 * 3 + 10 * 3 + 10 * 2 + 10 * 3);
  assert.equal(score(sim("EXPLORING")), 65);
});

test("score tolerates a sim with no ramp counter and counts FADE as finished", () => {
  const bare = { identified: new Set([0]), kits: [1], phase: "EXPLORING" };
  assert.equal(score(bare), 15);
  assert.equal(score({ ...bare, phase: "FADE" }), 25);
});
