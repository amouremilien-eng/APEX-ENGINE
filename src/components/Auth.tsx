import React, { useState, useEffect, useRef } from "react";
import { useUserStore } from "../store/useUserStore";
import { Loader2 } from "lucide-react";

export function Auth() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const { login, register } = useUserStore();

  // ============================================================
  // AURORA CANVAS — Biggie palette (violet → cyan)
  // ============================================================
  useEffect(() => {
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
      { x: 0.2,  y: 0.25, r: 0.55, color: [130, 40, 210], alpha: 0.40, speed: 0.012, ox: 0.20, oy: 0.16, phase: 0 },
      { x: 0.75, y: 0.3,  r: 0.50, color: [55, 90, 220],  alpha: 0.35, speed: 0.009, ox: 0.18, oy: 0.14, phase: 1.8 },
      { x: 0.5,  y: 0.65, r: 0.55, color: [30, 160, 215], alpha: 0.32, speed: 0.011, ox: 0.18, oy: 0.20, phase: 3.2 },
      { x: 0.8,  y: 0.7,  r: 0.42, color: [180, 50, 230], alpha: 0.28, speed: 0.014, ox: 0.22, oy: 0.18, phase: 5.0 },
      { x: 0.15, y: 0.6,  r: 0.38, color: [25, 200, 230], alpha: 0.26, speed: 0.016, ox: 0.25, oy: 0.18, phase: 2.5 },
      { x: 0.6,  y: 0.15, r: 0.32, color: [200, 60, 255], alpha: 0.24, speed: 0.013, ox: 0.16, oy: 0.22, phase: 4.2 },
      { x: 0.35, y: 0.4,  r: 0.20, color: [220, 200, 255], alpha: 0.12, speed: 0.018, ox: 0.14, oy: 0.12, phase: 1.2 },
      { x: 0.65, y: 0.55, r: 0.16, color: [180, 220, 255], alpha: 0.10, speed: 0.020, ox: 0.12, oy: 0.14, phase: 3.8 },
    ];

    const draw = () => {
      t += 1;
      const w = canvas.width;
      const h = canvas.height;

      ctx.fillStyle = "#100830";
      ctx.fillRect(0, 0, w, h);

      for (const b of blobs) {
        const cx = w * (b.x + Math.sin(t * b.speed + b.phase) * b.ox + Math.cos(t * b.speed * 0.6 + b.phase * 1.7) * b.ox * 0.5);
        const cy = h * (b.y + Math.cos(t * b.speed * 0.85 + b.phase) * b.oy + Math.sin(t * b.speed * 0.4 + b.phase * 2.1) * b.oy * 0.4);
        const pulse = 1 + Math.sin(t * b.speed * 2 + b.phase) * 0.22;
        const radius = Math.min(w, h) * b.r * pulse;

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        const [r, g, bl] = b.color;
        const a = b.alpha + Math.sin(t * b.speed * 1.5 + b.phase) * 0.08;
        grad.addColorStop(0, `rgba(${r},${g},${bl},${a})`);
        grad.addColorStop(0.3, `rgba(${r},${g},${bl},${a * 0.65})`);
        grad.addColorStop(0.65, `rgba(${r},${g},${bl},${a * 0.2})`);
        grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      // Light beams
      for (let i = 0; i < 4; i++) {
        ctx.save();
        const angle = (t * 0.003 + i * 1.6) % (Math.PI * 2);
        const sx = w * (0.35 + Math.sin(angle + i) * 0.28);
        const sy = h * (0.35 + Math.cos(angle * 0.8 + i * 0.5) * 0.22);
        ctx.translate(sx, sy);
        ctx.rotate(angle * 0.4 + i * 0.9);
        const colors = [[140, 50, 220], [50, 120, 220], [25, 190, 230], [180, 60, 240]];
        const [sr, sg, sb] = colors[i];
        const sa = 0.07 + Math.sin(t * 0.012 + i * 2) * 0.035;
        const streakGrad = ctx.createLinearGradient(-w * 0.5, 0, w * 0.5, 0);
        streakGrad.addColorStop(0, `rgba(${sr},${sg},${sb},0)`);
        streakGrad.addColorStop(0.25, `rgba(${sr},${sg},${sb},${sa * 0.5})`);
        streakGrad.addColorStop(0.5, `rgba(${sr},${sg},${sb},${sa})`);
        streakGrad.addColorStop(0.75, `rgba(${sr},${sg},${sb},${sa * 0.5})`);
        streakGrad.addColorStop(1, `rgba(${sr},${sg},${sb},0)`);
        ctx.fillStyle = streakGrad;
        ctx.fillRect(-w * 0.5, -h * 0.018, w, h * 0.036);
        ctx.restore();
      }

      // Center brightness
      const centerGrad = ctx.createRadialGradient(w * 0.45, h * 0.4, 0, w * 0.45, h * 0.4, w * 0.45);
      centerGrad.addColorStop(0, `rgba(120, 80, 200, ${0.06 + Math.sin(t * 0.005) * 0.025})`);
      centerGrad.addColorStop(1, "rgba(120, 80, 200, 0)");
      ctx.fillStyle = centerGrad;
      ctx.fillRect(0, 0, w, h);

      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);

  // ============================================================
  // LOGIN / REGISTER LOGIC (identique à l'ancien Auth.tsx)
  // ============================================================
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }
    setError("");
    setIsLoading(true);

    try {
      if (isLogin) {
        sessionStorage.setItem("showIntroVideo", "true");
        await login(username, password);
        setTimeout(() => {
          window.dispatchEvent(new Event("force-app-update"));
        }, 100);
      } else {
        await register(username, password);
      }
    } catch (err: any) {
      setError(err.message || "Une erreur est survenue");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: "#100830" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        .aurora-auth * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes auroraCardIn {
          from { opacity: 0; transform: translateY(28px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes auroraLogoGlow {
          0%, 100% { box-shadow: 0 0 30px rgba(130,40,210,0.3), 0 0 60px rgba(56,217,245,0.12); }
          50% { box-shadow: 0 0 45px rgba(130,40,210,0.5), 0 0 90px rgba(56,217,245,0.25); }
        }
        @keyframes auroraShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes auroraShake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        @keyframes auroraSpin { to { transform: rotate(360deg); } }
        @keyframes auroraBorderShift {
          0%, 100% { border-color: rgba(130,40,210,0.18); }
          50% { border-color: rgba(56,217,245,0.22); }
        }
        @keyframes auroraErrorIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .aurora-auth input::placeholder { color: rgba(255,255,255,0.22); }
        .aurora-auth input:-webkit-autofill {
          -webkit-box-shadow: 0 0 0 50px rgba(16,8,48,0.95) inset !important;
          -webkit-text-fill-color: #e2e8f0 !important;
        }
      `}</style>

      {/* AURORA CANVAS */}
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, zIndex: 0 }} />

      {/* Noise overlay */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", opacity: 0.3,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`,
        backgroundRepeat: "repeat", backgroundSize: "128px",
      }} />

      {/* LOGIN CARD */}
      <div className="aurora-auth" style={{
        position: "relative", zIndex: 2,
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "100%", height: "100%",
        fontFamily: "'Inter', -apple-system, sans-serif",
      }}>
        <div style={{
          width: 420, maxWidth: "92vw",
          animation: `auroraCardIn 0.7s cubic-bezier(0.16, 1, 0.3, 1) both${shake ? ", auroraShake 0.4s ease" : ""}`,
        }}>
          <div style={{
            background: "rgba(14, 10, 40, 0.45)",
            backdropFilter: "blur(48px) saturate(1.8)",
            WebkitBackdropFilter: "blur(48px) saturate(1.8)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 28,
            padding: "48px 40px 40px",
            boxShadow: "0 32px 100px rgba(0,0,0,0.35), 0 0 100px rgba(130,40,210,0.10), inset 0 1px 0 rgba(255,255,255,0.08)",
            animation: "auroraBorderShift 6s ease-in-out infinite",
          }}>

            {/* LOGO + TITLE */}
            <div style={{ textAlign: "center", marginBottom: 36 }}>
              <div style={{
                width: 60, height: 60, borderRadius: 18, margin: "0 auto 18px",
                background: "linear-gradient(135deg, rgba(130,40,210,0.4), rgba(30,160,215,0.3))",
                border: "1px solid rgba(255,255,255,0.14)",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: "auroraLogoGlow 4s ease-in-out infinite",
              }}>
                <span style={{ fontSize: 28 }}>⚡</span>
              </div>
              <h1 style={{ fontSize: 24, fontWeight: 900, color: "#f4f0ff", letterSpacing: "-0.03em" }}>
                Bloomberg Terminal Ads
              </h1>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.40)", marginTop: 8, fontWeight: 500 }}>
                {isLogin ? "Connectez-vous à votre espace trader" : "Créez votre compte trader"}
              </p>
            </div>

            {/* ERROR */}
            {error && (
              <div style={{
                marginBottom: 20, padding: "12px 16px",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                borderRadius: 14, textAlign: "center",
                animation: "auroraErrorIn 0.3s ease-out",
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#fca5a5" }}>{error}</span>
              </div>
            )}

            {/* FORM */}
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>

              {/* USERNAME */}
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>
                  Identifiant
                </label>
                <div style={{
                  borderRadius: 14,
                  background: focused === "user" ? "rgba(56,217,245,0.07)" : "rgba(255,255,255,0.04)",
                  border: `1.5px solid ${focused === "user" ? "rgba(56,217,245,0.5)" : "rgba(255,255,255,0.09)"}`,
                  transition: "all 0.3s ease",
                  boxShadow: focused === "user" ? "0 0 28px rgba(56,217,245,0.12), inset 0 0 14px rgba(56,217,245,0.04)" : "none",
                }}>
                  <input
                    type="text" required
                    placeholder="ex: tfgmd"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onFocus={() => setFocused("user")}
                    onBlur={() => setFocused(null)}
                    style={{
                      width: "100%", padding: "15px 18px", fontSize: 15, fontWeight: 600,
                      background: "transparent", border: "none", outline: "none",
                      color: "#e8e4f0", fontFamily: "inherit",
                    }}
                  />
                </div>
              </div>

              {/* PASSWORD */}
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>
                  Mot de passe
                </label>
                <div style={{
                  borderRadius: 14,
                  background: focused === "pass" ? "rgba(130,40,210,0.07)" : "rgba(255,255,255,0.04)",
                  border: `1.5px solid ${focused === "pass" ? "rgba(130,40,210,0.55)" : "rgba(255,255,255,0.09)"}`,
                  transition: "all 0.3s ease",
                  boxShadow: focused === "pass" ? "0 0 28px rgba(130,40,210,0.14), inset 0 0 14px rgba(130,40,210,0.04)" : "none",
                }}>
                  <input
                    type="password" required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocused("pass")}
                    onBlur={() => setFocused(null)}
                    style={{
                      width: "100%", padding: "15px 18px", fontSize: 15, fontWeight: 600,
                      background: "transparent", border: "none", outline: "none",
                      color: "#e8e4f0", fontFamily: "inherit",
                    }}
                  />
                </div>
              </div>

              {/* SUBMIT BUTTON */}
              <button
                type="submit"
                disabled={isLoading}
                style={{
                  marginTop: 10, padding: "17px", borderRadius: 14, border: "none",
                  cursor: isLoading ? "wait" : "pointer",
                  background: isLoading
                    ? "rgba(255,255,255,0.04)"
                    : "linear-gradient(135deg, rgba(130,40,210,0.6), rgba(40,160,220,0.5))",
                  color: "#fff", fontSize: 15, fontWeight: 800, fontFamily: "inherit",
                  transition: "all 0.3s ease",
                  boxShadow: isLoading ? "none" : "0 6px 30px rgba(130,40,210,0.28), inset 0 1px 0 rgba(255,255,255,0.14)",
                  position: "relative", overflow: "hidden",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                }}
                onMouseEnter={(e) => {
                  if (!isLoading) {
                    (e.currentTarget as HTMLButtonElement).style.background = "linear-gradient(135deg, rgba(130,40,210,0.75), rgba(40,180,230,0.65))";
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 10px 44px rgba(130,40,210,0.4), 0 0 70px rgba(56,217,245,0.12), inset 0 1px 0 rgba(255,255,255,0.18)";
                    (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isLoading) {
                    (e.currentTarget as HTMLButtonElement).style.background = "linear-gradient(135deg, rgba(130,40,210,0.6), rgba(40,160,220,0.5))";
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 30px rgba(130,40,210,0.28), inset 0 1px 0 rgba(255,255,255,0.14)";
                    (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
                  }
                }}
              >
                {isLoading ? (
                  <>
                    <Loader2 style={{ width: 18, height: 18, animation: "auroraSpin 0.8s linear infinite" }} />
                    {isLogin ? "Connexion..." : "Inscription..."}
                  </>
                ) : (
                  isLogin ? "Se connecter" : "S'inscrire"
                )}
                {!isLoading && (
                  <div style={{
                    position: "absolute", inset: 0,
                    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
                    backgroundSize: "200% 100%",
                    animation: "auroraShimmer 3s ease-in-out infinite",
                  }} />
                )}
              </button>
            </form>

            {/* TOGGLE LOGIN/REGISTER */}
            <div style={{ textAlign: "center", marginTop: 24 }}>
              <button
                type="button"
                onClick={() => { setIsLogin(!isLogin); setError(""); }}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.35)",
                  fontFamily: "inherit", transition: "color 0.2s ease",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(56,217,245,0.8)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.35)"; }}
              >
                {isLogin ? "Pas encore de compte ? S'inscrire" : "Déjà un compte ? Se connecter"}
              </button>
            </div>

            {/* FOOTER */}
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.18)" }}>Gamned! — Trading Desk</p>
            </div>
          </div>

          {/* GLOW UNDER CARD */}
          <div style={{
            position: "absolute", bottom: -24, left: "8%", right: "8%", height: 100,
            background: "radial-gradient(ellipse, rgba(130,40,210,0.22), rgba(30,160,215,0.10) 50%, transparent 75%)",
            filter: "blur(35px)", pointerEvents: "none",
          }} />
        </div>
      </div>
    </div>
  );
}
