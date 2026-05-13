const canvas = document.getElementById("particles-bg");
if (!canvas) {
    console.error("particles.js: canvas not found");
} else {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        console.error("particles.js: failed to get 2d context");
    } else {

        let particles = [];
        let hue = 0;

        const mouse = {
            x: null,
            y: null,
            radius: 120
        };


        function resetParticles() {
            resizeCanvas();
        }

// expose globally
        window.resetParticles = resetParticles;

// ===== RESIZE HANDLING =====
        function resizeCanvas() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            createParticles();
        }

        window.addEventListener("resize", resizeCanvas);
        window.addEventListener("fullscreenchange", resizeCanvas);

// ===== MOUSE TRACKING =====
        window.addEventListener("mousemove", (e) => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
        });

// ===== PARTICLE CREATION (RESPONSIVE COUNT 🔥) =====
        function createParticles() {
            particles = [];

            const area = canvas.width * canvas.height;

            // Density scaling (adjust this if needed)
            const particleCount = Math.min(300, Math.floor(area / 8000));

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

            hue += 0.5;

            particles.forEach(p => {
                // Movement
                p.x += p.vx;
                p.y += p.vy;

                // Bounce
                if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
                if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

                // Glow near mouse
                let glow = 10;
                if (mouse.x !== null && mouse.y !== null) {
                    const dx = p.x - mouse.x;
                    const dy = p.y - mouse.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < mouse.radius) {
                        glow = 25 * (1 - dist / mouse.radius);
                    }
                }

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = `hsl(${hue}, 100%, 60%)`;

                ctx.shadowBlur = glow;
                ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;

                ctx.fill();
                ctx.shadowBlur = 0;
            });

            // ===== PARTICLE CONNECTIONS =====
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance < 120) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);

                        ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${1 - distance / 120})`;
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                }
            }

            // ===== MOUSE CONNECTIONS =====
            if (mouse.x !== null && mouse.y !== null) {
                particles.forEach(p => {
                    const dx = p.x - mouse.x;
                    const dy = p.y - mouse.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < mouse.radius) {
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(mouse.x, mouse.y);

                        ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${1 - dist / mouse.radius})`;
                        ctx.lineWidth = 1.5;
                        ctx.stroke();
                    }
                });
            }

            requestAnimationFrame(draw);
        }

// ===== INIT =====
        resizeCanvas();
        draw();
    }
}