const canvas = document.getElementById("particles-bg");
if (!canvas) {
    console.error("particles.js: canvas not found");
} else {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        console.error("particles.js: failed to get 2d context");
    } else {

        const TAU = Math.PI * 2;
        const CONN = 120;          // connection distance
        const CONN2 = CONN * CONN; // squared, avoids sqrt in the hot loop
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        let particles = [];
        let hue = 0;
        let rafId = null;

        const mouse = {
            x: null,
            y: null,
            radius: 120,
            radius2: 120 * 120
        };

        // ===== RESIZE HANDLING =====
        function resizeCanvas() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            createParticles();
        }

        // expose globally (kept for backwards compatibility)
        window.resetParticles = resizeCanvas;

        // Debounce resize so a drag-resize doesn't rebuild particles every tick.
        let resizeTimer = null;
        function onResize() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(resizeCanvas, 150);
        }
        window.addEventListener("resize", onResize, { passive: true });
        window.addEventListener("fullscreenchange", onResize, { passive: true });

        // ===== MOUSE TRACKING =====
        window.addEventListener("mousemove", (e) => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
        }, { passive: true });

        // ===== PARTICLE CREATION (RESPONSIVE COUNT) =====
        function createParticles() {
            particles = [];

            const area = canvas.width * canvas.height;
            // Lower density + cap than before: O(n^2) connections make high
            // counts very expensive for almost no visual gain.
            const particleCount = Math.min(140, Math.floor(area / 12000));

            for (let i = 0; i < particleCount; i++) {
                particles.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    vx: (Math.random() - 0.5) * 0.6,
                    vy: (Math.random() - 0.5) * 0.6,
                    size: Math.random() * 2 + 1
                });
            }
        }

        // ===== DRAW LOOP =====
        function draw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            hue = (hue + 0.5) % 360;
            const color = `hsl(${hue}, 100%, 60%)`;

            const w = canvas.width;
            const h = canvas.height;
            const hasMouse = mouse.x !== null && mouse.y !== null;

            // Move all particles first.
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0 || p.x > w) p.vx *= -1;
                if (p.y < 0 || p.y > h) p.vy *= -1;
            }

            // Draw every dot in ONE path with a single shadow setup.
            // shadowBlur is the most expensive op here — doing it once per
            // frame instead of once per particle is a huge win, and the look
            // is identical since all dots share the same colour.
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                ctx.moveTo(p.x + p.size, p.y);
                ctx.arc(p.x, p.y, p.size, 0, TAU);
            }
            ctx.fill();
            ctx.shadowBlur = 0;

            // Stronger glow for the handful of particles near the cursor.
            if (hasMouse) {
                for (let i = 0; i < particles.length; i++) {
                    const p = particles[i];
                    const dx = p.x - mouse.x;
                    const dy = p.y - mouse.y;
                    const d2 = dx * dx + dy * dy;
                    if (d2 < mouse.radius2) {
                        const dist = Math.sqrt(d2);
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, p.size, 0, TAU);
                        ctx.shadowColor = color;
                        ctx.shadowBlur = 25 * (1 - dist / mouse.radius);
                        ctx.fill();
                        ctx.shadowBlur = 0;
                    }
                }
            }

            // ===== PARTICLE CONNECTIONS =====
            // Compare squared distances; only pay for sqrt on actual links.
            ctx.lineWidth = 1;
            for (let i = 0; i < particles.length; i++) {
                const a = particles[i];
                for (let j = i + 1; j < particles.length; j++) {
                    const b = particles[j];
                    const dx = a.x - b.x;
                    const dy = a.y - b.y;
                    const d2 = dx * dx + dy * dy;

                    if (d2 < CONN2) {
                        const distance = Math.sqrt(d2);
                        ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${1 - distance / CONN})`;
                        ctx.beginPath();
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                        ctx.stroke();
                    }
                }
            }

            // ===== MOUSE CONNECTIONS =====
            if (hasMouse) {
                ctx.lineWidth = 1.5;
                for (let i = 0; i < particles.length; i++) {
                    const p = particles[i];
                    const dx = p.x - mouse.x;
                    const dy = p.y - mouse.y;
                    const d2 = dx * dx + dy * dy;

                    if (d2 < mouse.radius2) {
                        const dist = Math.sqrt(d2);
                        ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${1 - dist / mouse.radius})`;
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(mouse.x, mouse.y);
                        ctx.stroke();
                    }
                }
            }

            rafId = requestAnimationFrame(draw);
        }

        // ===== INIT =====
        resizeCanvas();

        if (reduceMotion) {
            // Honour the user's motion preference: paint one static frame,
            // no animation loop.
            const color = `hsl(200, 100%, 60%)`;
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                ctx.moveTo(p.x + p.size, p.y);
                ctx.arc(p.x, p.y, p.size, 0, TAU);
            }
            ctx.fill();
            ctx.shadowBlur = 0;
        } else {
            // Pause the loop when the tab is hidden so it isn't burning
            // cycles in the background, and resume cleanly on return.
            draw();
            document.addEventListener("visibilitychange", () => {
                if (document.hidden) {
                    if (rafId !== null) {
                        cancelAnimationFrame(rafId);
                        rafId = null;
                    }
                } else if (rafId === null) {
                    draw();
                }
            });
        }
    }
}
