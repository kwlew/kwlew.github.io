import { test } from "node:test";
import assert from "node:assert/strict";
import { generateField } from "../../assets/js/maze-sim/maze.js";
import { createSim, step, pose, stateLabel, IDENTIFY_MS, KIT_MS } from "../../assets/js/maze-sim/robot.js";
import { kitsRequired, POINTS } from "../../assets/js/maze-sim/scoring.js";

const TYPES = ["H", "S", "U", "red", "yellow", "green"];

function runToComplete(sim) {
  for (let i = 0; i < 20000 && sim.phase !== "COMPLETE"; i++) step(sim, 50);
}

test("kitsRequired", () => {
  assert.equal(kitsRequired("H"), 2);
  assert.equal(kitsRequired("red"), 2);
  assert.equal(kitsRequired("S"), 1);
  assert.equal(kitsRequired("yellow"), 1);
  assert.equal(kitsRequired("U"), 0);
  assert.equal(kitsRequired("green"), 0);
  assert.deepEqual(POINTS, { VICTIM_ID: 5, KIT: 10, RAMP: 10, EXIT_BONUS_PER_VICTIM: 10 });
});

test("victim types are deterministic and valid", () => {
  const seen = new Set();
  for (let seed = 1; seed <= 50; seed++) {
    const a = generateField(seed).levels[0].victims;
    const b = generateField(seed).levels[0].victims;
    assert.deepEqual(a, b);
    for (const v of a) {
      assert.ok(TYPES.includes(v.type), `seed ${seed} type ${v.type}`);
      seen.add(v.type);
    }
  }
  assert.equal(seen.size, 6, "all six types occur");
});

test("identify then drop kits", () => {
  const field = generateField(7);
  const sim = createSim(field);
  runToComplete(sim);
  assert.equal(sim.phase, "COMPLETE");
  // Global victim order: level 0 victims, then level 1.
  const victims = field.levels.flatMap(level => level.victims);
  assert.ok(field.levels[1].victims.length > 0);
  assert.equal(sim.kits.length, victims.length);
  victims.forEach((v, i) => {
    assert.ok(sim.identified.has(i), `victim ${i} identified`);
    assert.equal(sim.kits[i], kitsRequired(v.type), `victim ${i} kits`);
  });
});

test("large dt equals small dt", () => {
  const snap = sim => ({
    pos: sim.pos, phase: sim.phase, clock: sim.clock, level: sim.level,
    rampTraversals: sim.rampTraversals, pose: pose(sim), gyro: sim.gyro,
    identified: [...sim.identified], kits: sim.kits
  });
  for (const seed of [7, 3, 12]) {
    const a = createSim(generateField(seed));
    const b = createSim(generateField(seed));
    for (let total = 0; total < 120000; total += 5000) {
      step(a, 5000);
      for (let i = 0; i < 100; i++) step(b, 50);
      assert.deepEqual(snap(a), snap(b), `seed ${seed} at ${total + 5000} ms`);
    }
  }
});

test("identify takes IDENTIFY_MS, kit drops take KIT_MS each", () => {
  let checked = 0;
  for (let seed = 1; seed <= 30 && checked < 3; seed++) {
    const field = generateField(seed);
    const sim = createSim(field);
    const victims = field.levels.flatMap(level => level.victims);
    let guard = 0;
    while (sim.phase !== "IDENTIFY" && sim.phase !== "COMPLETE" && guard++ < 20000) step(sim, 10);
    if (sim.phase !== "IDENTIFY") continue;
    const index = victims.findIndex(v => v.node === sim.pos);
    assert.ok(index >= 0, "identify starts on a victim cell");
    assert.equal(stateLabel(sim), "IDENTIFY");
    assert.ok(!sim.identified.has(index));
    const t0 = sim.clock;
    step(sim, IDENTIFY_MS - 1 - (sim.clock - t0));
    assert.equal(sim.phase, "IDENTIFY", "still identifying after IDENTIFY_MS - 1");
    assert.ok(!sim.identified.has(index));
    step(sim, 10);
    assert.ok(sim.identified.has(index));
    const need = kitsRequired(victims[index].type);
    for (let k = 0; k < need; k++) {
      assert.equal(sim.phase, "KIT DROP");
      assert.equal(stateLabel(sim), "KIT DROP");
      assert.equal(sim.kits[index], k);
      step(sim, KIT_MS);
    }
    assert.equal(sim.kits[index], need);
    assert.notEqual(sim.phase, "KIT DROP");
    assert.notEqual(sim.phase, "IDENTIFY");
    checked++;
  }
  assert.ok(checked >= 3);
});
