import { useEffect, useState, useRef } from "react";

export function IntroVideo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<"aurora" | "converge" | "reveal" | "fade">("aurora");
  const [isVisible, setIsVisible] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [showCursor, setShowCursor] = useState(false);
  const [showSubtitle, setShowSubtitle] = useState(false);
  const [burstActive, setBurstActive] = useState(false);

  const fullTitle = "Bloomberg Terminal Ads";

  useEffect(() => {
    const shouldShow = sessionStorage.getItem("showIntroVideo");
    if (shouldShow === "true") {
      setIsVisible(true);
      sessionStorage.removeItem("showIntroVideo");
    }
  }, []);

  // ============================================================
  // TIMELINE — ~4s total
  // 0.0s  → aurora fade-in
  // 1.0s  → converge to center
  // 1.6s  → burst + logo + typewriter
  // 3.2s  → fade out begins
  // 4.2s  → dispatch "intro-done" + remove
  // ============================================================
  useEffect(() => {
    if (!isVisible) return;
    const t1 = setTimeout(() => setPhase("converge"), 1000);
    const t2 = setTimeout(() => { setPhase("reveal"); setBurstActive(true); setShowCursor(true); }, 1600);
    const t3 = setTimeout(() => setPhase("fade"), 3200);
    const t4 = setTimeout(() => {
      // Signal App.tsx to start entrance animations
      window.dispatchEvent(new Event("intro-animation-done"));
      setIsVisible(false);
    }, 4200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [isVisible]);

  // Typewriter — 50ms/letter
  useEffect(() => {
    if (phase !== "reveal") return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setTypedText(fullTitle.slice(0, i));
      if (i >= fullTitle.length) {
        clearInterval(interval);
        setTimeout(() => { setShowCursor(false); setShowSubtitle(true); }, 300);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [phase]);

  // ============================================================
  // CANVAS
  // ============================================================
  useEffect(() => {
    if (!isVisible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animId: number;
    let t = 0;

    const resize = () => {
      canvas.width = window.innerWidth * 2;
      canvas.height = window.innerHeight * 2;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
    };
    resize();
    window.addEventListener("resize", resize);

    const blobs = [
      { x: 0.15, y: 0.2,  r: 0.45, color: [130, 40, 210], alpha: 0, target: 0.45, speed: 0.015, ox: 0.22, oy: 0.18, phase: 0 },
      { x: 0.80, y: 0.25, r: 0.40, color: [55, 90, 220],  alpha: 0, target: 0.38, speed: 0.011, ox: 0.20, oy: 0.15, phase: 1.8 },
      { x: 0.5,  y: 0.75, r: 0.50, color: [30, 160, 215], alpha: 0, target: 0.35, speed: 0.013, ox: 0.18, oy: 0.22, phase: 3.2 },
      { x: 0.85, y: 0.7,  r: 0.38, color: [180, 50, 230], alpha: 0, target: 0.30, speed: 0.017, ox: 0.24, oy: 0.20, phase: 5.0 },
      { x: 0.10, y: 0.65, r: 0.35, color: [25, 200, 230], alpha: 0, target: 0.28, speed: 0.019, ox: 0.26, oy: 0.20, phase: 2.5 },
      { x: 0.65, y: 0.10, r: 0.30, color: [200, 60, 255], alpha: 0, target: 0.25, speed: 0.014, ox: 0.18, oy: 0.24, phase: 4.2 },
    ];

    const particles: { x: number; y: number; vx: number; vy: number; r: number; color: number[]; alpha: number; life: number }[] = [];
    let burstDone = false;

    const draw = () => {
      t += 1;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;

      ctx.fillStyle = "#050018";
      ctx.fillRect(0, 0, w, h);

      const phaseEl = document.getElementById("intro-phase");
      const cur = phaseEl?.dataset.phase || "aurora";

      // Converge: 0→1 over ~36 frames (0.6s)
      let converge = 0;
      if (cur === "converge") converge = Math.min(1, (t - 60) / 36);
      if (cur === "reveal" || cur === "fade") converge = 1;

      // Burst expand
      let burst = 0;
      if (cur === "reveal" || cur === "fade") burst = Math.min(1, (t - 96) / 24);

      for (const b of blobs) {
        b.alpha = Math.min(b.target, b.alpha + b.target / 15);

        const nx = b.x + Math.sin(t * b.speed + b.phase) * b.ox + Math.cos(t * b.speed * 0.6 + b.phase * 1.7) * b.ox * 0.5;
        const ny = b.y + Math.cos(t * b.speed * 0.85 + b.phase) * b.oy + Math.sin(t * b.speed * 0.4 + b.phase * 2.1) * b.oy * 0.4;
        const bx = w * (nx * (1 - converge) + 0.5 * converge);
        const by = h * (ny * (1 - converge) + 0.5 * converge);

        const pulse = 1 + Math.sin(t * b.speed * 2 + b.phase) * 0.15;
        let sz = pulse * (1 - converge * 0.5);
        if (burst > 0) sz = pulse * (0.5 + burst * 1.5);
        const radius = Math.min(w, h) * b.r * sz;

        let a = b.alpha;
        if (converge > 0.5) a *= 1 + (converge - 0.5) * 1.5;
        if (burst > 0) a *= Math.max(0.3, 1 - burst * 0.6);
        if (cur === "fade") a *= 0.4;

        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
        const [r, g, bl] = b.color;
        grad.addColorStop(0, `rgba(${r},${g},${bl},${a})`);
        grad.addColorStop(0.35, `rgba(${r},${g},${bl},${a * 0.6})`);
        grad.addColorStop(0.7, `rgba(${r},${g},${bl},${a * 0.15})`);
        grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      // Central glow
      if (converge > 0) {
        const ga = converge * 0.25 * (1 - burst * 0.7);
        const gr = Math.min(w, h) * (0.15 + converge * 0.15);
        const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr);
        g2.addColorStop(0, `rgba(220,200,255,${ga})`);
        g2.addColorStop(0.5, `rgba(130,80,220,${ga * 0.4})`);
        g2.addColorStop(1, "rgba(130,80,220,0)");
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, w, h);
      }

      // Burst particles
      if (cur === "reveal" && !burstDone) {
        burstDone = true;
        const cols = [[130,40,210],[55,90,220],[30,160,215],[180,50,230],[25,200,230],[220,200,255]];
        for (let i = 0; i < 70; i++) {
          const ang = (Math.PI * 2 * i) / 70 + (Math.random() - 0.5) * 0.3;
          const spd = 3 + Math.random() * 8;
          particles.push({ x: cx, y: cy, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, r: 2 + Math.random() * 4, color: cols[Math.floor(Math.random() * cols.length)], alpha: 0.8 + Math.random() * 0.2, life: 35 + Math.random() * 25 });
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.vx *= 0.97; p.vy *= 0.97; p.life--; p.alpha *= 0.97;
        if (p.life <= 0 || p.alpha < 0.01) { particles.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${p.alpha})`;
        ctx.fill();
        const tg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        tg.addColorStop(0, `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${p.alpha * 0.12})`);
        tg.addColorStop(1, `rgba(${p.color[0]},${p.color[1]},${p.color[2]},0)`);
        ctx.fillStyle = tg;
        ctx.fillRect(p.x - p.r * 4, p.y - p.r * 4, p.r * 8, p.r * 8);
      }

      // Flash
      if (cur === "reveal" && burst < 0.3) {
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0, 0.35 - burst * 1.4)})`;
        ctx.fillRect(0, 0, w, h);
      }

      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999, background: "#050018",
      opacity: phase === "fade" ? 0 : 1,
      transition: "opacity 1s ease-out",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        @keyframes iLogoIn {
          0% { transform: scale(0) rotate(-20deg); opacity: 0; }
          60% { transform: scale(1.15) rotate(3deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes iLogoPulse {
          0%, 100% { box-shadow: 0 0 40px rgba(130,40,210,0.4), 0 0 80px rgba(56,217,245,0.15); }
          50% { box-shadow: 0 0 60px rgba(130,40,210,0.6), 0 0 120px rgba(56,217,245,0.3); }
        }
        @keyframes iCursor { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes iSubIn {
          from { opacity: 0; transform: translateY(8px); letter-spacing: 0.3em; }
          to { opacity: 1; transform: translateY(0); letter-spacing: 0.15em; }
        }
        @keyframes iRing {
          0% { transform: scale(0); opacity: 0.6; }
          100% { transform: scale(3); opacity: 0; }
        }
      `}</style>

      <div id="intro-phase" data-phase={phase} style={{ display: "none" }} />
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, zIndex: 0 }} />

      <div style={{
        position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", opacity: 0.25,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`,
        backgroundRepeat: "repeat", backgroundSize: "128px",
      }} />

      <div style={{
        position: "relative", zIndex: 2,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        width: "100%", height: "100%",
        fontFamily: "'Inter', -apple-system, sans-serif",
      }}>
        {burstActive && [0, 0.12, 0.25].map((delay, i) => (
          <div key={i} style={{
            position: "absolute", width: 110, height: 110, borderRadius: "50%",
            border: `${2 - i * 0.5}px solid rgba(${i === 1 ? "56,217,245" : "130,40,210"},${0.4 - i * 0.1})`,
            animation: `iRing ${1 + i * 0.15}s ease-out forwards`,
            animationDelay: `${delay}s`,
          }} />
        ))}

        <div style={{
          width: 80, height: 80, borderRadius: 22,
          background: "linear-gradient(135deg, rgba(130,40,210,0.5), rgba(30,160,215,0.4))",
          border: "1.5px solid rgba(255,255,255,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center",
          opacity: phase === "reveal" || phase === "fade" ? 1 : 0,
          animation: phase === "reveal" ? "iLogoIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both, iLogoPulse 3s ease-in-out 0.6s infinite" : "none",
          marginBottom: 28,
        }}>
          <span style={{ fontSize: 38, filter: "drop-shadow(0 0 12px rgba(255,255,255,0.3))" }}>⚡</span>
        </div>

        <div style={{
          fontSize: 36, fontWeight: 900, color: "#f4f0ff", letterSpacing: "-0.03em",
          minHeight: 48, opacity: phase === "reveal" || phase === "fade" ? 1 : 0,
          transition: "opacity 0.3s ease",
          textShadow: "0 0 40px rgba(130,40,210,0.3), 0 0 80px rgba(56,217,245,0.15)",
          display: "flex", alignItems: "center",
        }}>
          <span>{typedText}</span>
          {showCursor && (
            <span style={{
              display: "inline-block", width: 3, height: 36, marginLeft: 2,
              background: "linear-gradient(to bottom, rgba(56,217,245,0.9), rgba(130,40,210,0.9))",
              borderRadius: 2, animation: "iCursor 0.6s step-end infinite",
            }} />
          )}
        </div>

        <div style={{
          fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.35)",
          marginTop: 16, textTransform: "uppercase", letterSpacing: "0.15em",
          opacity: showSubtitle ? 1 : 0,
          animation: showSubtitle ? "iSubIn 0.6s ease-out both" : "none",
        }}>
          Gamned! — Trading Desk
        </div>

        <div style={{
          width: showSubtitle ? 60 : 0, height: 2,
          background: "linear-gradient(to right, rgba(130,40,210,0.6), rgba(56,217,245,0.6))",
          borderRadius: 1, marginTop: 20,
          transition: "width 0.8s cubic-bezier(0.16, 1, 0.3, 1)", transitionDelay: "0.2s",
          boxShadow: "0 0 20px rgba(130,40,210,0.3)",
        }} />
      </div>
    </div>
  );
}
