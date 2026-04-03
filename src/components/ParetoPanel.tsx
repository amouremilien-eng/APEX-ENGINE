// ============================================================
// 🏆 ParetoPanel.tsx — Expert Interactive Pareto UI V3.0
// Cockpit Yield V13 — Gamned!
// ============================================================
// 🆕 V3.0 :
//   B. Recommandation intelligente (plus de forced "marge stable")
//   C. Relaxation hints UI
//   D. What-If hybride (partir d'une solution Pareto)
//   E. Warm-start inter-scénarios (cache des fronts)
//   G. Trajectoire temporelle (graphique gain projeté)
// ============================================================

import { useState, useMemo, useCallback, useEffect } from "react";
import { ProjectData, LineItem } from "../types";
import { cn } from "../utils/cn";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
  ComposedChart, Area, Line, Legend,
} from "recharts";
import {
  Wand2, AlertTriangle, CheckCircle2, Lock, Unlock, Shield, Target,
  TrendingUp, Zap, Sliders, BarChart3, Download, ChevronDown, ChevronUp,
  Info, X,
} from "lucide-react";
import {
  paretoOptimize,
  paretoSolutionToLineItems,
  whatIfPreview,
  projectTrajectory,
  PARETO_SCENARIOS,
  type ParetoSolution,
  type ParetoResult,
  type ResolvedSolution,
  type ScenarioId,
  type Gene,
} from "../ParetoEngine";

interface ParetoPanelProps {
  project: ProjectData;
  onChange: (project: ProjectData) => void;
  lineItems: LineItem[];
  lockedLines: Set<string>;
  toggleLock: (id: string) => void;
  currentMargin: number;
  isFin: boolean;
  reachElasticity: number;
  currSym: string;
  fmtKpi: (val: number) => string;
  createSnapshot: (action: "OPTIMIZATION", note?: string) => any;
}

const SOLUTION_COLORS: Record<string, string> = {
  "margin-locked": "#6366f1",
  "kpi-safe": "#10b981",
  "high-margin": "#f59e0b",
  "kpi-risk": "#ef4444",
  "conservative": "#3b82f6",
  "cap-safe": "#14b8a6",
  "default": "#8b5cf6",
};

function getSolutionColor(sol: ParetoSolution): string {
  if (sol.resolved.isMarginLocked) return SOLUTION_COLORS["margin-locked"];
  if (sol.tags.includes("kpi-risk")) return SOLUTION_COLORS["kpi-risk"];
  if (sol.tags.includes("high-margin")) return SOLUTION_COLORS["high-margin"];
  if (sol.tags.includes("kpi-safe")) return SOLUTION_COLORS["kpi-safe"];
  if (sol.tags.includes("conservative")) return SOLUTION_COLORS["conservative"];
  return SOLUTION_COLORS["default"];
}

function ParetoChartTooltip({ active, payload, currSym, fmtKpi }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;
  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 shadow-2xl p-4 min-w-[220px]">
      <div className="font-black text-sm text-gray-900 mb-2">{data.label}</div>
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between"><span className="text-gray-500">Gain projeté</span><span className="font-bold text-emerald-600">{data.gain?.toFixed(0)} {currSym}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">KPI projeté</span><span className="font-bold">{fmtKpi(data.kpi)}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Marge</span><span className="font-bold">{data.margin?.toFixed(1)}%</span></div>
        <div className="flex justify-between"><span className="text-gray-500">CPM Rev</span><span className="font-bold">{data.cpmRev?.toFixed(2)} {currSym}</span></div>
        {data.delta !== undefined && (
          <div className={cn("flex justify-between pt-1 border-t border-gray-100", data.delta >= 0 ? "text-emerald-600" : "text-red-600")}>
            <span className="font-bold">vs Actuel</span><span className="font-black">{data.delta >= 0 ? "+" : ""}{data.delta?.toFixed(0)} {currSym}</span>
          </div>
        )}
      </div>
      {data.constraintViolation > 0 && (
        <div className="mt-2 pt-2 border-t border-red-200 text-[10px] text-red-600 font-bold">
          ⚠️ Contrainte(s) violée(s) : {data.violatedConstraints?.join(", ")}
        </div>
      )}
    </div>
  );
}

export function ParetoPanel({
  project, onChange, lineItems, lockedLines, toggleLock,
  currentMargin, isFin, reachElasticity, currSym, fmtKpi, createSnapshot,
}: ParetoPanelProps) {
  const [selectedScenario, setSelectedScenario] = useState<ScenarioId>("balanced");
  const [solutions, setSolutions] = useState<ParetoSolution[] | null>(null);
  const [selectedSolIdx, setSelectedSolIdx] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showDetail, setShowDetail] = useState(true);
  const [showWhatIf, setShowWhatIf] = useState(false);
  const [whatIfResult, setWhatIfResult] = useState<ResolvedSolution | null>(null);
  const [whatIfMargins, setWhatIfMargins] = useState<Record<string, number>>({});
  const [respectCpmCap, setRespectCpmCap] = useState(true);

  // 🆕 V3.0 D : Base solution pour What-If hybride
  const [whatIfBaseSolution, setWhatIfBaseSolution] = useState<ParetoSolution | null>(null);

  // 🆕 V3.0 E : Cache des fronts pour warm-start
  const [previousFronts, setPreviousFronts] = useState<Map<ScenarioId, Gene[][]>>(new Map());

  // Reset quand les line items changent
  useEffect(() => {
    setSolutions(null);
    setSelectedSolIdx(null);
    setWhatIfResult(null);
    setWhatIfMargins({});
    setWhatIfBaseSolution(null);
  }, [lineItems.length]);

  const scenario = PARETO_SCENARIOS[selectedScenario];

  // 🆕 V3.0 E : handleOptimize avec warm-start
  const handleOptimize = useCallback(() => {
    if (lineItems.length < 2) {
      alert("Minimum 2 line items non verrouillées pour lancer Pareto.");
      return;
    }
    setIsRunning(true);
    setShowWhatIf(false);
    setWhatIfResult(null);
    setWhatIfBaseSolution(null);

    setTimeout(() => {
      // Warm-start : récupérer du scénario courant ou de n'importe quel précédent
      const warmStart =
        previousFronts.get(selectedScenario) ||
        (() => {
          const allGenes: Gene[][] = [];
          for (const genes of previousFronts.values()) allGenes.push(...genes);
          return allGenes.length > 0 ? allGenes.slice(0, 20) : undefined;
        })();

      const { solutions: results, frontGenes }: ParetoResult = paretoOptimize(
        project, lineItems, lockedLines, currentMargin, isFin,
        reachElasticity, currSym, undefined, undefined,
        selectedScenario, warmStart
      );

      // Sauvegarder le front pour le prochain run
      setPreviousFronts(prev => {
        const next = new Map(prev);
        next.set(selectedScenario, frontGenes);
        return next;
      });

      setSolutions(results);
      setSelectedSolIdx(results.findIndex(s => s.recommended));
      setIsRunning(false);
    }, 50);
  }, [
    project, lineItems, lockedLines, currentMargin, isFin,
    reachElasticity, currSym, selectedScenario, previousFronts,
  ]);

  // 🆕 V3.0 D : What-If avec support base solution
  const handleWhatIfChange = useCallback((lineId: string, newMargin: number) => {
    const updated = { ...whatIfMargins, [lineId]: newMargin };
    setWhatIfMargins(updated);
    setWhatIfResult(
      whatIfPreview(lineItems, project, lockedLines, updated, {}, isFin, reachElasticity, selectedScenario)
    );
  }, [whatIfMargins, lineItems, project, lockedLines, isFin, reachElasticity, selectedScenario]);

  const resetWhatIf = useCallback(() => {
    if (whatIfBaseSolution) {
      // Reset aux valeurs de la solution de base
      const margins: Record<string, number> = {};
      whatIfBaseSolution.resolved.lines.forEach(l => { margins[l.lineItemId] = l.newMargin; });
      setWhatIfMargins(margins);
      setWhatIfResult(
        whatIfPreview(lineItems, project, lockedLines, margins, {}, isFin, reachElasticity, selectedScenario)
      );
    } else {
      setWhatIfMargins({});
      setWhatIfResult(null);
    }
  }, [whatIfBaseSolution, lineItems, project, lockedLines, isFin, reachElasticity, selectedScenario]);

  // Initialiser What-If depuis une solution Pareto
  const startWhatIfFromSolution = useCallback((sol: ParetoSolution) => {
    setWhatIfBaseSolution(sol);
    const margins: Record<string, number> = {};
    sol.resolved.lines.forEach(l => { margins[l.lineItemId] = l.newMargin; });
    setWhatIfMargins(margins);
    setShowWhatIf(true);
    setWhatIfResult(
      whatIfPreview(lineItems, project, lockedLines, margins, {}, isFin, reachElasticity, selectedScenario)
    );
  }, [lineItems, project, lockedLines, isFin, reachElasticity, selectedScenario]);

  // Appliquer un What-If manuellement
  const applyWhatIf = useCallback(() => {
    if (!whatIfResult || whatIfResult.constraintViolation > 0) return;
    const joursRest = Math.max(1, project.durationDays - Math.floor((Date.now() - new Date(project.startDate || Date.now()).getTime()) / 86400000));
    const syntheticLineItems = whatIfResult.lines.map(line => {
      const original = lineItems.find(li => li.id === line.lineItemId);
      if (!original) return original!;
      return {
        ...original,
        marginPct: Math.round(line.newMargin * 100) / 100,
        cpmRevenue: Math.round(line.newCpmRevenue * 100) / 100,
        spend: Math.round(line.newDailyBudget * joursRest * 100) / 100,
      };
    }).filter(Boolean);

    const snapshot = createSnapshot(
      "OPTIMIZATION",
      `What-If Manuel — Marge ${whatIfResult.weightedMargin.toFixed(1)}% — Gain ${whatIfResult.totalGainProjected.toFixed(0)} ${currSym}`
    );
    onChange({
      ...project,
      lineItems: syntheticLineItems,
      history: [...(project.history || []), snapshot],
      updatedAt: new Date().toISOString(),
    });
    setSolutions(null);
    setShowWhatIf(false);
    setWhatIfBaseSolution(null);
    alert("✅ Configuration What-If appliquée !");
  }, [whatIfResult, project, lineItems, onChange, createSnapshot, currSym]);

  const chartData = useMemo(() => {
    if (!solutions) return [];
    return solutions.map((sol, idx) => ({
      idx, label: sol.label,
      gain: sol.resolved.totalGainProjected, kpi: sol.resolved.weightedKpi,
      margin: sol.resolved.weightedMargin, cpmRev: sol.resolved.weightedCpmRevenue,
      delta: sol.resolved.gainDeltaVsCurrent,
      constraintViolation: sol.resolved.constraintViolation,
      violatedConstraints: sol.resolved.violatedConstraints,
      recommended: sol.recommended, isMarginLocked: sol.resolved.isMarginLocked,
      color: getSolutionColor(sol), size: sol.recommended ? 180 : 120,
    }));
  }, [solutions]);

  const applySolution = useCallback((solIdx: number) => {
    if (!solutions || !solutions[solIdx]) return;
    const sol = solutions[solIdx];
    const joursRest = Math.max(1, project.durationDays - Math.floor((Date.now() - new Date(project.startDate || Date.now()).getTime()) / 86400000));
    const newLineItems = paretoSolutionToLineItems(sol, lineItems, joursRest);
    const paretoData = {
      label: sol.label, description: sol.description, tags: sol.tags,
      isMarginLocked: sol.resolved.isMarginLocked,
      weightedMargin: sol.resolved.weightedMargin,
      weightedKpi: sol.resolved.weightedKpi,
      weightedCpmRevenue: sol.resolved.weightedCpmRevenue,
      totalGainProjected: sol.resolved.totalGainProjected,
      currentGainProjected: sol.resolved.currentGainProjected,
      gainDeltaVsCurrent: sol.resolved.gainDeltaVsCurrent,
      cutLines: sol.resolved.cutLines || 0,
      freedBudgetPct: sol.resolved.freedBudgetPct || 0,
      scenario: selectedScenario,
      lines: sol.resolved.lines.map(l => ({
        name: l.name, originalMargin: l.originalMargin, newMargin: l.newMargin,
        marginDelta: l.marginDelta, newDailyBudget: l.newDailyBudget,
        budgetDeltaPct: l.budgetDeltaPct, newCpmRevenue: l.newCpmRevenue,
        projectedKpi: l.projectedKpi, cutReason: l.cutReason,
      })),
      currSym, kpiType: project.kpiType, isFin,
    };
    const snapshot = createSnapshot("OPTIMIZATION", `__PARETO_V11__${JSON.stringify(paretoData)}`);
    onChange({
      ...project, lineItems: newLineItems,
      history: [...(project.history || []), snapshot],
      updatedAt: new Date().toISOString(),
    });
    setSolutions(null);
    setSelectedSolIdx(null);
    alert(`✅ Solution "${sol.label}" appliquée !`);
  }, [solutions, project, lineItems, onChange, createSnapshot, selectedScenario, currSym, isFin]);

  const selectedSol = solutions && selectedSolIdx !== null ? solutions[selectedSolIdx] : null;

  // 🆕 V3.0 G : Données trajectoire pour la solution sélectionnée
  const trajectoryData = useMemo(() => {
    if (!selectedSol) return null;
    const joursRest = Math.max(1, project.durationDays - Math.floor((Date.now() - new Date(project.startDate || Date.now()).getTime()) / 86400000));
    const dailyAgg = new Map<string, number>();
    if (project.dailyEntries) {
      for (const e of project.dailyEntries) {
        dailyAgg.set(e.date, (dailyAgg.get(e.date) || 0) + (e.budgetSpent || 0));
      }
    }
    const historicalSpends = [...dailyAgg.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, spend]) => spend);
    return projectTrajectory(selectedSol.resolved, project, joursRest, historicalSpends);
  }, [selectedSol, project]);

  return (
    <div className="space-y-6">
      {/* HEADER + SCENARIOS */}
      <div className="bg-gradient-to-r from-violet-50 via-indigo-50 to-blue-50 border-2 border-violet-200 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-black text-xl text-gray-900 flex items-center gap-3">
              🏆 Pareto Multi-Objectif V3
              <span className="text-[10px] font-bold bg-violet-200 text-violet-800 px-2.5 py-1 rounded-full uppercase tracking-wider">
                Constraint-NSGA-II + Adaptive
              </span>
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Choisissez un scénario, lancez l'optimisation, explorez les solutions faisables.
            </p>
          </div>
          {solutions && (
            <button
              onClick={() => { setSolutions(null); setSelectedSolIdx(null); setWhatIfBaseSolution(null); }}
              className="text-sm text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-white/50"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Scénarios */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {(["safe", "balanced", "aggressive", "boost_kpi"] as ScenarioId[]).map(id => {
            const s = PARETO_SCENARIOS[id];
            const isActive = selectedScenario === id;
            const hasWarmStart = previousFronts.has(id);
            return (
              <button
                key={id}
                onClick={() => { setSelectedScenario(id); setSolutions(null); }}
                className={cn(
                  "relative rounded-xl p-4 border-2 transition-all text-left",
                  isActive
                    ? "border-violet-500 bg-white shadow-lg ring-2 ring-violet-200 scale-[1.02]"
                    : "border-gray-200 bg-white/60 hover:border-violet-300 hover:shadow-md"
                )}
              >
                <div className="text-lg mb-1">{s.emoji}</div>
                <div className={cn("font-black text-sm", isActive ? "text-violet-900" : "text-gray-700")}>
                  {s.label.replace(s.emoji + " ", "")}
                </div>
                <div className="text-[10px] text-gray-500 mt-1 leading-relaxed">{s.description}</div>
                <div className="flex flex-wrap gap-1 mt-2">
                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                    s.maxKpiDegradationPct <= 0.10 ? "bg-emerald-100 text-emerald-700"
                    : s.maxKpiDegradationPct <= 0.20 ? "bg-amber-100 text-amber-700"
                    : "bg-red-100 text-red-700"
                  )}>KPI ±{(s.maxKpiDegradationPct * 100).toFixed(0)}%</span>
                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                    s.cpmCapStrict ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  )}>Cap {s.cpmCapStrict ? "strict" : "flex"}</span>
                  {hasWarmStart && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
                      🔥 Warm
                    </span>
                  )}
                </div>
                {isActive && <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-violet-500 rounded-full border-2 border-white" />}
              </button>
            );
          })}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 p-1">
              <button onClick={() => setRespectCpmCap(true)} className={cn("px-3 py-1.5 rounded-md text-xs font-bold transition-all", respectCpmCap ? "bg-emerald-100 text-emerald-800 shadow-sm" : "text-gray-500 hover:text-gray-700")}>🛡️ Cap strict</button>
              <button onClick={() => setRespectCpmCap(false)} className={cn("px-3 py-1.5 rounded-md text-xs font-bold transition-all", !respectCpmCap ? "bg-amber-100 text-amber-800 shadow-sm" : "text-gray-500 hover:text-gray-700")}>🔓 Cap flexible</button>
            </div>
            <span className="text-xs text-gray-400">
              Cap vendu : <strong>{project.cpmSoldCap?.toFixed(2)} {currSym}</strong>
            </span>
          </div>
          <button
            onClick={handleOptimize}
            disabled={isRunning || lineItems.length < 2}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black transition-all shadow-lg",
              isRunning
                ? "bg-gray-400 text-white cursor-wait"
                : "bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 hover:shadow-xl active:scale-[0.98]"
            )}
          >
            <Wand2 className={cn("w-4 h-4", isRunning && "animate-spin")} />
            {isRunning ? "Optimisation..." : `Lancer ${scenario.emoji}`}
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* RÉSULTATS */}
      {/* ============================================================ */}
      {solutions && solutions.length > 0 && (<>

        {/* SCATTER CHART */}
        <div className="bg-white border-2 border-violet-100 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-black text-gray-900 flex items-center gap-2 text-sm">
              📊 Front de Pareto — {solutions.length} Solutions
              <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                {solutions.filter(s => s.resolved.constraintViolation === 0).length} faisables
              </span>
            </h4>
            <button
              onClick={() => { setShowWhatIf(!showWhatIf); if (!showWhatIf) setWhatIfBaseSolution(null); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all",
                showWhatIf
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-indigo-600 border-indigo-200 hover:border-indigo-400"
              )}
            >
              <Sliders className="w-3.5 h-3.5" /> What-If
            </button>
          </div>
          <div className="h-64 mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" dataKey="gain" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false}
                  label={{ value: `Gain Projeté (${currSym})`, position: 'bottom', offset: 5, style: { fontSize: 11, fill: '#94a3b8' } }} />
                <YAxis type="number" dataKey="kpi" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false}
                  label={{ value: `${project.kpiType} Projeté`, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#94a3b8' } }} reversed={isFin} />
                <ReferenceLine y={project.targetKpi} stroke="#ef4444" strokeDasharray="5 5" strokeWidth={1.5}
                  label={{ value: `Objectif ${project.kpiType}`, position: 'right', style: { fontSize: 9, fill: '#ef4444' } }} />
                <Tooltip content={<ParetoChartTooltip currSym={currSym} fmtKpi={fmtKpi} />} />
                <Scatter data={chartData} cursor="pointer" onClick={(data: any) => { if (data?.idx !== undefined) setSelectedSolIdx(data.idx); }}>
                  {chartData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color}
                      fillOpacity={selectedSolIdx === idx ? 1 : 0.7}
                      stroke={selectedSolIdx === idx ? "#1e1b4b" : "white"}
                      strokeWidth={selectedSolIdx === idx ? 3 : 2}
                      r={selectedSolIdx === idx ? 10 : entry.recommended ? 8 : 6} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-4 text-[10px] text-gray-500">
            {[
              { color: SOLUTION_COLORS["margin-locked"], label: "Marge Stable" },
              { color: SOLUTION_COLORS["kpi-safe"], label: "KPI Safe" },
              { color: SOLUTION_COLORS["high-margin"], label: "High Margin" },
              { color: SOLUTION_COLORS["kpi-risk"], label: "KPI Risque" },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: l.color }} />
                <span className="font-bold">{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* SOLUTION CARDS */}
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(solutions.length, 3)}, 1fr)` }}>
          {solutions.map((sol, idx) => {
            const isSelected = selectedSolIdx === idx;
            const isFeasible = sol.resolved.constraintViolation === 0;
            return (
              <div
                key={sol.id}
                onClick={() => setSelectedSolIdx(idx)}
                className={cn(
                  "rounded-xl p-5 cursor-pointer transition-all border-2 relative",
                  isSelected ? "bg-white border-violet-500 shadow-xl ring-2 ring-violet-300 scale-[1.02]"
                  : "bg-white border-gray-200 hover:border-violet-300 hover:shadow-md",
                  !isFeasible && "opacity-60 border-dashed",
                  sol.recommended && !isSelected && "border-emerald-300 bg-emerald-50/30"
                )}
              >
                {sol.recommended && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-[9px] font-black px-3 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                    ⭐ Recommandé
                  </div>
                )}
                {!isFeasible && (
                  <div className="absolute -top-2.5 right-3 bg-red-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full">
                    ⚠️ Contrainte
                  </div>
                )}
                <div className="text-center mb-3 pt-1">
                  <div className="text-base font-black text-gray-900">{sol.label}</div>
                  <div className="text-[11px] text-gray-500 mt-1">{sol.description}</div>
                </div>

                {/* Objectifs */}
                <div className="space-y-2 mb-3">
                  {sol.objectives.map((obj, oIdx) => (
                    <div key={oIdx} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">{obj.emoji}</span>
                        <span className="text-[10px] font-bold text-gray-600 uppercase">{obj.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-gray-200 rounded-full h-1.5">
                          <div className={cn("h-full rounded-full",
                            obj.normalizedValue >= 0.7 ? "bg-emerald-500"
                            : obj.normalizedValue >= 0.4 ? "bg-amber-500"
                            : "bg-red-500"
                          )} style={{ width: `${Math.min(100, obj.normalizedValue * 100)}%` }} />
                        </div>
                        <span className="text-[10px] font-black text-gray-700 w-16 text-right">{obj.displayValue}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Métriques clés */}
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-100">
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-gray-500 font-bold uppercase">Marge</div>
                    <div className="text-sm font-black text-gray-900">{sol.resolved.weightedMargin.toFixed(1)}%</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-gray-500 font-bold uppercase">Gain (Rev)</div>
                    <div className="text-sm font-black text-emerald-600">{sol.resolved.totalGainProjected.toFixed(0)} {currSym}</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-blue-600 font-bold uppercase">Budget Cost</div>
                    <div className="text-sm font-black text-blue-700">{(sol.resolved.totalDailyBudget * (1 - sol.resolved.weightedMargin / 100)).toFixed(0)} {currSym}/j</div>
                  </div>
                </div>

                {/* Delta vs actuel */}
                <div className={cn("mt-2 rounded-lg p-2 text-center text-xs font-black",
                  sol.resolved.gainDeltaVsCurrent > 0 ? "bg-emerald-50 text-emerald-700"
                  : sol.resolved.gainDeltaVsCurrent < 0 ? "bg-red-50 text-red-700"
                  : "bg-gray-50 text-gray-600"
                )}>
                  {sol.resolved.gainDeltaVsCurrent > 0 ? "📈 +" : sol.resolved.gainDeltaVsCurrent < 0 ? "📉 " : "= "}
                  {sol.resolved.gainDeltaVsCurrent.toFixed(0)} {currSym} vs actuel
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1 mt-2">
                  {sol.tags.filter(t => t !== "constraint-violated").map(tag => (
                    <span key={tag} className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                      tag === "kpi-safe" ? "bg-emerald-100 text-emerald-700"
                      : tag === "kpi-risk" ? "bg-red-100 text-red-700"
                      : tag === "high-margin" ? "bg-amber-100 text-amber-700"
                      : tag === "margin-locked" ? "bg-indigo-100 text-indigo-700"
                      : tag === "cap-safe" ? "bg-teal-100 text-teal-700"
                      : tag === "has-cuts" ? "bg-red-100 text-red-700"
                      : tag === "stable" ? "bg-gray-100 text-gray-600"
                      : tag === "gain-vs-current" ? "bg-emerald-100 text-emerald-700"
                      : tag === "loss-vs-current" ? "bg-red-100 text-red-700"
                      : "bg-violet-100 text-violet-700"
                    )}>
                      {tag === "kpi-safe" ? "✅ KPI" : tag === "kpi-risk" ? "⚠️ KPI"
                      : tag === "high-margin" ? "💰 Margin" : tag === "margin-locked" ? "🔒 Marge"
                      : tag === "cap-safe" ? "🛡️ Cap" : tag === "has-cuts" ? "🔪 Cuts"
                      : tag === "stable" ? "📊 Stable" : tag === "gain-vs-current" ? "📈"
                      : tag === "loss-vs-current" ? "📉" : tag}
                    </span>
                  ))}
                </div>

                {/* 🆕 V3.0 D : Bouton Modifier (What-If hybride) */}
                <div className="mt-3 pt-3 border-t border-gray-100 flex justify-center">
                  <button
                    onClick={(e) => { e.stopPropagation(); startWhatIfFromSolution(sol); }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold border border-violet-200 text-violet-600 hover:bg-violet-50 transition-all"
                  >
                    <Sliders className="w-3 h-3" /> Modifier cette solution
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* 🆕 V3.0 C : RELAXATION HINTS */}
        {solutions[0]?.relaxationHints && solutions[0].relaxationHints.length > 0 && (
          <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-5">
            <h4 className="font-black text-amber-900 flex items-center gap-2 text-sm mb-3">
              <AlertTriangle className="w-4 h-4" />
              Solutions supplémentaires disponibles si vous relâchez les contraintes
            </h4>
            <div className="space-y-3">
              {solutions[0].relaxationHints.map((hint, idx) => (
                <div key={idx} className="bg-white rounded-lg p-4 border border-amber-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black text-amber-800 uppercase">{hint.constraintName}</span>
                    <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                      +{hint.additionalSolutionsCount} solution(s)
                    </span>
                  </div>
                  <p className="text-sm text-amber-700 mb-2">{hint.costDescription}</p>
                  <div className="flex items-center gap-4 text-xs text-gray-600">
                    <span>Limite actuelle : <strong>{hint.originalLimit}</strong></span>
                    <span>→</span>
                    <span>Relaxée : <strong className="text-amber-700">{hint.relaxedLimit}</strong></span>
                    <span className="ml-auto text-emerald-600 font-bold">
                      Meilleur gain : {hint.bestGainIfRelaxed.toFixed(0)} {currSym}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* WHAT-IF */}
        {showWhatIf && (
          <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-200 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-black text-indigo-900 flex items-center gap-2 text-sm">
                <Sliders className="w-4 h-4" /> What-If — Simulation manuelle
                {whatIfBaseSolution && (
                  <span className="text-[10px] font-bold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
                    Base : {whatIfBaseSolution.label}
                  </span>
                )}
              </h4>
              <div className="flex items-center gap-2">
                <button onClick={resetWhatIf} className="text-xs text-indigo-600 font-bold hover:underline">↺ Reset</button>
                {whatIfBaseSolution && (
                  <button onClick={() => { setWhatIfBaseSolution(null); setWhatIfMargins({}); setWhatIfResult(null); }}
                    className="text-xs text-gray-400 font-bold hover:text-gray-600">✕ Détacher</button>
                )}
              </div>
            </div>
            <div className="space-y-3 mb-4">
              {lineItems.map(li => {
                const isLocked = lockedLines.has(li.id);
                const currentVal = whatIfMargins[li.id] ?? li.marginPct;
                return (
                  <div key={li.id} className={cn("flex items-center gap-4 bg-white rounded-lg p-3 border border-indigo-100", isLocked && "opacity-50")}>
                    <button onClick={() => toggleLock(li.id)} className={cn("p-1 rounded", isLocked ? "text-amber-500" : "text-gray-300")}>
                      {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                    <div className="w-32 text-xs font-bold text-gray-700 truncate">{li.name}</div>
                    <div className="flex-1 flex items-center gap-3">
                      <span className="text-[10px] text-gray-400 w-8">{scenario.marginRange[0]}%</span>
                      <input type="range" min={scenario.marginRange[0]} max={scenario.marginRange[1]} step="0.5" value={currentVal}
                        disabled={isLocked} onChange={(e) => handleWhatIfChange(li.id, Number(e.target.value))}
                        className="flex-1 accent-indigo-600" />
                      <span className="text-[10px] text-gray-400 w-8">{scenario.marginRange[1]}%</span>
                    </div>
                    <div className="text-right w-20">
                      <div className="text-sm font-black text-indigo-700">{currentVal.toFixed(1)}%</div>
                      {Math.abs(currentVal - li.marginPct) > 0.1 && (
                        <div className={cn("text-[10px] font-bold", currentVal > li.marginPct ? "text-emerald-600" : "text-red-600")}>
                          {currentVal > li.marginPct ? "+" : ""}{(currentVal - li.marginPct).toFixed(1)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {whatIfResult && (
              <div className="bg-white rounded-xl border-2 border-indigo-200 p-4">
                <div className="grid grid-cols-6 gap-3 mb-3">
                  <div className="text-center"><div className="text-[9px] text-gray-500 font-bold uppercase">Marge</div><div className="text-lg font-black text-gray-900">{whatIfResult.weightedMargin.toFixed(1)}%</div></div>
                  <div className="text-center"><div className="text-[9px] text-gray-500 font-bold uppercase">Gain Projeté</div><div className="text-lg font-black text-emerald-600">{whatIfResult.totalGainProjected.toFixed(0)} {currSym}</div></div>
                  <div className="text-center"><div className="text-[9px] text-gray-500 font-bold uppercase">{project.kpiType}</div><div className={cn("text-lg font-black", isFin ? (whatIfResult.weightedKpi <= project.targetKpi ? "text-emerald-600" : "text-red-600") : (whatIfResult.weightedKpi >= project.targetKpi ? "text-emerald-600" : "text-red-600"))}>{fmtKpi(whatIfResult.weightedKpi)}</div></div>
                  <div className="text-center"><div className="text-[9px] text-gray-500 font-bold uppercase">CPM Rev</div><div className={cn("text-lg font-black", whatIfResult.weightedCpmRevenue <= (project.cpmSoldCap || 999) ? "text-gray-900" : "text-red-600")}>{whatIfResult.weightedCpmRevenue.toFixed(2)} {currSym}</div></div>
                  <div className="text-center"><div className="text-[9px] text-blue-600 font-bold uppercase">Budget Cost/j</div><div className="text-lg font-black text-blue-700">{(whatIfResult.totalDailyBudget * (1 - whatIfResult.weightedMargin / 100)).toFixed(0)} {currSym}</div></div>
                  <div className="text-center"><div className="text-[9px] text-gray-500 font-bold uppercase">vs Actuel</div><div className={cn("text-lg font-black", whatIfResult.gainDeltaVsCurrent >= 0 ? "text-emerald-600" : "text-red-600")}>{whatIfResult.gainDeltaVsCurrent >= 0 ? "+" : ""}{whatIfResult.gainDeltaVsCurrent.toFixed(0)} {currSym}</div></div>
                </div>
                {whatIfResult.constraintViolation > 0 && (
                  <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-bold text-center">
                    ⚠️ Contrainte(s) violée(s) : {whatIfResult.violatedConstraints.join(", ")}
                  </div>
                )}
                {whatIfResult.constraintViolation === 0 && (
                  <div className="flex items-center justify-between mt-3">
                    <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 font-bold">
                      ✅ Toutes les contraintes respectées
                    </div>
                    <button onClick={applyWhatIf}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-sm">
                      ✅ Appliquer ce What-If
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* DÉTAIL SOLUTION */}
        {selectedSol && (
          <div className="bg-white border-2 border-violet-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h5 className="font-black text-violet-900 flex items-center gap-2">
                📋 {selectedSol.label}
                {selectedSol.resolved.constraintViolation > 0 && (
                  <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">
                    ⚠️ {selectedSol.resolved.violatedConstraints.length} contrainte(s)
                  </span>
                )}
              </h5>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowDetail(!showDetail)} className="text-xs text-violet-600 font-bold hover:underline flex items-center gap-1">
                  {showDetail ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showDetail ? "Masquer" : "Détail"}
                </button>
                <button
                  onClick={() => applySolution(selectedSolIdx!)}
                  disabled={selectedSol.resolved.constraintViolation > 0}
                  className={cn(
                    "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm",
                    selectedSol.resolved.constraintViolation > 0
                      ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                      : "bg-violet-600 text-white hover:bg-violet-700"
                  )}
                >
                  ✅ Appliquer
                </button>
              </div>
            </div>

            {/* Comparaison gain */}
            <div className="rounded-xl border border-gray-200 overflow-hidden mb-4">
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
                <span className="text-[10px] font-bold text-gray-500 uppercase">Gain actuel (sans changement)</span>
                <span className="text-xs font-black text-gray-700">{selectedSol.resolved.currentGainProjected.toFixed(0)} {currSym}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
                <span className="text-[10px] font-bold text-gray-500 uppercase">Gain avec cette solution</span>
                <span className="text-xs font-black text-gray-900">{selectedSol.resolved.totalGainProjected.toFixed(0)} {currSym}</span>
              </div>
              <div className={cn("flex items-center justify-between px-4 py-2.5",
                selectedSol.resolved.gainDeltaVsCurrent > 0 ? "bg-emerald-50" : selectedSol.resolved.gainDeltaVsCurrent < 0 ? "bg-red-50" : "bg-gray-50"
              )}>
                <span className={cn("text-[10px] font-black uppercase",
                  selectedSol.resolved.gainDeltaVsCurrent > 0 ? "text-emerald-700" : selectedSol.resolved.gainDeltaVsCurrent < 0 ? "text-red-700" : "text-gray-600"
                )}>
                  {selectedSol.resolved.gainDeltaVsCurrent > 0 ? "📈 Gain supplémentaire" : selectedSol.resolved.gainDeltaVsCurrent < 0 ? "📉 Perte potentielle" : "= Identique"}
                </span>
                <span className={cn("text-sm font-black",
                  selectedSol.resolved.gainDeltaVsCurrent > 0 ? "text-emerald-700" : selectedSol.resolved.gainDeltaVsCurrent < 0 ? "text-red-700" : "text-gray-600"
                )}>
                  {selectedSol.resolved.gainDeltaVsCurrent > 0 ? "+" : ""}{selectedSol.resolved.gainDeltaVsCurrent.toFixed(0)} {currSym}
                </span>
              </div>
            </div>

            {(selectedSol.resolved.cutLines || 0) > 0 && (
              <div className="bg-red-50 rounded-lg p-2 text-center mb-4">
                <span className="text-[10px] font-black text-red-700">
                  🔪 {selectedSol.resolved.cutLines} ligne(s) coupée(s) — {selectedSol.resolved.freedBudgetPct?.toFixed(0)}% budget redistribué
                </span>
              </div>
            )}

            {/* TABLEAU LIGNES */}
            {showDetail && (
              <div className="overflow-x-auto rounded-lg border border-violet-100">
                <table className="w-full text-sm text-left">
                  <thead className="text-[10px] text-violet-800 uppercase bg-violet-50 border-b border-violet-200">
                    <tr>
                      <th className="px-4 py-2.5 font-bold">Line Item</th>
                      <th className="px-4 py-2.5 font-bold">Statut</th>
                      <th className="px-4 py-2.5 font-bold">Marge</th>
                      <th className="px-4 py-2.5 font-bold">Budget/Jour (Rev)</th>
                      <th className="px-4 py-2.5 font-bold">Budget/Jour (Cost)</th>
                      <th className="px-4 py-2.5 font-bold">CPM Rev</th>
                      <th className="px-4 py-2.5 font-bold">KPI Projeté</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-violet-100">
                    {selectedSol.resolved.lines.map(line => (
                      <tr key={line.lineItemId} className={cn("hover:bg-violet-50/30",
                        line.cutReason?.startsWith("💀") ? "bg-red-50" : line.cutReason?.startsWith("⚠️") ? "bg-amber-50" : "bg-white"
                      )}>
                        <td className="px-4 py-2.5 font-medium text-gray-900 text-xs">
                          {line.name}
                          {line.cutReason && (
                            <div className={cn("text-[9px] font-bold mt-0.5", line.cutReason.startsWith("💀") ? "text-red-600" : "text-amber-600")}>
                              {line.cutReason}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {line.cutReason?.startsWith("💀")
                            ? <span className="text-[9px] font-black bg-red-200 text-red-800 px-2 py-0.5 rounded-full">💀 CUT</span>
                            : line.cutReason?.startsWith("⚠️")
                              ? <span className="text-[9px] font-black bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">⚠️ RÉDUIT</span>
                              : <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">✅ ACTIF</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-xs font-bold text-gray-900">{line.newMargin.toFixed(1)}%</span>
                          {Math.abs(line.marginDelta) > 0.1
                            ? <span className={cn("text-[10px] ml-1 font-bold", line.marginDelta > 0 ? "text-emerald-600" : "text-red-600")}>({line.marginDelta > 0 ? "+" : ""}{line.marginDelta.toFixed(1)})</span>
                            : selectedSol.resolved.isMarginLocked
                              ? <span className="text-[9px] ml-1 font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">= STABLE</span>
                              : null}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-xs font-bold text-gray-900">{line.newDailyBudget.toFixed(2)} {currSym}</span>
                          {Math.abs(line.budgetDeltaPct) > 1 && (
                            <span className={cn("text-[10px] ml-1 font-bold", line.budgetDeltaPct > 0 ? "text-emerald-600" : "text-red-600")}>
                              ({line.budgetDeltaPct > 0 ? "+" : ""}{line.budgetDeltaPct.toFixed(0)}%)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-xs font-bold text-blue-700">{(line.newDailyBudget * (1 - line.newMargin / 100)).toFixed(2)} {currSym}</span>
                          <div className="text-[9px] text-blue-500 mt-0.5">= Rev × (1-{line.newMargin.toFixed(0)}%)</div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-700">{line.newCpmRevenue.toFixed(2)} {currSym}</td>
                        <td className="px-4 py-2.5 text-xs font-bold text-gray-900">{fmtKpi(line.projectedKpi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 🆕 V3.0 G : TRAJECTOIRE */}
            {showDetail && trajectoryData && (
              <div className="mt-4 bg-gray-50 rounded-xl p-5 border border-gray-200">
                <h5 className="font-black text-gray-900 text-sm mb-3 flex items-center gap-2">
                  📈 Trajectoire de Gain Projeté
                  <span className="text-[10px] font-bold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                    {trajectoryData.days.length}j restants
                  </span>
                </h5>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={trajectoryData.days.filter((_, i) =>
                        i % Math.max(1, Math.floor(trajectoryData.days.length / 30)) === 0 || i === trajectoryData.days.length - 1
                      )}
                      margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                        label={{ value: 'Jours', position: 'bottom', offset: 0, style: { fontSize: 10, fill: '#94a3b8' } }} />
                      <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                        tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`} />
                      <Tooltip
                        formatter={(v: number, name: string) => [`${v.toFixed(0)} ${currSym}`, name]}
                        contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '11px' }}
                      />
                      <Area dataKey="cumulativeGainOptimistic" stroke="none" fill="#10b981" fillOpacity={0.08} name="Optimiste" />
                      <Area dataKey="cumulativeGainPessimistic" stroke="none" fill="#ef4444" fillOpacity={0.08} name="Pessimiste" />
                      <Line dataKey="cumulativeGain" stroke="#6366f1" strokeWidth={2.5} dot={false} name="Gain projeté" />
                      {project.gainObjective && project.gainObjective > 0 && (
                        <ReferenceLine y={project.gainObjective} stroke="#f59e0b" strokeDasharray="5 5" strokeWidth={1.5}
                          label={{ value: `Objectif ${project.gainObjective.toFixed(0)}`, position: 'right', style: { fontSize: 9, fill: '#f59e0b' } }} />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-between mt-2 text-[10px] text-gray-500">
                  <span>Gain final : <strong className="text-indigo-700">{trajectoryData.totalGainAtEnd.toFixed(0)} {currSym}</strong></span>
                  <span>IC 90% : <strong>{trajectoryData.confidenceInterval[0].toFixed(0)}–{trajectoryData.confidenceInterval[1].toFixed(0)} {currSym}</strong></span>
                </div>
              </div>
            )}
          </div>
        )}
      </>)}
    </div>
  );
}
