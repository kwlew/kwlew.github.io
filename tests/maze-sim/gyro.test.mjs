import { test } from "node:test";
import assert from "node:assert/strict";
import { generateField } from "../../assets/js/maze-sim/maze.js";
import {
  createSim, step, formatHeading, displayJitter, frontMm, TURN_MS
} from "../../assets/js/maze-sim/robot.js";

const MAX_DRIFT = 0.6;
const angularGap = (a, b) => Math.abs(((a - b + 540) % 360 + 360) % 360 - 180);

function runSeed(seed, onStep) {
  const sim = createSim(generateField(seed));
  let guard = 0;
  while (sim.phase !== "COMPLETE" && guard++ < 20000) {
    step(sim, 50);
    onStep(sim);
  }
  assert.equal(sim.phase, "COMPLETE");
  return sim;
}

test("formatHeading pads to 3 integer digits and 1 decimal", () => {
  assert.equal(formatHeading(90.4), "090.4°");
  assert.equal(formatHeading(359.96), "000.0°");
  assert.equal(formatHeading(0), "000.0°");
  assert.equal(formatHeading(-0.04), "000.0°");
  assert.equal(formatHeading(270), "270.0°");
  assert.equal(formatHeading(360.4), "000.4°");
});

test("drift stays within ±0.6° over seed 3 and actually moves", () => {
  let moved = false;
  runSeed(3, sim => {
    assert.ok(Math.abs(sim.drift) <= MAX_DRIFT + 1e-9, `drift ${sim.drift}`);
    if (sim.drift !== 0) moved = true;
  });
  assert.ok(moved, "drift random-walks during straight moves");
});

test("drift is 0 through each turn and when it completes", () => {
  let turns = 0;
  runSeed(3, sim => {
    const move = sim.step;
    if (!move || !move.turn) return;
    const elapsed = sim.clock - move.start;
    // Up to and including the first slice that finishes the turn.
    if (elapsed < move.turn + 50) {
      turns++;
      assert.equal(sim.drift, 0, `drift at elapsed ${elapsed} of a ${move.turn} ms turn`);
    }
  });
  assert.ok(turns > 0, "seed 3 turns at least once");
});

test("gyro is the exact heading x 90 plus drift, once a turn is done", () => {
  runSeed(3, sim => {
    assert.ok(sim.gyro >= 0 && sim.gyro < 360, `gyro ${sim.gyro} in [0, 360)`);
    const move = sim.step;
    if (move && sim.clock - move.start < move.turn) return; // mid-turn: animated
    const heading = move ? move.dir : sim.heading;
    assert.ok(angularGap(sim.gyro, heading * 90 + sim.drift) < 1e-6, `gyro ${sim.gyro} vs heading ${heading}`);
  });
});

test("gyro sweeps through a turn rather than snapping", () => {
  const sim = createSim(generateField(3));
  const seen = new Set();
  let guard = 0;
  while (sim.phase !== "COMPLETE" && guard++ < 20000) {
    step(sim, 10);
    if (sim.step && sim.step.turn && sim.clock - sim.step.start < TURN_MS) seen.add(sim.gyro);
  }
  assert.ok(seen.size > 2, "gyro takes intermediate values during a turn");
});

test("drift depends only on seed and total time sliced into 50 ms ticks", () => {
  const a = createSim(generateField(3));
  const b = createSim(generateField(3));
  step(a, 5000);
  for (let i = 0; i < 100; i++) step(b, 50);
  assert.equal(a.drift, b.drift);
  assert.equal(a.gyro, b.gyro);
});

test("display jitter is a pure hash in [-1, 1)", () => {
  assert.equal(displayJitter(1234, 2), displayJitter(1234, 2));
  const seen = new Set();
  for (let at = 0; at < 500; at++) {
    for (let i = 0; i < 4; i++) {
      const j = displayJitter(at, i);
      assert.ok(j >= -1 && j < 1, `jitter ${j}`);
      seen.add(j);
    }
  }
  assert.ok(seen.size > 1900, "values spread out, not constant");
});

test("frontMm is the front beam length in mm within ±3%", () => {
  const sim = createSim(generateField(3));
  const nominal = sim.beams[0].tiles * 300;
  const mm = frontMm(sim);
  assert.ok(Number.isInteger(mm));
  assert.ok(mm >= Math.floor(nominal * 0.97) && mm <= Math.ceil(nominal * 1.03), `${mm} vs ${nominal}`);
  assert.equal(frontMm(sim), mm, "stable between calls");
});
