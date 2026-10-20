// Records the parity fixture from the ORIGINAL assets/js/maze-sim.js.
//
// The old file is an IIFE bound to the DOM, so it is not run as-is. Instead the
// source between `const out = {` and the `// ===== RENDER =====` marker (the
// constants, generator and robot logic, untouched) is evaluated in a node:vm
// context with minimal stubs, then driven directly. Nothing is copied by hand,
// so the fixture is whatever the old code really produces.
//
// Usage: node tests/maze-sim/record-parity.mjs [path-to-old-maze-sim.js]
// (Only valid while the old file still has its original logic; Task 2 replaces it.)
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sourcePath = process.argv[2] || `${root}assets/js/maze-sim.js`;
const source = readFileSync(sourcePath, "utf8");

const startAt = source.indexOf("const out = {");
const endAt = source.indexOf("// ===== RENDER =====");
if (startAt < 0 || endAt < 0) throw new Error("maze-sim.js markers not found");
const body = source.slice(startAt, endAt);

const wrapped = `(function () {
  "use strict";
  const canvas = null;
  ${body}
  return { generate, newRun, update, getSim: () => sim, STEP_MS };
})`;

const noElement = () => null;
const context = vm.createContext({
  document: { getElementById: noElement, documentElement: {} },
  window: { matchMedia: () => ({ matches: true }) },
  getComputedStyle: () => ({ getPropertyValue: () => "" })
});
const api = vm.runInContext(wrapped, context)();

const SEEDS = 20;
const fixture = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  // newRun draws its seed as floor(Math.random() * 0x10000); force it.
  vm.runInContext(`Math.random = () => ${seed} / 0x10000;`, context);
  api.newRun(1);
  const sim = api.getSim();
  if (sim.seed !== seed) throw new Error(`seed forcing failed: wanted ${seed}, got ${sim.seed}`);

  const order = [];
  let guard = 0;
  while (sim.phase !== "COMPLETE" && guard++ < 20000) {
    const before = sim.visited.size;
    api.update(50);
    if (sim.visited.size > before) order.push(sim.pos);
  }
  if (sim.phase !== "COMPLETE") throw new Error(`seed ${seed} did not complete`);

  fixture.push({
    seed,
    walls: JSON.parse(JSON.stringify(sim.maze.walls)),
    // The old generator used null for plain floor; the new field model says 'floor'.
    tiles: sim.maze.tiles.map(tile => tile ?? "floor"),
    victims: sim.maze.victims.map(v => ({ cell: v.cell, dir: v.dir })),
    visitOrder: order
  });
}

const target = new URL("./fixtures/parity.json", import.meta.url);
writeFileSync(target, JSON.stringify(fixture) + "\n");
console.log(`wrote ${fixture.length} seeds to ${fileURLToPath(target)}`);
