import { useMemo } from "react";
import { ProjectData } from "../types";
import {
  runBacktest,
  checkRiskControls,
  validateDataQuality,
} from "../RiskEngine";

// ===== PIE CHART (SVG, no dependency) =====
function PieChart({ data, size = 120 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div className="text-xs text-gray-400 text-center" style={{ width: size, height: size, lineHeight: `${size}px` }}>Aucune donnee</div>;

  const r = size / 2;
  const ir = r * 0.55; // donut inner radius
  let cumAngle = -Math.PI / 2;

  const slices = data.filter(d => d.value > 0).map(d => {
    const angle = (d.value / total) * Math.PI * 2;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;
    const largeArc = angle > Math.PI ? 1 : 0;

    const x1 = r + r * Math.cos(startAngle);
    const y1 = r + r * Math.sin(startAngle);
    const x2 = r + r * Math.cos(endAngle);
    const y2 = r + r * Math.sin(endAngle);
    const ix1 = r + ir * Math.cos(startAngle);
    const iy1 = r + ir * Math.sin(startAngle);
    const ix2 = r + ir * Math.cos(endAngle);
    const iy2 = r + ir * Math.sin(endAngle);

    const path = data.filter(dd => dd.value > 0).length === 1
      ? `M ${r + r} ${r} A ${r} ${r} 0 1 1 ${r + r - 0.01} ${r} L ${r + ir - 0.01} ${r} A ${ir} ${ir} 0 1 0 ${r + ir} ${r} Z`
      : `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${ir} ${ir} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;

    return { ...d, path, pct: ((d.value / total) * 100).toFixed(0) };
  });

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} stroke="#fff" strokeWidth="2" />
        ))}
      </svg>
      {/* Centre gere par le parent */}
    </div>
  );
}

// ===== ANALYSE CARDS: 1 pie (pacing) + 3 color cards =====
export function AnalysePieCards({ project }: { project: ProjectData }) {
  const entries = project.dailyEntries || [];
  const totalSpend = entries.reduce((s, e) => s + (e.budgetSpent || 0), 0);
  const currentMargin = project.cpmRevenueActual > 0
    ? ((project.cpmRevenueActual - project.cpmCostActuel) / project.cpmRevenueActual) * 100
    : 0;

  const budgetSpent = project.budgetSpent || 0;
  const budgetTotal = project.budgetTotal || 1;
  const budgetPct = Math.min(100, (budgetSpent / budgetTotal) * 100);
  const budgetRemaining = Math.max(0, budgetTotal - budgetSpent);

  const gainEuros = totalSpend * (currentMargin / 100);

  const target = project.targetKpi || 0;
  const actual = project.actualKpi || 0;
  const isFin = ["CPA", "CPV", "CPC", "CPCV", "CPL", "CPI"].includes(project.kpiType);
  const kpiMet = isFin ? actual <= target : actual >= target;
  const fmtKpiVal = (v: number) => v < 0.1 ? v.toFixed(3) : v < 1 ? v.toFixed(3) : v.toFixed(2);

  const totalDays = project.durationDays || 30;
  const elapsedDays = entries.length;
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const daysPct = Math.min(100, (elapsedDays / totalDays) * 100);

  // Color logic
  const marginColor = currentMargin >= 35 ? "emerald" : currentMargin >= 20 ? "blue" : currentMargin >= 10 ? "amber" : "red";
  const kpiColor = kpiMet ? "emerald" : "red";
  const daysColor = daysPct < 50 ? "blue" : daysPct < 80 ? "amber" : "red";

  const colorClasses: Record<string, { bg: string; border: string; text: string; bar: string }> = {
    emerald: { bg: "bg-emerald-50", border: "border-emerald-100", text: "text-emerald-700", bar: "bg-emerald-500" },
    blue: { bg: "bg-blue-50", border: "border-blue-100", text: "text-blue-700", bar: "bg-blue-500" },
    amber: { bg: "bg-amber-50", border: "border-amber-100", text: "text-amber-700", bar: "bg-amber-500" },
    red: { bg: "bg-red-50", border: "border-red-100", text: "text-red-700", bar: "bg-red-500" },
  };

  const mc = colorClasses[marginColor];
  const kc = colorClasses[kpiColor];
  const dc = colorClasses[daysColor];

  return (
    <div className="grid grid-cols-4 gap-4">
      {/* Pacing — camembert */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm flex flex-col items-center">
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3 self-start">Pacing Budget</div>
        <div className="relative">
          <PieChart data={[
            { label: "Depense", value: budgetSpent, color: "#3b82f6" },
            { label: "Restant", value: budgetRemaining, color: "#e5e7eb" },
          ]} size={100} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-black text-gray-900">{budgetPct.toFixed(0)}%</span>
          </div>
        </div>
        <div className="text-[10px] text-gray-500 mt-2 text-center">{budgetSpent.toFixed(0)}€ / {budgetTotal.toFixed(0)}€</div>
        <div className="flex gap-2 mt-2">
          <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /><span className="text-[9px] text-gray-400">Depense</span></div>
          <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-200" /><span className="text-[9px] text-gray-400">Restant</span></div>
        </div>
      </div>

      {/* Marge — card couleur */}
      <div className={`rounded-xl p-4 border shadow-sm ${mc.bg} ${mc.border}`}>
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Marge</div>
        <div className={`text-2xl font-black ${mc.text}`} style={{ fontVariantNumeric: "tabular-nums" }}>{currentMargin.toFixed(1)}%</div>
        <div className="w-full h-2 bg-white/50 rounded-full mt-3 overflow-hidden">
          <div className={`h-full rounded-full ${mc.bar}`} style={{ width: `${Math.min(100, currentMargin)}%` }} />
        </div>
        <div className="text-[10px] text-gray-500 mt-2">+{gainEuros.toFixed(0)}€ de gain cumule</div>
      </div>

      {/* KPI — card couleur */}
      <div className={`rounded-xl p-4 border shadow-sm ${kc.bg} ${kc.border}`}>
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">KPI {project.kpiType}</div>
        <div className={`text-2xl font-black ${kc.text}`} style={{ fontVariantNumeric: "tabular-nums" }}>{actual > 0 ? fmtKpiVal(actual) : "—"}</div>
        <div className="flex items-center gap-2 mt-3">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${kpiMet ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
            {kpiMet ? "ON TARGET" : "OFF TARGET"}
          </span>
        </div>
        <div className="text-[10px] text-gray-500 mt-2">Objectif : {target > 0 ? fmtKpiVal(target) : "—"}</div>
      </div>

      {/* Avancement — card couleur */}
      <div className={`rounded-xl p-4 border shadow-sm ${dc.bg} ${dc.border}`}>
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Avancement</div>
        <div className={`text-2xl font-black ${dc.text}`}>J{elapsedDays}</div>
        <div className="w-full h-2 bg-white/50 rounded-full mt-3 overflow-hidden">
          <div className={`h-full rounded-full ${dc.bar}`} style={{ width: `${daysPct}%` }} />
        </div>
        <div className="text-[10px] text-gray-500 mt-2">{remainingDays}j restants sur {totalDays}j</div>
      </div>
    </div>
  );
}

// ===== RISK CONTROLS PANEL =====
export function RiskControlsPanel({ project }: { project: ProjectData }) {
  const alerts = useMemo(() => checkRiskControls(project), [project]);
  const criticals = alerts.filter(a => a.severity === "critical");
  const warnings = alerts.filter(a => a.severity === "warning");

  if (alerts.length === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold text-sm">✓</div>
        <div>
          <div className="text-sm font-bold text-emerald-900">Aucun risque detecte</div>
          <div className="text-xs text-emerald-600">Tous les indicateurs sont dans les seuils normaux</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {criticals.map(a => (
        <div key={a.id} className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded">CRITIQUE</span>
            <span className="text-sm font-bold text-red-900">{a.title}</span>
          </div>
          <div className="text-xs text-red-700">{a.message}</div>
        </div>
      ))}
      {warnings.map(a => (
        <div key={a.id} className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded">ATTENTION</span>
            <span className="text-sm font-bold text-amber-900">{a.title}</span>
          </div>
          <div className="text-xs text-amber-700">{a.message}</div>
        </div>
      ))}
    </div>
  );
}

// ===== DATA QUALITY PANEL =====
export function DataQualityPanel({ project }: { project: ProjectData }) {
  const issues = useMemo(() => validateDataQuality(project), [project]);
  const errors = issues.filter(i => i.severity === "error");
  const warnings = issues.filter(i => i.severity === "warning");

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold text-gray-900">Qualite des donnees</div>
        <div className="flex gap-2">
          {errors.length > 0 && <span className="text-[9px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded">{errors.length} erreur{errors.length > 1 ? "s" : ""}</span>}
          {warnings.length > 0 && <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded">{warnings.length} alerte{warnings.length > 1 ? "s" : ""}</span>}
          {issues.length === 0 && <span className="text-[9px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">OK</span>}
        </div>
      </div>
      {issues.length === 0 ? (
        <div className="text-xs text-emerald-600">Toutes les donnees sont valides.</div>
      ) : (
        <div className="max-h-40 overflow-y-auto space-y-1">
          {issues.slice(0, 20).map((issue, i) => (
            <div key={i} className={`text-[11px] px-2 py-1 rounded ${issue.severity === "error" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
              <strong>{issue.day}</strong> — {issue.issue}
            </div>
          ))}
          {issues.length > 20 && <div className="text-[10px] text-gray-400 px-2">+ {issues.length - 20} autres...</div>}
        </div>
      )}
    </div>
  );
}

// ===== BACKTEST PANEL =====
export function BacktestPanel({ project }: { project: ProjectData }) {
  const results = useMemo(() => runBacktest(project), [project]);

  if (results.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="text-sm font-bold text-gray-900 mb-2">Backtest historique</div>
        <div className="text-xs text-gray-400">Pas assez de donnees pour un backtest (minimum 14 jours).</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="text-sm font-bold text-gray-900 mb-3">Backtest historique — Si marge +3pts</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-100">
              <th className="text-left py-2 px-2">Periode</th>
              <th className="text-right py-2 px-2">Marge Reelle</th>
              <th className="text-right py-2 px-2">Marge Sim.</th>
              <th className="text-right py-2 px-2">Gain Reel</th>
              <th className="text-right py-2 px-2">Gain Sim.</th>
              <th className="text-right py-2 px-2">Delta</th>
              <th className="text-left py-2 px-2">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2 px-2 font-medium text-gray-700">{r.period}</td>
                <td className="py-2 px-2 text-right">{r.actualMargin.toFixed(1)}%</td>
                <td className="py-2 px-2 text-right">{r.simulatedMargin.toFixed(1)}%</td>
                <td className="py-2 px-2 text-right">{r.actualGain.toFixed(0)}€</td>
                <td className="py-2 px-2 text-right">{r.simulatedGain.toFixed(0)}€</td>
                <td className={`py-2 px-2 text-right font-bold ${r.deltaGain >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {r.deltaGain >= 0 ? "+" : ""}{r.deltaGain.toFixed(0)}€
                </td>
                <td className="py-2 px-2">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${r.deltaGain >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                    {r.deltaGain >= 0 ? "PROFITABLE" : "OPTIMAL"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

