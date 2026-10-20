// Canvas renderer for the Rescue Maze simulation. Only what the robot has
// sensed is drawn, so the map builds up the same way the real one does.
import { DIRS, nodeId, levelOf, cellOf } from "./maze.js?v=10";
import { pose, beamScale, BODY, BODY_SWELL, FADE_MS, SENSE_MS } from "./robot.js?v=10";

const TRAIL_FADE_MS = 9000;
const INK = "#0b0a09";
const LETTER_PX = 12; // the site's type floor (--fs-2xs), in CSS px

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let TEXT, ACCENT, VICTIM, BLUE, FONT, FAINT;
  let SWATCH = {};
  function readColors() {
    const styles = getComputedStyle(document.documentElement);
    const rgb = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    TEXT = rgb("--c-text-rgb", "236, 230, 218");
    ACCENT = rgb("--c-accent-rgb", "255, 138, 31");
    VICTIM = rgb("--label-cyan-rgb", "57, 197, 207");
    BLUE = rgb("--label-blue-rgb", "88, 166, 255");
    FONT = rgb("--font-mono", "monospace");
    FAINT = rgb("--c-text-faint", "#837e72");
    // Victim swatches: harmed / red, stable / yellow, unharmed / green.
    SWATCH = {
      red: rgb("--label-red-rgb", "255, 123, 114"),
      yellow: rgb("--label-gold-rgb", "227, 179, 65"),
      green: rgb("--label-green-rgb", "86, 211, 100")
    };
  }
  readColors();

  let size = 0;
  let last = null;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = canvas.clientWidth;
    readColors();
    if (!size) return;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (last) render(last);
  }

  // Victim marker geometry in CSS px (the context is already DPR-scaled). The
  // badge is sized so a LETTER_PX letter fits, and sits against the wall
  // without crossing it.
  function badge(unit, dir) {
    const r = Math.max(unit * 0.15, LETTER_PX * 0.72);
    const off = Math.min(unit * 0.3, unit * 0.5 - r - 1.5);
    return { r, off, dx: DIRS[dir][0], dy: DIRS[dir][1] };
  }

  function drawIdentified(victim, vx, vy, r) {
    const swatch = SWATCH[victim.type];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(vx, vy, r, 0, Math.PI * 2);
    if (swatch) {
      ctx.fillStyle = `rgba(${swatch}, 0.95)`;
      ctx.strokeStyle = `rgba(${TEXT}, 0.55)`;
      ctx.fill();
      ctx.stroke();
      return;
    }
    ctx.fillStyle = "rgba(11, 10, 9, 0.9)";
    ctx.fill();
    ctx.strokeStyle = `rgba(${VICTIM}, 0.95)`;
    ctx.stroke();
    ctx.fillStyle = `rgb(${TEXT})`;
    ctx.font = `500 ${LETTER_PX}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(victim.type, vx, vy + 0.5);
  }

  // One small square per dropped kit on the floor, either side of the badge
  // along the victim's wall (first kit one side, second the other).
  function drawKits(count, vx, vy, b, unit) {
    const side = Math.max(4.5, unit * 0.12);
    const gap = b.r + 2 + side / 2;
    for (let k = 0; k < count; k++) {
      const along = k % 2 === 0 ? gap : -gap;
      const kx = vx - b.dy * along;
      const ky = vy + b.dx * along;
      ctx.fillStyle = `rgba(${TEXT}, 0.9)`;
      ctx.fillRect(kx - side / 2, ky - side / 2, side, side);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.strokeRect(kx - side / 2, ky - side / 2, side, side);
    }
  }

  // Three chevrons across a ramp tile, pointing the way up (ramp.dir).
  function drawChevrons(cx, cy, dir, unit) {
    const [dx, dy] = DIRS[dir];
    const reach = unit * 0.07;
    const half = unit * 0.16;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.strokeStyle = `rgba(${TEXT}, 0.55)`;
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let k = -1; k <= 1; k++) {
      const at = k * unit * 0.2;
      ctx.moveTo(at - reach, -half);
      ctx.lineTo(at + reach, 0);
      ctx.lineTo(at - reach, half);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Level tabs in the top-left margin: "L1 ● 12/81" per level, the level on
  // screen filled in the accent colour. Counts are tiles mapped (visited + black).
  function drawTabs(sim, shown, margin) {
    const { levels } = sim.field;
    ctx.font = `500 ${LETTER_PX}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const y = margin * 0.5;
    const dot = 3.5;
    let x = margin;
    levels.forEach((level, l) => {
      let mapped = 0;
      for (const node of sim.visited) if (levelOf(node) === l) mapped++;
      for (const node of sim.black) if (levelOf(node) === l) mapped++;
      const label = `L${l + 1}`;
      const count = `${mapped}/${level.size * level.size}`;
      const active = l === shown;
      const color = active ? `rgb(${ACCENT})` : `rgba(${TEXT}, 0.5)`;
      ctx.fillStyle = color;
      ctx.fillText(label, x, y);
      x += ctx.measureText(label).width + 5 + dot;
      ctx.beginPath();
      ctx.arc(x, y, dot, 0, Math.PI * 2);
      if (active) {
        ctx.fill();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }
      x += dot + 5;
      ctx.fillText(count, x, y);
      x += ctx.measureText(count).width + 14;
    });
  }

  function render(sim) {
    last = sim;
    if (!size) return;
    const field = sim.field;
    const robot = pose(sim);
    const margin = size * 0.07;
    // Every level is drawn at the tile size of the largest one, centred, so the
    // smaller level reads as a smaller maze rather than a zoomed-in copy.
    const biggest = Math.max(...field.levels.map(level => level.size));
    const unit = (size - margin * 2) / biggest;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    if (sim.phase === "FADE") ctx.globalAlpha = Math.max(0, 1 - sim.hold / FADE_MS);

    // One level, or both cross-fading around the ramp arrival.
    const fade = robot.levelFade;
    const layers = fade ? [[fade.from, 1 - fade.t], [fade.to, fade.t]] : [[robot.level, 1]];
    for (const [l, alpha] of layers) {
      ctx.save();
      ctx.globalAlpha *= alpha;
      drawLevel(sim, robot, l, margin, unit, biggest);
      ctx.restore();
    }

    drawTabs(sim, robot.level, margin);
    ctx.restore();
  }

  function drawLevel(sim, robot, shown, margin, unit, biggest) {
    const field = sim.field;
    const onShown = node => levelOf(node) === shown;
    const level = field.levels[shown];
    const N = level.size;
    const startCell = cellOf(field.start);
    const cellX = cell => cell % N;
    const cellY = cell => Math.floor(cell / N);
    const origin = margin + ((biggest - N) / 2) * unit;
    const px = x => origin + x * unit;
    const center = cell => [px(cellX(cell) + 0.5), px(cellY(cell) + 0.5)];

    // Lattice points: the unknown maze, before anything is sensed.
    ctx.fillStyle = `rgba(${TEXT}, 0.16)`;
    for (let y = 0; y <= N; y++) {
      for (let x = 0; x <= N; x++) ctx.fillRect(px(x) - 1, px(y) - 1, 2, 2);
    }

    // Visited tiles.
    ctx.fillStyle = `rgba(${ACCENT}, 0.07)`;
    for (const node of sim.visited) {
      if (!onShown(node)) continue;
      const cell = cellOf(node);
      ctx.fillRect(px(cellX(cell)) + 1, px(cellY(cell)) + 1, unit - 2, unit - 2);
    }

    // Floor tiles the robot has found: blue where it has driven on, black
    // (hatched) where its floor sensor tripped.
    ctx.fillStyle = `rgba(${BLUE}, 0.3)`;
    for (const node of sim.visited) {
      if (!onShown(node)) continue;
      const cell = cellOf(node);
      if (level.tiles[cell] === "blue") {
        ctx.fillRect(px(cellX(cell)) + 1, px(cellY(cell)) + 1, unit - 2, unit - 2);
      }
    }
    for (const node of sim.black) {
      if (!onShown(node)) continue;
      const cell = cellOf(node);
      const x = px(cellX(cell)) + 1;
      const y = px(cellY(cell)) + 1;
      const w = unit - 2;
      ctx.fillStyle = "#000";
      ctx.fillRect(x, y, w, w);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, w);
      ctx.clip();
      ctx.strokeStyle = `rgba(${TEXT}, 0.16)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let offset = -w; offset < w; offset += w / 4) {
        ctx.moveTo(x + offset, y + w);
        ctx.lineTo(x + offset + w, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Debris tiles the robot has driven onto: scattered dots in the faint text colour.
    const dots = level.debrisDots || {};
    ctx.fillStyle = FAINT;
    for (const node of sim.visited) {
      if (!onShown(node)) continue;
      const cell = cellOf(node);
      if (level.tiles[cell] !== "debris" || !dots[cell]) continue;
      const radius = Math.max(1.25, unit * 0.025);
      for (const dot of dots[cell]) {
        ctx.beginPath();
        ctx.arc(px(cellX(cell) + 0.12 + dot.x * 0.76), px(cellY(cell) + 0.12 + dot.y * 0.76), radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The ramp, on both levels once the robot has been on that end of it (and
    // on both ends during the cross-fade, while it is driving across).
    if (field.ramp) {
      for (const node of [field.ramp.from, field.ramp.to]) {
        if (!onShown(node) || !(sim.visited.has(node) || robot.levelFade)) continue;
        const [rampX, rampY] = center(cellOf(node));
        drawChevrons(rampX, rampY, field.ramp.dir, unit);
      }
    }

    // Start tile marker.
    if (onShown(field.start)) {
      ctx.strokeStyle = `rgba(${TEXT}, 0.35)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(px(cellX(startCell)) + unit * 0.18, px(cellY(startCell)) + unit * 0.18, unit * 0.64, unit * 0.64);
      ctx.setLineDash([]);
    }

    // Trail through visited cell centres, fading with age.
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    for (let i = 1; i < sim.trail.length; i++) {
      if (!onShown(sim.trail[i - 1].node) || !onShown(sim.trail[i].node)) continue;
      const age = reduceMotion ? 0 : sim.clock - sim.trail[i].t;
      const alpha = Math.max(0.12, 1 - age / TRAIL_FADE_MS) * 0.55;
      const [x1, y1] = center(cellOf(sim.trail[i - 1].node));
      const [x2, y2] = center(cellOf(sim.trail[i].node));
      ctx.strokeStyle = `rgba(${ACCENT}, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Known walls: north and west of every cell, plus the outer east/south.
    // A known entry may hold null sides (unsensed); only true sides are drawn.
    ctx.strokeStyle = `rgba(${TEXT}, 0.9)`;
    ctx.lineWidth = 2;
    ctx.lineCap = "square";
    ctx.beginPath();
    for (let cell = 0; cell < N * N; cell++) {
      const x = cellX(cell);
      const y = cellY(cell);
      const known = sim.known.get(nodeId(shown, cell));
      if (!known) continue;
      if (known[0] === true) { ctx.moveTo(px(x), px(y)); ctx.lineTo(px(x + 1), px(y)); }
      if (known[3] === true) { ctx.moveTo(px(x), px(y)); ctx.lineTo(px(x), px(y + 1)); }
      if (x === N - 1 && known[1] === true) { ctx.moveTo(px(x + 1), px(y)); ctx.lineTo(px(x + 1), px(y + 1)); }
      if (y === N - 1 && known[2] === true) { ctx.moveTo(px(x), px(y + 1)); ctx.lineTo(px(x + 1), px(y + 1)); }
    }
    ctx.stroke();

    // Victims, once found: a ring against the wall they were spotted on.
    // Once identified the ring turns into the victim's letter (H / S / U) or
    // a colour swatch (red / yellow / green), with a floor square per kit.
    // Victim indices are global: level 0 victims first, then level 1.
    let firstIndex = 0;
    for (let l = 0; l < shown; l++) firstIndex += field.levels[l].victims.length;
    level.victims.forEach((victim, at) => {
      const index = firstIndex + at;
      const foundAt = sim.found.get(victim);
      if (foundAt === undefined) return;
      const [cx, cy] = center(cellOf(victim.node));
      const b = badge(unit, victim.dir);
      const vx = cx + b.dx * b.off;
      const vy = cy + b.dy * b.off;
      if (sim.identified.has(index)) {
        drawIdentified(victim, vx, vy, b.r);
        drawKits(sim.kits[index], vx, vy, b, unit);
        return;
      }
      ctx.strokeStyle = `rgba(${VICTIM}, 0.95)`;
      ctx.fillStyle = `rgba(${VICTIM}, 0.25)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(vx, vy, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const since = sim.clock - foundAt;
      if (!reduceMotion && since < 900) {
        const t = since / 900;
        ctx.strokeStyle = `rgba(${VICTIM}, ${0.8 * (1 - t)})`;
        ctx.beginPath();
        ctx.arc(vx, vy, b.r + t * unit * 0.35, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // Robot, on the level it is currently driving.
    const { x, y, angle } = robot;
    const wobble = reduceMotion ? 0 : robot.wobble;
    // Debris wobble: sideways of the heading, in tiles.
    const rx = px(x + Math.cos(angle) * wobble);
    const ry = px(y + Math.sin(angle) * wobble);

    // ToF beams from the cell the robot just sensed: one line per beam, to the
    // wall it hit (with a tick there) or fading out where it ran out of range.
    // Lengths carry the ±3% display noise; the fade runs over SENSE_MS.
    const sinceSense = sim.clock - sim.senseAt;
    if (!reduceMotion && sim.phase !== "COMPLETE" && sim.phase !== "FADE" && sinceSense >= 0 && sinceSense < SENSE_MS) {
      const alpha = 0.9 * (1 - sinceSense / SENSE_MS);
      ctx.lineWidth = 1.5;
      ctx.lineCap = "butt";
      sim.beams.forEach((beam, index) => {
        if (!onShown(beam.node)) return;
        const [bx, by] = center(cellOf(beam.node));
        const [dx, dy] = DIRS[beam.dir];
        const length = beam.tiles * unit * beamScale(sim, index);
        const ex = bx + dx * length;
        const ey = by + dy * length;
        if (beam.hit) {
          ctx.strokeStyle = `rgba(${ACCENT}, ${alpha})`;
        } else {
          const fade = ctx.createLinearGradient(bx, by, ex, ey);
          fade.addColorStop(0, `rgba(${ACCENT}, ${alpha})`);
          fade.addColorStop(1, `rgba(${ACCENT}, 0)`);
          ctx.strokeStyle = fade;
        }
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(ex, ey);
        if (beam.hit) {
          const tick = unit * 0.07;
          ctx.moveTo(ex - dy * tick, ey + dx * tick);
          ctx.lineTo(ex + dy * tick, ey - dx * tick);
        }
        ctx.stroke();
      });
    }

    if (robot.level !== shown) return;
    // Climbing the ramp swells the body a little: the tilt cue.
    const body = unit * BODY * (robot.climb === null ? 1 : 1 + BODY_SWELL * Math.sin(Math.PI * robot.climb));
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(angle);
    ctx.fillStyle = `rgb(${ACCENT})`;
    ctx.fillRect(-body / 2, -body / 2, body, body);
    ctx.fillStyle = INK;
    ctx.fillRect(-body * 0.18, -body / 2, body * 0.36, body * 0.2);
    ctx.restore();
  }

  // Nothing to release; present so main.js can treat both renderers alike.
  function dispose() {}

  return { resize, render, dispose };
}
