// Scene model for the 3D renderer. Pure and DOM-free: turns the sim
// state into plain data (static geometry that only grows, plus the robot's
// transform) that render3d.js draws.
//
// World: 1 unit = 1 tile. Level L's floor is at y = L * LEVEL_GAP. Cell
// (col, row) on an N x N level sits at x = col - (N-1)/2, z = row - (N-1)/2
// (row grows southward = +z). Yaw 0 faces north (-z); positive yaw is clockwise
// seen from above, matching pose().angle.
import { DIRS, levelOf, cellOf } from "./maze.js?v=10";
import { pose } from "./robot.js?v=10";

export const LEVEL_GAP = 2.5;
export const WALL_H = 0.3;
export const WALL_T = 0.05;

const PLATE_GAP = 0.01;     // victim plate stands this far off the wall face
const KIT_ALONG = 0.2;      // kit offset along the victim's wall, tiles
const KIT_CUBE = 0.08;      // kit cube side (matches the renderer)
const KIT_GAP = 0.04;       // kit clearance from the wall face
const DEBRIS_INSET = 0.12;  // debris dots span the tile's inner 76 %, as in 2D
const DEBRIS_SPAN = 0.76;

// Centre of a node's cell, on its level's floor.
export function cellToWorld(field, node) {
  const level = levelOf(node);
  const size = field.levels[level].size;
  const cell = cellOf(node);
  const half = (size - 1) / 2;
  return { x: (cell % size) - half, y: level * LEVEL_GAP, z: Math.floor(cell / size) - half };
}

function wallSides(sim) {
  let count = 0;
  for (const entry of sim.known.values()) {
    for (let dir = 0; dir < 4; dir++) if (entry[dir] === true) count++;
  }
  return count;
}

function kitTotal(sim) {
  return sim.kits.reduce((total, n) => total + n, 0);
}

// Changes exactly when buildStatic's output would: every ingredient below only
// grows within a run, and seed + run tell one run's maze from the next.
export function staticVersion(sim) {
  return [
    sim.seed,
    sim.run,
    wallSides(sim),
    sim.visited.size,
    sim.black.size,
    sim.found.size,
    sim.identified.size,
    kitTotal(sim)
  ].join(":");
}

// Everything that is not the robot, limited to what it has sensed so far.
export function buildStatic(field, sim) {
  const walls = [];
  const seen = new Set();
  const addWall = (level, x, z, axis) => {
    const key = `${level}:${x}:${z}:${axis}`;
    if (seen.has(key)) return;
    seen.add(key);
    walls.push({ level, x, z, axis });
  };
  for (const [node, entry] of sim.known) {
    const level = levelOf(node);
    const { x, z } = cellToWorld(field, node);
    if (entry[0] === true) addWall(level, x, z - 0.5, "x");
    if (entry[2] === true) addWall(level, x, z + 0.5, "x");
    if (entry[3] === true) addWall(level, x - 0.5, z, "z");
    if (entry[1] === true) addWall(level, x + 0.5, z, "z");
  }

  const tiles = [];
  const debris = [];
  for (const node of sim.visited) {
    const level = levelOf(node);
    const cell = cellOf(node);
    const { x, z } = cellToWorld(field, node);
    const data = field.levels[level];
    const kind = data.tiles[cell];
    tiles.push({ level, x, z, kind });
    if (kind !== "debris") continue;
    for (const dot of data.debrisDots[cell] || []) {
      debris.push({ level, x: x - 0.5 + DEBRIS_INSET + dot.x * DEBRIS_SPAN, z: z - 0.5 + DEBRIS_INSET + dot.y * DEBRIS_SPAN });
    }
  }
  for (const node of sim.black) {
    const { x, z } = cellToWorld(field, node);
    tiles.push({ level: levelOf(node), x, z, kind: "black" });
  }

  // Victims once found; global index runs level 1 victims first, then level 2.
  const victims = [];
  const kits = [];
  let index = 0;
  field.levels.forEach((data, level) => {
    for (const victim of data.victims) {
      const at = index++;
      if (!sim.found.has(victim)) continue;
      const { x, y, z } = cellToWorld(field, victim.node);
      const [dx, dz] = DIRS[victim.dir];
      const plate = 0.5 - WALL_T / 2 - PLATE_GAP;
      victims.push({
        index: at,
        level,
        x: x + dx * plate,
        y: y + WALL_H / 2,
        z: z + dz * plate,
        dir: victim.dir,
        type: victim.type,
        identified: sim.identified.has(at)
      });
      // One cube per dropped kit on the floor beside the plate, first kit one
      // side along the wall, second the other (as in the 2D view).
      const wallOff = 0.5 - WALL_T / 2 - KIT_GAP - KIT_CUBE / 2;
      for (let k = 0; k < sim.kits[at]; k++) {
        const along = k % 2 === 0 ? KIT_ALONG : -KIT_ALONG;
        kits.push({ level, x: x + dx * wallOff - dz * along, z: z + dz * wallOff + dx * along });
      }
    }
  });

  let ramp = null;
  if (field.ramp && (sim.visited.has(field.ramp.from) || sim.visited.has(field.ramp.to))) {
    ramp = { from: cellToWorld(field, field.ramp.from), to: cellToWorld(field, field.ramp.to), dir: field.ramp.dir };
  }

  return { walls, tiles, debris, victims, kits, ramp };
}

// The robot's world transform. Off the ramp it sits on its level's floor. While
// climbing, pose() reports progress 0..1 along the ramp (and still the starting
// level); the robot then follows the segment between the two ramp ends, pitched
// to its slope: up when it started at ramp.from, down otherwise.
export function robotTransform(field, sim) {
  const p = pose(sim);
  const size = field.levels[p.level].size;
  const half = size / 2;
  if (p.climb === null) {
    return {
      level: p.level,
      x: p.x - half + Math.cos(p.angle) * p.wobble,
      y: p.level * LEVEL_GAP,
      z: p.y - half + Math.sin(p.angle) * p.wobble,
      yaw: p.angle,
      pitch: 0
    };
  }
  const { ramp } = field;
  const up = sim.step.from === ramp.from;
  const a = cellToWorld(field, up ? ramp.from : ramp.to);
  const b = cellToWorld(field, up ? ramp.to : ramp.from);
  const t = p.climb;
  const run = Math.hypot(b.x - a.x, b.z - a.z);
  const pitch = Math.atan2(LEVEL_GAP, run);
  return {
    level: p.level,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: p.angle,
    pitch: up ? pitch : -pitch
  };
}

const FRUSTUM_MARGIN = 0.08;

// Orthographic half extents (world units) that keep every level in frame at
// any azimuth: the bounding sphere around the target (the middle of the level
// gap) projects to a circle of the same radius from every direction, so the
// frustum only has to cover that circle plus a margin.
export function fitFrustum(levelSizes, aspect) {
  const half = Math.max(...levelSizes) / 2;
  const target = { x: 0, y: LEVEL_GAP / 2, z: 0 };
  const top = (levelSizes.length - 1) * LEVEL_GAP + WALL_H;
  const radius = Math.hypot(half, half, Math.max(target.y, top - target.y));
  const halfH = radius * (1 + FRUSTUM_MARGIN) * Math.max(1, 1 / aspect);
  return { halfW: halfH * aspect, halfH, target };
}
