// Background field: a faint dot matrix that brightens toward the accent
// around the pointer, with a slow scan line sweeping down every so often.
// Draws only while something changes (pointer moved or a sweep is running),
// so an idle page costs nothing.
(function () {
  "use strict";

  const canvas = document.getElementById("particles-bg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const SPACING = 28;
  const DOT = 1.5;
  const BASE_ALPHA = 0.06;
  const POINTER_RADIUS = 150;
  const POINTER_ALPHA = 0.45;
  const SWEEP_BAND = 60;
  const SWEEP_ALPHA = 0.1;
  const SWEEP_DURATION = 7000;
  const SWEEP_EVERY = 16000;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;

  // Colours come from the design tokens so the field follows the palette.
  const styles = getComputedStyle(document.documentElement);
  const rgb = name => styles.getPropertyValue(name).split(",").map(n => Number(n.trim()));
  const TEXT = rgb("--c-text-rgb").length === 3 ? rgb("--c-text-rgb") : [236, 230, 218];
  const ACCENT = rgb("--c-accent-rgb").length === 3 ? rgb("--c-accent-rgb") : [255, 138, 31];

  let width = 0;
  let height = 0;
  let pointer = null;
  let sweepStart = null;
  let rafId = null;
  let sweepTimer = null;

  const smoothstep = t => t * t * (3 - 2 * t);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(performance.now());
  }

  function sweepY(now) {
    if (sweepStart === null) return null;
    const t = (now - sweepStart) / SWEEP_DURATION;
    if (t >= 1) {
      sweepStart = null;
      return null;
    }
    return -SWEEP_BAND + t * (height + SWEEP_BAND * 2);
  }

  function draw(now) {
    ctx.clearRect(0, 0, width, height);
    const scanY = sweepY(now);
    const offset = (SPACING - DOT) / 2;

    for (let y = offset; y < height; y += SPACING) {
      const scanBoost = scanY === null
        ? 0
        : SWEEP_ALPHA * Math.max(0, 1 - Math.abs(y - scanY) / SWEEP_BAND);
      const rowStyle = `rgba(${TEXT[0]}, ${TEXT[1]}, ${TEXT[2]}, ${BASE_ALPHA + scanBoost})`;
      const rowNearPointer = pointer && Math.abs(y - pointer.y) < POINTER_RADIUS;

      // fillStyle is only reassigned when a dot differs from its row, which
      // keeps the common case to one assignment per row.
      ctx.fillStyle = rowStyle;
      for (let x = offset; x < width; x += SPACING) {
        let near = 0;
        if (rowNearPointer) {
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < POINTER_RADIUS) near = smoothstep(1 - distance / POINTER_RADIUS);
        }

        if (near > 0) {
          const alpha = BASE_ALPHA + scanBoost + near * (POINTER_ALPHA - BASE_ALPHA);
          const r = TEXT[0] + (ACCENT[0] - TEXT[0]) * near;
          const g = TEXT[1] + (ACCENT[1] - TEXT[1]) * near;
          const b = TEXT[2] + (ACCENT[2] - TEXT[2]) * near;
          ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${alpha})`;
          ctx.fillRect(x, y, DOT, DOT);
          ctx.fillStyle = rowStyle;
        } else {
          ctx.fillRect(x, y, DOT, DOT);
        }
      }
    }
  }

  function frame(now) {
    rafId = null;
    draw(now);
    if (sweepStart !== null) request();
  }

  function request() {
    if (rafId === null && !document.hidden) rafId = requestAnimationFrame(frame);
  }

  function startSweep() {
    if (document.hidden) return;
    sweepStart = performance.now();
    request();
  }

  // Debounce resize so a drag-resize doesn't redraw every tick.
  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  }

  // Kept for backwards compatibility with pages that called it directly.
  window.resetParticles = resize;

  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("fullscreenchange", onResize, { passive: true });

  if (!reduceMotion) {
    if (finePointer) {
      window.addEventListener("pointermove", event => {
        pointer = { x: event.clientX, y: event.clientY };
        request();
      }, { passive: true });

      document.documentElement.addEventListener("pointerleave", () => {
        pointer = null;
        request();
      });
    }

    sweepTimer = setInterval(startSweep, SWEEP_EVERY);
    setTimeout(startSweep, 1200);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
        clearInterval(sweepTimer);
      } else {
        clearInterval(sweepTimer);
        sweepTimer = setInterval(startSweep, SWEEP_EVERY);
        request();
      }
    });
  }

  resize();
})();
