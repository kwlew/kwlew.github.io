// WebGL renderer for the Rescue Maze simulation: the static scene (floors,
// walls, tiles, debris, victim plates, kits, ramp) seen through an orthographic
// camera that orbits slowly and can be dragged. Only what the robot has sensed
// is built, so the map grows the same way the 2D one does. Colours all come
// from the site's CSS custom properties; materials are unlit.
import { DIRS, levelOf } from "./maze.js?v=10";
import { pose, beamScale, BODY, FADE_MS, SENSE_MS } from "./robot.js?v=10";
import {
  LEVEL_GAP, WALL_H, WALL_T, staticVersion, buildStatic, fitFrustum, robotTransform, cellToWorld
} from "./scene3d-model.js?v=10";

const THREE_URL = "/assets/vendor/three/three.module.min.js";

const ELEVATION = 35 * Math.PI / 180;
const ORBIT_PERIOD_MS = 60000;
const DRAG_DEG_PER_PX = 0.4;
const RESUME_MS = 4000;
const START_AZIMUTH = 30;
const CAMERA_DISTANCE = 40;

const FLOOR_ALPHA = 0.55;     // floors let the level behind them show through
const TILE_INSET = 0.04;      // visited / blue tiles stop short of the lattice, as in 2D
const HOLE_DEPTH = 0.05;      // black tiles are pits this far below the floor
const RAMP_WIDTH = 0.6;
const RAMP_THICK = 0.03;
const RAMP_FILL = 0.18;       // ramp strip: quiet text-coloured fill, hairline edges
const RAMP_EDGE = 0.35;
const PLATE = 0.24;
const KIT_CUBE = 0.08;
const DEBRIS_CUBE = 0.06;
const TEXTURE_PX = 128;
const LIFT = 0.002;           // decals stack this far apart above the floor

const INACTIVE_LEVEL = 0.35;  // opacity factor of the level the robot is not on
const ROBOT_H = 0.2;
const NOTCH_W = 0.36;         // front notch, fractions of the body as in 2D
const NOTCH_D = 0.2;
const PITCH_EASE = 0.15;      // pitch eases in/out over this share of the climb at each end
const BEAM_BODY_Y = 0.1;      // beams leave the cell centre at body height
const BEAM_TICK = 0.07;       // half-length of the tick where a beam hit a wall
const BEAM_ALPHA = 0.9;
const TRAIL_LIFT = 0.01;
const TRAIL_ALPHA = 0.4;
const TRAIL_START = 512;      // trail buffer capacity (segments); doubles when full
const LABEL_PX = 12;          // label font size in CSS px: the site's type floor (--fs-2xs)
const LABEL_TEX_SCALE = 4;    // texture pixels per CSS pixel of label
const LABEL_TEX_W = 320;      // fits "L2 100/100" at LABEL_PX with margin
const LABEL_TEX_H = 64;
const LABEL_INACTIVE_ALPHA = 0.5;
const LABEL_OUT = 0.25;       // labels sit this far outside the corner, clear of the walls
const LABEL_EDGE = 4;         // labels keep at least this many CSS px from the canvas edge
const LABEL_PAD = 8;          // texture px between the text and the texture's right edge

// Draw order within a level (the level number is added x10 so upper levels
// draw over lower ones).
const RANK = { floor: 0, wall: 0.5, tint: 1, blue: 2, hole: 3, chevron: 4, plate: 5, ramp: 6, trail: 7, beam: 8 };
const smooth = x => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

export async function createRenderer3d(canvas, opts = {}) {
  const THREE = await import(THREE_URL);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearAlpha(0);

  canvas.style.touchAction = "pan-y";

  const scene = new THREE.Scene();
  const staticGroup = new THREE.Group();
  const dynamicGroup = new THREE.Group();   // robot, beams, trails, labels: survives static rebuilds
  scene.add(staticGroup);
  scene.add(dynamicGroup);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

  // ===== COLOURS =====
  let C = null;
  function readColors() {
    const styles = getComputedStyle(document.documentElement);
    const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    const rgb = (name, fallback) => token(name, fallback);
    const text = rgb("--c-text-rgb", "236, 230, 218");
    const surface = token("--c-surface", "rgb(21, 20, 17)");
    C = {
      text,
      accent: rgb("--c-accent-rgb", "255, 138, 31"),
      victim: rgb("--label-cyan-rgb", "57, 197, 207"),
      blue: rgb("--label-blue-rgb", "88, 166, 255"),
      swatch: {
        red: rgb("--label-red-rgb", "255, 123, 114"),
        yellow: rgb("--label-gold-rgb", "227, 179, 65"),
        green: rgb("--label-green-rgb", "86, 211, 100")
      },
      font: token("--font-mono", "monospace"),
      faint: token("--c-text-faint", "rgb(131, 126, 114)"),
      ink: token("--c-surface-sunken", "rgb(11, 10, 9)"),
      pit: token("--c-bg-deep", "rgb(10, 9, 8)"),
      surface
    };
  }
  const col = triple => new THREE.Color(`rgb(${triple})`);
  readColors();

  // ===== STATIC SCENE =====
  let owned = [];                 // geometries, materials and textures to dispose on rebuild
  let levelMaterials = [];        // per level: { material, base } for level-wide opacity
  let rampMaterials = [];         // the ramp strip: it joins two levels, so it follows their mean
  let appliedFactors = [];        // last opacity factor applied per level (null = reapply)
  let appliedRamp = null;
  let builtVersion = null;
  const own = thing => { owned.push(thing); return thing; };

  // Chevron and plate textures (and the decal materials that use them) are kept
  // across static rebuilds: a rebuild happens for nearly every newly visited
  // cell, and the art only depends on the key. Dropped when colours are re-read.
  const decalCache = new Map();   // key -> { texture, materials: Map(level -> material) }
  function disposeDecals() {
    for (const { texture, materials } of decalCache.values()) {
      texture.dispose();
      for (const m of materials.values()) m.dispose();
    }
    decalCache.clear();
  }
  function decalMaterial(level, key, draw) {
    let entry = decalCache.get(key);
    if (!entry) decalCache.set(key, entry = { texture: textured(draw()), materials: new Map() });
    let m = entry.materials.get(level);
    if (!m) entry.materials.set(level, m = new THREE.MeshBasicMaterial({ map: entry.texture, transparent: true, depthWrite: false }));
    (levelMaterials[level] ||= []).push({ material: m, base: 1 });
    return m;
  }

  function disposeStatic() {
    // Instanced meshes free their instance-matrix buffer only through their own
    // dispose(); geometries and materials do not reach it.
    staticGroup.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    for (const thing of owned) thing.dispose();
    owned = [];
    levelMaterials = [];
    rampMaterials = [];
    appliedFactors = [];
    appliedRamp = null;
    staticGroup.clear();
  }

  function material(level, rank, color, opacity, extra = {}) {
    const translucent = opacity < 1;
    const solid = !translucent && !extra.transparent;
    const m = own(new THREE.MeshBasicMaterial({
      color,
      transparent: translucent,
      opacity,
      depthWrite: !translucent,
      ...extra
    }));
    (levelMaterials[level] ||= []).push({ material: m, base: opacity, solid });
    return { m, order: level * 10 + rank };
  }

  function applyAlpha(list, alpha) {
    for (const { material: m, base, solid } of list || []) {
      // The factor scales each material's own opacity (floors are already translucent).
      m.opacity = base * alpha;
      // Solid materials only blend while faded; decals and lines always do.
      if (!solid) continue;
      m.transparent = m.opacity < 1;
      m.depthWrite = !m.transparent;
    }
  }

  function flatGeometry(size) {
    const g = own(new THREE.PlaneGeometry(size, size));
    g.rotateX(-Math.PI / 2);
    return g;
  }

  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  function place(x, y, z, yaw = 0) {
    quat.setFromAxisAngle(yAxis, yaw);
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), quat, one);
  }

  function instanced(group, geometry, mat, order, matrices) {
    if (!matrices.length) return null;
    const mesh = new THREE.InstancedMesh(geometry, mat, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    group.add(mesh);
    return mesh;
  }

  // Hairlines along every wall's box edges, merged into one LineSegments.
  function wallEdges(walls, boxGeometry) {
    const edges = own(new THREE.EdgesGeometry(boxGeometry));
    const template = edges.getAttribute("position");
    const out = new Float32Array(walls.length * template.count * 3);
    const v = new THREE.Vector3();
    walls.forEach((wall, w) => {
      const m = place(wall.x, wall.level * LEVEL_GAP + WALL_H / 2, wall.z, wall.axis === "z" ? Math.PI / 2 : 0);
      for (let i = 0; i < template.count; i++) {
        v.fromBufferAttribute(template, i).applyMatrix4(m);
        v.toArray(out, (w * template.count + i) * 3);
      }
    });
    const g = own(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.BufferAttribute(out, 3));
    return g;
  }

  // Text-coloured chevrons pointing along the ramp's climbing direction, as in 2D.
  function chevronCanvas(dir) {
    const c = document.createElement("canvas");
    c.width = c.height = TEXTURE_PX;
    const ctx = c.getContext("2d");
    const [dx, dz] = DIRS[dir];
    ctx.translate(TEXTURE_PX / 2, TEXTURE_PX / 2);
    ctx.rotate(Math.atan2(dz, dx));
    ctx.strokeStyle = `rgba(${C.text}, 0.7)`;
    ctx.lineWidth = TEXTURE_PX * 0.04;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let k = -1; k <= 1; k++) {
      const at = k * TEXTURE_PX * 0.2;
      ctx.moveTo(at - TEXTURE_PX * 0.07, -TEXTURE_PX * 0.16);
      ctx.lineTo(at + TEXTURE_PX * 0.07, 0);
      ctx.lineTo(at - TEXTURE_PX * 0.07, TEXTURE_PX * 0.16);
    }
    ctx.stroke();
    return c;
  }

  // A victim plate: a ring until identified, then the letter or colour swatch.
  function plateCanvas(type, identified) {
    const c = document.createElement("canvas");
    c.width = c.height = TEXTURE_PX;
    const ctx = c.getContext("2d");
    const mid = TEXTURE_PX / 2;
    const r = TEXTURE_PX * 0.42;
    ctx.lineWidth = TEXTURE_PX * 0.06;
    ctx.beginPath();
    ctx.arc(mid, mid, r, 0, Math.PI * 2);
    const swatch = C.swatch[type];
    if (!identified) {
      ctx.fillStyle = `rgba(${C.victim}, 0.25)`;
      ctx.strokeStyle = `rgba(${C.victim}, 0.95)`;
      ctx.fill();
      ctx.stroke();
    } else if (swatch) {
      ctx.fillStyle = `rgba(${swatch}, 0.95)`;
      ctx.strokeStyle = `rgba(${C.text}, 0.55)`;
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = C.ink;
      ctx.strokeStyle = `rgba(${C.victim}, 0.95)`;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = `rgb(${C.text})`;
      ctx.font = `500 ${Math.round(TEXTURE_PX * 0.5)}px ${C.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(type, mid, mid + TEXTURE_PX * 0.02);
    }
    return c;
  }

  function textured(canvasEl) {
    const t = new THREE.CanvasTexture(canvasEl);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  function buildScene(sim) {
    disposeStatic();
    const { field } = sim;
    const data = buildStatic(field, sim);
    const wallBox = own(new THREE.BoxGeometry(1, WALL_H, WALL_T));
    const flat = flatGeometry(1);

    field.levels.forEach((levelData, level) => {
      const group = new THREE.Group();
      staticGroup.add(group);
      const base = level * LEVEL_GAP;
      const mine = list => list.filter(item => item.level === level);

      // Floor.
      {
        const { m, order } = material(level, RANK.floor, new THREE.Color(C.surface), FLOOR_ALPHA);
        const mesh = new THREE.Mesh(own(new THREE.PlaneGeometry(levelData.size, levelData.size).rotateX(-Math.PI / 2)), m);
        mesh.position.y = base;
        mesh.renderOrder = order;
        mesh.frustumCulled = false;
        group.add(mesh);
      }

      // Walls: filled boxes (pushed back a hair so the edges win) plus hairlines.
      const walls = mine(data.walls);
      if (walls.length) {
        const { m, order } = material(level, RANK.wall, new THREE.Color(C.ink), 1, {
          polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
        });
        instanced(group, wallBox, m, order, walls.map(w =>
          place(w.x, base + WALL_H / 2, w.z, w.axis === "z" ? Math.PI / 2 : 0)));
        const line = own(new THREE.LineBasicMaterial({ color: col(C.text), transparent: true, opacity: 0.55, depthWrite: false }));
        (levelMaterials[level] ||= []).push({ material: line, base: 0.55 });
        const lines = new THREE.LineSegments(wallEdges(walls, wallBox), line);
        lines.renderOrder = order + 0.1;
        lines.frustumCulled = false;
        group.add(lines);
      }

      // Tile fills. Black holes win over everything; the rest tint visited floor.
      const tiles = mine(data.tiles);
      const tint = tiles.filter(t => t.kind !== "black");
      const tileFill = (list, rank, color, opacity, inset, lift, extra) => {
        const { m, order } = material(level, rank, color, opacity, extra);
        const s = 1 - inset * 2;
        instanced(group, flat, m, order, list.map(t => {
          const mat4 = place(t.x, base + lift, t.z);
          mat4.scale(new THREE.Vector3(s, 1, s));
          return mat4;
        }));
      };
      tileFill(tint, RANK.tint, col(C.accent), 0.12, TILE_INSET, LIFT);
      tileFill(tint.filter(t => t.kind === "blue"), RANK.blue, col(C.blue), 0.4, TILE_INSET, LIFT * 2);
      const holes = tiles.filter(t => t.kind === "black");
      // Drawn after the translucent floor so the pit reads as a darker square.
      tileFill(holes, RANK.hole, new THREE.Color(C.pit), 1, TILE_INSET, -HOLE_DEPTH, { transparent: true, depthWrite: false });
      if (holes.length) {
        const outline = own(new THREE.LineBasicMaterial({ color: col(C.text), transparent: true, opacity: 0.3, depthWrite: false }));
        (levelMaterials[level] ||= []).push({ material: outline, base: 0.3 });
        const pos = [];
        const h = 0.5 - TILE_INSET;
        for (const t of holes) {
          const y = base - HOLE_DEPTH + LIFT;
          const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
          for (let i = 0; i < 4; i++) {
            const [ax, az] = corners[i];
            const [bx, bz] = corners[(i + 1) % 4];
            pos.push(t.x + ax, y, t.z + az, t.x + bx, y, t.z + bz);
          }
        }
        const g = own(new THREE.BufferGeometry());
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        const lines = new THREE.LineSegments(g, outline);
        lines.renderOrder = level * 10 + RANK.hole + 0.5;
        lines.frustumCulled = false;
        group.add(lines);
      }

      // Ramp chevrons on the ramp's end tiles.
      // Only the end(s) the robot has visited, as in 2D.
      const rampEnds = data.ramp ? tiles.filter(t => t.kind === "ramp") : [];
      if (rampEnds.length) {
        const decal = decalMaterial(level, `chevron:${data.ramp.dir}`, () => chevronCanvas(data.ramp.dir));
        for (const end of rampEnds) {
          const mesh = new THREE.Mesh(flat, decal);
          mesh.position.set(end.x, base + LIFT * 4, end.z);
          mesh.renderOrder = level * 10 + RANK.chevron;
          mesh.frustumCulled = false;
          group.add(mesh);
        }
      }

      // Debris and kit cubes.
      const cubes = (list, size, color, opacity) => {
        const { m, order } = material(level, RANK.plate, color, opacity);
        const g = own(new THREE.BoxGeometry(size, size, size));
        instanced(group, g, m, order, list.map(item => place(item.x, base + size / 2, item.z)));
      };
      cubes(mine(data.debris), DEBRIS_CUBE, new THREE.Color(C.faint), 1);
      cubes(mine(data.kits), KIT_CUBE, col(C.text), 1);

      // Victim plates, facing into the cell from the wall they were found on.
      const plateGeometry = own(new THREE.PlaneGeometry(PLATE, PLATE));
      for (const v of mine(data.victims)) {
        // Every unidentified plate is the same ring, whatever its type.
        const m = decalMaterial(level, v.identified ? `plate:${v.type}` : "plate:ring", () => plateCanvas(v.type, v.identified));
        const [dx, dz] = DIRS[v.dir];
        const mesh = new THREE.Mesh(plateGeometry, m);
        mesh.position.set(v.x, v.y, v.z);
        mesh.rotation.y = Math.atan2(-dx, -dz);
        mesh.renderOrder = level * 10 + RANK.plate;
        mesh.frustumCulled = false;
        group.add(mesh);
      }
    });

    // Ramp strip between its two ends, over both levels.
    if (data.ramp) {
      const { from, to } = data.ramp;
      const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      const box = own(new THREE.BoxGeometry(RAMP_WIDTH, RAMP_THICK, length));
      const fill = own(new THREE.MeshBasicMaterial({ color: col(C.text), transparent: true, opacity: RAMP_FILL, depthWrite: false }));
      const edge = own(new THREE.LineBasicMaterial({ color: col(C.text), transparent: true, opacity: RAMP_EDGE, depthWrite: false }));
      rampMaterials.push({ material: fill, base: RAMP_FILL }, { material: edge, base: RAMP_EDGE });
      const strip = new THREE.Mesh(box, fill);
      strip.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
      strip.lookAt(to.x, to.y, to.z);
      strip.renderOrder = RANK.ramp + 10;
      strip.frustumCulled = false;
      const edges = new THREE.LineSegments(own(new THREE.EdgesGeometry(box)), edge);
      edges.renderOrder = RANK.ramp + 10.1;
      edges.frustumCulled = false;
      strip.add(edges);
      staticGroup.add(strip);
    }
  }

  // ===== DYNAMIC LAYER =====
  // Robot, beams, trails and labels live in their own group: the static scene
  // rebuilds around them. Everything here is allocated once (buffers have a
  // fixed capacity, the trail doubles when full) and only updated per frame.
  const dyn = [];                 // geometries, materials and textures to dispose with the renderer
  const ownDyn = thing => { dyn.push(thing); return thing; };
  const accentColor = new THREE.Color();
  const textColor = new THREE.Color();
  const labelTint = new THREE.Color();

  const robot = new THREE.Group();
  robot.rotation.order = "YXZ";     // yaw about the world up axis, then pitch about the robot's own side axis
  const bodyMat = ownDyn(new THREE.MeshBasicMaterial());
  const notchMat = ownDyn(new THREE.MeshBasicMaterial());
  {
    const box = (w, h, d, mat, x, y, z) => {
      const mesh = new THREE.Mesh(ownDyn(new THREE.BoxGeometry(w, h, d)), mat);
      mesh.position.set(x, y, z);
      robot.add(mesh);
    };
    const nw = BODY * NOTCH_W;
    const nd = BODY * NOTCH_D;
    box(BODY, ROBOT_H, BODY, bodyMat, 0, ROBOT_H / 2, 0);
    // The dark notch marks the front (-z at yaw 0): on the front face, and across the top edge as in 2D.
    box(nw, ROBOT_H * 0.6, 0.008, notchMat, 0, ROBOT_H / 2, -BODY / 2);
    box(nw, 0.008, nd, notchMat, 0, ROBOT_H, -BODY / 2 + nd / 2);
  }
  dynamicGroup.add(robot);

  // Four beams, each a line (plus a tick where it hit a wall): 8 segments at most.
  const BEAM_VERTS = 4 * 2 * 2;
  const beamPos = new Float32Array(BEAM_VERTS * 3);
  const beamCol = new Float32Array(BEAM_VERTS * 4);
  const beamGeometry = ownDyn(new THREE.BufferGeometry());
  beamGeometry.setAttribute("position", new THREE.BufferAttribute(beamPos, 3).setUsage(THREE.DynamicDrawUsage));
  beamGeometry.setAttribute("color", new THREE.BufferAttribute(beamCol, 4).setUsage(THREE.DynamicDrawUsage));
  beamGeometry.setDrawRange(0, 0);
  const beamMat = ownDyn(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
  const beamLines = new THREE.LineSegments(beamGeometry, beamMat);
  beamLines.frustumCulled = false;
  beamLines.visible = false;
  dynamicGroup.add(beamLines);

  function updateBeams(sim, p) {
    const since = sim.clock - sim.senseAt;
    const show = sim.phase !== "COMPLETE" && sim.phase !== "FADE" && p.climb === null &&
      since >= 0 && since < SENSE_MS && sim.beams.length > 0;
    beamLines.visible = show;
    if (!show) return;
    beamMat.opacity = BEAM_ALPHA * (1 - since / SENSE_MS);
    let v = 0;
    const vertex = (x, y, z, alpha) => {
      beamPos[v * 3] = x; beamPos[v * 3 + 1] = y; beamPos[v * 3 + 2] = z;
      beamCol[v * 4] = accentColor.r; beamCol[v * 4 + 1] = accentColor.g; beamCol[v * 4 + 2] = accentColor.b; beamCol[v * 4 + 3] = alpha;
      v++;
    };
    sim.beams.forEach((beam, index) => {
      const o = cellToWorld(sim.field, beam.node);
      const y = o.y + BEAM_BODY_Y;
      const [dx, dz] = DIRS[beam.dir];
      const length = beam.tiles * beamScale(sim, index);
      const ex = o.x + dx * length;
      const ez = o.z + dz * length;
      vertex(o.x, y, o.z, 1);
      vertex(ex, y, ez, beam.hit ? 1 : 0);      // a miss fades out where the beam ran out of range
      if (beam.hit) {
        vertex(ex + dz * BEAM_TICK, y, ez - dx * BEAM_TICK, 1);
        vertex(ex - dz * BEAM_TICK, y, ez + dx * BEAM_TICK, 1);
      }
    });
    beamGeometry.setDrawRange(0, v);
    beamGeometry.attributes.position.needsUpdate = true;
    beamGeometry.attributes.color.needsUpdate = true;
    beamLines.renderOrder = levelOf(sim.beams[0].node) * 10 + RANK.beam;
  }

  // One polyline per level, written as segment pairs into a buffer that is only
  // re-filled when the trail grows and only re-uploaded over the filled range.
  const trails = [];              // per level: { line, material, geometry, capacity, positions }
  const trailCount = [];
  let trailSeen = null;
  let trailLength = -1;

  function trailFor(level, need) {
    let t = trails[level];
    if (!t) {
      const material = ownDyn(new THREE.LineBasicMaterial({ color: accentColor, transparent: true, opacity: TRAIL_ALPHA, depthWrite: false }));
      t = trails[level] = { line: new THREE.LineSegments(new THREE.BufferGeometry(), material), material, geometry: null, capacity: 0, positions: null };
      t.line.frustumCulled = false;
      t.line.renderOrder = level * 10 + RANK.trail;
      dynamicGroup.add(t.line);
    }
    if (t.capacity < need) {
      t.geometry?.dispose();
      let capacity = Math.max(TRAIL_START, t.capacity * 2);
      while (capacity < need) capacity *= 2;
      t.capacity = capacity;
      t.positions = new Float32Array(capacity * 6);
      t.geometry = new THREE.BufferGeometry();
      t.geometry.setAttribute("position", new THREE.BufferAttribute(t.positions, 3).setUsage(THREE.DynamicDrawUsage));
      t.line.geometry = t.geometry;
    }
    return t;
  }

  function updateTrails(sim) {
    const trail = sim.trail;
    if (trail === trailSeen && trail.length === trailLength) return;
    trailSeen = trail;
    trailLength = trail.length;
    const levels = sim.field.levels.length;
    for (let l = 0; l < levels; l++) { trailFor(l, trail.length); trailCount[l] = 0; }
    for (let i = 1; i < trail.length; i++) {
      const level = levelOf(trail[i - 1].node);
      if (level !== levelOf(trail[i].node)) continue;          // no segment across the ramp
      const a = cellToWorld(sim.field, trail[i - 1].node);
      const b = cellToWorld(sim.field, trail[i].node);
      const t = trails[level];
      const at = trailCount[level]++ * 6;
      t.positions[at] = a.x; t.positions[at + 1] = a.y + TRAIL_LIFT; t.positions[at + 2] = a.z;
      t.positions[at + 3] = b.x; t.positions[at + 4] = b.y + TRAIL_LIFT; t.positions[at + 5] = b.z;
    }
    trails.forEach((t, l) => {
      const count = l < levels ? trailCount[l] : 0;
      t.line.visible = l < levels;
      t.geometry.setDrawRange(0, count * 2);
      const attribute = t.geometry.attributes.position;
      attribute.clearUpdateRanges();
      if (count) attribute.addUpdateRange(0, count * 6);
      attribute.needsUpdate = true;
    });
  }

  // One sprite per level, "L1 81/81": a white-on-clear mask texture tinted by the
  // sprite colour, so switching the active level never redraws it.
  const screenX = new THREE.Vector3();
  const screenY = new THREE.Vector3();
  const screenZ = new THREE.Vector3();
  const labelAnchor = new THREE.Vector3();
  const labelPoint = new THREE.Vector3();
  const labels = [];              // per level: { sprite, material, context, texture, text }
  function labelFor(level) {
    if (labels[level]) return labels[level];
    const surface = document.createElement("canvas");
    surface.width = LABEL_TEX_W;
    surface.height = LABEL_TEX_H;
    const texture = ownDyn(new THREE.CanvasTexture(surface));
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = ownDyn(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
    const sprite = new THREE.Sprite(material);
    // Centred sprite: updateLabels places it from a screen-space rectangle for the text.
    sprite.frustumCulled = false;
    sprite.renderOrder = 100 + level;
    dynamicGroup.add(sprite);
    return (labels[level] = { sprite, material, context: surface.getContext("2d"), texture, text: null, textW: 0 });
  }

  function drawLabel(label, text) {
    const ctx = label.context;
    ctx.clearRect(0, 0, LABEL_TEX_W, LABEL_TEX_H);
    ctx.font = `500 ${LABEL_PX * LABEL_TEX_SCALE}px ${C.font}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "white";                // mask only; the sprite colour supplies the theme colour
    ctx.fillText(text, LABEL_TEX_W - LABEL_PAD, LABEL_TEX_H / 2);
    label.textW = ctx.measureText(text).width / LABEL_TEX_SCALE;     // CSS px, for keeping it on screen
    label.texture.needsUpdate = true;
    label.text = text;
  }

  function updateLabels(sim, factors) {
    // Texture pixels per CSS pixel is LABEL_TEX_SCALE, and CSS pixels per world
    // unit is the canvas height over the frustum height, so one texture pixel
    // spans 1 / (LABEL_TEX_SCALE * pxPerUnit) world units: the em is LABEL_PX CSS px.
    const unitsPerCssPx = (camera.top - camera.bottom) / height;
    const w = LABEL_TEX_W / LABEL_TEX_SCALE * unitsPerCssPx;
    const h = LABEL_TEX_H / LABEL_TEX_SCALE * unitsPerCssPx;
    camera.matrixWorld.extractBasis(screenX, screenY, screenZ);
    sim.field.levels.forEach((levelData, level) => {
      let mapped = 0;
      for (const node of sim.visited) if (levelOf(node) === level) mapped++;
      for (const node of sim.black) if (levelOf(node) === level) mapped++;
      const label = labelFor(level);
      const text = `L${level + 1} ${mapped}/${levelData.size * levelData.size}`;
      if (text !== label.text) drawLabel(label, text);
      const half = levelData.size / 2;
      // Anchor: the back-left corner (at yaw 0), a little outside. Where it lands on
      // screen decides which way the text runs: towards the canvas interior, then
      // clamped to LABEL_EDGE from every side, so it is never cut off at any azimuth
      // or canvas size. The shift is applied along the camera's own axes, which is
      // exact for an orthographic view.
      labelAnchor.set(-half - LABEL_OUT, level * LEVEL_GAP, -half - LABEL_OUT);
      labelPoint.copy(labelAnchor).project(camera);
      const ax = (labelPoint.x + 1) / 2 * width;
      const ay = (1 - labelPoint.y) / 2 * height;
      const tw = Math.min(label.textW, width - 2 * LABEL_EDGE);
      const left = Math.max(LABEL_EDGE, Math.min(ax < width / 2 ? ax : ax - tw, width - LABEL_EDGE - tw));
      const top = Math.max(LABEL_EDGE, Math.min(ay < height / 2 ? ay : ay - LABEL_PX, height - LABEL_EDGE - LABEL_PX));
      // Sprite centre (screen px): the text is right-aligned in its texture.
      const cx = left + tw / 2 - LABEL_TEX_W / LABEL_TEX_SCALE / 2 + LABEL_PAD / LABEL_TEX_SCALE + tw / 2;
      const cy = top + LABEL_PX / 2;
      label.sprite.position.copy(labelAnchor)
        .addScaledVector(screenX, (cx - ax) * unitsPerCssPx)
        .addScaledVector(screenY, -(cy - ay) * unitsPerCssPx);
      label.sprite.scale.set(w, h, 1);
      // Active level: accent, full; inactive: text colour at half strength.
      const u = (factors[level] - INACTIVE_LEVEL) / (1 - INACTIVE_LEVEL);
      label.material.color.copy(labelTint.copy(textColor).lerp(accentColor, u));
      label.material.opacity = LABEL_INACTIVE_ALPHA + (1 - LABEL_INACTIVE_ALPHA) * u;
      label.sprite.visible = true;
    });
    labels.forEach((label, level) => { if (level >= sim.field.levels.length) label.sprite.visible = false; });
  }

  function paintDynamic() {
    accentColor.set(`rgb(${C.accent})`);
    textColor.set(`rgb(${C.text})`);
    bodyMat.color.set(`rgb(${C.accent})`);
    notchMat.color.set(C.ink);
    trails.forEach(t => t.material.color.copy(accentColor));
    labels.forEach(label => { label.text = null; });          // font may have loaded: redraw next frame
  }
  paintDynamic();

  const factors = [];
  function updateDynamic(sim) {
    const p = pose(sim);
    const levels = sim.field.levels.length;

    updateTrails(sim);      // before emphasis, so a new trail gets its level's opacity below

    // Level emphasis: the level the robot is on stays full; the other drops to
    // INACTIVE_LEVEL, and the two cross-fade through the arrival at the end of a
    // ramp climb (pose.level only switches then, so it can't drive this alone).
    factors.length = levels;
    factors.fill(INACTIVE_LEVEL);
    if (p.levelFade) {
      factors[p.levelFade.from] = 1 + (INACTIVE_LEVEL - 1) * p.levelFade.t;
      factors[p.levelFade.to] = INACTIVE_LEVEL + (1 - INACTIVE_LEVEL) * p.levelFade.t;
    } else {
      factors[p.level] = 1;
    }
    factors.forEach((f, level) => {
      if (appliedFactors[level] === f) return;
      appliedFactors[level] = f;
      applyAlpha(levelMaterials[level], f);
      if (trails[level]) trails[level].material.opacity = TRAIL_ALPHA * f;
    });
    // The ramp strip joins the first and last level: it follows their mean.
    const ramp = factors.reduce((sum, f) => sum + f, 0) / levels;
    if (ramp !== appliedRamp) { appliedRamp = ramp; applyAlpha(rampMaterials, ramp); }

    // Robot. robotTransform pitches the whole climb at once (it steps in during the
    // in-place turn); the displayed pitch is eased in and out so the body only tilts
    // while it is actually travelling along the ramp.
    const tf = robotTransform(sim.field, sim);
    const tilt = p.climb === null ? 0 : smooth(p.climb / PITCH_EASE) * smooth((1 - p.climb) / PITCH_EASE);
    robot.position.set(tf.x, tf.y, tf.z);
    robot.rotation.set(tf.pitch * tilt, -tf.yaw, 0);      // yaw is clockwise from above; three's is counter-clockwise

    updateBeams(sim, p);
    updateLabels(sim, factors);
  }

  function disposeDynamic() {
    for (const thing of dyn) thing.dispose();
    for (const t of trails) { t.geometry?.dispose(); t.material.dispose(); }
    dyn.length = 0;
    trails.length = 0;
    labels.length = 0;
    dynamicGroup.clear();
  }

  // ===== CAMERA =====
  const cam = { azimuth: START_AZIMUTH, dragging: false, resumeAt: 0 };
  let fitKey = null;
  let fitted = null;
  let last = null;
  let previous = null;
  let shownOpacity = null;
  let width = 0;
  let height = 0;

  function fit(sim) {
    const sizes = sim.field.levels.map(level => level.size);
    const key = `${sizes.join(",")}:${width}x${height}`;
    if (key === fitKey) return;
    fitKey = key;
    fitted = fitFrustum(sizes, width / height);
    camera.left = -fitted.halfW;
    camera.right = fitted.halfW;
    camera.top = fitted.halfH;
    camera.bottom = -fitted.halfH;
    camera.updateProjectionMatrix();
  }

  function placeCamera() {
    const { target } = fitted;
    const az = cam.azimuth * Math.PI / 180;
    camera.position.set(
      target.x + CAMERA_DISTANCE * Math.cos(ELEVATION) * Math.sin(az),
      target.y + CAMERA_DISTANCE * Math.sin(ELEVATION),
      target.z + CAMERA_DISTANCE * Math.cos(ELEVATION) * Math.cos(az)
    );
    camera.lookAt(target.x, target.y, target.z);
    camera.updateMatrixWorld();      // labels project through it before the render does
  }

  // ===== DRAG =====
  let dragPointer = null;
  let dragX = 0;

  function onDown(event) {
    if (dragPointer !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
    dragPointer = event.pointerId;
    dragX = event.clientX;
    cam.dragging = true;
    try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* pointer already gone */ }
  }

  function onMove(event) {
    if (event.pointerId !== dragPointer) return;
    // The scene follows the pointer: dragging right turns its front to the right.
    cam.azimuth -= (event.clientX - dragX) * DRAG_DEG_PER_PX;
    dragX = event.clientX;
    if (last) render(last);
  }

  function release(event) {
    if (dragPointer === null || event.pointerId !== dragPointer) return;
    dragPointer = null;
    cam.dragging = false;
    cam.resumeAt = performance.now() + RESUME_MS;
    try {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    } catch (_) { /* capture already released */ }
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("lostpointercapture", release);

  // ===== CONTEXT LOSS =====
  function onContextLost(event) {
    event.preventDefault();
    opts.onLost?.();
  }
  canvas.addEventListener("webglcontextlost", onContextLost);

  // ===== PUBLIC =====
  let disposed = false;

  function resize() {
    if (disposed) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    readColors();
    paintDynamic();
    disposeDecals();   // cached art holds the old colours
    builtVersion = null;
    if (!w || !h) return;
    width = w;
    height = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    fitKey = null;
    if (last) render(last);
  }

  function render(sim) {
    if (disposed) return;
    last = sim;
    // The same end-of-run fade as the 2D canvas; the next run's first frame is back to 1.
    const fade = sim.phase === "FADE" ? String(Math.max(0, 1 - sim.hold / FADE_MS)) : "1";
    if (fade !== shownOpacity) { canvas.style.opacity = fade; shownOpacity = fade; }
    const now = performance.now();
    const dt = previous === null ? 0 : Math.min(50, now - previous);
    previous = now;
    if (!width || !height) return;
    if (!cam.dragging && now >= cam.resumeAt) {
      cam.azimuth = (cam.azimuth + 360 * dt / ORBIT_PERIOD_MS) % 360;
    }
    const version = staticVersion(sim);
    if (version !== builtVersion) {
      buildScene(sim);
      builtVersion = version;
    }
    fit(sim);
    placeCamera();
    updateDynamic(sim);
    if (renderer.getContext().isContextLost()) return;
    renderer.render(scene, camera);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", release);
    canvas.removeEventListener("pointercancel", release);
    canvas.removeEventListener("lostpointercapture", release);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    disposeStatic();
    disposeDecals();
    disposeDynamic();
    canvas.style.opacity = "";
    const lost = renderer.getContext().isContextLost();
    renderer.dispose();
    if (!lost) renderer.forceContextLoss();   // forcing an already lost context only logs a warning
    last = null;
  }

  return { resize, render, dispose };
}
