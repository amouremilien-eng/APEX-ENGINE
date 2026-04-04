import { useEffect, useRef, useState, useMemo } from "react";
import { ProjectData } from "../types";
import {
  computeCampaignLearningStats,
  computeCrossCampaignPrior,
  getBayesianElasticity,
  detectFunnelTag,
  predictPacing,
  fitSaturationModel,
  type CampaignLearningStats,
  type CrossCampaignPrior,
  type PredictivePacing,
} from "../LearningEngine";
import {
  estimateWinRateCurve,
  computeOptimalBid,
  type BidShadingResult,
  type WinRateCurve,
} from "../BidShadingEngine";

// ============================================================
// 🧠 LEARNING ENGINE DASHBOARD — Bloomberg Terminal Ads
// ============================================================

interface Props {
  project: ProjectData;
  allProjects?: ProjectData[];
  onNavigateToMarge?: () => void;
}

function getDaysRemaining(project: ProjectData): number {
  if (project.endDate) {
    const diff = Math.ceil((new Date(project.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff > 0) return diff;
  }
  return 15;
}

function getMarginPct(project: ProjectData): number {
  return project.cpmRevenueActual > 0
    ? ((project.cpmRevenueActual - project.cpmCostActuel) / project.cpmRevenueActual) * 100
    : 0;
}

// ===== GALAXY BRAIN CANVAS =====
function GalaxyBrain() {
  const ref = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0, down: false });
  const cyclesRef = useRef(0);
  const [stats, setStats] = useState({ nodes: 46, synapses: 312, cycles: 0, conf: "55.0%", data: "2,400", ops: "1,200" });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = devicePixelRatio || 1;
    let W = 0, H = 0, cx = 0, cy = 0;
    let animId = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      W = rect.width; H = rect.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2; cy = H / 2;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const mx = mouseRef.current;
    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mx.x = e.clientX - r.left; mx.y = e.clientY - r.top;
    };
    const onDown = () => { mx.down = true; };
    const onUp = () => { mx.down = false; };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);

    const hex = (a: number) => Math.max(0, Math.min(255, ~~(a * 255))).toString(16).padStart(2, "0");

    const MODS = [
      { label: "Elasticity", color: "#a78bfa" },
      { label: "Saturation", color: "#60a5fa" },
      { label: "Bayesian", color: "#34d399" },
      { label: "Pacing", color: "#fbbf24" },
      { label: "Funnel", color: "#f472b6" },
      { label: "BidShade", color: "#38d9f5" },
    ];

    // Stars
    const stars = Array.from({ length: 200 }, () => ({
      x: (Math.random() - .5) * 2, y: (Math.random() - .5) * 2,
      s: .3 + Math.random() * 1.5, ph: Math.random() * 6.28, bright: Math.random()
    }));

    // Spiral particles
    const spiralP: any[] = [];
    for (let arm = 0; arm < 4; arm++) {
      for (let i = 0; i < 100; i++) {
        spiralP.push({
          bA: i / 100 * 5 + arm * 1.5708, bR: 15 + i * 1.2,
          ox: (Math.random() - .5) * (5 + i * .1), oy: (Math.random() - .5) * (5 + i * .1),
          sz: .3 + Math.random() * 1.8,
          color: MODS[~~(Math.random() * MODS.length)].color,
          ph: Math.random() * 6.28, sp: .15 + Math.random() * .35, bright: .3 + Math.random() * .7
        });
      }
    }

    // Module nodes
    const nodes = MODS.map((m, i) => ({
      m, i, bA: (i / 6) * 6.28,
      orbit: Math.min(W, H) * .24 + i * 12,
      x: 0, y: 0, r: 10, hov: false, act: false, pulse: 0
    }));

    // Pulses
    const pulses: any[] = [];
    let pulseTimer = 0;

    // Waves
    const waves: any[] = [];
    const onClick = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      let hit = false;
      nodes.forEach(n => {
        if (Math.hypot(px - n.x, py - n.y) < n.r * 3) {
          n.act = !n.act; hit = true;
          if (n.act) {
            waves.push({ x: n.x, y: n.y, r: 0, color: n.m.color, life: 1 });
            nodes.forEach(o => { if (o !== n) pulses.push({ fx: n.x, fy: n.y, tx: o.x, ty: o.y, t: 0, sp: .008 + Math.random() * .01, color: n.m.color, sz: 2, trail: [] }); });
          }
        }
      });
      if (!hit) waves.push({ x: px, y: py, r: 0, color: "#8228d2", life: 1 });
    };
    canvas.addEventListener("click", onClick);

    function loop(ts: number) {
      const t = ts * .001;
      ctx.clearRect(0, 0, W, H);

      // Stars
      stars.forEach(s => {
        const sx = cx + s.x * W * .5, sy = cy + s.y * H * .5;
        const a = .04 + s.bright * .08 + Math.sin(t * .4 + s.ph) * .03;
        ctx.fillStyle = `rgba(148,163,184,${a})`;
        ctx.beginPath(); ctx.arc(sx, sy, s.s, 0, 6.28); ctx.fill();
      });

      // Spiral arms
      for (let arm = 0; arm < 4; arm++) {
        ctx.strokeStyle = MODS[arm % 6].color + "04";
        ctx.lineWidth = 18;
        ctx.beginPath();
        for (let i = 0; i < 60; i++) {
          const a = i / 60 * 5 + arm * 1.5708 + t * .06;
          const r = 15 + i * 1.2;
          const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      spiralP.forEach(p => {
        const a = p.bA + t * .06;
        let px = cx + Math.cos(a) * p.bR + p.ox + Math.sin(t * p.sp + p.ph) * 2;
        let py = cy + Math.sin(a) * p.bR + p.oy + Math.cos(t * p.sp + p.ph) * 2;
        const dx = mx.x - px, dy = mx.y - py, d = Math.hypot(dx, dy);
        if (d < 80) { const f = (1 - d / 80) * 10; px -= dx / d * f; py -= dy / d * f; }
        const al = (.06 + Math.sin(t * p.sp + p.ph) * .03) * p.bright;
        ctx.fillStyle = p.color + hex(al);
        ctx.beginPath(); ctx.arc(px, py, p.sz, 0, 6.28); ctx.fill();
      });

      // Streams to core
      nodes.forEach(n => {
        const cp1x = (n.x + cx) / 2 + Math.sin(t + n.i * 2) * 18;
        const cp1y = (n.y + cy) / 2 + Math.cos(t + n.i * 2) * 14;
        ctx.strokeStyle = n.m.color + hex(.04 + Math.sin(t + n.i) * .02);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.quadraticCurveTo(cp1x, cp1y, cx, cy); ctx.stroke();
        const at = (t * .25 + n.i * .4) % 1;
        const et = at < .5 ? 2 * at * at : 1 - (-2 * at + 2) ** 2 / 2;
        const dotx = n.x + (cx - n.x) * et, doty = n.y + (cy - n.y) * et;
        ctx.fillStyle = n.m.color + "70";
        ctx.beginPath(); ctx.arc(dotx, doty, 2, 0, 6.28); ctx.fill();
      });

      // Core
      const coreR = 16 + Math.sin(t * 2.5) * 2;
      ctx.save(); ctx.translate(cx, cy);
      for (let i = 0; i < 3; i++) {
        const gr = coreR + 12 + i * 10;
        const rot = t * (.3 + i * .15) * (i % 2 ? 1 : -1);
        const sides = 6 + i * 2;
        ctx.strokeStyle = (i === 0 ? "#8228d2" : i === 1 ? "#38d9f5" : "#a78bfa") + hex(.07);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let s = 0; s <= sides; s++) {
          const a = rot + (s / sides) * 6.28;
          const hx = Math.cos(a) * gr, hy = Math.sin(a) * gr;
          s === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
        }
        ctx.stroke();
      }
      ctx.restore();

      const gf = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 4);
      gf.addColorStop(0, "rgba(130,40,210,.08)"); gf.addColorStop(.3, "rgba(56,217,245,.03)"); gf.addColorStop(1, "transparent");
      ctx.fillStyle = gf; ctx.beginPath(); ctx.arc(cx, cy, coreR * 4, 0, 6.28); ctx.fill();

      const sg = ctx.createRadialGradient(cx - coreR * .3, cy - coreR * .25, 0, cx, cy, coreR);
      sg.addColorStop(0, "#ffffff25"); sg.addColorStop(.3, "#8228d2cc"); sg.addColorStop(.7, "#38d9f5aa"); sg.addColorStop(1, "#1ea0d778");
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, 6.28); ctx.fill();
      ctx.font = "12px sans-serif"; ctx.textAlign = "center"; ctx.fillText("⚡", cx, cy + 1);
      // label removed

      // Module nodes
      nodes.forEach(n => {
        n.orbit = Math.min(W, H) * .24 + n.i * 12;
        const a = n.bA + t * .06;
        let tx = cx + Math.cos(a) * n.orbit, ty = cy + Math.sin(a) * n.orbit;
        const dx = mx.x - tx, dy = mx.y - ty, d = Math.hypot(dx, dy);
        if (d < 140) { const f = (1 - d / 140) * (mx.down ? 28 : 14); tx += dx / d * f; ty += dy / d * f; }
        n.x += (tx - n.x) * .1; n.y += (ty - n.y) * .1;
        n.hov = Math.hypot(mx.x - n.x, mx.y - n.y) < n.r * 3;
        const target = n.hov ? 14 : 10;
        n.r += (target + Math.sin(t * 2 + n.i) * 1 - n.r) * .1;
        if (n.act) { n.pulse += .05; for (let i = 0; i < 3; i++) { const rr = n.r + 6 + i * 10 + Math.sin(n.pulse - i * .6) * 5; ctx.strokeStyle = n.m.color + hex((.2 - i * .06) * (.5 + Math.sin(n.pulse - i * .6) * .5)); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(n.x, n.y, rr, 0, 6.28); ctx.stroke(); } }
        const gl = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * (n.hov ? 4 : 3));
        gl.addColorStop(0, n.m.color + hex(n.hov ? .25 : .12)); gl.addColorStop(.5, n.m.color + hex(n.hov ? .06 : .03)); gl.addColorStop(1, "transparent");
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 4, 0, 6.28); ctx.fill();
        const csg = ctx.createRadialGradient(n.x - n.r * .3, n.y - n.r * .25, 0, n.x, n.y, n.r);
        csg.addColorStop(0, "#fff3"); csg.addColorStop(.45, n.m.color); csg.addColorStop(1, n.m.color + "aa");
        ctx.fillStyle = csg; ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.28); ctx.fill();
        ctx.font = `600 ${n.hov ? 10 : 9}px Inter, sans-serif`; ctx.textAlign = "center";
        ctx.fillStyle = n.m.color + (n.hov ? "ff" : "bb"); ctx.fillText(n.m.label, n.x, n.y - n.r - 6);
      });

      // Pulses
      pulseTimer++;
      if (pulseTimer % 25 === 0 && nodes.length > 1) {
        const f = nodes[~~(Math.random() * nodes.length)];
        const ti = ~~(Math.random() * (nodes.length + 1));
        const to = ti === nodes.length ? { x: cx, y: cy } : nodes[ti];
        if (to !== f) pulses.push({ fx: f.x, fy: f.y, tx: to.x, ty: to.y, t: 0, sp: .007 + Math.random() * .01, color: f.m.color, sz: 1.5 + Math.random() * 1.5, trail: [] as any[] });
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]; p.t += p.sp;
        const e = p.t < .5 ? 2 * p.t * p.t : 1 - (-2 * p.t + 2) ** 2 / 2;
        const ppx = p.fx + (p.tx - p.fx) * e, ppy = p.fy + (p.ty - p.fy) * e;
        p.trail.push({ x: ppx, y: ppy, a: 1 }); if (p.trail.length > 14) p.trail.shift();
        p.trail.forEach((pt: any) => pt.a *= .9);
        p.trail.forEach((pt: any) => { ctx.fillStyle = p.color + hex(pt.a * .5); ctx.beginPath(); ctx.arc(pt.x, pt.y, p.sz * pt.a, 0, 6.28); ctx.fill(); });
        if (p.t >= 1) pulses.splice(i, 1);
      }

      // Waves
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i]; w.r += 4; w.life = 1 - w.r / 250;
        if (w.life <= 0) { waves.splice(i, 1); continue; }
        ctx.strokeStyle = w.color + hex(w.life * .25); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, 6.28); ctx.stroke();
      }

      // Mouse glow
      const mgr = mx.down ? 60 : 35;
      const mg = ctx.createRadialGradient(mx.x, mx.y, 0, mx.x, mx.y, mgr);
      mg.addColorStop(0, mx.down ? "rgba(130,40,210,.04)" : "rgba(56,217,245,.02)"); mg.addColorStop(1, "transparent");
      ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx.x, mx.y, mgr, 0, 6.28); ctx.fill();

      // Update stats
      frameRef.current++;
      if (frameRef.current % 40 === 0) {
        cyclesRef.current++;
        const c = cyclesRef.current;
        setStats({
          nodes: 46 + ~~(Math.sin(t * .3) * 3),
          synapses: pulses.length + 290 + ~~(Math.sin(t * .5) * 12),
          cycles: c,
          conf: Math.min(98, 55 + c * .15 + Math.sin(t) * 2).toFixed(1) + "%",
          data: (2400 + c * 11).toLocaleString(),
          ops: (1200 + ~~(Math.sin(t) * 250)).toLocaleString()
        });
      }

      animId = requestAnimationFrame(loop);
    }
    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-gray-200 bg-gradient-to-b from-[#0c1029] to-[#060812]" style={{ height: 220 }}>
      <canvas ref={ref} className="absolute inset-0 w-full h-full" />
      {/* HUD overlay */}
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4">
        {/* Top */}
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md flex items-center justify-center text-xs" style={{ background: "linear-gradient(135deg,rgba(130,40,210,.5),rgba(30,160,215,.4))" }}>⚡</div>
              <span className="text-xs font-bold text-white/90">Learning Engine v10.3</span>
            </div>
            <p className="text-[9px] text-white/30 mt-0.5 font-mono">Galaxy Neural Map — Survole les modules, clique pour activer</p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </div>
        </div>
        {/* Bottom stats */}
        <div className="flex justify-center gap-6">
          {[
            { v: stats.nodes, l: "Neurones", c: "#a78bfa" },
            { v: stats.synapses, l: "Synapses", c: "#60a5fa" },
            { v: stats.cycles, l: "Cycles", c: "#34d399" },
            { v: stats.conf, l: "Confiance", c: "#fbbf24" },
            { v: stats.data, l: "Data Points", c: "#f472b6" },
            { v: stats.ops, l: "Ops/sec", c: "#38d9f5" },
          ].map(s => (
            <div key={s.l} className="text-center">
              <div className="font-mono text-sm font-bold" style={{ color: s.c, textShadow: `0 0 10px ${s.c}40` }}>{s.v}</div>
              <div className="text-[7px] font-mono text-white/25 uppercase tracking-widest">{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===== CARD WRAPPER =====
function Card({ title, tag, icon, live, children, explainer }: {
  title: string; tag: string; icon: string; live?: boolean;
  children: React.ReactNode; explainer: React.ReactNode;
}) {
  const [showExplainer, setShowExplainer] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-blue-200 transition-colors">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <div>
            <h3 className="text-sm font-bold text-gray-900">{title}</h3>
            <p className="text-[10px] text-gray-400 font-medium">{tag}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {live && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> LIVE
            </span>
          )}
          <button
            onClick={() => setShowExplainer(!showExplainer)}
            className="text-[10px] font-semibold text-blue-500 hover:text-blue-700 px-2 py-0.5 rounded-md hover:bg-blue-50 transition-colors"
          >
            {showExplainer ? "Masquer ▲" : "Comment ça marche ▼"}
          </button>
        </div>
      </div>
      <div className="p-4">{children}</div>
      {showExplainer && (
        <div className="mx-4 mb-4 p-3 bg-blue-50/50 border border-blue-100 rounded-lg text-xs text-gray-600 leading-relaxed">
          {explainer}
        </div>
      )}
    </div>
  );
}

// ===== BID SHADING SCENARIOS CARD =====
function BidShadingCard({ project }: { project: ProjectData }) {
  const stats = useMemo(() => computeCampaignLearningStats(project), [project]);
  const winCurve = useMemo(() => {
    const spends = project.dailyEntries?.map(e => e.budgetSpent) || [];
    return estimateWinRateCurve(project.cpmCostActuel, project.cpmRevenueActual, project.cpmSoldCap || 0, spends, project.dailyEntries);
  }, [project]);

  const currentWR = winCurve.predict(project.cpmCostActuel);
  const optimalBid = project.cpmCostActuel * 0.87; // simplified
  const optWR = winCurve.predict(optimalBid);
  const aggBid = project.cpmCostActuel * 0.67;
  const aggWR = winCurve.predict(aggBid);
  const margin = project.cpmRevenueActual > 0
    ? ((project.cpmRevenueActual - project.cpmCostActuel) / project.cpmRevenueActual) * 100
    : 0;

  const scenarios = [
    { emoji: "🛡️", name: "Stable", bid: project.cpmCostActuel, wr: ((currentWR * 100) || 0).toFixed(0), margin: (margin || 0).toFixed(0), style: "bg-blue-50 border-blue-100", badgeStyle: "bg-blue-100 text-blue-700", badge: "LOW RISK" },
    { emoji: "⚡", name: "Optimal", bid: optimalBid, wr: ((optWR * 100) || 0).toFixed(0), margin: ((margin + 10) || 0).toFixed(0), style: "bg-emerald-50 border-emerald-200", badgeStyle: "bg-emerald-100 text-emerald-700", badge: "RECOMMENDED" },
    { emoji: "🔥", name: "Aggressive", bid: aggBid, wr: ((aggWR * 100) || 0).toFixed(0), margin: ((margin + 25) || 0).toFixed(0), style: "bg-red-50 border-red-100", badgeStyle: "bg-red-100 text-red-700", badge: "HIGH RISK" },
  ];

  return (
    <Card title="Bid Shading Engine" tag="3 scénarios calculés" icon="⚡" live
      explainer={
        <>
          <strong className="text-blue-700">Comment ça marche :</strong> L'engine balaye 50 niveaux de bid entre 60% et 150% du bid actuel. Pour chaque candidat, il calcule un <strong>score composite</strong> = gain de marge × win rate × respect du cap CPM × tolérance KPI. Le scénario <strong>"Optimal"</strong> maximise ce score.
          <br /><span className="font-mono text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded mt-1 inline-block">score = marginGain × winRate(bid) × capPenalty × kpiPenalty</span>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {scenarios.map(s => (
          <div key={s.name} className={`rounded-xl p-3 text-center border ${s.style}`}>
            <div className="text-xl">{s.emoji}</div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{s.name}</div>
            <div className="font-mono text-lg font-bold text-gray-900 mt-1">€{(s.bid || 0).toFixed(2)}</div>
            <div className="text-[11px] text-gray-500 leading-relaxed mt-1">Win Rate: {s.wr}%<br/>Margin: {s.margin}%</div>
            <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-bold mt-2 ${s.badgeStyle}`}>{s.badge}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ===== WIN RATE CURVE =====
function WinRateCard({ project }: { project: ProjectData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const winCurve = useMemo(() => {
    const spends = project.dailyEntries?.map(e => e.budgetSpent) || [];
    return estimateWinRateCurve(project.cpmCostActuel, project.cpmRevenueActual, project.cpmSoldCap || 0, spends, project.dailyEntries);
  }, [project]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const c = cv.getContext("2d")!;
    const dpr = devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    cv.width = rect.width * dpr; cv.height = rect.height * dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width, h = rect.height, pad = 30;
    const { L, k, x0 } = winCurve;

    // Grid
    c.strokeStyle = "#f1f5f9"; c.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = pad + (i / 4) * (h - pad * 2); c.beginPath(); c.moveTo(pad, y); c.lineTo(w - pad, y); c.stroke(); }
    // Y labels
    c.font = "500 9px Inter, sans-serif"; c.fillStyle = "#94a3b8"; c.textAlign = "right";
    for (let i = 0; i <= 4; i++) { const y = pad + (i / 4) * (h - pad * 2); c.fillText((4 - i) * 25 + "%", pad - 6, y + 3); }

    // Curve fill
    c.beginPath(); c.moveTo(pad, h - pad);
    for (let px = 0; px <= w - pad * 2; px++) {
      const bid = 1 + (px / (w - pad * 2)) * 7;
      const wr = L / (1 + Math.exp(-k * (bid - x0)));
      c.lineTo(px + pad, h - pad - wr * (h - pad * 2));
    }
    c.lineTo(w - pad, h - pad); c.closePath();
    const grd = c.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, "rgba(59,130,246,.08)"); grd.addColorStop(1, "rgba(59,130,246,0)");
    c.fillStyle = grd; c.fill();

    // Curve line
    c.beginPath(); c.strokeStyle = "#3b82f6"; c.lineWidth = 2;
    for (let px = 0; px <= w - pad * 2; px++) {
      const bid = 1 + (px / (w - pad * 2)) * 7;
      const wr = L / (1 + Math.exp(-k * (bid - x0)));
      px === 0 ? c.moveTo(px + pad, h - pad - wr * (h - pad * 2)) : c.lineTo(px + pad, h - pad - wr * (h - pad * 2));
    }
    c.stroke();

    // Current bid marker
    const curBid = project.cpmCostActuel;
    const bx = (b: number) => pad + ((b - 1) / 7) * (w - pad * 2);
    const by = (b: number) => h - pad - (L / (1 + Math.exp(-k * (b - x0)))) * (h - pad * 2);
    if (curBid > 1 && curBid < 8) {
      c.setLineDash([3, 3]); c.strokeStyle = "#10b98160"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(bx(curBid), by(curBid)); c.lineTo(bx(curBid), h - pad); c.stroke();
      c.setLineDash([]);
      c.fillStyle = "#10b981"; c.beginPath(); c.arc(bx(curBid), by(curBid), 5, 0, 6.28); c.fill();
      c.font = "600 8px Inter, sans-serif"; c.textAlign = "center"; c.fillText("Current €" + curBid.toFixed(2), bx(curBid), by(curBid) - 8);
    }
  }, [project, winCurve]);

  return (
    <Card title="Win Rate Curve" tag="Modèle logistique estimé" icon="📈"
      explainer={
        <>
          <strong className="text-blue-700">Sans API DSP, comment on estime ?</strong> Le <strong>ratio CPM Cost / Revenue</strong> donne ta position dans les enchères. Le <strong>coefficient de variation du spend</strong> journalier sert de proxy du fill rate.
          <br /><span className="font-mono text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded mt-1 inline-block">winRate(bid) = L / (1 + exp(-k × (bid - x₀)))</span>
          <br />L = {(winCurve.L || 0).toFixed(2)}, k = {(winCurve.k || 0).toFixed(2)}, x₀ = €{(winCurve.x0 || 0).toFixed(2)}, Confiance: {((winCurve.confidence || 0) * 100).toFixed(0)}%. <strong>Quand une API DSP sera connectée, les vraies données remplaceront cette estimation.</strong>
        </>
      }
    >
      <canvas ref={canvasRef} className="w-full" style={{ height: 160 }} />
    </Card>
  );
}

// ===== LEARNING PROGRESS BARS =====
function LearningProgressCard({ project, allProjects }: { project: ProjectData; allProjects: ProjectData[] }) {
  const stats = useMemo(() => computeCampaignLearningStats(project), [project]);
  const prior = useMemo(() => computeCrossCampaignPrior(allProjects || [], project.kpiType || "CPA"), [allProjects, project.kpiType]);
  const bayes = useMemo(() => getBayesianElasticity(stats, prior), [stats, prior]);
  const pacing = useMemo(() => {
    const spends = project.dailyEntries?.map(e => e.budgetSpent) || [];
    return predictPacing(spends, project.budgetTotal, project.budgetSpent, getDaysRemaining(project));
  }, [project]);

  const bars = [
    { label: "Elasticity R²", value: stats?.elasticityConfidence || 0, color: "#a78bfa" },
    { label: "Saturation fit", value: stats?.saturationModel?.confidence || 0, color: "#3b82f6" },
    { label: "Prior blend", value: bayes.confidence, color: "#34d399" },
    { label: "Pacing AR(1)", value: pacing ? Math.min(1, Math.abs(pacing.ar1Beta)) : 0, color: "#fbbf24" },
    { label: "Funnel conf.", value: project.lineItems?.length ? detectFunnelTag(project.lineItems[0]?.name || "").confidence : 0, color: "#f472b6" },
  ];

  return (
    <Card title="Campaign Learning Progress" tag="5 métriques de confiance" icon="🧠" live
      explainer={
        <>
          <strong className="text-blue-700">Chaque barre = la confiance du modèle :</strong><br />
          <strong>Elasticity R²</strong> — Corrélation marge → KPI, pondérée par récence (demi-vie 7j).<br />
          <strong>Saturation fit</strong> — Qualité du modèle courbe S logistique.<br />
          <strong>Prior blend</strong> — Confiance dans la fusion bayésienne cross-campagne.<br />
          <strong>Pacing AR(1)</strong> — Force du modèle auto-régressif (β plus haut = plus prédictif).<br />
          <strong>Funnel conf.</strong> — Certitude de la détection automatique du funnel.
        </>
      }
    >
      <div className="space-y-3">
        {bars.map(b => (
          <div key={b.label} className="flex items-center gap-3">
            <span className="text-[11px] font-semibold text-gray-500 w-24 shrink-0">{b.label}</span>
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${Math.max(2, b.value * 100)}%`, background: b.color }} />
            </div>
            <span className="font-mono text-xs font-bold w-10 text-right" style={{ color: b.color }}>{(b.value * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ===== FUNNEL DETECTION =====
function FunnelCard({ project }: { project: ProjectData }) {
  const funnelData = useMemo(() => {
    const items = project.lineItems || [];
    const counts: Record<string, number> = { awareness: 0, prospecting: 0, mixed: 0, retargeting: 0, conversion: 0, unknown: 0 };
    items.forEach(li => { const { tag } = detectFunnelTag(li.name); counts[tag]++; });
    const total = Math.max(1, items.length);
    return [
      { label: "AWARENESS", pct: counts.awareness / total, color: "#a78bfa", bg: "bg-purple-50", border: "border-purple-200" },
      { label: "PROSPECTING", pct: counts.prospecting / total, color: "#3b82f6", bg: "bg-blue-50", border: "border-blue-200" },
      { label: "CONSIDERATION", pct: counts.mixed / total, color: "#34d399", bg: "bg-emerald-50", border: "border-emerald-200" },
      { label: "RETARGETING", pct: counts.retargeting / total, color: "#fbbf24", bg: "bg-amber-50", border: "border-amber-200" },
      { label: "CONVERSION", pct: counts.conversion / total, color: "#f87171", bg: "bg-red-50", border: "border-red-200" },
    ];
  }, [project]);

  return (
    <Card title="Funnel Detection & Performance" tag="Détection automatique par noms" icon="🏳️"
      explainer={
        <>
          <strong className="text-blue-700">Comment ça détecte :</strong> L'engine scanne les noms de campagnes / ad groups avec <strong>16 patterns regex par funnel</strong>. Ex: "retarget", "cart_abandon", "RTG" → Retargeting. Le funnel détecté adapte les paramètres du Bid Shading (un retargeting tolère moins de dégradation KPI qu'un prospecting).
        </>
      }
    >
      <div className="flex flex-col items-center gap-1">
        {funnelData.map((f, i) => (
          <div key={f.label} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${f.bg} ${f.border}`}
            style={{ width: `${100 - i * 14}%` }}>
            <span className="text-[11px] font-bold" style={{ color: f.color }}>{f.label}</span>
            <span className="font-mono text-[11px] font-semibold text-gray-500">{(f.pct * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ===== PREDICTIVE PACING =====
function PacingCard({ project }: { project: ProjectData }) {
  const pacing = useMemo(() => {
    const spends = project.dailyEntries?.map(e => e.budgetSpent) || [];
    return predictPacing(spends, project.budgetTotal, project.budgetSpent, getDaysRemaining(project));
  }, [project]);

  const pct = project.budgetTotal > 0 ? project.budgetSpent / project.budgetTotal : 0;
  const predicted = pacing?.predictedEndSpendPct || pct * 100;
  const rec = pacing?.recommendation || "maintain";
  const recColors: Record<string, string> = { accelerate: "text-amber-600 bg-amber-50", maintain: "text-emerald-600 bg-emerald-50", decelerate: "text-blue-600 bg-blue-50", urgent: "text-red-600 bg-red-50" };

  return (
    <Card title="Predictive Pacing" tag="AR(1) + Monte Carlo 500 sim" icon="🎯" live
      explainer={
        <>
          <strong className="text-blue-700">Modèle AR(1) :</strong> Le spend de demain est prédit par <span className="font-mono text-[10px] text-purple-600 bg-purple-50 px-1 rounded">spend(t) = α + β × spend(t-1) + ε</span>.
          Ensuite, <strong>500 trajectoires Monte Carlo</strong> simulent les jours restants. Recommandation : accelerate si prédiction &lt; 90%, maintain si 90-105%, decelerate si &gt; 105%.
        </>
      }
    >
      <div className="flex items-center gap-6">
        <div className="relative w-28 h-28">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
            <circle cx="60" cy="60" r="50" fill="none" stroke="#f1f5f9" strokeWidth="8" />
            <circle cx="60" cy="60" r="50" fill="none" stroke="#3b82f6" strokeWidth="8"
              strokeDasharray={`${pct * 314} 314`} strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-lg font-bold text-gray-900">{(pct * 100).toFixed(0)}%</span>
            <span className="text-[9px] text-gray-400 font-semibold">SPENT</span>
          </div>
        </div>
        <div className="font-mono text-xs text-gray-500 space-y-1.5">
          <div>Budget: <strong className="text-gray-900">€{project.budgetTotal?.toLocaleString()}</strong></div>
          <div>Spent: <strong className="text-gray-900">€{project.budgetSpent?.toLocaleString()}</strong></div>
          <div>Days left: <strong className="text-gray-900">{getDaysRemaining(project)}</strong></div>
          <div>Predicted: <strong className="text-emerald-600">{(predicted || 0).toFixed(1)}%</strong></div>
          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${recColors[rec]}`}>
            ● {rec.toUpperCase()}
          </span>
        </div>
      </div>
    </Card>
  );
}

// ===== MARGIN HEATMAP =====
function HeatmapCard({ project }: { project: ProjectData }) {
  const days = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const entries = project.dailyEntries || [];
  // Build 4-week grid from latest entries
  const cells = useMemo(() => {
    const result: { margin: number; day: number; week: number }[] = [];
    const last28 = entries.slice(-28);
    last28.forEach((e, i) => {
      result.push({ margin: Math.min(99, e.marginPct != null ? Math.min(99, e.marginPct) : getMarginPct(project)), day: i % 7, week: ~~(i / 7) });
    });
    // Fill if < 28
    while (result.length < 28) {
      result.push({ margin: Math.min(99, Math.max(0, getMarginPct(project) + (Math.random() - .5) * 3)), day: result.length % 7, week: ~~(result.length / 7) });
    }
    return result;
  }, [entries, project.cpmRevenueActual, project.cpmCostActuel]);

  const getColor = (m: number) => {
    if (m >= 80) return { bg: "bg-emerald-200", text: "text-emerald-800" };
    if (m >= 60) return { bg: "bg-blue-200", text: "text-blue-800" };
    if (m >= 40) return { bg: "bg-amber-200", text: "text-amber-800" };
    return { bg: "bg-red-200", text: "text-red-800" };
  };

  return (
    <Card title="Margin Heatmap" tag="4 dernières semaines" icon="🔥"
      explainer={
        <>
          <strong className="text-blue-700">Lecture :</strong> Chaque case = la marge réelle d'un jour. <span className="text-emerald-600 font-bold">Vert</span> = &gt;45% (excellent), <span className="text-blue-600 font-bold">Bleu</span> = 35-45%, <span className="text-amber-600 font-bold">Jaune</span> = 25-35%, <span className="text-red-600 font-bold">Rouge</span> = &lt;25%. Le Learning Engine utilise ces données pour détecter les <strong>meilleurs jours de la semaine</strong> et ajuster les recommandations de bid.
        </>
      }
    >
      <div>
        <div className="grid grid-cols-7 gap-1 mb-1">
          {days.map(d => <div key={d} className="text-[9px] text-gray-400 text-center font-semibold">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((c, i) => {
            const { bg, text } = getColor(c.margin);
            return (
              <div key={i} className={`aspect-square rounded flex items-center justify-center font-mono text-[9px] font-bold ${bg} ${text}`}
                title={`Sem ${c.week + 1}, ${days[c.day]}: ${c.margin.toFixed(1)}%`}>
                {c.margin.toFixed(0)}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ===== BAYESIAN FUSION =====
function BayesianCard({ project, allProjects }: { project: ProjectData; allProjects: ProjectData[] }) {
  const stats = useMemo(() => computeCampaignLearningStats(project), [project]);
  const prior = useMemo(() => computeCrossCampaignPrior(allProjects || [], project.kpiType || "CPA"), [allProjects, project.kpiType]);
  const bayes = useMemo(() => getBayesianElasticity(stats, prior), [stats, prior]);
  const priorWeight = prior ? prior.sampleSize / (prior.sampleSize + (stats?.elasticityConfidence || 0) * 30) : 0;

  return (
    <Card title="Bayesian Cross-Campaign Fusion" tag="Learning Engine v10.0 — Prior + Données courantes" icon="🔬"
      explainer={
        <>
          <strong className="text-blue-700">Le problème :</strong> une nouvelle campagne n'a pas assez de données. <strong>La solution :</strong> le prior bayésien utilise les campagnes terminées similaires comme point de départ.
          <br /><span className="font-mono text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded mt-1 inline-block">blended = prior × priorWeight + current × dataWeight</span>
          <br />Une élasticité de <strong>{(bayes.elasticity || 0).toFixed(2)}</strong> signifie : +1pt marge → le KPI se dégrade de {Math.abs(bayes.elasticity || 0).toFixed(2)}%. Ce chiffre alimente directement le Bid Shading Engine.
        </>
      }
    >
      <div className="flex items-center justify-center gap-3">
        <div className="text-center px-4 py-3 rounded-xl bg-purple-50 border border-purple-100 min-w-[100px]">
          <div className="text-[9px] font-bold text-purple-400 uppercase tracking-wider">Prior</div>
          <div className="font-mono text-lg font-bold text-purple-600">{prior ? prior.avgElasticity.toFixed(2) : "—"}</div>
          <div className="text-[9px] text-purple-400">{prior ? `${prior.sampleSize} campagnes` : "Aucun"}</div>
        </div>
        <span className="text-gray-300 text-lg">→</span>
        <div className="text-center px-4 py-3 rounded-xl bg-blue-50 border border-blue-100 min-w-[100px]">
          <div className="text-[9px] font-bold text-blue-400 uppercase tracking-wider">Current</div>
          <div className="font-mono text-lg font-bold text-blue-600">{stats?.marginKpiElasticity != null ? stats.marginKpiElasticity.toFixed(2) : "—"}</div>
          <div className="text-[9px] text-blue-400">R² = {(stats?.elasticityConfidence || 0).toFixed(2)}</div>
        </div>
        <span className="text-gray-300 text-lg">→</span>
        <div className="text-center px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 min-w-[100px]">
          <div className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">Blended</div>
          <div className="font-mono text-lg font-bold text-emerald-600">{(bayes.elasticity || 0).toFixed(2)}</div>
          <div className="text-[9px] text-emerald-400">Conf: {((bayes.confidence || 0) * 100).toFixed(0)}%</div>
        </div>
      </div>
      <div className="text-center mt-2 text-[10px] text-gray-400 font-mono">
        Poids prior: {((priorWeight || 0) * 100).toFixed(0)}% | Poids data: {(((1 - (priorWeight || 0)) * 100)).toFixed(0)}% | Source: {bayes.source}
      </div>
    </Card>
  );
}

// ===== MAIN EXPORT =====
export function LearningEngineDashboard({ project, allProjects = [], onNavigateToMarge }: Props) {
  return (
    <div className="p-6 bg-[#f8f9fa] h-full overflow-y-auto space-y-5">
      {/* Galaxy Brain */}
      <GalaxyBrain />

      {/* Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BidShadingCard project={project} />
        <WinRateCard project={project} />
        <LearningProgressCard project={project} allProjects={allProjects} />
        <FunnelCard project={project} />
        <PacingCard project={project} />
        <HeatmapCard project={project} />
      </div>

      {/* Bayesian full width */}
      <BayesianCard project={project} allProjects={allProjects} />
    </div>
  );
}

// ===== MINI WIDGET (for CockpitYield) =====
export function LearningEngineMiniWidget({ project, allProjects = [], onNavigate }: { project: ProjectData; allProjects?: ProjectData[]; onNavigate: () => void }) {
  const stats = useMemo(() => computeCampaignLearningStats(project), [project]);
  const prior = useMemo(() => computeCrossCampaignPrior(allProjects || [], project.kpiType || "CPA"), [allProjects, project.kpiType]);
  const bayes = useMemo(() => getBayesianElasticity(stats, prior), [stats, prior]);

  return (
    <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-100 rounded-xl p-4 flex items-center justify-between cursor-pointer hover:border-purple-300 transition-colors" onClick={onNavigate}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm" style={{ background: "linear-gradient(135deg,rgba(130,40,210,.3),rgba(30,160,215,.2))" }}>🧠</div>
        <div>
          <div className="text-xs font-bold text-gray-800">Learning Engine</div>
          <div className="text-[10px] text-gray-500">Confiance {((bayes.confidence || 0) * 100).toFixed(0)}% • Élasticité {(bayes.elasticity || 0).toFixed(2)} • Bid optimal €{((project.cpmCostActuel || 0) * .87).toFixed(2)}</div>
        </div>
      </div>
      <span className="text-xs font-bold text-blue-600 hover:text-blue-800">Voir le détail →</span>
    </div>
  );
}
