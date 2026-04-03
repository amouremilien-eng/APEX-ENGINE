// ============================================================
// 🏆 ParetoEngine.ts — V3.0 Multi-Objective Optimization
// Cockpit Yield V13 — Gamned!
// ============================================================
// 🔥 V3.0 AMÉLIORATIONS :
//   A. ADAPTIVE POPULATION SIZING — grille ≤3 lignes, NSGA-II adaptatif >3
//   B. RECOMMANDATION INTELLIGENTE — scoring composite au lieu de "marge stable = toujours"
//   C. RELAXATION PROGRESSIVE — hints si trop de contraintes violées
//   D. WHAT-IF HYBRIDE — support base solution
//   E. WARM-START INTER-SCÉNARIOS — réutiliser le front précédent
//   F. NORMALISATION BORNES FIXES — barres comparables entre solutions
//   G. TRAJECTOIRE TEMPORELLE — projection jour par jour
// ============================================================

import type { LineItem, ProjectData } from "./types";
import { enrichLineItemFromLearning, computeAdGroupStats, riskAdjustMultiplier, continuousPerfScore } from "./LearningEngine";

// ============================================================
// TYPES
// ============================================================

export interface Gene {
  lineItemId: string;
  marginPct: number;
  budgetWeight: number;
}

export interface Individual {
  genes: Gene[];
  objectives: ObjectiveScore[];
  rank: number;
  crowdingDistance: number;
  constraintViolation: number;
  violatedConstraints: string[];
}

export interface ObjectiveScore {
  name: string;
  value: number;
  direction: "maximize" | "minimize" | "target";
  targetValue?: number;
  normalizedValue: number;
  displayValue: string;
  emoji: string;
}

export interface OptimizationObjective {
  name: string;
  emoji: string;
  weight: number;
  direction: "maximize" | "minimize" | "target";
  targetValue?: number;
  tolerancePct?: number;
  evaluate: (solution: ResolvedSolution) => number;
  format: (value: number) => string;
}

export interface HardConstraint {
  name: string;
  description: string;
  check: (solution: ResolvedSolution) => { feasible: boolean; violation: number; message?: string };
}

export interface ResolvedLine {
  lineItemId: string;
  name: string;
  originalMargin: number;
  newMargin: number;
  originalSpend: number;
  newDailyBudget: number;
  newCpmRevenue: number;
  projectedKpi: number;
  marginDelta: number;
  budgetDeltaPct: number;
  riskVolatility: number;
  cutReason?: string;
}

export interface ResolvedSolution {
  lines: ResolvedLine[];
  totalGainProjected: number;
  weightedMargin: number;
  weightedKpi: number;
  weightedCpmRevenue: number;
  totalDailyBudget: number;
  budgetVariance: number;
  isMarginLocked?: boolean;
  cutLines?: number;
  freedBudgetPct?: number;
  currentGainProjected: number;
  gainDeltaVsCurrent: number;
  constraintViolation: number;
  violatedConstraints: string[];
  trajectory?: SolutionTrajectory;
}

// 🆕 V3.0 G : Trajectoire temporelle
export interface SolutionTrajectory {
  days: TrajectoryPoint[];
  totalGainAtEnd: number;
  confidenceInterval: [number, number];
}

export interface TrajectoryPoint {
  day: number;
  date: string;
  cumulativeGain: number;
  cumulativeGainOptimistic: number;
  cumulativeGainPessimistic: number;
  dailySpend: number;
  dailyGain: number;
}

// 🆕 V3.0 C : Relaxation hints
export interface RelaxedConstraintInfo {
  constraintName: string;
  originalLimit: string;
  relaxedLimit: string;
  additionalSolutionsCount: number;
  bestGainIfRelaxed: number;
  costDescription: string;
}

// 🆕 V3.0 F : Bornes fixes
interface ObjectiveBounds {
  min: number;
  max: number;
}

export interface ParetoSolution {
  id: string;
  label: string;
  description: string;
  resolved: ResolvedSolution;
  objectives: ObjectiveScore[];
  rank: number;
  tags: string[];
  recommended: boolean;
  scenarioId?: string;
  relaxationHints?: RelaxedConstraintInfo[];
}

export interface ParetoConfig {
  populationSize: number;
  generations: number;
  crossoverRate: number;
  mutationRate: number;
  elitismRate: number;
  maxSolutions: number;
}

// 🆕 V3.0 E : Résultat enrichi avec gènes du front
export interface ParetoResult {
  solutions: ParetoSolution[];
  frontGenes: Gene[][];
}

export type ScenarioId = "safe" | "aggressive" | "boost_kpi" | "balanced" | "custom";

export interface ParetoScenario {
  id: ScenarioId;
  label: string;
  emoji: string;
  description: string;
  maxKpiDegradationPct: number;
  cpmCapStrict: boolean;
  cpmCapTolerancePct: number;
  marginRange: [number, number];
  configOverride?: Partial<ParetoConfig>;
}

// ============================================================
// CONSTANTES
// ============================================================

const DEFAULT_CONFIG: ParetoConfig = {
  populationSize: 120,
  generations: 60,
  crossoverRate: 0.85,
  mutationRate: 0.15,
  elitismRate: 0.10,
  maxSolutions: 5,
};

export const PARETO_SCENARIOS: Record<ScenarioId, ParetoScenario> = {
  safe: {
    id: "safe", label: "🛡️ Safe", emoji: "🛡️",
    description: "KPI garanti ±10%, CPM Cap strict, marge prudente +5-15pts",
    maxKpiDegradationPct: 0.10,
    cpmCapStrict: true,
    cpmCapTolerancePct: 0.0,
    marginRange: [5, 75],
    configOverride: { mutationRate: 0.10 },
  },
  balanced: {
    id: "balanced", label: "⚖️ Équilibré", emoji: "⚖️",
    description: "Bon compromis marge/KPI, CPM Cap respecté à ±5%",
    maxKpiDegradationPct: 0.20,
    cpmCapStrict: true,
    cpmCapTolerancePct: 0.05,
    marginRange: [5, 85],
  },
  aggressive: {
    id: "aggressive", label: "🔥 Agressif", emoji: "🔥",
    description: "Marge maximale, KPI toléré ±25%, CPM Cap flexible",
    maxKpiDegradationPct: 0.25,
    cpmCapStrict: false,
    cpmCapTolerancePct: 0.15,
    marginRange: [5, 95],
    configOverride: { mutationRate: 0.25, generations: 80 },
  },
  boost_kpi: {
    id: "boost_kpi", label: "🚀 Boost KPI", emoji: "🚀",
    description: "Redistribuer le budget vers les meilleures lignes KPI (marge stable)",
    maxKpiDegradationPct: 0.05,
    cpmCapStrict: true,
    cpmCapTolerancePct: 0.0,
    marginRange: [5, 95],
  },
  custom: {
    id: "custom", label: "⚙️ Custom", emoji: "⚙️",
    description: "Configuration manuelle",
    maxKpiDegradationPct: 0.20,
    cpmCapStrict: true,
    cpmCapTolerancePct: 0.05,
    marginRange: [5, 95],
  },
};

// ============================================================
// FONCTIONS UTILITAIRES
// ============================================================

function projectKpi(
  currentKpi: number, currentMargin: number, newMargin: number,
  cpmRevenue: number, isFin: boolean, kpiType: string,
  reachElasticity: number = 0.85
): number {
  if (currentKpi === 0) return 0;
  if (Math.abs(newMargin - currentMargin) < 0.01) return currentKpi;
  const cpmCost = cpmRevenue * (1 - currentMargin / 100);
  const newCpmRevenue = newMargin < 100 ? cpmCost / (1 - newMargin / 100) : cpmRevenue * 10;
  const cpmRevenueRatio = newCpmRevenue / cpmRevenue;
  if (isFin) {
    if (kpiType === "CPA" || kpiType === "CPV") {
      const volumeRatio = cpmRevenue / newCpmRevenue;
      const reachImpact = Math.pow(volumeRatio, reachElasticity);
      return currentKpi * cpmRevenueRatio / reachImpact;
    }
    return currentKpi * cpmRevenueRatio;
  } else {
    const bidChangeRatio = cpmRevenueRatio > 0 ? 1 / cpmRevenueRatio : 1;
    const qualitySensitivity: Record<string, number> = {
      "CTR": 0.35, "VTR": 0.45, "Viewability": 0.15,
    };
    const sensitivity = qualitySensitivity[kpiType] || 0.25;
    const logImpact = Math.sign(bidChangeRatio - 1) * Math.log(1 + Math.abs(bidChangeRatio - 1)) * sensitivity;
    const clampedImpact = Math.max(-0.40, Math.min(0.40, logImpact));
    return Math.max(0, Math.min(100, currentKpi * (1 + clampedImpact)));
  }
}

function randBetween(min: number, max: number): number { return min + Math.random() * (max - min); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
}

// ============================================================
// CONTRAINTES DURES
// ============================================================

function buildHardConstraints(
  project: ProjectData, isFin: boolean, scenario: ParetoScenario
): HardConstraint[] {
  const targetKpi = project.targetKpi || 0.0001;
  const cpmCap = project.cpmSoldCap || 100;
  const constraints: HardConstraint[] = [];

  constraints.push({
    name: "KPI Max Degradation",
    description: `KPI ne doit pas se dégrader de plus de ${(scenario.maxKpiDegradationPct * 100).toFixed(0)}%`,
    check: (sol) => {
      if (isFin) {
        const maxAllowed = targetKpi * (1 + scenario.maxKpiDegradationPct);
        const feasible = sol.weightedKpi <= maxAllowed;
        const violation = feasible ? 0 : (sol.weightedKpi - maxAllowed) / maxAllowed;
        return { feasible, violation, message: feasible ? undefined : `${project.kpiType} projeté ${sol.weightedKpi.toFixed(2)} > max ${maxAllowed.toFixed(2)}` };
      } else {
        const minAllowed = targetKpi * (1 - scenario.maxKpiDegradationPct);
        const feasible = sol.weightedKpi >= minAllowed;
        const violation = feasible ? 0 : (minAllowed - sol.weightedKpi) / Math.max(minAllowed, 0.001);
        return { feasible, violation, message: feasible ? undefined : `${project.kpiType} projeté ${sol.weightedKpi.toFixed(2)}% < min ${minAllowed.toFixed(2)}%` };
      }
    }
  });

  if (cpmCap > 0 && scenario.cpmCapStrict) {
    const maxCpmRev = cpmCap * (1 + scenario.cpmCapTolerancePct);
    constraints.push({
      name: "CPM Cap Strict",
      description: `CPM Revenue ≤ ${maxCpmRev.toFixed(2)} (cap ${cpmCap.toFixed(2)} + ${(scenario.cpmCapTolerancePct * 100).toFixed(0)}%)`,
      check: (sol) => {
        const feasible = sol.weightedCpmRevenue <= maxCpmRev;
        const violation = feasible ? 0 : (sol.weightedCpmRevenue - maxCpmRev) / maxCpmRev;
        return { feasible, violation };
      }
    });
  }

  constraints.push({
    name: "Margin Bounds",
    description: `Marge par ligne entre ${scenario.marginRange[0]}% et ${scenario.marginRange[1]}%`,
    check: (sol) => {
      let totalViolation = 0;
      for (const line of sol.lines) {
        if (line.newMargin < scenario.marginRange[0]) totalViolation += (scenario.marginRange[0] - line.newMargin) / 100;
        if (line.newMargin > scenario.marginRange[1]) totalViolation += (line.newMargin - scenario.marginRange[1]) / 100;
      }
      return { feasible: totalViolation === 0, violation: totalViolation };
    }
  });

  constraints.push({
    name: "Budget Positif",
    description: "Aucune ligne avec un budget négatif",
    check: (sol) => {
      const negatives = sol.lines.filter(l => l.newDailyBudget < 0);
      return { feasible: negatives.length === 0, violation: negatives.length };
    }
  });

  return constraints;
}

function checkConstraints(sol: ResolvedSolution, constraints: HardConstraint[]): { totalViolation: number; violatedNames: string[] } {
  let totalViolation = 0;
  const violatedNames: string[] = [];
  for (const c of constraints) {
    const result = c.check(sol);
    if (!result.feasible) {
      totalViolation += result.violation;
      violatedNames.push(c.name);
    }
  }
  return { totalViolation, violatedNames };
}

// ============================================================
// REPAIR MECHANISM
// ============================================================

function repairGenes(genes: Gene[], scenario: ParetoScenario, lockedLines: Set<string>): Gene[] {
  return genes.map(g => {
    const isBudgetLocked = lockedLines.has(g.lineItemId);
    return {
      ...g,
      marginPct: clamp(g.marginPct, scenario.marginRange[0], scenario.marginRange[1]),
      budgetWeight: isBudgetLocked ? g.budgetWeight : Math.max(0.01, g.budgetWeight),
    };
  });
}

// ============================================================
// GAIN ACTUEL (MÊME BASE BUDGÉTAIRE)
// ============================================================

function computeCurrentGain(
  lines: ResolvedLine[], joursEcoules: number,
  budgetJournalierDisponible: number, joursRestants: number
): number {
  const totalOriginalDaily = lines.reduce((s, l) => s + l.originalSpend / Math.max(1, joursEcoules), 0);
  if (totalOriginalDaily <= 0) return 0;
  const currentWeightedMargin = lines.reduce((s, l) => {
    const origDaily = l.originalSpend / Math.max(1, joursEcoules);
    return s + origDaily * l.originalMargin;
  }, 0) / totalOriginalDaily;
  return budgetJournalierDisponible * joursRestants * (currentWeightedMargin / 100);
}

// ============================================================
// RÉSOLUTION D'UNE SOLUTION
// ============================================================

export function resolveSolution(
  genes: Gene[], lineItems: LineItem[], project: ProjectData,
  joursEcoules: number, joursRestants: number, budgetJournalierDisponible: number,
  isFin: boolean, reachElasticity: number, lockedLines: Set<string>,
  agStats: ReturnType<typeof computeAdGroupStats>,
  constraints?: HardConstraint[]
): ResolvedSolution {
  const totalWeight = genes.filter(g => !lockedLines.has(g.lineItemId)).reduce((s, g) => s + g.budgetWeight, 0);
  const lockedDailySpend = lineItems.filter(li => lockedLines.has(li.id)).reduce((s, li) => s + (li.spend || 0) / Math.max(1, joursEcoules), 0);
  const availableDailyBudget = budgetJournalierDisponible - lockedDailySpend;
  let allMarginsLocked = true;

  const lines: ResolvedLine[] = genes.map(gene => {
    const li = lineItems.find(l => l.id === gene.lineItemId);
    if (!li) return null!;
    const originalDailyAvg = (li.spend || 0) / Math.max(1, joursEcoules);
    const isBudgetLocked = lockedLines.has(li.id);
    const newMargin = gene.marginPct;
    if (Math.abs(newMargin - li.marginPct) > 0.1) allMarginsLocked = false;
    const newDailyBudget = isBudgetLocked ? originalDailyAvg : (totalWeight > 0 ? (gene.budgetWeight / totalWeight) * availableDailyBudget : originalDailyAvg);
    const cpmCost = li.cpmRevenue * (1 - li.marginPct / 100);
    const newCpmRevenue = newMargin < 100 ? cpmCost / (1 - newMargin / 100) : li.cpmRevenue;
    const projectedKpi = projectKpi(li.kpiActual, li.marginPct, newMargin, li.cpmRevenue, isFin, project.kpiType, reachElasticity);
    const enriched = enrichLineItemFromLearning(li, agStats, project.kpiType, project.targetKpi || 0, 0);
    return {
      lineItemId: li.id, name: li.name, originalMargin: li.marginPct, newMargin,
      originalSpend: li.spend || 0, newDailyBudget, newCpmRevenue, projectedKpi,
      marginDelta: newMargin - li.marginPct,
      budgetDeltaPct: originalDailyAvg > 0 ? ((newDailyBudget - originalDailyAvg) / originalDailyAvg) * 100 : 0,
      riskVolatility: enriched.calibratedVolatility,
    };
  }).filter(Boolean);

  const totalDailyBudget = lines.reduce((s, l) => s + l.newDailyBudget, 0);
  const weightedMargin = totalDailyBudget > 0 ? lines.reduce((s, l) => s + l.newDailyBudget * l.newMargin, 0) / totalDailyBudget : 0;

  let weightedKpi: number;
  if (isFin) {
    const totalActions = lines.reduce((s, l) => l.projectedKpi > 0 ? s + l.newDailyBudget / l.projectedKpi : s, 0);
    weightedKpi = totalActions > 0 ? totalDailyBudget / totalActions : 0;
  } else {
    weightedKpi = totalDailyBudget > 0 ? lines.reduce((s, l) => s + l.newDailyBudget * l.projectedKpi, 0) / totalDailyBudget : 0;
  }

  const weightedCpmRevenue = totalDailyBudget > 0 ? lines.reduce((s, l) => s + l.newDailyBudget * l.newCpmRevenue, 0) / totalDailyBudget : 0;
  const totalGainProjected = totalDailyBudget * joursRestants * (weightedMargin / 100);
  const currentGainProjected = computeCurrentGain(lines, joursEcoules, budgetJournalierDisponible, joursRestants);
  const gainDeltaVsCurrent = totalGainProjected - currentGainProjected;

  let constraintViolation = 0;
  let violatedConstraints: string[] = [];
  if (constraints) {
    const result = checkConstraints(
      { lines, totalGainProjected, weightedMargin, weightedKpi, weightedCpmRevenue, totalDailyBudget,
        budgetVariance: 0, currentGainProjected, gainDeltaVsCurrent, constraintViolation: 0, violatedConstraints: [] },
      constraints
    );
    constraintViolation = result.totalViolation;
    violatedConstraints = result.violatedNames;
  }

  return {
    lines, totalGainProjected, weightedMargin, weightedKpi, weightedCpmRevenue, totalDailyBudget,
    budgetVariance: stdDev(lines.map(l => l.budgetDeltaPct)),
    isMarginLocked: allMarginsLocked,
    currentGainProjected, gainDeltaVsCurrent,
    constraintViolation, violatedConstraints,
  };
}

// ============================================================
// OPTIMISATION MARGE STABLE (Budget-Only + CUTS)
// ============================================================

function optimizeFixedMargin(
  lineItems: LineItem[], project: ProjectData, lockedLines: Set<string>,
  joursEcoules: number, joursRestants: number, budgetJournalierDisponible: number,
  isFin: boolean, _reachElasticity: number,
  agStats: ReturnType<typeof computeAdGroupStats>, currSym: string
): ResolvedSolution {
  const targetKpi = project.targetKpi || 0.0001;
  const maxSpend = Math.max(...lineItems.map(li => li.spend || 0), 1);
  const avgDailyAll = lineItems.reduce((acc, li) => acc + ((li.spend || 0) / Math.max(1, joursEcoules)), 0) / Math.max(lineItems.length, 1);
  const lockedDailySpend = lineItems.filter(li => lockedLines.has(li.id)).reduce((s, li) => s + (li.spend || 0) / Math.max(1, joursEcoules), 0);
  const availableDailyBudget = budgetJournalierDisponible - lockedDailySpend;

  const HARD_CUT_BUDGET_PCT = 0.02;
  const SOFT_CUT_BUDGET_PCT = 0.15;

  type CutDecision = "hard_cut" | "soft_cut" | "none";

  // 🔥 V3.1 FIX : Seuils de cut DYNAMIQUES basés sur la distribution réelle
  // Si aucune ligne n'atteint l'objectif, on ne peut pas tout couper.
  // Les seuils sont relatifs au MEILLEUR KPI de la campagne, pas à l'objectif absolu.
  const unlockedItems = lineItems.filter(li => !lockedLines.has(li.id));
  const unlockedKpis = unlockedItems.map(li => li.kpiActual ?? 0).filter(k => k > 0);

  // Trouver le meilleur KPI parmi les lignes (celui qui s'approche le plus de l'objectif)
  let bestKpiRatio = 0; // ratio performance vs objectif (1.0 = atteint, >1 = dépassé pour fin, <1 pour qualité)
  if (isFin && unlockedKpis.length > 0) {
    bestKpiRatio = targetKpi / Math.min(...unlockedKpis); // Plus le CPA est bas, mieux c'est
  } else if (!isFin && unlockedKpis.length > 0) {
    bestKpiRatio = Math.max(...unlockedKpis) / Math.max(targetKpi, 0.001);
  }

  // Si AUCUNE ligne n'atteint l'objectif (bestKpiRatio < 1), adapter les seuils
  // On passe en mode "relatif" : couper seulement les lignes qui sont BEAUCOUP plus mauvaises que la médiane
  const useRelativeMode = bestKpiRatio < 0.8; // Aucune ligne proche de l'objectif

  // Calcul de la médiane KPI pour le mode relatif
  let medianKpi = 0;
  if (useRelativeMode && unlockedKpis.length >= 2) {
    const sorted = [...unlockedKpis].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianKpi = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  const cutAnalysis = lineItems.map(li => {
    const dailyAvg = (li.spend || 0) / Math.max(1, joursEcoules);
    const kpi = li.kpiActual ?? 0;
    const isLocked = lockedLines.has(li.id);
    if (isLocked) return { li, dailyAvg, cut: "none" as CutDecision, cutReason: undefined as string | undefined };

    // KPI = 0 → toujours hard cut (aucune performance du tout)
    if (kpi === 0 && dailyAvg > 0) return { li, dailyAvg, cut: "hard_cut" as CutDecision, cutReason: `💀 KPI=0 — aucune performance` };

    if (useRelativeMode && medianKpi > 0) {
      // 🔥 MODE RELATIF : Comparer à la médiane, pas à l'objectif
      // Couper seulement les lignes qui sont 3× pires que la médiane
      if (isFin) {
        const ratioVsMedian = kpi / medianKpi; // >1 = pire que la médiane (CPA plus élevé)
        if (ratioVsMedian > 3.0) return { li, dailyAvg, cut: "hard_cut" as CutDecision, cutReason: `💀 ${project.kpiType} ${kpi.toFixed(2)}${currSym} = ${ratioVsMedian.toFixed(1)}× la médiane (${medianKpi.toFixed(2)}${currSym})` };
        if (ratioVsMedian > 2.0) return { li, dailyAvg, cut: "soft_cut" as CutDecision, cutReason: `⚠️ ${project.kpiType} ${kpi.toFixed(2)}${currSym} = ${ratioVsMedian.toFixed(1)}× la médiane — en observation` };
      } else {
        const ratioVsMedian = kpi / medianKpi; // <1 = pire que la médiane (CTR plus bas)
        if (ratioVsMedian < 0.25) return { li, dailyAvg, cut: "hard_cut" as CutDecision, cutReason: `💀 ${project.kpiType} ${kpi.toFixed(2)}% = ${(ratioVsMedian * 100).toFixed(0)}% de la médiane` };
        if (ratioVsMedian < 0.4) return { li, dailyAvg, cut: "soft_cut" as CutDecision, cutReason: `⚠️ ${project.kpiType} ${kpi.toFixed(2)}% = ${(ratioVsMedian * 100).toFixed(0)}% de la médiane — en observation` };
      }
    } else {
      // MODE ABSOLU : Objectif atteignable, comparer à l'objectif
      if (isFin) {
        const ratio = kpi / targetKpi;
        if (ratio > 3.0) return { li, dailyAvg, cut: "hard_cut" as CutDecision, cutReason: `💀 ${project.kpiType} ${kpi.toFixed(2)}${currSym} = ${ratio.toFixed(1)}× l'objectif` };
        if (ratio > 2.0) return { li, dailyAvg, cut: "soft_cut" as CutDecision, cutReason: `⚠️ ${project.kpiType} ${kpi.toFixed(2)}${currSym} = ${ratio.toFixed(1)}× l'objectif — en observation` };
      } else {
        const ratio = kpi / Math.max(targetKpi, 0.001);
        if (ratio < 0.2) return { li, dailyAvg, cut: "hard_cut" as CutDecision, cutReason: `💀 ${project.kpiType} ${kpi.toFixed(2)}% = ${(ratio * 100).toFixed(0)}% de l'objectif` };
        if (ratio < 0.4) return { li, dailyAvg, cut: "soft_cut" as CutDecision, cutReason: `⚠️ ${project.kpiType} ${kpi.toFixed(2)}% = ${(ratio * 100).toFixed(0)}% de l'objectif — en observation` };
      }
    }
    return { li, dailyAvg, cut: "none" as CutDecision, cutReason: undefined as string | undefined };
  });

  // 🔥 V3.1 GARDE CRITIQUE : Ne JAMAIS couper plus de 50% des lignes non-lockées
  // Si on dépasse, garder seulement les pires comme hard_cut et promouvoir le reste en "none"
  const totalUnlocked = cutAnalysis.filter(c => !lockedLines.has(c.li.id)).length;
  const totalCuts = cutAnalysis.filter(c => c.cut !== "none" && !lockedLines.has(c.li.id)).length;
  const maxAllowedCuts = Math.max(1, Math.floor(totalUnlocked * 0.50)); // Max 50% de cuts

  if (totalCuts > maxAllowedCuts) {
    // Trier les cuts par sévérité (KPI le plus mauvais d'abord)
    const cutItems = cutAnalysis
      .filter(c => c.cut !== "none" && !lockedLines.has(c.li.id))
      .sort((a, b) => {
        // Les pires KPI en premier (à garder en cut)
        if (isFin) return (b.li.kpiActual ?? 0) - (a.li.kpiActual ?? 0); // CPA élevé = pire
        return (a.li.kpiActual ?? 0) - (b.li.kpiActual ?? 0); // CTR bas = pire
      });

    // Garder seulement les maxAllowedCuts pires, promouvoir le reste
    const linesToPromote = new Set(cutItems.slice(maxAllowedCuts).map(c => c.li.id));
    cutAnalysis.forEach(c => {
      if (linesToPromote.has(c.li.id)) {
        c.cut = "none";
        c.cutReason = undefined;
      }
    });
  }

  const hardCuts = cutAnalysis.filter(c => c.cut === "hard_cut" && !lockedLines.has(c.li.id));
  const softCuts = cutAnalysis.filter(c => c.cut === "soft_cut" && !lockedLines.has(c.li.id));
  const budgetFreedByHardCuts = hardCuts.reduce((s, c) => s + c.dailyAvg * (1 - HARD_CUT_BUDGET_PCT), 0);
  const budgetFreedBySoftCuts = softCuts.reduce((s, c) => s + c.dailyAvg * (1 - SOFT_CUT_BUDGET_PCT), 0);
  const totalBudgetFreed = budgetFreedByHardCuts + budgetFreedBySoftCuts;
  const totalOriginalDailyUnlocked = cutAnalysis.filter(c => !lockedLines.has(c.li.id)).reduce((s, c) => s + c.dailyAvg, 0);
  const freedPct = totalOriginalDailyUnlocked > 0 ? (totalBudgetFreed / totalOriginalDailyUnlocked) * 100 : 0;

  const scored = cutAnalysis.map(ca => {
    const li = ca.li;
    const isLocked = lockedLines.has(li.id);
    if (isLocked) return { ...ca, score: 0, isLocked: true, fillRate: 1.0 };
    if (ca.cut !== "none") return { ...ca, score: 0, isLocked: false, fillRate: 1.0 };
    const perfScore = continuousPerfScore(li.kpiActual ?? 0, targetKpi, isFin);
    const volWeight = Math.max(0.05, Math.sqrt((li.spend || 0) / maxSpend));
    const enriched = enrichLineItemFromLearning(li, agStats, project.kpiType, targetKpi, 0);
    const riskMult = riskAdjustMultiplier(enriched.calibratedVolatility);
    const fillRate = (() => {
      if (joursEcoules <= 1 || (li.spend || 0) <= 0) return 0.85;
      const theoreticalTotal = ca.dailyAvg * joursEcoules;
      return theoreticalTotal > 0 ? Math.max(0.3, Math.min(1.0, (li.spend || 0) / theoreticalTotal)) : 0.85;
    })();
    return { ...ca, score: Math.max(0.01, (perfScore * perfScore / 5) * volWeight * riskMult), isLocked: false, fillRate };
  });

  const survivorItems = scored.filter(s => !s.isLocked && s.cut === "none");
  const totalScore = survivorItems.reduce((s, item) => s + item.score, 0);
  const budgetForSurvivors = availableDailyBudget - hardCuts.reduce((s, c) => s + c.dailyAvg * HARD_CUT_BUDGET_PCT, 0) - softCuts.reduce((s, c) => s + c.dailyAvg * SOFT_CUT_BUDGET_PCT, 0);

  const allocations = scored.map(item => {
    if (item.isLocked) return { ...item, proposedDaily: item.dailyAvg };
    if (item.cut === "hard_cut") return { ...item, proposedDaily: item.dailyAvg * HARD_CUT_BUDGET_PCT };
    if (item.cut === "soft_cut") return { ...item, proposedDaily: item.dailyAvg * SOFT_CUT_BUDGET_PCT };
    const theoreticalDaily = totalScore > 0 ? (item.score / totalScore) * budgetForSurvivors : item.dailyAvg;
    let proposedDaily = (theoreticalDaily * 0.7) + (item.dailyAvg * 0.3);
    const spendRatio = item.dailyAvg / Math.max(avgDailyAll, 0.01);
    const dynamicCap = spendRatio > 1.5 ? 0.50 : spendRatio > 1.0 ? 0.65 : spendRatio > 0.5 ? 0.80 : 1.0;
    const upwardCap = item.dailyAvg * (dynamicCap + (freedPct / 100) * 0.5);
    const downwardCap = item.dailyAvg * dynamicCap;
    proposedDaily = Math.max(Math.max(0, item.dailyAvg - downwardCap), Math.min(item.dailyAvg + upwardCap, proposedDaily));
    if (item.dailyAvg > 0) proposedDaily = Math.min(proposedDaily, (item.dailyAvg / (item.fillRate || 0.85)) * 1.2);
    proposedDaily = Math.max(avgDailyAll * 0.05, proposedDaily);
    return { ...item, proposedDaily };
  });

  const totalCutBudget = allocations.filter(a => a.cut !== "none" && !a.isLocked).reduce((s, a) => s + a.proposedDaily, 0);
  const totalSurvivorBudget = allocations.filter(a => a.cut === "none" && !a.isLocked).reduce((s, a) => s + a.proposedDaily, 0);
  const targetSurvivorBudget = availableDailyBudget - totalCutBudget;
  if (totalSurvivorBudget > 0 && Math.abs(totalSurvivorBudget - targetSurvivorBudget) > 1) {
    const ratio = targetSurvivorBudget / totalSurvivorBudget;
    allocations.forEach(a => { if (!a.isLocked && a.cut === "none") a.proposedDaily *= ratio; });
  }

  const lines: ResolvedLine[] = allocations.map(a => {
    const li = a.li;
    const enriched = enrichLineItemFromLearning(li, agStats, project.kpiType, targetKpi, 0);
    return {
      lineItemId: li.id, name: li.name, originalMargin: li.marginPct, newMargin: li.marginPct,
      originalSpend: li.spend || 0, newDailyBudget: a.proposedDaily, newCpmRevenue: li.cpmRevenue,
      projectedKpi: li.kpiActual, marginDelta: 0,
      budgetDeltaPct: a.dailyAvg > 0 ? ((a.proposedDaily - a.dailyAvg) / a.dailyAvg) * 100 : 0,
      riskVolatility: enriched.calibratedVolatility, cutReason: a.cutReason,
    };
  });

  const totalDailyBudget = lines.reduce((s, l) => s + l.newDailyBudget, 0);
  const weightedMargin = totalDailyBudget > 0 ? lines.reduce((s, l) => s + l.newDailyBudget * l.newMargin, 0) / totalDailyBudget : 0;
  const weightedKpi = totalDailyBudget > 0
    ? (isFin
        ? (() => { const ta = lines.reduce((s, l) => l.projectedKpi > 0 ? s + l.newDailyBudget / l.projectedKpi : s, 0); return ta > 0 ? totalDailyBudget / ta : 0; })()
        : lines.reduce((s, l) => s + l.newDailyBudget * l.projectedKpi, 0) / totalDailyBudget)
    : 0;
  const weightedCpmRevenue = totalDailyBudget > 0 ? lines.reduce((s, l) => s + l.newDailyBudget * l.newCpmRevenue, 0) / totalDailyBudget : 0;
  const totalGainProjected = totalDailyBudget * joursRestants * (weightedMargin / 100);
  const currentGainProjected = computeCurrentGain(lines, joursEcoules, budgetJournalierDisponible, joursRestants);

  return {
    lines, totalGainProjected, weightedMargin, weightedKpi, weightedCpmRevenue, totalDailyBudget,
    budgetVariance: stdDev(lines.map(l => l.budgetDeltaPct)),
    isMarginLocked: true,
    cutLines: hardCuts.length + softCuts.length,
    freedBudgetPct: freedPct,
    currentGainProjected,
    gainDeltaVsCurrent: totalGainProjected - currentGainProjected,
    constraintViolation: 0, violatedConstraints: [],
  };
}

// ============================================================
// 🆕 V3.0 G : TRAJECTOIRE TEMPORELLE
// ============================================================

export function projectTrajectory(
  resolved: ResolvedSolution,
  project: ProjectData,
  joursRestants: number,
  dailySpends?: number[]
): SolutionTrajectory {
  const margin = resolved.weightedMargin;
  const dailyBudget = resolved.totalDailyBudget;
  const gainPerDay = dailyBudget * (margin / 100);

  let spendVolatility = 0.10;
  if (dailySpends && dailySpends.length >= 5) {
    const changes: number[] = [];
    for (let i = 1; i < dailySpends.length; i++) {
      if (dailySpends[i - 1] > 0) {
        changes.push(Math.abs(dailySpends[i] - dailySpends[i - 1]) / dailySpends[i - 1]);
      }
    }
    if (changes.length > 0) {
      spendVolatility = Math.min(0.5, changes.reduce((a, b) => a + b, 0) / changes.length);
    }
  }

  const today = new Date();
  const days: TrajectoryPoint[] = [];
  let cumulGain = 0;
  let cumulGainOpt = 0;
  let cumulGainPess = 0;

  for (let d = 1; d <= joursRestants; d++) {
    const date = new Date(today.getTime() + d * 86400000);
    const dateStr = date.toISOString().split('T')[0];
    const dailyGain = gainPerDay;
    cumulGain += dailyGain;
    const uncertainty = gainPerDay * spendVolatility * Math.sqrt(d);
    cumulGainOpt += gainPerDay + uncertainty / Math.sqrt(Math.max(1, joursRestants));
    cumulGainPess += Math.max(0, gainPerDay - uncertainty / Math.sqrt(Math.max(1, joursRestants)));

    days.push({
      day: d, date: dateStr,
      cumulativeGain: cumulGain,
      cumulativeGainOptimistic: cumulGainOpt,
      cumulativeGainPessimistic: Math.max(0, cumulGainPess),
      dailySpend: dailyBudget,
      dailyGain,
    });
  }

  return {
    days,
    totalGainAtEnd: cumulGain,
    confidenceInterval: [Math.max(0, cumulGainPess), cumulGainOpt],
  };
}

// ============================================================
// CONSTRAINT-DOMINATION NSGA-II
// ============================================================

function dominates(a: Individual, b: Individual): boolean {
  if (a.constraintViolation === 0 && b.constraintViolation > 0) return true;
  if (a.constraintViolation > 0 && b.constraintViolation === 0) return false;
  if (a.constraintViolation > 0 && b.constraintViolation > 0) {
    return a.constraintViolation < b.constraintViolation;
  }
  let strictlyBetterOnAny = false;
  for (let i = 0; i < a.objectives.length; i++) {
    if (a.objectives[i].normalizedValue < b.objectives[i].normalizedValue) return false;
    if (a.objectives[i].normalizedValue > b.objectives[i].normalizedValue) strictlyBetterOnAny = true;
  }
  return strictlyBetterOnAny;
}

function nonDominatedSort(population: Individual[]): Individual[][] {
  const n = population.length;
  const dominationCount = new Array(n).fill(0);
  const dominated: number[][] = Array.from({ length: n }, () => []);
  const fronts: Individual[][] = [[]];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (dominates(population[i], population[j])) dominated[i].push(j);
      else if (dominates(population[j], population[i])) dominationCount[i]++;
    }
    if (dominationCount[i] === 0) { population[i].rank = 1; fronts[0].push(population[i]); }
  }
  let currentFront = 0;
  while (fronts[currentFront].length > 0) {
    const nextFront: Individual[] = [];
    for (const ind of fronts[currentFront]) {
      const idx = population.indexOf(ind);
      for (const j of dominated[idx]) {
        dominationCount[j]--;
        if (dominationCount[j] === 0) { population[j].rank = currentFront + 2; nextFront.push(population[j]); }
      }
    }
    fronts.push(nextFront);
    currentFront++;
  }
  return fronts.filter(f => f.length > 0);
}

function assignCrowdingDistance(front: Individual[]): void {
  const n = front.length;
  if (n <= 2) { front.forEach(ind => (ind.crowdingDistance = Infinity)); return; }
  front.forEach(ind => (ind.crowdingDistance = 0));
  for (let m = 0; m < front[0].objectives.length; m++) {
    front.sort((a, b) => a.objectives[m].normalizedValue - b.objectives[m].normalizedValue);
    front[0].crowdingDistance = Infinity;
    front[n - 1].crowdingDistance = Infinity;
    const range = front[n - 1].objectives[m].normalizedValue - front[0].objectives[m].normalizedValue;
    if (range === 0) continue;
    for (let i = 1; i < n - 1; i++) {
      front[i].crowdingDistance += (front[i + 1].objectives[m].normalizedValue - front[i - 1].objectives[m].normalizedValue) / range;
    }
  }
}

function tournamentSelect(population: Individual[]): Individual {
  const a = population[Math.floor(Math.random() * population.length)];
  const b = population[Math.floor(Math.random() * population.length)];
  if (a.constraintViolation === 0 && b.constraintViolation > 0) return a;
  if (b.constraintViolation === 0 && a.constraintViolation > 0) return b;
  if (a.rank < b.rank) return a;
  if (b.rank < a.rank) return b;
  return a.crowdingDistance > b.crowdingDistance ? a : b;
}

function crossover(parent1: Gene[], parent2: Gene[], rate: number, lockedLines?: Set<string>): [Gene[], Gene[]] {
  if (Math.random() > rate) return [structuredClone(parent1), structuredClone(parent2)];
  const child1: Gene[] = [], child2: Gene[] = [];
  for (let i = 0; i < parent1.length; i++) {
    const isBudgetLocked = lockedLines?.has(parent1[i].lineItemId) || false;
    if (Math.random() < 0.5) {
      const alpha = randBetween(0.3, 0.7);
      const bw1 = isBudgetLocked ? parent1[i].budgetWeight : clamp(alpha * parent1[i].budgetWeight + (1 - alpha) * parent2[i].budgetWeight, 0.01, 1);
      const bw2 = isBudgetLocked ? parent2[i].budgetWeight : clamp((1 - alpha) * parent1[i].budgetWeight + alpha * parent2[i].budgetWeight, 0.01, 1);
      child1.push({ lineItemId: parent1[i].lineItemId, marginPct: clamp(alpha * parent1[i].marginPct + (1 - alpha) * parent2[i].marginPct, 5, 95), budgetWeight: bw1 });
      child2.push({ lineItemId: parent1[i].lineItemId, marginPct: clamp((1 - alpha) * parent1[i].marginPct + alpha * parent2[i].marginPct, 5, 95), budgetWeight: bw2 });
    } else {
      child1.push(structuredClone(parent1[i]));
      child2.push(structuredClone(parent2[i]));
    }
  }
  return [child1, child2];
}

function mutate(genes: Gene[], rate: number, generation: number, maxGenerations: number, lockedLines?: Set<string>): Gene[] {
  const af = 1 - (generation / maxGenerations) * 0.7;
  return genes.map(gene => {
    const m = { ...gene };
    const isBudgetLocked = lockedLines?.has(gene.lineItemId) || false;
    if (Math.random() < rate) m.marginPct = clamp(gene.marginPct + randBetween(-15, 15) * af, 5, 95);
    if (!isBudgetLocked && Math.random() < rate) m.budgetWeight = clamp(gene.budgetWeight + randBetween(-0.3, 0.3) * af, 0.01, 1);
    return m;
  });
}

// ============================================================
// OBJECTIFS
// ============================================================

export function buildDefaultObjectives(project: ProjectData, isFin: boolean, currSym: string): OptimizationObjective[] {
  const targetKpi = project.targetKpi || 0.0001;
  const cpmCap = project.cpmSoldCap || 100;
  return [
    { name: "Gain Total", emoji: "💰", weight: 1.0, direction: "maximize", evaluate: (sol) => sol.totalGainProjected, format: (v) => `${v.toFixed(0)} ${currSym}` },
    { name: "Respect KPI", emoji: "🎯", weight: 1.0, direction: "maximize",
      evaluate: (sol) => Math.min(1.0, isFin ? targetKpi / Math.max(sol.weightedKpi, 0.001) : sol.weightedKpi / Math.max(targetKpi, 0.001)),
      format: (v) => `${(v * 100).toFixed(0)}%` },
    { name: "Respect Cap CPM", emoji: "🛡️", weight: 0.8, direction: "maximize",
      evaluate: (sol) => { if (cpmCap <= 0) return 1.0; const r = sol.weightedCpmRevenue / cpmCap; return r <= 1.0 ? 1.0 : r <= 1.05 ? 0.8 : r <= 1.15 ? 0.4 : Math.max(0, 1 - (r - 1)); },
      format: (v) => v >= 0.95 ? "✅ OK" : v >= 0.7 ? "⚠️ Limite" : "❌ Dépassé" },
    { name: "Stabilité Budget", emoji: "📊", weight: 0.5, direction: "minimize", evaluate: (sol) => sol.budgetVariance, format: (v) => `±${v.toFixed(0)}%` },
    { name: "Rendement/Risque", emoji: "⚖️", weight: 0.7, direction: "maximize",
      evaluate: (sol) => { if (sol.totalGainProjected <= 0) return 0; const av = sol.lines.reduce((s, l) => s + (l.riskVolatility || 0.15), 0) / Math.max(1, sol.lines.length); return sol.totalGainProjected * riskAdjustMultiplier(av, 2.0); },
      format: (v) => `${v.toFixed(0)} ${currSym}` },
  ];
}

// ============================================================
// 🆕 V3.0 F : NORMALISATION BORNES FIXES
// ============================================================

function computeFixedBounds(
  objectives: OptimizationObjective[],
  _project: ProjectData,
  joursRestants: number,
  budgetJournalierDisponible: number,
  _isFin: boolean
): ObjectiveBounds[] {
  const budgetRemaining = budgetJournalierDisponible * joursRestants;
  return objectives.map(obj => {
    switch (obj.name) {
      case "Gain Total": return { min: 0, max: Math.max(1, budgetRemaining * 0.95) };
      case "Respect KPI": return { min: 0, max: 1.0 };
      case "Respect Cap CPM": return { min: 0, max: 1.0 };
      case "Stabilité Budget": return { min: 0, max: 200 };
      case "Rendement/Risque": return { min: 0, max: Math.max(1, budgetRemaining * 0.95) };
      default: return { min: 0, max: 1 };
    }
  });
}

function normalizeObjectivesGlobally(population: Individual[], fixedBounds?: ObjectiveBounds[]): void {
  if (population.length === 0) return;
  for (let m = 0; m < population[0].objectives.length; m++) {
    let min: number, max: number;
    if (fixedBounds && fixedBounds[m]) {
      min = fixedBounds[m].min;
      max = fixedBounds[m].max;
    } else {
      const values = population.map(ind => ind.objectives[m].normalizedValue);
      min = Math.min(...values);
      max = Math.max(...values);
    }
    const range = max - min;
    population.forEach(ind => {
      ind.objectives[m].normalizedValue = range === 0
        ? 0.5
        : Math.max(0, Math.min(1, (ind.objectives[m].normalizedValue - min) / range));
    });
  }
}

// ============================================================
// ÉVALUATION
// ============================================================

function evaluateIndividual(
  genes: Gene[], objectives: OptimizationObjective[], lineItems: LineItem[], project: ProjectData,
  joursEcoules: number, joursRestants: number, budgetJournalierDisponible: number,
  isFin: boolean, reachElasticity: number, lockedLines: Set<string>,
  agStats: ReturnType<typeof computeAdGroupStats>, constraints: HardConstraint[]
): { objectives: ObjectiveScore[]; resolved: ResolvedSolution; constraintViolation: number; violatedConstraints: string[] } {
  const resolved = resolveSolution(genes, lineItems, project, joursEcoules, joursRestants, budgetJournalierDisponible, isFin, reachElasticity, lockedLines, agStats, constraints);
  const scores: ObjectiveScore[] = objectives.map(obj => {
    const rawValue = obj.evaluate(resolved);
    const normalizedValue = obj.direction === "maximize" ? rawValue : obj.direction === "minimize" ? -rawValue : (() => { const t = obj.targetValue || 0; const tol = (obj.tolerancePct || 10) / 100; return Math.max(0, 1 - Math.abs(rawValue - t) / Math.max(t, 0.001) / tol); })();
    return { name: obj.name, value: rawValue, direction: obj.direction, targetValue: obj.targetValue, normalizedValue, displayValue: obj.format(rawValue), emoji: obj.emoji };
  });
  return { objectives: scores, resolved, constraintViolation: resolved.constraintViolation, violatedConstraints: resolved.violatedConstraints };
}

// ============================================================
// 🆕 V3.0 A : GRILLE DÉTERMINISTE (≤3 lignes)
// ============================================================

function createDeterministicGrid(
  lineItems: LineItem[], scenario: ParetoScenario,
  joursEcoules: number, lockedLines: Set<string>
): Gene[][] {
  const [minM, maxM] = scenario.marginRange;
  const population: Gene[][] = [];
  const marginSteps = [minM, minM + (maxM - minM) * 0.25, minM + (maxM - minM) * 0.5, minM + (maxM - minM) * 0.75, maxM];
  const budgetStrategies = ["equal", "perf", "inverse"] as const;
  const unlockedItems = lineItems.filter(li => !lockedLines.has(li.id));
  if (unlockedItems.length === 0) return [];

  const generateForMargins = (margins: number[]) => {
    for (const strat of budgetStrategies) {
      const genes: Gene[] = lineItems.map(li => {
        const isLocked = lockedLines.has(li.id);
        const dailyAvg = (li.spend || 0) / Math.max(1, joursEcoules);
        let bw = dailyAvg;
        if (!isLocked) {
          const unlockedIdx = unlockedItems.indexOf(li);
          if (strat === "equal") bw = dailyAvg;
          else if (strat === "perf") bw = dailyAvg * Math.max(0.1, 1 + (li.kpiActual || 0) * 0.1);
          else bw = dailyAvg * Math.max(0.2, 1 / Math.max(1, li.kpiActual || 1));
        }
        return {
          lineItemId: li.id,
          marginPct: isLocked ? clamp(li.marginPct, minM, maxM) : (margins[unlockedItems.indexOf(li)] ?? li.marginPct),
          budgetWeight: Math.max(0.01, bw),
        };
      });
      population.push(genes);
    }
  };

  if (unlockedItems.length === 1) {
    for (const m of marginSteps) generateForMargins([m]);
  } else if (unlockedItems.length === 2) {
    for (const m1 of marginSteps) for (const m2 of marginSteps) generateForMargins([m1, m2]);
  } else if (unlockedItems.length === 3) {
    for (const m1 of marginSteps) for (const m2 of marginSteps) for (const m3 of marginSteps)
      generateForMargins([m1, m2, m3]);
  }

  return population;
}

// ============================================================
// POPULATION INITIALE
// ============================================================

function createInitialPopulation(
  lineItems: LineItem[], project: ProjectData, joursEcoules: number,
  lockedLines: Set<string>, populationSize: number, currentMargin: number,
  scenario: ParetoScenario, warmStartGenes?: Gene[][]
): Gene[][] {
  const [minM, maxM] = scenario.marginRange;
  const population: Gene[][] = [];

  // 🆕 V3.0 A : Grille déterministe pour ≤3 lignes non-lockées
  const unlockedCount = lineItems.filter(li => !lockedLines.has(li.id)).length;
  if (unlockedCount <= 3 && unlockedCount > 0) {
    const grid = createDeterministicGrid(lineItems, scenario, joursEcoules, lockedLines);
    population.push(...grid);
    // Compléter avec du random si besoin
    while (population.length < populationSize) {
      population.push(lineItems.map(li => ({
        lineItemId: li.id,
        marginPct: clamp(li.marginPct + randBetween(-20, 20), minM, maxM),
        budgetWeight: Math.max(0.01, ((li.spend || 0) / Math.max(1, joursEcoules)) * randBetween(0.5, 2.0)),
      })));
    }
    return population.slice(0, populationSize);
  }

  // Seed 1: Current state
  population.push(lineItems.map(li => ({
    lineItemId: li.id,
    marginPct: clamp(li.marginPct, minM, maxM),
    budgetWeight: (li.spend || 0) / Math.max(1, joursEcoules)
  })));

  // Seeds variées marge
  population.push(lineItems.map(li => ({
    lineItemId: li.id,
    marginPct: clamp(li.marginPct + randBetween(5, 15), minM, maxM),
    budgetWeight: (li.spend || 0) / Math.max(1, joursEcoules)
  })));
  population.push(lineItems.map(li => ({
    lineItemId: li.id,
    marginPct: clamp(li.marginPct + randBetween(-5, 25), minM, maxM),
    budgetWeight: (li.spend || 0) / Math.max(1, joursEcoules)
  })));

  // 🆕 V3.0 E : Warm-start seeds
  if (warmStartGenes && warmStartGenes.length > 0) {
    const maxWarmStart = Math.floor(populationSize * 0.20);
    const validWarm = warmStartGenes
      .map(genes => genes.filter(g => lineItems.some(li => li.id === g.lineItemId)))
      .filter(genes => genes.length === lineItems.length)
      .slice(0, maxWarmStart);
    population.push(...validWarm);
  }

  // Seeds stratégiques adaptées au scénario
  const strategies = scenario.id === "aggressive"
    ? [{ mm: 1.8, bias: "performance" as const }, { mm: 2.5, bias: "stars" as const }, { mm: 1.4, bias: "even" as const }, { mm: 3.0, bias: "stars" as const }]
    : scenario.id === "safe"
      ? [{ mm: 1.05, bias: "performance" as const }, { mm: 1.1, bias: "even" as const }, { mm: 1.15, bias: "performance" as const }, { mm: 0.95, bias: "performance" as const }]
      : [{ mm: 1.8, bias: "performance" as const }, { mm: 1.15, bias: "even" as const }, { mm: 0.85, bias: "performance" as const }, { mm: 2.5, bias: "stars" as const }, { mm: 1.4, bias: "even" as const }];

  for (const strat of strategies) {
    const isFin = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
    const target = project.targetKpi || 0.001;
    population.push(lineItems.map(li => {
      const perfRatio = isFin ? (li.kpiActual > 0 ? target / li.kpiActual : 0.5) : (li.kpiActual / Math.max(target, 0.001));
      let mm = strat.mm; if (perfRatio > 1.0) mm *= 1.2; else if (perfRatio < 0.5) mm *= 0.6;
      let bw = (li.spend || 0) / Math.max(1, joursEcoules);
      if (strat.bias === "performance") bw *= Math.max(0.1, perfRatio);
      else if (strat.bias === "stars" && perfRatio > 1.0) bw *= 2.0;
      return { lineItemId: li.id, marginPct: clamp(li.marginPct * mm, minM, maxM), budgetWeight: Math.max(0.01, bw) };
    }));
  }

  // Random
  const marginSpread = scenario.id === "aggressive" ? 35 : scenario.id === "safe" ? 10 : 25;
  while (population.length < populationSize) {
    population.push(lineItems.map(li => {
      const da = (li.spend || 0) / Math.max(1, joursEcoules);
      return { lineItemId: li.id, marginPct: clamp(li.marginPct + randBetween(-marginSpread, marginSpread), minM, maxM), budgetWeight: Math.max(0.01, da * randBetween(0.3, 2.5)) };
    }));
  }
  return population.slice(0, populationSize);
}

// ============================================================
// 🆕 V3.0 B : SCORING DE RECOMMANDATION INTELLIGENT
// ============================================================

function computeRecommendationScore(
  sol: ParetoSolution,
  objectives: OptimizationObjective[],
  scenario: ParetoScenario
): number {
  let score = 0;

  // 1. Gain delta positif (25 pts max)
  score += (sol.resolved.gainDeltaVsCurrent > 0 ? 1 : 0) * 25;

  // 2. Respect KPI — poids dépend du scénario
  const kpiObj = sol.objectives.find(o => o.name === "Respect KPI");
  if (kpiObj) {
    const kpiWeight = scenario.id === "boost_kpi" ? 40 : scenario.id === "aggressive" ? 15 : 30;
    score += (kpiObj.value || 0) * kpiWeight;
  }

  // 3. Respect Cap
  const capObj = sol.objectives.find(o => o.name === "Respect Cap CPM");
  if (capObj) {
    const capWeight = scenario.cpmCapStrict ? 20 : 10;
    score += (capObj.value || 0) * capWeight;
  }

  // 4. Gain absolu normalisé (20 pts max)
  const gainObj = sol.objectives.find(o => o.name === "Gain Total");
  if (gainObj && gainObj.value > 0) {
    score += Math.min(20, gainObj.normalizedValue * 20);
  }

  // 5. Stabilité (5 pts bonus)
  if (sol.resolved.budgetVariance < 30) score += 5;

  // 6. Pénalité contraintes
  if (sol.resolved.constraintViolation > 0) score -= 50;

  // 7. Bonus/malus marge stable selon scénario
  if (sol.resolved.isMarginLocked && scenario.id === "safe") score += 10;
  if (sol.resolved.isMarginLocked && scenario.id === "aggressive") score -= 5;

  return score;
}

// ============================================================
// 🆕 V3.0 B : LABELING (sans recommended forcé)
// ============================================================

function labelSolution(
  sol: ParetoSolution, objectives: ObjectiveScore[],
  project: ProjectData, isFin: boolean, currentMargin: number, currSym: string
): void {
  const margin = sol.resolved.weightedMargin;
  const kpiScore = objectives.find(o => o.name === "Respect KPI")?.value || 0;
  const capScore = objectives.find(o => o.name === "Respect Cap CPM")?.value || 0;
  const delta = sol.resolved.gainDeltaVsCurrent;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(0)} ${currSym} vs actuel` : `${delta.toFixed(0)} ${currSym} vs actuel`;
  sol.tags = [];

  if (sol.resolved.constraintViolation > 0) {
    sol.tags.push("constraint-violated");
    for (const c of sol.resolved.violatedConstraints) {
      if (c === "KPI Max Degradation") sol.tags.push("kpi-risk");
      if (c === "CPM Cap Strict") sol.tags.push("cap-exceeded");
    }
  }

  if (sol.resolved.isMarginLocked) sol.tags.push("margin-locked");
  if (margin > currentMargin * 1.4) sol.tags.push("high-margin");
  if (margin < currentMargin * 1.1) sol.tags.push("conservative");
  if (kpiScore > 0.8 && !sol.tags.includes("kpi-risk")) sol.tags.push("kpi-safe");
  if (kpiScore < 0.5 && !sol.tags.includes("kpi-risk")) sol.tags.push("kpi-risk");
  if (capScore > 0.9 && !sol.tags.includes("cap-exceeded")) sol.tags.push("cap-safe");
  if (sol.resolved.budgetVariance < 20) sol.tags.push("stable");
  if (delta < 0) sol.tags.push("loss-vs-current");
  if (delta > 0) sol.tags.push("gain-vs-current");
  if ((sol.resolved.cutLines || 0) > 0) sol.tags.push("has-cuts");

  if (sol.resolved.isMarginLocked) {
    sol.label = "🔒 Marge Stable";
    const cutInfo = (sol.resolved.cutLines || 0) > 0
      ? ` — ${sol.resolved.cutLines} ligne(s) coupée(s), ${sol.resolved.freedBudgetPct?.toFixed(0)}% redistribué`
      : "";
    sol.description = `Marge ${margin.toFixed(0)}% INCHANGÉE — ${deltaStr}${cutInfo}`;
  } else if (sol.tags.includes("high-margin") && sol.tags.includes("kpi-safe")) {
    sol.label = "🏆 Meilleur Compromis";
    sol.description = `Marge ${margin.toFixed(0)}% — ${deltaStr} — KPI confortable`;
  } else if (sol.tags.includes("high-margin") && sol.tags.includes("kpi-risk")) {
    sol.label = "🔥 Rentabilité Maximum";
    sol.description = `Marge max ${margin.toFixed(0)}% — ${deltaStr} — KPI à la limite`;
  } else if (sol.tags.includes("conservative") && sol.tags.includes("kpi-safe")) {
    sol.label = "🛡️ Conservateur";
    sol.description = `Marge ${margin.toFixed(0)}% prudente — ${deltaStr}`;
  } else if (sol.tags.includes("kpi-safe") && sol.tags.includes("cap-safe")) {
    sol.label = "✅ Safe & Compliant";
    sol.description = `Marge ${margin.toFixed(0)}% — ${deltaStr} — KPI + Cap OK`;
  } else if (sol.tags.includes("stable")) {
    sol.label = "📊 Stable";
    sol.description = `Marge ${margin.toFixed(0)}% — ${deltaStr}`;
  } else {
    sol.label = "⚖️ Équilibré";
    sol.description = `Marge ${margin.toFixed(0)}% — ${deltaStr}`;
  }

  // 🆕 V3.0 B : recommended sera assigné dans selectRepresentativeSolutions
  sol.recommended = false;
}

// ============================================================
// 🆕 V3.0 C : RELAXATION HINTS
// ============================================================

function computeRelaxationHints(
  population: Individual[],
  constraints: HardConstraint[],
  scenario: ParetoScenario,
  _project: ProjectData,
  _isFin: boolean,
  _currSym: string,
  feasibleCount: number
): RelaxedConstraintInfo[] {
  if (feasibleCount >= 3) return [];
  const hints: RelaxedConstraintInfo[] = [];
  const infeasible = population.filter(ind => ind.constraintViolation > 0);
  if (infeasible.length === 0) return [];

  for (const constraint of constraints) {
    const nearFeasible = infeasible.filter(ind => {
      if (!ind.violatedConstraints.includes(constraint.name)) return false;
      return ind.violatedConstraints.length <= 2;
    });
    if (nearFeasible.length === 0) continue;

    const bestNearFeasible = nearFeasible.sort((a, b) => {
      const gainA = a.objectives.find(o => o.name === "Gain Total")?.value || 0;
      const gainB = b.objectives.find(o => o.name === "Gain Total")?.value || 0;
      return gainB - gainA;
    })[0];
    const bestGain = bestNearFeasible.objectives.find(o => o.name === "Gain Total")?.value || 0;

    let originalLimit = "", relaxedLimit = "", costDescription = "";
    if (constraint.name === "KPI Max Degradation") {
      const pct = scenario.maxKpiDegradationPct;
      const relaxedPct = pct * 1.5;
      originalLimit = `±${(pct * 100).toFixed(0)}%`;
      relaxedLimit = `±${(relaxedPct * 100).toFixed(0)}%`;
      costDescription = `Accepter ${(relaxedPct * 100).toFixed(0)}% de dégradation KPI au lieu de ${(pct * 100).toFixed(0)}%`;
    } else if (constraint.name === "CPM Cap Strict") {
      const tol = scenario.cpmCapTolerancePct;
      const relaxedTol = Math.max(tol + 0.05, tol * 1.5);
      originalLimit = `+${(tol * 100).toFixed(0)}%`;
      relaxedLimit = `+${(relaxedTol * 100).toFixed(0)}%`;
      costDescription = `Tolérer +${(relaxedTol * 100).toFixed(0)}% sur le Cap CPM au lieu de +${(tol * 100).toFixed(0)}%`;
    } else {
      continue;
    }

    hints.push({
      constraintName: constraint.name,
      originalLimit, relaxedLimit,
      additionalSolutionsCount: nearFeasible.length,
      bestGainIfRelaxed: bestGain,
      costDescription,
    });
  }
  return hints.sort((a, b) => b.additionalSolutionsCount - a.additionalSolutionsCount);
}

// ============================================================
// SÉLECTION REPRÉSENTATIVE
// ============================================================

function selectRepresentativeSolutions(
  front: Individual[], maxSolutions: number, objectives: OptimizationObjective[],
  lineItems: LineItem[], project: ProjectData,
  joursEcoules: number, joursRestants: number, budgetJournalierDisponible: number,
  isFin: boolean, reachElasticity: number, lockedLines: Set<string>,
  currentMargin: number, currSym: string, agStats: ReturnType<typeof computeAdGroupStats>,
  fixedMarginSolution: ResolvedSolution | null, constraints: HardConstraint[],
  scenario: ParetoScenario
): ParetoSolution[] {
  const slotsForPareto = fixedMarginSolution ? maxSolutions - 1 : maxSolutions;
  const solutions: ParetoSolution[] = [];

  if (fixedMarginSolution) {
    const fixedObjectives: ObjectiveScore[] = objectives.map(obj => ({
      name: obj.name, value: obj.evaluate(fixedMarginSolution!), direction: obj.direction,
      normalizedValue: obj.evaluate(fixedMarginSolution!), displayValue: obj.format(obj.evaluate(fixedMarginSolution!)), emoji: obj.emoji,
    }));
    const fixedSol: ParetoSolution = { id: "pareto_fixed_margin", label: "", description: "", resolved: fixedMarginSolution, objectives: fixedObjectives, rank: 0, tags: [], recommended: false };
    labelSolution(fixedSol, fixedObjectives, project, isFin, currentMargin, currSym);
    solutions.push(fixedSol);
  }

  const feasibleFront = front.filter(ind => ind.constraintViolation === 0);
  const actualFront = feasibleFront.length > 0 ? feasibleFront : front.slice(0, Math.min(3, front.length));

  const selected: Set<number> = new Set();
  if (actualFront.length <= slotsForPareto) {
    actualFront.forEach((_, idx) => selected.add(idx));
  } else {
    for (let m = 0; m < objectives.length && selected.size < slotsForPareto; m++) {
      let bestIdx = 0, bestVal = -Infinity;
      actualFront.forEach((ind, idx) => { if (!selected.has(idx) && ind.objectives[m].normalizedValue > bestVal) { bestVal = ind.objectives[m].normalizedValue; bestIdx = idx; } });
      selected.add(bestIdx);
    }
    if (selected.size < slotsForPareto) {
      let bestIdx = 0, bestW = -Infinity;
      actualFront.forEach((ind, idx) => { if (selected.has(idx)) return; const w = ind.objectives.reduce((s, o, m2) => s + o.normalizedValue * objectives[m2].weight, 0); if (w > bestW) { bestW = w; bestIdx = idx; } });
      selected.add(bestIdx);
    }
    const remaining = actualFront.map((ind, idx) => ({ ind, idx })).filter(({ idx }) => !selected.has(idx)).sort((a, b) => b.ind.crowdingDistance - a.ind.crowdingDistance);
    for (const { idx } of remaining) { if (selected.size >= slotsForPareto) break; selected.add(idx); }
  }

  let solIdx = 0;
  for (const idx of selected) {
    const ind = actualFront[idx];
    const resolved = resolveSolution(ind.genes, lineItems, project, joursEcoules, joursRestants, budgetJournalierDisponible, isFin, reachElasticity, lockedLines, agStats, constraints);
    const sol: ParetoSolution = { id: `pareto_${solIdx++}`, label: "", description: "", resolved, objectives: ind.objectives, rank: ind.rank, tags: [], recommended: false };
    labelSolution(sol, ind.objectives, project, isFin, currentMargin, currSym);
    solutions.push(sol);
  }

  // Tri : marge stable d'abord, puis faisables, puis gain
  solutions.sort((a, b) => {
    if (a.resolved.isMarginLocked && !b.resolved.isMarginLocked) return -1;
    if (!a.resolved.isMarginLocked && b.resolved.isMarginLocked) return 1;
    if (a.resolved.constraintViolation === 0 && b.resolved.constraintViolation > 0) return -1;
    if (a.resolved.constraintViolation > 0 && b.resolved.constraintViolation === 0) return 1;
    return b.resolved.totalGainProjected - a.resolved.totalGainProjected;
  });

  // 🆕 V3.0 B : Recommandation par scoring composite
  const feasibleSolutions = solutions.filter(s => s.resolved.constraintViolation === 0);
  if (feasibleSolutions.length > 0) {
    let bestScore = -Infinity;
    let bestSol: ParetoSolution | null = null;
    for (const sol of feasibleSolutions) {
      const score = computeRecommendationScore(sol, objectives, scenario);
      if (score > bestScore) { bestScore = score; bestSol = sol; }
    }
    if (bestSol) {
      bestSol.recommended = true;
      if (!bestSol.resolved.isMarginLocked) {
        bestSol.label = `⭐ ${bestSol.label}`;
      }
    }
  } else if (solutions.length > 0) {
    solutions.sort((a, b) => a.resolved.constraintViolation - b.resolved.constraintViolation);
    solutions[0].recommended = true;
    solutions[0].label = `⚠️ ${solutions[0].label} (meilleur compromis)`;
  }

  return solutions;
}

// ============================================================
// 🏆 FONCTION PRINCIPALE — V3.0
// ============================================================

export function paretoOptimize(
  project: ProjectData, lineItems: LineItem[], lockedLines: Set<string>,
  currentMargin: number, isFin: boolean, reachElasticity: number, currSym: string,
  customObjectives?: OptimizationObjective[], customConfig?: Partial<ParetoConfig>,
  scenarioId?: ScenarioId,
  warmStartGenes?: Gene[][]
): ParetoResult {
  const scenario = PARETO_SCENARIOS[scenarioId || "balanced"];

  // 🆕 V3.0 A : Adaptive population sizing
  const nLines = lineItems.length;
  const adaptiveConfig = (() => {
    if (nLines <= 3) return { populationSize: 40, generations: 20, mutationRate: 0.08, crossoverRate: 0.9, elitismRate: 0.15, maxSolutions: 4 };
    if (nLines <= 6) return { populationSize: 80, generations: 40, mutationRate: 0.12, crossoverRate: 0.85, elitismRate: 0.12, maxSolutions: 5 };
    if (nLines <= 12) return { populationSize: 120, generations: 60, mutationRate: 0.15, crossoverRate: 0.85, elitismRate: 0.10, maxSolutions: 5 };
    return { populationSize: 180, generations: 90, mutationRate: 0.20, crossoverRate: 0.80, elitismRate: 0.08, maxSolutions: 6 };
  })();
  const config = { ...DEFAULT_CONFIG, ...adaptiveConfig, ...(scenario.configOverride || {}), ...customConfig };

  const objectives = customObjectives || buildDefaultObjectives(project, isFin, currSym);
  const constraints = buildHardConstraints(project, isFin, scenario);

  const now = new Date();
  const startDate = project.startDate ? new Date(project.startDate) : now;
  const joursEcoules = Math.max(1, Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const joursRestants = Math.max(1, project.durationDays - joursEcoules);
  const budgetJournalierDisponible = (project.budgetTotal - project.budgetSpent) / joursRestants;
  if (lineItems.length === 0) return { solutions: [], frontGenes: [] };

  // 🆕 V3.0 F : Bornes fixes
  const fixedBounds = computeFixedBounds(objectives, project, joursRestants, budgetJournalierDisponible, isFin);

  console.log(`🏆 Pareto V3.0 [${scenario.label}]: ${config.populationSize} pop × ${config.generations} gen, ${lineItems.length} lines, ${constraints.length} constraints, ${lockedLines.size} budget-locked, warmStart=${warmStartGenes?.length || 0}`);
  const t0 = performance.now();
  const agStats = computeAdGroupStats(project);

  // Solution Marge Stable (toujours)
  const fixedMarginSolution = optimizeFixedMargin(lineItems, project, lockedLines, joursEcoules, joursRestants, budgetJournalierDisponible, isFin, reachElasticity, agStats, currSym);

  // Si scénario boost_kpi → only return fixed margin
  if (scenario.id === "boost_kpi") {
    const fixedObjectives: ObjectiveScore[] = objectives.map(obj => ({
      name: obj.name, value: obj.evaluate(fixedMarginSolution), direction: obj.direction,
      normalizedValue: obj.evaluate(fixedMarginSolution), displayValue: obj.format(obj.evaluate(fixedMarginSolution)), emoji: obj.emoji,
    }));
    const sol: ParetoSolution = { id: "pareto_boost_kpi", label: "🚀 Boost KPI", description: "", resolved: fixedMarginSolution, objectives: fixedObjectives, rank: 0, tags: ["margin-locked", "kpi-safe"], recommended: true };
    sol.description = `Redistribution budget optimale — Marge ${fixedMarginSolution.weightedMargin.toFixed(0)}% INCHANGÉE`;
    if ((fixedMarginSolution.cutLines || 0) > 0) sol.description += ` — ${fixedMarginSolution.cutLines} ligne(s) coupée(s)`;
    return { solutions: [sol], frontGenes: [] };
  }

  // NSGA-II avec contraintes
  const initialGenes = createInitialPopulation(lineItems, project, joursEcoules, lockedLines, config.populationSize, currentMargin, scenario, warmStartGenes);
  let population: Individual[] = initialGenes.map(genes => {
    const repairedGenes = repairGenes(genes, scenario, lockedLines);
    const { objectives: scores, constraintViolation, violatedConstraints } = evaluateIndividual(repairedGenes, objectives, lineItems, project, joursEcoules, joursRestants, budgetJournalierDisponible, isFin, reachElasticity, lockedLines, agStats, constraints);
    return { genes: repairedGenes, objectives: scores, rank: 0, crowdingDistance: 0, constraintViolation, violatedConstraints };
  });
  normalizeObjectivesGlobally(population, fixedBounds);

  for (let gen = 0; gen < config.generations; gen++) {
    const children: Individual[] = [];
    while (children.length < config.populationSize) {
      const [cg1, cg2] = crossover(tournamentSelect(population).genes, tournamentSelect(population).genes, config.crossoverRate, lockedLines);
      for (const rawGenes of [mutate(cg1, config.mutationRate, gen, config.generations, lockedLines), mutate(cg2, config.mutationRate, gen, config.generations, lockedLines)]) {
        const repairedGenes = repairGenes(rawGenes, scenario, lockedLines);
        const { objectives: scores, constraintViolation, violatedConstraints } = evaluateIndividual(repairedGenes, objectives, lineItems, project, joursEcoules, joursRestants, budgetJournalierDisponible, isFin, reachElasticity, lockedLines, agStats, constraints);
        children.push({ genes: repairedGenes, objectives: scores, rank: 0, crowdingDistance: 0, constraintViolation, violatedConstraints });
      }
    }
    const combined = [...population, ...children.slice(0, config.populationSize)];
    normalizeObjectivesGlobally(combined, fixedBounds);
    const fronts = nonDominatedSort(combined);
    const newPop: Individual[] = [];
    for (const front of fronts) {
      if (newPop.length + front.length <= config.populationSize) { assignCrowdingDistance(front); newPop.push(...front); }
      else { assignCrowdingDistance(front); front.sort((a, b) => b.crowdingDistance - a.crowdingDistance); newPop.push(...front.slice(0, config.populationSize - newPop.length)); break; }
    }
    population = newPop;
  }

  normalizeObjectivesGlobally(population, fixedBounds);
  const finalFronts = nonDominatedSort(population);
  const paretoFront = finalFronts[0] || [];
  assignCrowdingDistance(paretoFront);

  const t1 = performance.now();
  const feasibleCount = paretoFront.filter(ind => ind.constraintViolation === 0).length;
  console.log(`🏆 Pareto V3.0: ${paretoFront.length} front (${feasibleCount} feasible) in ${(t1 - t0).toFixed(0)}ms`);

  // 🆕 V3.0 C : Relaxation hints
  const relaxationHints = computeRelaxationHints(population, constraints, scenario, project, isFin, currSym, feasibleCount);

  // 🆕 V3.0 E : Extraire les gènes du front pour warm-start
  const frontGenes = paretoFront.map(ind => structuredClone(ind.genes));

  const results = selectRepresentativeSolutions(
    paretoFront, config.maxSolutions, objectives, lineItems, project,
    joursEcoules, joursRestants, budgetJournalierDisponible,
    isFin, reachElasticity, lockedLines, currentMargin, currSym, agStats,
    fixedMarginSolution, constraints, scenario
  );

  // Attacher les relaxation hints à toutes les solutions
  if (relaxationHints.length > 0) {
    results.forEach(sol => { sol.relaxationHints = relaxationHints; });
  }

  return { solutions: results, frontGenes };
}

// ============================================================
// WHAT-IF API
// ============================================================

export function whatIfPreview(
  lineItems: LineItem[], project: ProjectData, lockedLines: Set<string>,
  marginOverrides: Record<string, number>,
  budgetOverrides: Record<string, number>,
  isFin: boolean, reachElasticity: number,
  scenarioId?: ScenarioId
): ResolvedSolution {
  const now = new Date();
  const startDate = project.startDate ? new Date(project.startDate) : now;
  const joursEcoules = Math.max(1, Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const joursRestants = Math.max(1, project.durationDays - joursEcoules);
  const budgetJournalierDisponible = (project.budgetTotal - project.budgetSpent) / joursRestants;
  const agStats = computeAdGroupStats(project);
  const scenario = PARETO_SCENARIOS[scenarioId || "balanced"];
  const constraints = buildHardConstraints(project, isFin, scenario);

  const genes: Gene[] = lineItems.map(li => ({
    lineItemId: li.id,
    marginPct: marginOverrides[li.id] ?? li.marginPct,
    budgetWeight: budgetOverrides[li.id] ?? ((li.spend || 0) / Math.max(1, joursEcoules)),
  }));

  return resolveSolution(genes, lineItems, project, joursEcoules, joursRestants, budgetJournalierDisponible, isFin, reachElasticity, lockedLines, agStats, constraints);
}

// ============================================================
// HELPER
// ============================================================

export function paretoSolutionToLineItems(solution: ParetoSolution, originalLineItems: LineItem[], joursRestants: number): LineItem[] {
  return solution.resolved.lines.map(line => {
    const original = originalLineItems.find(li => li.id === line.lineItemId);
    if (!original) return original!;
    return {
      ...original,
      marginPct: Math.round(line.newMargin * 100) / 100,
      cpmRevenue: Math.round(line.newCpmRevenue * 100) / 100,
      spend: Math.round(line.newDailyBudget * joursRestants * 100) / 100,
    };
  }).filter(Boolean);
}
