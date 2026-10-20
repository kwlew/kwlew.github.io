import { test } from "node:test";
import assert from "node:assert/strict";
import { generateField, levelOf, cellOf, DIRS } from "../../assets/js/maze-sim/maze.js";
import { createSim, step, pose } from "../../assets/js/maze-sim/robot.js";
import {
  LEVEL_GAP, WALL_H, cellToWorld, staticVersion, buildStatic, robotTransform
} from "../../assets/js/maze-sim/scene3d-model.js";

const sameXYZ = (got, want) => assert.deepEqual({ x: got.x, y: got.y, z: got.z }, want);

test("cellToWorld centres levels", () => {
  const field = generateField(1);
  sameXYZ(cellToWorld(field, 0), { x: -4, y: 0, z: -4 });
  sameXYZ(cellToWorld(field, 80), { x: 4, y: 0, z: 4 });
  sameXYZ(cellToWorld(field, 128), { x: -3, y: 2.5, z: -3 });
  sameXYZ(cellToWorld(field, 152), { x: 0, y: 2.5, z: 0 });
  assert.equal(LEVEL_GAP, 2.5);
});

// Walls straight from known sides, keyed by world position (independent of buildStatic).
function expectedWalls(field, sim) {
  const keys = new Set();
  for (const [node, entry] of sim.known) {
    const level = levelOf(node);
    const size = field.levels[level].size;
    const cell = cellOf(node);
    const cx = (cell % size) - (size - 1) / 2;
    const cz = Math.floor(cell / size) - (size - 1) / 2;
    if (entry[0] === true) keys.add(`${level}:${cx}:${cz - 0.5}:x`);
    if (entry[2] === true) keys.add(`${level}:${cx}:${cz + 0.5}:x`);
    if (entry[3] === true) keys.add(`${level}:${cx - 0.5}:${cz}:z`);
    if (entry[1] === true) keys.add(`${level}:${cx + 0.5}:${cz}:z`);
  }
  return keys;
}

function checkWalls(seed, sim, label) {
  const field = sim.field;
  const walls = buildStatic(field, sim).walls;
  const keys = walls.map(w => `${w.level}:${w.x}:${w.z}:${w.axis}`);
  assert.equal(new Set(keys).size, keys.length, `${label} seed ${seed}: duplicate walls`);
  assert.deepEqual([...keys].sort(), [...expectedWalls(field, sim)].sort(), `${label} seed ${seed}`);
}

test("walls match known walls", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const sim = createSim(generateField(seed));
    checkWalls(seed, sim, "step 0");
    let t = 0;
    for (const target of [200, 600]) {
      while (t < target) { step(sim, 50); t += 50; }
      checkWalls(seed, sim, `step ${target}`);
    }
    for (let i = 0; i < 20000 && sim.phase !== "COMPLETE"; i++) step(sim, 50);
    assert.equal(sim.phase, "COMPLETE", `seed ${seed} completes`);
    checkWalls(seed, sim, "COMPLETE");
  }
});

function distToSegment(p, a, b) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ap = { x: p.x - a.x, y: p.y - a.y, z: p.z - a.z };
  const len2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const t = Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / len2));
  return Math.hypot(ap.x - ab.x * t, ap.y - ab.y * t, ap.z - ab.z * t);
}

test("robot stays on ramp line while climbing", () => {
  let climbing = 0;
  let up = 0;
  let down = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const field = generateField(seed);
    const sim = createSim(field);
    const a = cellToWorld(field, field.ramp.from);
    const b = cellToWorld(field, field.ramp.to);
    const pitch = Math.atan2(LEVEL_GAP, Math.hypot(b.x - a.x, b.z - a.z));
    for (let i = 0; i < 20000 && sim.phase !== "COMPLETE"; i++) {
      step(sim, 10);
      const robot = robotTransform(field, sim);
      if (pose(sim).climb === null) {
        assert.equal(robot.pitch, 0, `seed ${seed} off-ramp pitch`);
        assert.equal(robot.y, robot.level * LEVEL_GAP, `seed ${seed} off-ramp y`);
        continue;
      }
      climbing++;
      assert.ok(distToSegment(robot, a, b) <= 0.01, `seed ${seed} off the ramp line`);
      assert.ok(Math.abs(Math.abs(robot.pitch) - pitch) < 1e-6, `seed ${seed} pitch magnitude`);
      // Going up starts on the lower level.
      assert.equal(Math.sign(robot.pitch), robot.level === 0 ? 1 : -1, `seed ${seed} pitch sign`);
      if (robot.pitch > 0) up++; else down++;
    }
  }
  assert.ok(climbing > 0, "some climbs sampled");
  assert.ok(up > 0 && down > 0, "both directions sampled");
});

test("ramp slope stays gentle over seeds 1..200", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const field = generateField(seed);
    const a = cellToWorld(field, field.ramp.from);
    const b = cellToWorld(field, field.ramp.to);
    const pitch = Math.atan2(LEVEL_GAP, Math.hypot(b.x - a.x, b.z - a.z));
    assert.ok(pitch <= Math.atan2(2.5, 3) + 1e-9, `seed ${seed} pitch ${pitch}`);
  }
  // Pitch seen during real climbs, not just the geometry.
  for (let seed = 1; seed <= 200; seed++) {
    const field = generateField(seed);
    const sim = createSim(field);
    for (let i = 0; i < 20000 && sim.phase !== "COMPLETE"; i++) {
      step(sim, 25);
      assert.ok(Math.abs(robotTransform(field, sim).pitch) <= Math.atan2(2.5, 3) + 1e-9, `seed ${seed}`);
    }
  }
});

test("robot transform off the ramp follows the pose", () => {
  const field = generateField(3);
  const sim = createSim(field);
  const start = robotTransform(field, sim);
  assert.deepEqual(start, { level: 0, x: -4 + 0.5 - 0.5 + 0, y: 0, z: 4, yaw: 0, pitch: 0 });
  for (let i = 0; i < 400; i++) {
    step(sim, 50);
    const p = pose(sim);
    const r = robotTransform(field, sim);
    if (p.climb !== null) continue;
    assert.equal(r.yaw, p.angle);
    const half = field.levels[p.level].size / 2;
    assert.ok(Math.abs(r.x - (p.x - half)) <= 0.04 + 1e-9);
    assert.ok(Math.abs(r.z - (p.y - half)) <= 0.04 + 1e-9);
  }
});

test("staticVersion tracks static output", () => {
  const field = generateField(9);
  const sim = createSim(field);
  let version = staticVersion(sim);
  let json = JSON.stringify(buildStatic(field, sim));
  let changes = 0;
  for (let i = 0; i < 20000 && sim.phase !== "COMPLETE"; i++) {
    step(sim, 50);
    const nextVersion = staticVersion(sim);
    const nextJson = JSON.stringify(buildStatic(field, sim));
    assert.equal(nextVersion !== version, nextJson !== json, `step ${i}`);
    if (nextJson !== json) changes++;
    version = nextVersion;
    json = nextJson;
  }
  assert.equal(sim.phase, "COMPLETE");
  assert.ok(changes > 10, "the scene actually grew");
});

test("staticVersion differs across runs", () => {
  const a = createSim(generateField(1));
  const b = createSim(generateField(2));
  a.run = 1;
  b.run = 2;
  assert.notEqual(staticVersion(a), staticVersion(b));
  const c = createSim(generateField(1));
  c.run = 2;
  assert.notEqual(staticVersion(a), staticVersion(c));
  const d = createSim(generateField(2));
  d.run = 1;
  assert.notEqual(staticVersion(d), staticVersion(b));
});

test("victims and kits", () => {
  const field = generateField(7);
  const sim = createSim(field);
  for (let i = 0; i < 20000 && sim.phase !== "COMPLETE"; i++) step(sim, 50);
  const scene = buildStatic(field, sim);
  const total = field.levels.reduce((n, level) => n + level.victims.length, 0);
  assert.equal(scene.victims.length, total);
  assert.ok(scene.victims.every(v => v.identified));
  assert.deepEqual(scene.victims.map(v => v.index), [...Array(total).keys()]);
  assert.equal(scene.kits.length, sim.kits.reduce((n, k) => n + k, 0));
  for (const v of scene.victims) {
    assert.equal(v.y, v.level * LEVEL_GAP + WALL_H / 2);
    const [dx, dz] = DIRS[v.dir];
    assert.ok(Math.abs(dx * (v.x % 1) + dz * (v.z % 1)) > 0, "plate sits off the cell centre");
  }
});

test("ramp appears once an end is visited; debris from visited tiles", () => {
  const field = generateField(5);
  const sim = createSim(field);
  const before = buildStatic(field, sim);
  assert.equal(before.ramp, null);
  for (let i = 0; i < 20000 && sim.phase !== "COMPLETE"; i++) step(sim, 50);
  const scene = buildStatic(field, sim);
  assert.deepEqual(scene.ramp.from, cellToWorld(field, field.ramp.from));
  assert.deepEqual(scene.ramp.to, cellToWorld(field, field.ramp.to));
  assert.equal(scene.ramp.dir, field.ramp.dir);
  const expected = field.levels.reduce((n, level, l) => {
    let count = 0;
    for (const node of sim.visited) {
      if (levelOf(node) === l && level.tiles[cellOf(node)] === "debris") count += level.debrisDots[cellOf(node)].length;
    }
    return n + count;
  }, 0);
  assert.equal(scene.debris.length, expected);
  assert.equal(scene.tiles.length, sim.visited.size + sim.black.size);
});
