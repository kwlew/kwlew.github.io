import { test } from "node:test";
import assert from "node:assert/strict";
import { fitFrustum, LEVEL_GAP, WALL_H } from "../../assets/js/maze-sim/scene3d-model.js";

test("fitFrustum is square at aspect 1 and covers the bounding sphere", () => {
  const f = fitFrustum([9, 7], 1);
  assert.equal(f.halfW, f.halfH);
  // The sphere around the target reaches the footprint corners: any azimuth keeps them in frame.
  assert.ok(f.halfH >= 6.87, `halfH ${f.halfH}`);
  const reach = Math.hypot(Math.hypot(4.5, 4.5), LEVEL_GAP + WALL_H - LEVEL_GAP / 2);
  assert.ok(f.halfH >= 1.08 * reach - 1e-9, `halfH ${f.halfH} < ${1.08 * reach}`);
});

test("fitFrustum scales the width with the aspect ratio", () => {
  const wide = fitFrustum([9, 7], 2);
  assert.equal(wide.halfW, 2 * wide.halfH);
  assert.ok(wide.halfH >= 6.87);
  // Portrait: the width is the limiting axis, so the height grows to keep the stack in frame.
  const tall = fitFrustum([9, 7], 0.5);
  assert.equal(tall.halfH, 2 * tall.halfW);
  assert.ok(tall.halfW >= 6.87);
});

test("fitFrustum targets the middle of the level gap", () => {
  const f = fitFrustum([9, 7], 1);
  assert.equal(f.target.y, 1.25);
  assert.equal(f.target.x, 0);
  assert.equal(f.target.z, 0);
});
