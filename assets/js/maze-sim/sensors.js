// Time-of-flight sensing: four beams per cell, mapped into the robot's known walls.
// Pure, DOM-free. A beam stays on the level of its origin node.
import { OPPOSITE, levelOf, cellOf, neighbourNode } from "./maze.js?v=10";

export const TOF_RANGE_TILES = 4;       // sensor range, in tiles from the cell centre

// Four beams in order front, right, back, left of heading (0 N, 1 E, 2 S, 3 W).
// Beam = { dir, tiles, hit, passed, node }: tiles is the distance from the cell
// centre to the wall it hit (k + 0.5 for a wall k cells away) or the range cap
// when nothing was in reach; passed lists the open edges crossed as flattened
// [node, dir] pairs; node is the cell the beam was cast from.
export function castBeams(field, node, heading) {
  const level = field.levels[levelOf(node)];
  const beams = [];
  for (let turn = 0; turn < 4; turn++) {
    const dir = (heading + turn) % 4;
    const passed = [];
    let at = node;
    let tiles = TOF_RANGE_TILES;
    let hit = false;
    for (let k = 0; k + 0.5 <= TOF_RANGE_TILES; k++) {
      const next = neighbourNode(field, at, dir);
      if (level.walls[cellOf(at)][dir] || next < 0) {
        tiles = k + 0.5;
        hit = true;
        break;
      }
      passed.push(at, dir);
      at = next;
    }
    beams.push({ dir, tiles, hit, passed, node });
  }
  return beams;
}

function sides(known, node) {
  let entry = known.get(node);
  if (!entry) {
    entry = [null, null, null, null];
    known.set(node, entry);
  }
  return entry;
}

function mark(known, field, node, dir, wall) {
  sides(known, node)[dir] = wall;
  const next = neighbourNode(field, node, dir);
  if (next >= 0) sides(known, next)[OPPOSITE[dir]] = wall;
}

// Record what the beams saw: edges they crossed are open, the wall they hit is closed.
export function applyBeams(known, beams, field) {
  for (const beam of beams) {
    const { passed } = beam;
    for (let i = 0; i < passed.length; i += 2) mark(known, field, passed[i], passed[i + 1], false);
    if (!beam.hit) continue;
    const last = passed.length
      ? neighbourNode(field, passed[passed.length - 2], passed[passed.length - 1])
      : beam.node;
    mark(known, field, last, beam.dir, true);
  }
}
