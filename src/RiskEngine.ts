// ============================================================
// RISK ENGINE — Backtest, Risk Controls, Data Quality, Stress Test, Audit Trail
// ============================================================

import { ProjectData, DailyEntry } from "./types";

// ===== TYPES =====

export interface BacktestResult {
  period: string;
  actualMargin: number;
  simulatedMargin: number;
  actualKpi: number;
  simulatedKpi: number;
  actualGain: number;
  simulatedGain: number;
  deltaGain: number;
  recommendation: string;
}

export interface RiskAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  category: "daily_loss" | "position_limit" | "pacing" | "margin_floor" | "kpi_drift";
  title: string;
  message: string;
  value: number;
  threshold: number;
  timestamp: number;
}

export interface DataQualityIssue {
  field: string;
  day: string;
  issue: string;
  severity: "warning" | "error";
  value: number | string;
}

export interface StressScenario {
  name: string;
  cpmRevenueShock: number; // % change
  projectedMargin: number;
  projectedKpi: number;
  projectedGain: number;
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface AuditEntry {
  timestamp: number;
  action: string;
  field: string;
  oldValue: string;
  newValue: string;
  projectedImpact: string;
  actualOutcome?: string;
}

// ===== 1. BACKTEST =====

export function runBacktest(project: ProjectData, windowDays: number = 7): BacktestResult[] {
  const entries = project.dailyEntries || [];
  if (entries.length < windowDays * 2) return [];

  const results: BacktestResult[] = [];
  const currentMargin = project.cpmRevenueActual > 0
    ? ((project.cpmRevenueActual - project.cpmCostActuel) / project.cpmRevenueActual) * 100
    : 0;

  // Slide window: for each period, compare actual vs what would have happened with +3pt margin
  for (let i = windowDays; i <= entries.length - windowDays; i += windowDays) {
    const window = entries.slice(i, i + windowDays);
    const prevWindow = entries.slice(i - windowDays, i);

    const avgSpend = window.reduce((s, e) => s + (e.budgetSpent || 0), 0) / window.length;
    const avgKpi = window.reduce((s, e) => s + (e.kpiActual || 0), 0) / window.length;
    const avgMargin = window.reduce((s, e) => s + (e.marginPct || currentMargin), 0) / window.length;
    const prevAvgMargin = prevWindow.reduce((s, e) => s + (e.marginPct || currentMargin), 0) / prevWindow.length;

    // Simulate: if margin had been +3pts higher
    const simMargin = avgMargin + 3;
    const elasticity = -0.05; // conservative estimate
    const simKpiDelta = 3 * elasticity;
    const simKpi = avgKpi * (1 + simKpiDelta);
    const actualGain = avgSpend * windowDays * (avgMargin / 100);
    const simGain = avgSpend * windowDays * (simMargin / 100);

    const startDate = window[0]?.date || `J${i}`;
    const endDate = window[window.length - 1]?.date || `J${i + windowDays}`;

    results.push({
      period: `${startDate} → ${endDate}`,
      actualMargin: avgMargin,
      simulatedMargin: simMargin,
      actualKpi: avgKpi,
      simulatedKpi: simKpi,
      actualGain: actualGain,
      simulatedGain: simGain,
      deltaGain: simGain - actualGain,
      recommendation: simGain > actualGain && simKpi <= (project.targetKpi * 1.1)
        ? "Marge +3pts aurait ete profitable"
        : "Marge actuelle etait optimale",
    });
  }

  return results;
}

// ===== 2. RISK CONTROLS =====

export function checkRiskControls(project: ProjectData): RiskAlert[] {
  const alerts: RiskAlert[] = [];
  const entries = project.dailyEntries || [];
  const now = Date.now();

  // A. Daily loss detection
  if (entries.length >= 2) {
    const last = entries[entries.length - 1];
    const prev = entries[entries.length - 2];
    const lastMargin = last.marginPct || 0;
    const prevMargin = prev.marginPct || 0;
    const dailyLoss = prevMargin - lastMargin;

    if (dailyLoss > 5) {
      alerts.push({
        id: `daily_loss_${now}`,
        severity: dailyLoss > 10 ? "critical" : "warning",
        category: "daily_loss",
        title: "Perte de marge journaliere",
        message: `Marge en baisse de ${dailyLoss.toFixed(1)} pts en 1 jour (${prevMargin.toFixed(1)}% → ${lastMargin.toFixed(1)}%)`,
        value: dailyLoss,
        threshold: 5,
        timestamp: now,
      });
    }
  }

  // B. Position limit — budget concentration
  const totalBudget = project.budgetTotal || 0;
  const spent = project.budgetSpent || 0;
  const pctSpent = totalBudget > 0 ? (spent / totalBudget) * 100 : 0;

  // Check if remaining days can sustain remaining budget
  const endDate = project.endDate ? new Date(project.endDate) : null;
  const daysLeft = endDate ? Math.max(1, Math.ceil((endDate.getTime() - now) / 86400000)) : 15;
  const remainingBudget = totalBudget - spent;
  const requiredDailySpend = remainingBudget / daysLeft;
  const avgDailySpend = entries.length > 0
    ? entries.reduce((s, e) => s + (e.budgetSpent || 0), 0) / entries.length
    : 0;

  if (avgDailySpend > 0 && requiredDailySpend > avgDailySpend * 1.5) {
    alerts.push({
      id: `pacing_risk_${now}`,
      severity: requiredDailySpend > avgDailySpend * 2 ? "critical" : "warning",
      category: "pacing",
      title: "Risque de sous-pacing",
      message: `Il faut depenser ${requiredDailySpend.toFixed(0)}€/jour pour finir le budget, mais la moyenne est de ${avgDailySpend.toFixed(0)}€/jour`,
      value: requiredDailySpend,
      threshold: avgDailySpend * 1.5,
      timestamp: now,
    });
  }

  // C. Margin floor alert
  const currentMargin = project.cpmRevenueActual > 0
    ? ((project.cpmRevenueActual - project.cpmCostActuel) / project.cpmRevenueActual) * 100
    : 0;

  if (currentMargin < 15) {
    alerts.push({
      id: `margin_floor_${now}`,
      severity: currentMargin < 10 ? "critical" : "warning",
      category: "margin_floor",
      title: "Marge sous le plancher",
      message: `Marge actuelle ${currentMargin.toFixed(1)}% est sous le seuil minimum de 15%`,
      value: currentMargin,
      threshold: 15,
      timestamp: now,
    });
  }

  // D. KPI drift — compare last 3 days vs target
  if (entries.length >= 3) {
    const last3 = entries.slice(-3);
    const avgKpi = last3.reduce((s, e) => s + (e.kpiActual || 0), 0) / 3;
    const target = project.targetKpi || 0;
    const isFin = ["CPA", "CPV", "CPC", "CPCV", "CPL", "CPI"].includes(project.kpiType);

    const kpiOk = isFin ? avgKpi <= target : avgKpi >= target;
    const drift = isFin ? ((avgKpi - target) / target) * 100 : ((target - avgKpi) / target) * 100;

    if (!kpiOk && Math.abs(drift) > 15) {
      alerts.push({
        id: `kpi_drift_${now}`,
        severity: Math.abs(drift) > 30 ? "critical" : "warning",
        category: "kpi_drift",
        title: "Derive KPI",
        message: `${project.kpiType} moyen 3 derniers jours: ${avgKpi.toFixed(2)} vs objectif ${target.toFixed(2)} (ecart ${drift.toFixed(0)}%)`,
        value: avgKpi,
        threshold: target,
        timestamp: now,
      });
    }
  }

  return alerts;
}

// ===== 3. DATA QUALITY =====

export function validateDataQuality(project: ProjectData): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  const entries = project.dailyEntries || [];

  entries.forEach((entry, idx) => {
    const day = entry.date || `Jour ${idx + 1}`;

    // Negative spend
    if ((entry.budgetSpent || 0) < 0) {
      issues.push({ field: "budgetSpent", day, issue: "Spend negatif", severity: "error", value: entry.budgetSpent });
    }

    // Zero spend on active day
    if (entry.budgetSpent === 0 && idx < entries.length - 1) {
      issues.push({ field: "budgetSpent", day, issue: "Spend a zero (jour actif)", severity: "warning", value: 0 });
    }

    // Impossible CPM (> 50€ or < 0)
    if (entry.cpmRev !== undefined && (entry.cpmRev > 50 || entry.cpmRev < 0)) {
      issues.push({ field: "cpmRev", day, issue: `CPM Revenue anormal: ${entry.cpmRev}`, severity: "error", value: entry.cpmRev });
    }

    // Negative margin
    if (entry.marginPct !== undefined && entry.marginPct < -10) {
      issues.push({ field: "marginPct", day, issue: `Marge negative: ${entry.marginPct}%`, severity: "error", value: entry.marginPct });
    }

    // Margin > 80% (suspicious)
    if (entry.marginPct !== undefined && entry.marginPct > 80) {
      issues.push({ field: "marginPct", day, issue: `Marge anormalement haute: ${entry.marginPct}%`, severity: "warning", value: entry.marginPct });
    }

    // KPI = 0 with spend > 0
    if ((entry.kpiActual === 0 || entry.kpiActual === undefined) && (entry.budgetSpent || 0) > 0) {
      issues.push({ field: "kpiActual", day, issue: "KPI a zero avec du spend", severity: "warning", value: 0 });
    }

    // Spike detection: spend > 3x average
    if (entries.length >= 5 && idx >= 3) {
      const prevAvg = entries.slice(Math.max(0, idx - 5), idx).reduce((s, e) => s + (e.budgetSpent || 0), 0) / Math.min(5, idx);
      if (prevAvg > 0 && (entry.budgetSpent || 0) > prevAvg * 3) {
        issues.push({ field: "budgetSpent", day, issue: `Spike de spend: ${entry.budgetSpent}€ vs moyenne ${prevAvg.toFixed(0)}€`, severity: "warning", value: entry.budgetSpent || 0 });
      }
    }

    // Date validation
    if (entry.date) {
      const d = new Date(entry.date);
      if (isNaN(d.getTime())) {
        issues.push({ field: "date", day, issue: "Date invalide", severity: "error", value: entry.date });
      }
    }
  });

  // Global checks
  if (project.cpmCostActuel > project.cpmRevenueActual && project.cpmRevenueActual > 0) {
    issues.push({ field: "cpmCost", day: "Global", issue: `CPM Cost (${project.cpmCostActuel}) > CPM Revenue (${project.cpmRevenueActual})`, severity: "error", value: project.cpmCostActuel });
  }

  if (project.budgetSpent > project.budgetTotal && project.budgetTotal > 0) {
    issues.push({ field: "budget", day: "Global", issue: `Budget depense (${project.budgetSpent}) > Budget total (${project.budgetTotal})`, severity: "error", value: project.budgetSpent });
  }

  return issues;
}

// ===== 4. STRESS TEST =====

export function runStressTest(project: ProjectData): StressScenario[] {
  const currentMargin = project.cpmRevenueActual > 0
    ? ((project.cpmRevenueActual - project.cpmCostActuel) / project.cpmRevenueActual) * 100
    : 0;
  const currentGainPerDay = (project.budgetTotal > 0 && project.durationDays > 0)
    ? (project.budgetTotal / project.durationDays) * (currentMargin / 100)
    : 0;
  const daysLeft = project.endDate
    ? Math.max(1, Math.ceil((new Date(project.endDate).getTime() - Date.now()) / 86400000))
    : 15;
  const cost = project.cpmCostActuel;

  const shocks = [
    { name: "CPM Revenue -5%", pct: -5 },
    { name: "CPM Revenue -10%", pct: -10 },
    { name: "CPM Revenue -20%", pct: -20 },
    { name: "CPM Revenue -30%", pct: -30 },
    { name: "CPM Revenue +10%", pct: 10 },
    { name: "CPM Revenue +20%", pct: 20 },
  ];

  return shocks.map(s => {
    const newRevenue = project.cpmRevenueActual * (1 + s.pct / 100);
    const newMargin = newRevenue > 0 ? ((newRevenue - cost) / newRevenue) * 100 : 0;
    const newGainPerDay = (project.budgetTotal / Math.max(project.durationDays, 1)) * (newMargin / 100);
    const projectedGain = newGainPerDay * daysLeft;

    // KPI impact: rough estimate based on margin change
    const marginDelta = newMargin - currentMargin;
    const kpiImpact = 1 + marginDelta * 0.005; // conservative
    const projectedKpi = (project.actualKpi || 0) * kpiImpact;

    let riskLevel: StressScenario["riskLevel"] = "low";
    if (newMargin < 10) riskLevel = "critical";
    else if (newMargin < 20) riskLevel = "high";
    else if (newMargin < 30) riskLevel = "medium";

    return {
      name: s.name,
      cpmRevenueShock: s.pct,
      projectedMargin: newMargin,
      projectedKpi: projectedKpi,
      projectedGain: projectedGain,
      riskLevel,
    };
  });
}

// ===== 5. AUDIT TRAIL =====

const AUDIT_STORAGE_KEY = "apex_audit_trail";

export function logAuditEntry(projectId: string, entry: Omit<AuditEntry, "timestamp">): void {
  const trail = getAuditTrail(projectId);
  trail.push({ ...entry, timestamp: Date.now() });
  // Keep last 200 entries
  const trimmed = trail.slice(-200);
  try {
    const allTrails = JSON.parse(localStorage.getItem(AUDIT_STORAGE_KEY) || "{}");
    allTrails[projectId] = trimmed;
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(allTrails));
  } catch { /* storage full — silent */ }
}

export function getAuditTrail(projectId: string): AuditEntry[] {
  try {
    const allTrails = JSON.parse(localStorage.getItem(AUDIT_STORAGE_KEY) || "{}");
    return allTrails[projectId] || [];
  } catch {
    return [];
  }
}

// ===== 6. PORTFOLIO RISK SUMMARY =====

export function getPortfolioRiskSummary(projects: ProjectData[]): {
  totalBudget: number;
  totalSpent: number;
  avgMargin: number;
  projectsAtRisk: number;
  criticalAlerts: number;
} {
  let totalBudget = 0, totalSpent = 0, totalMarginWeighted = 0, projectsAtRisk = 0, criticalAlerts = 0;

  projects.forEach(p => {
    totalBudget += p.budgetTotal || 0;
    totalSpent += p.budgetSpent || 0;
    const margin = p.cpmRevenueActual > 0
      ? ((p.cpmRevenueActual - p.cpmCostActuel) / p.cpmRevenueActual) * 100
      : 0;
    totalMarginWeighted += margin * (p.budgetSpent || 0);

    const alerts = checkRiskControls(p);
    if (alerts.some(a => a.severity === "critical")) {
      projectsAtRisk++;
      criticalAlerts += alerts.filter(a => a.severity === "critical").length;
    }
  });

  return {
    totalBudget,
    totalSpent,
    avgMargin: totalSpent > 0 ? totalMarginWeighted / totalSpent : 0,
    projectsAtRisk,
    criticalAlerts,
  };
}
