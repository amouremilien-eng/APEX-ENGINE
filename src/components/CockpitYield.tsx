import { useState, useMemo, ChangeEvent, useEffect } from "react";
import { ProjectData, LineItem, ProjectSnapshot, MarginPeriod, ProjectNote, Anomaly, AlertTriggered, TimingRecommendation } from "../types";
import { cn } from "../utils/cn";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Bar, Area } from "recharts";
import { Settings, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2, Trash2, DollarSign, Percent, Target, ChevronLeft, ChevronRight, Upload, Wand2, ArrowRight, Lock, Unlock, Clock, MousePointer2, Activity, BarChart3, Bell, Zap, Eye, Radio, Shield, TrendingUp as TrendUp } from "lucide-react";
import * as XLSX from "xlsx";
import { TTDImporter } from "./TTDImporter";
// 🏆 V2.0 : ParetoPanel Interactif
import { ParetoPanel } from "./ParetoPanel";
// 💰 V11.0 : Bid Shading Engine — Bloomberg Terminal Ads
import { BidShadingPanel } from "./BidShadingPanel";
// 🔥 V8.0 : Learning Engine
import {
  computeAdGroupStats,
  getCalibratedCoefficients,
  computeCampaignLearningStats,
  generateLearningInsights,
  enrichLineItemFromLearning,
  detectFunnelTag,
  continuousPerfScore,
  scoreToCategoryFromContinuous,
  computeCrossCampaignPrior,      // 🔥 V10.0
  riskAdjustMultiplier,           // 📊 V10.1 : Sharpe Ratio
  computeRiskAdjustedScore,       // 📊 V10.1
   predictPacing,                  // 🔮 V10.3 : Pacing Prédictif
  detectRegimeChanges,            // 🔄 V10.4 : Détection Régime
} from "../LearningEngine";
interface CockpitYieldProps {
  project: ProjectData;
  onChange: (project: ProjectData) => void;
  allProjects?: ProjectData[];  // 🔥 V10.0 : Pour le prior cross-campagne
}

interface OptimizationItem extends LineItem {
  perfRatio?: number;
  perfScore?: number;
  perfCategory?: "dead" | "underperforming" | "ok" | "good" | "star";
  riskVolatility?: number;  // 📊 V10.1 : Sharpe Ratio
  newMargin?: number;
  newCpmRevenue?: number;
  allocationScore?: number;
  capAlignmentBonus?: number;
  action?: string;
  dailyBudgetAverage?: number; 
  dailyBudgetProposed?: number; 
  totalRemainingBudget?: number;
  volumeWeight?: number;
  fillRate?: number;
  kpiProjected?: number;
}
/** Pondération logarithmique par volume de spend - empêche les micro-lignes de capter tout le budget */
function calculateVolumeWeight(spend: number, maxSpend: number): number {
  if (maxSpend <= 0 || spend <= 0) return 0.05;
  return Math.max(0.05, Math.sqrt(spend / maxSpend));
}
/** Estimation du fill rate basé sur la régularité de dépense historique */
/** 🔥 V12.0 : Estimation du fill rate basé sur la VOLATILITÉ du spend journalier
 *  Le vrai fill rate dépend de la capacité du DSP à dépenser le budget alloué.
 *  Signal fiable : la régularité du spend (coefficient de variation).
 *  - CV bas (< 0.3) = spend régulier = fill rate élevé (le DSP remplit bien)
 *  - CV élevé (> 0.8) = spend erratique = fill rate bas (bid trop bas ou inventaire rare)
 *  
 *  On combine avec le ratio spend/théorique pour avoir les deux dimensions :
 *  1. Volume : est-ce que le budget total est atteint ?
 *  2. Régularité : est-ce que le spend est prévisible jour après jour ?
 */
function estimateFillRate(
  dailyAvgSpend: number, 
  totalSpend: number, 
  joursEcoules: number,
  dailySpends?: number[]  // 🔥 V12.0 : Optionnel — tableau des spends journaliers pour calcul volatilité
): number {
  if (joursEcoules <= 1 || totalSpend <= 0) return 0.85;
  
  // Dimension 1 : Ratio volume (ancien calcul, gardé comme composante)
  const theoreticalTotal = dailyAvgSpend * joursEcoules;
  const volumeRatio = theoreticalTotal > 0 ? totalSpend / theoreticalTotal : 0.85;
  const volumeComponent = Math.max(0.3, Math.min(1.0, volumeRatio));
  
  // Dimension 2 : Régularité du spend (coefficient de variation)
  if (dailySpends && dailySpends.length >= 3) {
    const nonZeroSpends = dailySpends.filter(s => s > 0);
    if (nonZeroSpends.length >= 3) {
      const mean = nonZeroSpends.reduce((a, b) => a + b, 0) / nonZeroSpends.length;
      if (mean > 0) {
        const variance = nonZeroSpends.reduce((acc, s) => acc + (s - mean) ** 2, 0) / nonZeroSpends.length;
        const cv = Math.sqrt(variance) / mean; // Coefficient de variation
        
        // Jours à zéro = signal fort de fill rate insuffisant
        const zeroDaysPct = (dailySpends.length - nonZeroSpends.length) / dailySpends.length;
        
        // Pénaliser les jours à zéro (chaque jour sans spend = -10% de fill rate)
        const zeroPenalty = Math.max(0.4, 1 - zeroDaysPct * 1.0);
        
        // CV → fill rate (mapping empirique)
        // CV < 0.2 → fill rate ~95% (très régulier)
        // CV = 0.5 → fill rate ~70% (irrégulier)
        // CV > 1.0 → fill rate ~40% (très chaotique)
        const regularityComponent = Math.max(0.3, Math.min(0.98, 1 - cv * 0.6));
        
        // Combiner : 60% régularité + 30% volume + 10% pénalité jours zéro
        const combined = (regularityComponent * 0.60) + (volumeComponent * 0.30) + (zeroPenalty * 0.10);
        return Math.max(0.3, Math.min(1.0, combined));
      }
    }
  }
  
  // Fallback si pas de données journalières : ancien calcul amélioré
  return volumeComponent;
}
/** Cap dynamique de changement de budget basé sur le poids budgétaire relatif de la ligne */
function getDynamicBudgetCap(dailyAvg: number, avgDailyAll: number, mode: string): number {
  if (avgDailyAll <= 0 || dailyAvg <= 0) return 0.5;
  const spendRatio = dailyAvg / avgDailyAll;
  
  if (mode === "boost_kpi") {
    if (spendRatio > 1.5) return 0.30; // Gros piliers : ±30% max (rendements décroissants)
    if (spendRatio > 1.0) return 0.40;
    if (spendRatio > 0.5) return 0.60;
    return 0.80;
  } else if (mode === "increase_aggressive") {
    if (spendRatio > 1.5) return 1.0;
    if (spendRatio > 1.0) return 1.5;
    return 2.5;
  } else {
    if (spendRatio > 1.5) return 0.50;
    if (spendRatio > 1.0) return 0.65;
    if (spendRatio > 0.5) return 0.80;
    return 1.0;
  }
}

/** Projette l'impact KPI d'un changement de marge sur une ligne */
/** Projette l'impact KPI d'un changement de marge sur une ligne
 *  🔥 V12.0 : Impact KPI qualité réaliste basé sur le shift d'inventaire
 *  - CTR : très sensible au placement (above-fold vs below-fold, corrélation 0.7+)
 *  - VTR : très sensible au format (in-stream vs outstream, corrélation 0.6+)
 *  - Viewability : sensibilité modérée (above-fold, corrélation 0.4)
 */
function projectLineKpi(
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
    // 🔥 V12.0 : Impact RÉALISTE basé sur le shift de bid/inventaire
    // Baisser le bid = perte de positions premium → qualité BAISSE
    // Monter le bid = accès au premium → qualité MONTE
    
    // Ratio de changement de bid (si marge monte → bid baisse et vice versa)
    const bidChangeRatio = cpmRevenueRatio > 0 ? 1 / cpmRevenueRatio : 1; // bid = cost, inversement corrélé à CPM Rev
    
    // Coefficients de sensibilité par type de KPI qualité
    // Basé sur les corrélations bid-qualité observées en programmatique :
    // - CTR : très sensible au placement (above-fold = +300% CTR vs below-fold)
    //         Bid plus bas → positions dégradées → CTR chute
    // - VTR : très sensible au format vidéo (in-stream premium = 75% VTR vs outstream = 25%)
    //         Bid plus bas → shift vers outstream → VTR s'effondre
    // - Viewability : modérément sensible (above-fold ~85% vs below-fold ~40%)
    //         Mais les SSP ont des floors viewability, donc l'impact est atténué
    const qualitySensitivity: Record<string, number> = {
      "CTR": 0.35,         // 10% de baisse de bid → ~3.5% de baisse de CTR
      "VTR": 0.45,         // 10% de baisse de bid → ~4.5% de baisse de VTR (shift outstream)
      "Viewability": 0.15, // 10% de baisse de bid → ~1.5% de baisse de Viewability
    };
    
    const sensitivity = qualitySensitivity[kpiType] || 0.25;
    
    // Impact logarithmique (rendements décroissants pour les gros changements)
    // bidChangeRatio > 1 = bid monte = qualité monte
    // bidChangeRatio < 1 = bid baisse = qualité baisse
    const logImpact = Math.sign(bidChangeRatio - 1) * Math.log(1 + Math.abs(bidChangeRatio - 1)) * sensitivity;
    
    // Plafonner l'impact à ±40% (au-delà on est hors modèle)
    const clampedImpact = Math.max(-0.40, Math.min(0.40, logImpact));
    
    const projectedKpi = currentKpi * (1 + clampedImpact);
    
    // Plancher : KPI qualité ne peut pas descendre sous 0 ni dépasser 100%
    return Math.max(0, Math.min(100, projectedKpi));
  }
}

/** Contrainte KPI : réduit automatiquement la marge proposée si le KPI projeté sort des bornes */
function clampMarginForKpi(
  currentKpi: number, currentMargin: number, proposedMargin: number,
  cpmRevenue: number, targetKpi: number, isFin: boolean, kpiType: string,
  maxKpiDegradationPct: number = 0.25,
  reachElasticity: number = 0.85
): number {
  if (currentKpi === 0 || targetKpi === 0) return proposedMargin;
  
  const projected = projectLineKpi(currentKpi, currentMargin, proposedMargin, cpmRevenue, isFin, kpiType, reachElasticity);
  
  if (isFin) {
    const maxAllowedKpi = targetKpi * (1 + maxKpiDegradationPct);
    if (projected <= maxAllowedKpi) return proposedMargin;
    // Bisection pour trouver la marge max qui respecte la contrainte
    let lo = currentMargin, hi = proposedMargin;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      const midKpi = projectLineKpi(currentKpi, currentMargin, mid, cpmRevenue, isFin, kpiType, reachElasticity);
      if (midKpi <= maxAllowedKpi) lo = mid; else hi = mid;
    }
    return Math.round(lo * 100) / 100;
  } else {
    const minAllowedKpi = targetKpi * (1 - maxKpiDegradationPct);
    if (projected >= minAllowedKpi) return proposedMargin;
    let lo = currentMargin, hi = proposedMargin;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      const midKpi = projectLineKpi(currentKpi, currentMargin, mid, cpmRevenue, isFin, kpiType, reachElasticity);
      if (midKpi >= minAllowedKpi) lo = mid; else hi = mid;
    }
    return Math.round(lo * 100) / 100;
  }
}
// 🔥 V27 FIX : Calcul du VRAI Cost cumulé depuis les dailyEntries
function computeTrueCostSpent(project: ProjectData): number {
  if (project.dailyEntries && project.dailyEntries.length > 0) {
    return project.dailyEntries.reduce((sum, e) => {
      const spend = e.budgetSpent || 0;
      const margin = e.marginPct || 0;
      return sum + spend * (1 - margin / 100);
    }, 0);
  }
  if (project.marginPeriods && project.marginPeriods.length > 0) {
    let totalCost = 0;
    for (let i = 0; i < project.marginPeriods.length; i++) {
      const period = project.marginPeriods[i];
      const nextPeriod = project.marginPeriods[i + 1];
      const budgetInPeriod = nextPeriod
        ? nextPeriod.budgetSpentAtStart - period.budgetSpentAtStart
        : project.budgetSpent - period.budgetSpentAtStart;
      totalCost += budgetInPeriod * (1 - period.marginPct / 100);
    }
    return totalCost;
  }
  if (project.inputMode === "CPM Cost") {
    return project.budgetSpent * (project.cpmCostActuel / project.cpmRevenueActual);
  }
  return project.budgetSpent * (1 - project.margeInput / 100);
}
export function CockpitYield({ project, onChange, allProjects = [] }: CockpitYieldProps) {
  const [activeTab, setActiveTab] = useState<"analyse" | "comparateur" | "multilines" | "historique" | "notes" | "radar">("analyse");
  const [dashSource, setDashSource] = useState<"sidebar" | "table">("sidebar");
  const [uplift, setUplift] = useState(project.uplift ?? 3.0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [proposedOptimizations, setProposedOptimizations] = useState<OptimizationItem[] | null>(null)
  const [marginGoal, setMarginGoal] = useState<"increase" | "decrease" | "boost_kpi" | "increase_aggressive" | "pareto" | null>(null);
  // 🏆 V2.0 : ParetoPanel gère son propre state
  const [respectCpmCap, setRespectCpmCap] = useState<boolean>(true);
  const [lockedLines, setLockedLines] = useState<Set<string>>(new Set());
  const [attrClick, setAttrClick] = useState(project.attrClick ?? 0);
  const [attrView, setAttrView] = useState(project.attrView ?? 0);
  const [trend, setTrend] = useState<number | null>(null);
  const [funnelType, setFunnelType] = useState<"prospecting" | "mixed" | "retargeting">("mixed");
  const [expertMode, setExpertMode] = useState<boolean>(false);
  const [ttdMode, setTtdMode] = useState<boolean>(false);
  const [ttdFile, setTtdFile] = useState<File | null>(null);
  const [clientMode, setClientMode] = useState<boolean>(false);
  const [period1Start, setPeriod1Start] = useState<string>("");
  const [period1End, setPeriod1End] = useState<string>("");
  const [period2Start, setPeriod2Start] = useState<string>("");
  const [period2End, setPeriod2End] = useState<string>("");   

  // 🔬 V9.1 : Élasticité calibrée depuis le LearningEngine (si assez de données)
  const calibratedStats = useMemo(() => {
    return computeCampaignLearningStats(project);
  }, [project.id, project.dailyEntries?.length, project.kpiType]);

  // 🔥 V10.0 : Prior cross-campagne (à connecter à Supabase plus tard)
  // Pour l'instant : null. Quand tu auras les données, passer les projets terminés ici.
  // Exemple futur : computeCrossCampaignPrior(allCompletedProjects, project.kpiType, funnelType)
 const crossCampaignPrior = useMemo(() => {
    const completedProjects = allProjects.filter(p => 
      p.id !== project.id && // Exclure la campagne courante
      p.status === "completed" && 
      p.dailyEntries && p.dailyEntries.length >= 5
    );
    if (completedProjects.length < 2) return null; // Minimum 2 campagnes pour un prior utile
    return computeCrossCampaignPrior(completedProjects, project.kpiType, funnelType);
  }, [allProjects.length, project.id, project.kpiType, funnelType]);

  const getReachElasticity = (): number => {
    // 🔬 V9.1 : Si le LearningEngine a mesuré l'élasticité avec confiance, l'utiliser
    // pour le reachElasticity du modèle théorique
    const calibrated = getCalibratedCoefficients(project, funnelType, crossCampaignPrior);
    if (calibrated.source !== "default" && calibratedStats && calibratedStats.elasticityConfidence > 0.3) {
      // Adapter marginKpiElasticity en reachElasticity
      // marginKpiElasticity mesure %KPI/%marge, on le convertit en facteur reach [0.3-0.97]
      const empiricalElasticity = Math.max(0.3, Math.min(0.97, 0.85 + calibratedStats.marginKpiElasticity * 2));
      console.log(`🔬 Élasticité calibrée: ${empiricalElasticity.toFixed(3)} (R²=${calibratedStats.elasticityConfidence.toFixed(2)}, source: ${calibrated.source})`);
      return empiricalElasticity;
    }
    // Fallback : sélecteur manuel funnel
    switch (funnelType) {
      case "retargeting": return 0.93;
      case "prospecting": return 0.60;
      case "mixed": 
      default: return 0.85;
    }
  };

  useEffect(() => {
  setAttrClick(project.attrClick ?? 0);
  setAttrView(project.attrView ?? 0);
}, [project.id, project.attrClick, project.attrView]);
  useEffect(() => {
  if (!project.dailyEntries || project.dailyEntries.length === 0) {
    setUplift(project.uplift ?? 3.0);
    return;
  }
  
  // Calculer la marge actuelle du projet
  let projectCurrentMargin = 0;
  if (project.inputMode === "CPM Cost") {
    if (project.cpmRevenueActual > 0) {
      projectCurrentMargin = Math.round(((project.cpmRevenueActual - project.cpmCostActuel) / project.cpmRevenueActual) * 100 * 100) / 100;
    }
  } else {
    projectCurrentMargin = Math.round(project.margeInput * 100) / 100;
  }
  
  // Trier par date décroissante et prendre la plus récente
  const sortedEntries = [...project.dailyEntries].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const lastEntry = sortedEntries[0];
  
  if (!lastEntry.marginPct) {
    setUplift(project.uplift ?? 3.0);
    return;
  }
  
  const lastMargin = Math.round(lastEntry.marginPct * 100) / 100;
  
  // 🔥 V8.1 : SYNC KPI GLOBAL cumulé depuis TOUTES les dailyEntries
  const allEntries = project.dailyEntries;
  const totalSpentAll = allEntries.reduce((s, e) => s + (e.budgetSpent || 0), 0);
  const isFin_sync = !["Viewability", "VTR", "CTR"].includes(project.kpiType);

  let globalKpi = 0;
  if (totalSpentAll > 0) {
    if (isFin_sync) {
      const totalActions = allEntries.reduce((s, e) =>
        e.kpiActual > 0 ? s + (e.budgetSpent || 0) / e.kpiActual : s, 0);
      globalKpi = totalActions > 0 ? totalSpentAll / totalActions : 0;
    } else {
      globalKpi = allEntries.reduce((s, e) => s + (e.budgetSpent || 0) * (e.kpiActual || 0), 0) / totalSpentAll;
    }
  }

  // 🔥 V8.1 : CPM Revenue GLOBAL = totalSpent / totalImpressions (pas une moyenne)
  const totalImpUnits = allEntries.reduce((s, e) => {
    const cpm = e.cpmRevenue || 0;
    return cpm > 0 ? s + (e.budgetSpent || 0) / cpm : s;
  }, 0);
  const globalCpmRevenue = totalImpUnits > 0 ? totalSpentAll / totalImpUnits : project.cpmRevenueActual;

  // Détecter les changements
  const marginChanged = Math.abs(lastMargin - projectCurrentMargin) > 0.05;
  const kpiChanged = Math.abs(globalKpi - (project.actualKpi || 0)) > 0.005;
  const cpmRevChanged = Math.abs(globalCpmRevenue - (project.cpmRevenueActual || 0)) > 0.05;

  if (marginChanged || kpiChanged || cpmRevChanged) {
    const updates: Partial<ProjectData> = {};

    // Marge
    if (marginChanged) {
      if (project.inputMode === "Marge %") {
        updates.margeInput = lastMargin;
      } else {
        updates.cpmCostActuel = Math.round(globalCpmRevenue * (1 - lastMargin / 100) * 100) / 100;
      }
    }

    // KPI global
    if (kpiChanged) {
      updates.actualKpi = Math.round(globalKpi * 1000) / 1000;
    }

    // CPM Revenue global
    if (cpmRevChanged) {
      updates.cpmRevenueActual = Math.round(globalCpmRevenue * 100) / 100;
      // Recalculer CPM Cost pour préserver la marge courante (évite boucle infinie)
      if (project.inputMode === "CPM Cost") {
        updates.cpmCostActuel = Math.round(globalCpmRevenue * (1 - lastMargin / 100) * 100) / 100;
      }
    }

    onChange({ ...project, ...updates });
  }

  // Calculer l'uplift par rapport à la marge actuelle
  const calculatedUplift = lastMargin - projectCurrentMargin;
  setUplift(calculatedUplift);
  
}, [project.id, project.dailyEntries, project.inputMode, project.cpmRevenueActual]);
 useEffect(() => {
    // 🔥 V3 : Désactivé si dailyEntries existe (le trader gère manuellement via Suivi Campagne)
    if (project.dailyEntries && project.dailyEntries.length > 0) return;
    
    if (!project.updatedAt || project.budgetTotal === 0 || project.durationDays === 0) return;
    
    const lastUpdate = new Date(project.updatedAt);
    const now = new Date();
    const daysElapsed = Math.floor((now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysElapsed > 0 && project.budgetSpent < project.budgetTotal) {
      const dailyBudget = project.budgetTotal / project.durationDays;
      const actualDailySpend = dailyBudget * 1.10;
      const additionalSpend = actualDailySpend * daysElapsed;
      const newBudgetSpent = Math.min(project.budgetTotal, project.budgetSpent + additionalSpend);
      
      if (newBudgetSpent > project.budgetSpent) {
        updateField("budgetSpent", newBudgetSpent);
      }
    }
  }, [project.id]);
// 🔥 V12.0 : Coefficient de tolérance KPI par type de campagne
  // En branding (CTR, VTR, Viewability), les KPI sont naturellement plus volatils
  // et les écarts à l'objectif sont plus tolérés par les clients.
  // En performance (CPA, CPC, CPCV), chaque cent compte et les écarts sont critiques.
  const getKpiToleranceFactor = (kpiType: string): number => {
    // Retourne un facteur multiplicatif sur le scoring :
    // > 1.0 = plus tolérant (branding) → les lignes "underperforming" sont traitées comme "ok"
    // < 1.0 = plus strict (performance) → les lignes "ok" sont traitées comme "underperforming"
    // = 1.0 = neutre
    switch (kpiType) {
      // BRANDING : haute volatilité naturelle, objectifs souvent indicatifs
      case "CTR":        return 1.4;  // ±40% de tolérance (CTR varie de 50% jour/jour naturellement)
      case "Viewability": return 1.3;  // ±30% (dépend beaucoup du format, pas du trader)
      case "VTR":        return 1.3;  // ±30% (dépend format vidéo in-stream vs outstream)
      
      // PERFORMANCE MOLLE : objectifs importants mais avec marge
      case "CPC":        return 1.1;  // ±10% de tolérance
      case "CPV":        return 1.0;  // Neutre
      case "CPM":        return 1.2;  // ±20% (CPM dépend beaucoup du marché)
      
      // PERFORMANCE DURE : chaque cent compte, client surveille au quotidien
      case "CPA":        return 0.85; // -15% : plus strict (CPA est LE KPI roi)
      case "CPCV":       return 0.90; // -10% : assez strict (vidéo à la perf)
      
      default:           return 1.0;
    }
  };
  const toggleLock = (id: string) => {
    const newLocked = new Set(lockedLines);
    if (newLocked.has(id)) newLocked.delete(id);
    else newLocked.add(id);
    setLockedLines(newLocked);
  };

  const currSym = project.currency.includes("EUR") ? "€" : "$";

  const updateField = <K extends keyof ProjectData>(field: K, value: ProjectData[K]) => {
    onChange({ ...project, [field]: value, updatedAt: new Date().toISOString() });
  };

  const updateUplift = (newUplift: number) => {
    setUplift(newUplift);
    updateField("uplift", newUplift);
  };

  const createSnapshot = (action: ProjectSnapshot["action"], note?: string): ProjectSnapshot => {
    const marginPct = project.inputMode === "CPM Cost" 
      ? ((project.cpmRevenueActual - project.cpmCostActuel) / project.cpmRevenueActual) * 100
      : project.margeInput;
    
    const cpmCost = project.inputMode === "CPM Cost" 
  ? project.cpmCostActuel 
  : Math.round(project.cpmRevenueActual * (1 - project.margeInput / 100) * 100) / 100;
    
    const gainRealized = project.budgetSpent * (marginPct / 100);
    
    return {
      timestamp: new Date().toISOString(),
      budgetSpent: project.budgetSpent,
      marginPct,
      cpmCostActuel: cpmCost,
      cpmRevenueActual: project.cpmRevenueActual,
      actualKpi: project.actualKpi,
      gainRealized,
      action,
      note
    };
  };

  const handleDeleteHistoryEntry = (index: number) => {
    if (!confirm("⚠️ Supprimer cette entrée de l'historique ? Cette action est irréversible.")) {
      return;
    }

    const entryToDelete = project.history?.[index];
    if (!entryToDelete) return;

    const newHistory = [...(project.history || [])];
    newHistory.splice(index, 1);

    let updatedProject = { ...project, history: newHistory };

    if (entryToDelete.action === "DAILY_UPDATE" && entryToDelete.note) {
      const dateMatch = entryToDelete.note.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (dateMatch) {
        const [day, month, year] = dateMatch[1].split('/');
        const dateToDelete = `${year}-${month}-${day}`;
        
        const newDailyEntries = (project.dailyEntries || []).filter(
          entry => entry.date !== dateToDelete
        );
        
        updatedProject.dailyEntries = newDailyEntries;
        
        const newBudgetSpent = newDailyEntries.reduce((sum, e) => sum + e.budgetSpent, 0);
        updatedProject.budgetSpent = newBudgetSpent;
      }
    }

    if (entryToDelete.action === "MARGIN_UP" || entryToDelete.action === "MARGIN_DOWN") {
      const newMarginPeriods = (project.marginPeriods || []).filter(
        period => Math.abs(new Date(period.startDate).getTime() - new Date(entryToDelete.timestamp).getTime()) > 5000
      );
      
      updatedProject.marginPeriods = newMarginPeriods;
      
      if (newMarginPeriods.length > 0) {
        const lastPeriod = newMarginPeriods[newMarginPeriods.length - 1];
        updatedProject.margeInput = lastPeriod.marginPct;
      }
    }

    updatedProject.updatedAt = new Date().toISOString();
    onChange(updatedProject);
    
    alert("✅ Entrée supprimée avec succès !");
  };

  const applyMarginChange = () => {
    if (uplift === 0) {
      alert("Aucun changement de marge à appliquer.");
      return;
    }
    
    const newMarginPct = currentMarginPctCalc + uplift;
    
    const action: "MARGIN_UP" | "MARGIN_DOWN" = uplift > 0 ? "MARGIN_UP" : "MARGIN_DOWN";
    const note = uplift > 0 
      ? `Augmentation de marge : +${uplift.toFixed(1)} points (nouvelle marge : ${newMarginPct.toFixed(2)}%)` 
      : `Baisse de marge : ${uplift.toFixed(1)} points (nouvelle marge : ${newMarginPct.toFixed(2)}%)`;
    
    const snapshot: ProjectSnapshot = {
      timestamp: new Date().toISOString(),
      budgetSpent: project.budgetSpent,
      marginPct: newMarginPct,
      cpmCostActuel: project.inputMode === "CPM Cost" 
        ? project.cpmCostActuel 
        : project.cpmRevenueActual * (1 - newMarginPct / 100),
      cpmRevenueActual: project.cpmRevenueActual,
      actualKpi: project.actualKpi,
      gainRealized: project.budgetSpent * (newMarginPct / 100),
      action: action,
      note: note
    };
    
    const newPeriod: MarginPeriod = {
      startDate: new Date().toISOString(),
      marginPct: newMarginPct,
      budgetSpentAtStart: project.budgetSpent
    };
    
    const newHistory = [...(project.history || []), snapshot];
    const newMarginPeriods = [...(project.marginPeriods || []), newPeriod];
    
    onChange({
      ...project,
      history: newHistory,
      marginPeriods: newMarginPeriods,
      margeInput: newMarginPct,
      updatedAt: new Date().toISOString()
    });
    
    alert(`✅ Changement de marge enregistré !`);
  };

  const budgetRemaining = project.budgetTotal - project.budgetSpent;
  const pctProgress = project.budgetTotal > 0 ? project.budgetSpent / project.budgetTotal : 0;

// 🔥 CALCUL CORRECT : Basé sur les DATES réelles, pas le budget
let currentDay = 0;
if (project.startDate) {
  const startDate = new Date(project.startDate);
  const today = new Date();
  
  // Nombre de jours écoulés depuis le début de la campagne
  const daysElapsed = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // S'assurer que currentDay est entre 0 et durationDays
  currentDay = Math.max(0, Math.min(project.durationDays, daysElapsed));
} else {
  // Fallback : ancien calcul basé sur le budget si pas de startDate
  currentDay = Math.floor(project.durationDays * pctProgress);
}

  // 🔮 V10.3 : Pacing Prédictif (AR(1) + Monte Carlo)
  const pacingPrediction = useMemo(() => {
    if (!project.dailyEntries || project.dailyEntries.length < 5 || project.durationDays <= 0) return null;
    const _currSym = project.currency.includes("EUR") ? "€" : "$";
    let _currentDay = 0;
    if (project.startDate) {
      const sd = new Date(project.startDate);
      _currentDay = Math.max(0, Math.min(project.durationDays, Math.floor((Date.now() - sd.getTime()) / 86400000)));
    } else {
      const _pct = project.budgetTotal > 0 ? project.budgetSpent / project.budgetTotal : 0;
      _currentDay = Math.floor(project.durationDays * _pct);
    }
    const joursRestants = Math.max(0, project.durationDays - _currentDay);
    if (joursRestants <= 0) return null;

    // Agréger les spends par date (critique en mode adgroup/sous-campagne)
    const dailyAgg = new Map<string, number>();
    for (const e of project.dailyEntries) {
      dailyAgg.set(e.date, (dailyAgg.get(e.date) || 0) + (e.budgetSpent || 0));
    }
    const dailySpends = [...dailyAgg.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, spend]) => spend);

    return predictPacing(dailySpends, project.budgetTotal, project.budgetSpent, joursRestants, _currSym);
 }, [project.dailyEntries?.length, project.budgetTotal, project.budgetSpent, project.durationDays, project.startDate, project.currency]);

  // 🔄 V10.4 : Détection de Changement de Régime (CUSUM)
  const regimeChanges = useMemo(() => {
    if (!project.dailyEntries || project.dailyEntries.length < 8) return [];
    const _currSym = project.currency.includes("EUR") ? "€" : "$";
    return detectRegimeChanges(project.dailyEntries, project.kpiType, _currSym);
  }, [project.dailyEntries?.length, project.kpiType, project.currency]);

  let cpmCostActuelCalc = 0;
let currentMarginPctCalc = 0;

// 1️⃣ Essayer de récupérer depuis la dernière entrée dailyEntries
if (project.dailyEntries && project.dailyEntries.length > 0) {
  const sortedEntries = [...project.dailyEntries].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const lastEntry = sortedEntries[0];
  
  // Utiliser les données de la dernière entrée
  currentMarginPctCalc = Math.round(lastEntry.marginPct * 100) / 100;
  cpmCostActuelCalc = Math.round(lastEntry.cpmRevenue * (1 - lastEntry.marginPct / 100) * 100) / 100;
}
// 2️⃣ Sinon, fallback sur les valeurs du projet
else if (project.inputMode === "CPM Cost") {
  cpmCostActuelCalc = project.cpmCostActuel;
  if (project.cpmRevenueActual > 0) {
    currentMarginPctCalc = Math.round(((project.cpmRevenueActual - cpmCostActuelCalc) / project.cpmRevenueActual) * 100 * 100) / 100;
  }
} else {
  currentMarginPctCalc = Math.round(project.margeInput * 100) / 100;
  cpmCostActuelCalc = Math.round(project.cpmRevenueActual * (1 - project.margeInput / 100) * 100) / 100;
}

  const calculateWeightedMargin = (): number => {
    if (!project.marginPeriods || project.marginPeriods.length === 0) {
      return currentMarginPctCalc;
    }
    
    let totalGain = 0;
    let totalSpent = 0;
    
    for (let i = 0; i < project.marginPeriods.length; i++) {
      const period = project.marginPeriods[i];
      const nextPeriod = project.marginPeriods[i + 1];
      
      const budgetInPeriod = nextPeriod 
        ? nextPeriod.budgetSpentAtStart - period.budgetSpentAtStart
        : project.budgetSpent - period.budgetSpentAtStart;
      
      const gainInPeriod = budgetInPeriod * (period.marginPct / 100);
      
      totalGain += gainInPeriod;
      totalSpent += budgetInPeriod;
    }
    
    return totalSpent > 0 ? (totalGain / totalSpent) * 100 : currentMarginPctCalc;
  };

  const displayMargin = calculateWeightedMargin();

  // 🔥 NOUVELLE FONCTION : Calcul des MOYENNES depuis dailyEntries
  const calculateDailyAverages = () => {
    if (!project.dailyEntries || project.dailyEntries.length === 0) {
      // Si pas d'entrées quotidiennes, retourner les valeurs actuelles
      return {
        avgCpmCost: cpmCostActuelCalc,
        avgCpmRevenue: project.cpmRevenueActual,
        avgMargin: currentMarginPctCalc,
        avgKpi: project.actualKpi
      };
    }

    let totalSpent = 0;
    let totalCost = 0;
    let totalRevenue = 0;
    let totalGain = 0;
    let totalKpiWeighted = 0;

    project.dailyEntries.forEach(entry => {
      const spent = entry.budgetSpent || 0;
      const margin = entry.marginPct || 0;
      const revenue = entry.cpmRevenue || 0;
      const cost = revenue * (1 - margin / 100);
      const kpi = entry.kpiActual || 0;

      totalSpent += spent;
      totalCost += cost * spent;        // ✅ CORRECT : Σ(CPM Cost × Budget)
      totalRevenue += revenue * spent;  // ✅ CORRECT : Σ(CPM Revenue × Budget)
      totalGain += spent * (margin / 100);
      totalKpiWeighted += spent * kpi;
    });

    // ✅ MOYENNES PONDÉRÉES CORRECTES : Σ(CPM × Budget) / Σ(Budget)
    const totalImpressions = project.dailyEntries.reduce((sum, e) => {
  const cpm = e.cpmRevenue || 0;
  return sum + (cpm > 0 ? (e.budgetSpent || 0) / cpm : 0);
}, 0);
const avgCpmRevenue = totalImpressions > 0 ? totalSpent / totalImpressions : project.cpmRevenueActual;
    // 🔥 V10.5 : CPM Cost CUMULÉ = total media cost / total impressions (pas pondéré par spend)
    const totalMediaCost = project.dailyEntries.reduce((sum, e) => sum + (e.budgetSpent || 0) * (1 - (e.marginPct || 0) / 100), 0);
    const avgCpmCost = totalImpressions > 0 ? totalMediaCost / totalImpressions : cpmCostActuelCalc;
    const avgMargin = totalSpent > 0 ? (totalGain / totalSpent) * 100 : currentMarginPctCalc;
    const isFin2 = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
    let avgKpi: number;
    if (isFin2) {
      const totalActions = project.dailyEntries.reduce((sum, e) => {
        return e.kpiActual > 0 ? sum + (e.budgetSpent || 0) / e.kpiActual : sum;
      }, 0);
      avgKpi = totalActions > 0 ? totalSpent / totalActions : project.actualKpi;
    } else {
      avgKpi = totalSpent > 0 ? totalKpiWeighted / totalSpent : project.actualKpi;
    }

    return {
      avgCpmCost,
      avgCpmRevenue,
      avgMargin,
      avgKpi
    };
  };

  const dailyAverages = calculateDailyAverages();

  const totalSpendTable = project.lineItems.reduce((acc, li) => acc + (li.spend || 0), 0);
  let wMargin = currentMarginPctCalc;
  let wCpmRev = project.cpmRevenueActual;
  let wCpmCost = cpmCostActuelCalc;
  let wKpi = project.actualKpi;

  if (totalSpendTable > 0) {
    wMargin = project.lineItems.reduce((acc, li) => acc + ((li.spend || 0) * li.marginPct), 0) / totalSpendTable;
    const totalImpTable = project.lineItems.reduce((acc, li) => acc + (li.cpmRevenue > 0 ? (li.spend || 0) / li.cpmRevenue : 0), 0);
    if (totalImpTable > 0) {
      wCpmRev = totalSpendTable / totalImpTable;
      const totalCostTable = project.lineItems.reduce((acc, li) => acc + ((li.spend || 0) * (1 - li.marginPct / 100)), 0);
      wCpmCost = totalCostTable / totalImpTable;
    }
    wKpi = project.lineItems.reduce((acc, li) => acc + ((li.spend || 0) * li.kpiActual), 0) / totalSpendTable;
  }

  // 🔥 UTILISER LES MOYENNES QUOTIDIENNES pour l'affichage
  const dispCpmCost = dashSource === "sidebar" ? dailyAverages.avgCpmCost : wCpmCost;
  const dispCpmRev = dashSource === "sidebar" ? dailyAverages.avgCpmRevenue : wCpmRev;
  const dispMargin = dashSource === "sidebar" ? dailyAverages.avgMargin : wMargin;
  const dispKpi = dashSource === "sidebar" ? dailyAverages.avgKpi : wKpi;

  const isFin = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
  const isCompleted = project.status === "completed";
  const margeEuroDisp = dispCpmRev - dispCpmCost;

  const gainRealized = project.budgetSpent * (dailyAverages.avgMargin / 100);
  const gainRemaining = budgetRemaining * (currentMarginPctCalc / 100);

  // ========================================
  // 🔥 V4.0 : MOTEURS RADAR TRADER
  // ========================================
  
  // --- 1. DÉTECTION D'ANOMALIES ---
  const detectedAnomalies: Anomaly[] = (() => {
    if (!project.dailyEntries || project.dailyEntries.length < 4) return [];
    
    // 🔥 V11.0 FIX : Agréger par DATE d'abord (critique en mode adgroup)
    const isFin_anom = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
    const anomDailyAgg = new Map<string, { totalSpend: number; totalMarginW: number; totalKpiW: number; totalActions: number }>();
    for (const e of project.dailyEntries) {
      const spend = e.budgetSpent || 0;
      const kpi = e.kpiActual || 0;
      const margin = e.marginPct || 0;
      const ex = anomDailyAgg.get(e.date);
      if (ex) {
        ex.totalSpend += spend;
        ex.totalMarginW += spend * margin;
        ex.totalKpiW += spend * kpi;
        if (isFin_anom && kpi > 0) ex.totalActions += spend / kpi;
      } else {
        anomDailyAgg.set(e.date, {
          totalSpend: spend,
          totalMarginW: spend * margin,
          totalKpiW: spend * kpi,
          totalActions: isFin_anom && kpi > 0 ? spend / kpi : 0,
        });
      }
    }
    const anomDays = [...anomDailyAgg.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, d]) => ({
        date,
        budgetSpent: d.totalSpend,
        kpiActual: isFin_anom
          ? (d.totalActions > 0 ? d.totalSpend / d.totalActions : 0)
          : (d.totalSpend > 0 ? d.totalKpiW / d.totalSpend : 0),
        marginPct: d.totalSpend > 0 ? d.totalMarginW / d.totalSpend : 0,
      }))
      .filter(d => d.budgetSpent > 0);
    
    if (anomDays.length < 4) return [];
    
    const anomalies: Anomaly[] = [];
    const windowSize = 3;
    
    for (let i = windowSize; i < anomDays.length; i++) {
      const entry = anomDays[i];
      const window = anomDays.slice(i - windowSize, i);
      
      // Moyenne mobile spend
      const avgSpend = window.reduce((s, e) => s + e.budgetSpent, 0) / windowSize;
      const spendDev = avgSpend > 0 ? ((entry.budgetSpent - avgSpend) / avgSpend) * 100 : 0;
      
      if (Math.abs(spendDev) > 80) {
        anomalies.push({
          id: `anom_spend_${entry.date}`,
          date: entry.date,
          type: spendDev > 0 ? "spend_spike" : "spend_drop",
          metric: "Budget Journalier",
          expectedValue: avgSpend,
          actualValue: entry.budgetSpent,
          deviationPct: spendDev,
          severity: Math.abs(spendDev) > 150 ? "high" : "medium",
          investigated: false
        });
      }
      
      // Moyenne mobile KPI
      const avgKpi = window.reduce((s, e) => s + e.kpiActual, 0) / windowSize;
      const kpiDev = avgKpi > 0 ? ((entry.kpiActual - avgKpi) / avgKpi) * 100 : 0;
      
      // 🔥 V11.5 FIX : Distinguer KPI financier vs qualité pour la sévérité
      // KPI financier (CPA, CPC…) : spike = mauvais, drop = bon
      // KPI qualité (CTR, VTR, Viewability) : spike = bon, drop = mauvais
      const isPositiveDeviation = kpiDev > 0;
      const isGoodDeviation = isFin_anom ? !isPositiveDeviation : isPositiveDeviation;
      
      if (Math.abs(kpiDev) > 40) {
        // Si la déviation est BONNE (CTR monte, CPA baisse), réduire la sévérité
        const adjustedSeverity: "high" | "medium" | "low" = isGoodDeviation
          ? "low"  // Bonne nouvelle → toujours "low" (info seulement)
          : Math.abs(kpiDev) > 80 ? "high" : Math.abs(kpiDev) > 50 ? "medium" : "low";
        
        anomalies.push({
          id: `anom_kpi_${entry.date}`,
          date: entry.date,
          type: kpiDev > 0 ? "kpi_spike" : "kpi_drop",
          metric: project.kpiType,
          expectedValue: avgKpi,
          actualValue: entry.kpiActual,
          deviationPct: kpiDev,
          severity: adjustedSeverity,
          investigated: false
        });
      }
      
      // Shift marge brutal
      const avgMargin = window.reduce((s, e) => s + e.marginPct, 0) / windowSize;
      const marginDev = avgMargin > 0 ? ((entry.marginPct - avgMargin) / avgMargin) * 100 : 0;
      
      if (Math.abs(marginDev) > 25) {
        anomalies.push({
          id: `anom_margin_${entry.date}`,
          date: entry.date,
          type: "margin_shift",
          metric: "Marge %",
          expectedValue: avgMargin,
          actualValue: entry.marginPct,
          deviationPct: marginDev,
          severity: Math.abs(marginDev) > 50 ? "high" : "medium",
          investigated: false
        });
      }
    }
    return anomalies.slice(-15);
  })();

  // --- 2. ALERTES AUTOMATIQUES ---
  const triggeredAlerts: AlertTriggered[] = (() => {
    const alerts: AlertTriggered[] = [];
    if (project.budgetTotal <= 0 || project.durationDays <= 0) return alerts;
    
    const joursRestants = Math.max(0, project.durationDays - currentDay);
    const theoreticalSpent = currentDay > 0 ? project.budgetTotal * (currentDay / project.durationDays) : 0;
    const pacingPct = theoreticalSpent > 0 ? ((project.budgetSpent - theoreticalSpent) / theoreticalSpent) * 100 : 0;
    const kpiVsTarget = project.targetKpi > 0 ? (project.actualKpi / project.targetKpi) * 100 : 0;
    const cpmRevVsCap = project.cpmSoldCap > 0 ? ((project.cpmRevenueActual - project.cpmSoldCap) / project.cpmSoldCap) * 100 : 0;
    const now = new Date().toISOString();
    
    /// 🔮 V10.3 : Alertes pacing PRÉDICTIVES (prédictif prioritaire, réactif en fallback)
    if (pacingPrediction && pacingPrediction.recommendation === "urgent") {
      alerts.push({
        ruleId: "auto_pacing_predictive_urgent",
        ruleName: "🔮 Pacing Prédictif — URGENT",
        severity: "critical",
        message: pacingPrediction.message,
        triggeredAt: now,
        dismissed: false,
        metricValues: { pacing_predicted_pct: pacingPrediction.predictedEndSpendPct, days_to_depletion: pacingPrediction.daysToDepletion || 0, adjust_pct: pacingPrediction.recommendedDailyAdjustPct }
      });
    } else if (pacingPrediction && (pacingPrediction.recommendation === "accelerate" || pacingPrediction.recommendation === "decelerate")) {
      alerts.push({
        ruleId: "auto_pacing_predictive",
        ruleName: `🔮 Pacing Prédictif — ${pacingPrediction.recommendation === "accelerate" ? "Sous-dépense" : "Sur-dépense"}`,
        severity: "warning",
        message: pacingPrediction.message,
        triggeredAt: now,
        dismissed: false,
        metricValues: { pacing_predicted_pct: pacingPrediction.predictedEndSpendPct, adjust_pct: pacingPrediction.recommendedDailyAdjustPct }
      });
   } else if (!pacingPrediction && Math.abs(pacingPct) > 20) {
      // Fallback réactif UNIQUEMENT si pas de données prédictives
      alerts.push({
        ruleId: "auto_pacing_critical",
        ruleName: "Pacing Critique",
        severity: "critical",
        message: pacingPct > 0 
          ? `Pacing en AVANCE de +${pacingPct.toFixed(0)}%. Risque de fin de budget prématurée dans ${joursRestants}j.`
          : `Pacing en RETARD de ${pacingPct.toFixed(0)}%. Budget sous-dépensé, ${budgetRemaining.toFixed(0)} ${currSym} restants.`,
        triggeredAt: now,
        dismissed: false,
        metricValues: { pacing_pct: pacingPct, days_remaining: joursRestants }
      });
   } else if (!pacingPrediction && Math.abs(pacingPct) > 10) {
      alerts.push({
        ruleId: "auto_pacing_warning",
        ruleName: "Pacing Décalé",
        severity: "warning",
        message: `Pacing ${pacingPct > 0 ? "en avance" : "en retard"} de ${pacingPct.toFixed(0)}%. Surveiller les prochains jours.`,
        triggeredAt: now,
        dismissed: false,
        metricValues: { pacing_pct: pacingPct }
      });
    }
    
    // Alerte KPI hors objectif
    if (project.actualKpi > 0 && project.targetKpi > 0) {
      if (isFin && project.actualKpi > project.targetKpi * 1.3) {
        alerts.push({
          ruleId: "auto_kpi_degraded",
          ruleName: "KPI Dégradé",
          severity: "critical",
          message: `${project.kpiType} à ${project.actualKpi.toFixed(2)} ${currSym} — dépasse l'objectif de +${((project.actualKpi / project.targetKpi - 1) * 100).toFixed(0)}%. Action requise.`,
          triggeredAt: now,
          dismissed: false,
          metricValues: { kpi_actual: project.actualKpi, kpi_vs_target_pct: kpiVsTarget }
        });
      } else if (!isFin && project.actualKpi < project.targetKpi * 0.7) {
        alerts.push({
          ruleId: "auto_kpi_degraded",
          ruleName: "KPI Dégradé",
          severity: "critical",
          message: `${project.kpiType} à ${project.actualKpi.toFixed(2)}% — sous l'objectif de ${((1 - project.actualKpi / project.targetKpi) * 100).toFixed(0)}%. Action requise.`,
          triggeredAt: now,
          dismissed: false,
          metricValues: { kpi_actual: project.actualKpi, kpi_vs_target_pct: kpiVsTarget }
        });
      }
    }
    
    // Alerte marge haute (>70% = visible sur reporting)
    if (currentMarginPctCalc > 70) {
      alerts.push({
        ruleId: "auto_margin_high",
        ruleName: "Marge Élevée",
        severity: "warning",
        message: `Marge à ${currentMarginPctCalc.toFixed(1)}% — visible sur reporting client. Envisager une baisse ou un split de lignes.`,
        triggeredAt: now,
        dismissed: false,
        metricValues: { margin_pct: currentMarginPctCalc }
      });
    }
    
    // Alerte CPM Rev > Cap
    if (cpmRevVsCap > 5) {
      alerts.push({
        ruleId: "auto_cpm_over_cap",
        ruleName: "CPM Revenu > Cap",
        severity: cpmRevVsCap > 15 ? "critical" : "warning",
        message: `CPM Revenu (${project.cpmRevenueActual.toFixed(2)} ${currSym}) dépasse le Cap de +${cpmRevVsCap.toFixed(1)}%. Client peut détecter.`,
        triggeredAt: now,
        dismissed: false,
        metricValues: { cpm_revenue_vs_cap_pct: cpmRevVsCap }
      });
    }
    
    // Alerte fin de campagne imminente
    if (joursRestants > 0 && joursRestants <= 3 && budgetRemaining > project.budgetTotal * 0.15) {
      alerts.push({
        ruleId: "auto_end_near",
        ruleName: "Fin Imminente",
        severity: "warning",
        message: `${joursRestants}j restants avec ${((budgetRemaining / project.budgetTotal) * 100).toFixed(0)}% du budget non dépensé. Accélérer le spend.`,
        triggeredAt: now,
        dismissed: false,
        metricValues: { days_remaining: joursRestants, pacing_pct: pacingPct }
      });
    }
    
   // Alerte anomalies récentes non investiguées
    const recentHighAnomalies = detectedAnomalies.filter(a => a.severity === "high");
    if (recentHighAnomalies.length > 0) {
      alerts.push({
        ruleId: "auto_anomaly_detected",
        ruleName: "Anomalies Détectées",
        severity: "warning",
        message: `${recentHighAnomalies.length} anomalie(s) critique(s) détectée(s) dans les dailyEntries. Investiguer.`,
        triggeredAt: now,
        dismissed: false,
        metricValues: { anomaly_count: recentHighAnomalies.length }
      });
    }

    // 🔄 V10.4 : Alertes changement de régime (CUSUM)
    const structuralRegimes = regimeChanges.filter(r => r.isStructural && r.confidence > 0.4);
    if (structuralRegimes.length > 0) {
      for (const regime of structuralRegimes.slice(0, 2)) {
        alerts.push({
          ruleId: `auto_regime_${regime.metric}`,
          ruleName: `🔄 Changement de Régime — ${regime.metricLabel}`,
          severity: regime.confidence > 0.7 ? "critical" : "warning",
          message: regime.message,
          triggeredAt: now,
          dismissed: false,
          metricValues: { change_pct: regime.changePct, days_in_regime: regime.daysInNewRegime, confidence: regime.confidence }
        });
      }
    }
    
    return alerts;
  })();

  // --- 3. RECOMMANDATIONS DE TIMING ---
  const timingRecos: TimingRecommendation[] = (() => {
    const recos: TimingRecommendation[] = [];
    if (!project.dailyEntries || project.dailyEntries.length < 3 || project.durationDays <= 0) return recos;
    
    const joursRestants = Math.max(1, project.durationDays - currentDay);
    
    // 🔥 V11.0 FIX : Agréger par DATE d'abord (mode adgroup)
    const isFin_reco = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
    const recoDailyAgg = new Map<string, { totalSpend: number; totalKpiW: number; totalActions: number }>();
    for (const e of project.dailyEntries) {
      const spend = e.budgetSpent || 0;
      const kpi = e.kpiActual || 0;
      const ex = recoDailyAgg.get(e.date);
      if (ex) {
        ex.totalSpend += spend;
        ex.totalKpiW += spend * kpi;
        if (isFin_reco && kpi > 0) ex.totalActions += spend / kpi;
      } else {
        recoDailyAgg.set(e.date, { totalSpend: spend, totalKpiW: spend * kpi, totalActions: isFin_reco && kpi > 0 ? spend / kpi : 0 });
      }
    }
    const recoDays = [...recoDailyAgg.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, d]) => ({
        kpiActual: isFin_reco
          ? (d.totalActions > 0 ? d.totalSpend / d.totalActions : 0)
          : (d.totalSpend > 0 ? d.totalKpiW / d.totalSpend : 0),
      }))
      .filter(d => d.kpiActual > 0);
    
    if (recoDays.length < 3) return recos;
    const last3 = recoDays.slice(-3);
    
    const now = new Date().toISOString();
    const expiresIn5 = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    
    // Trend KPI sur 3 derniers jours (agrégés)
    const kpiTrend = last3.length >= 3 ? (last3[2].kpiActual - last3[0].kpiActual) / Math.max(last3[0].kpiActual, 0.01) : 0;
    
    // KPI stable sous objectif → monter marge
    if (isFin && project.actualKpi > 0 && project.actualKpi < project.targetKpi * 0.85 && Math.abs(kpiTrend) < 0.1) {
      recos.push({
        id: `reco_increase_${Date.now()}`,
        type: "increase_margin",
        trigger: `${project.kpiType} stable sous objectif depuis 3j (trend ${(kpiTrend * 100).toFixed(1)}%)`,
        optimalDay: currentDay + 1,
        confidence: 75,
        expectedImpact: `Montée de +3-5 pts de marge possible sans risque KPI (marge d'avance de ${((1 - project.actualKpi / project.targetKpi) * 100).toFixed(0)}%)`,
        expiresAt: expiresIn5,
        status: "pending",
        createdAt: now
      });
    }
    
    // KPI qualité au-dessus de l'objectif → monter marge
    if (!isFin && project.actualKpi > project.targetKpi * 1.15 && Math.abs(kpiTrend) < 0.1) {
      recos.push({
        id: `reco_increase_qual_${Date.now()}`,
        type: "increase_margin",
        trigger: `${project.kpiType} à ${project.actualKpi.toFixed(2)}% (>${project.targetKpi.toFixed(2)}% objectif) stable`,
        optimalDay: currentDay + 1,
        confidence: 70,
        expectedImpact: `Marge augmentable de +3-5 pts avec un impact qualité minime (<2%)`,
        expiresAt: expiresIn5,
        status: "pending",
        createdAt: now
      });
    }
    
    // KPI en dégradation → baisser marge
    if (isFin && kpiTrend > 0.15 && project.actualKpi > project.targetKpi) {
      recos.push({
        id: `reco_decrease_${Date.now()}`,
        type: "decrease_margin",
        trigger: `${project.kpiType} en hausse de +${(kpiTrend * 100).toFixed(0)}% sur 3j — dépasse l'objectif`,
        optimalDay: currentDay,
        confidence: 80,
        expectedImpact: `Baisse de marge de -3 à -5 pts recommandée pour stabiliser le KPI avant reporting`,
        expiresAt: expiresIn5,
        status: "pending",
        createdAt: now
      });
    }
    
    // Pacing en retard → boost budget
    const theoreticalSpent = project.budgetTotal * (currentDay / project.durationDays);
    const pacingPct = theoreticalSpent > 0 ? ((project.budgetSpent - theoreticalSpent) / theoreticalSpent) * 100 : 0;
    
    if (pacingPct < -15 && joursRestants > 5) {
      recos.push({
        id: `reco_boost_${Date.now()}`,
        type: "boost_budget",
        trigger: `Pacing en retard de ${pacingPct.toFixed(0)}% avec ${joursRestants}j restants`,
        optimalDay: currentDay,
        confidence: 85,
        expectedImpact: `Augmenter le budget journalier de +${Math.abs(pacingPct).toFixed(0)}% pour rattraper le pacing d'ici J+${Math.min(5, joursRestants)}`,
        expiresAt: expiresIn5,
        status: "pending",
        createdAt: now
      });
    }
    
    // Pacing en avance → réduire
    if (pacingPct > 15 && joursRestants > 5) {
      recos.push({
        id: `reco_reduce_${Date.now()}`,
        type: "reduce_budget",
        trigger: `Pacing en avance de +${pacingPct.toFixed(0)}% — risque de fin de budget prématurée`,
        optimalDay: currentDay,
        confidence: 80,
        expectedImpact: `Réduire le spend quotidien de -${(pacingPct * 0.5).toFixed(0)}% pour lisser sur les ${joursRestants}j restants`,
        expiresAt: expiresIn5,
        status: "pending",
        createdAt: now
      });
    }
    
    // Fenêtre d'opportunité : mi-campagne + KPI OK
    if (currentDay >= project.durationDays * 0.4 && currentDay <= project.durationDays * 0.6) {
      const kpiOk = isFin ? project.actualKpi <= project.targetKpi : project.actualKpi >= project.targetKpi;
      if (kpiOk && currentMarginPctCalc < 50) {
        recos.push({
          id: `reco_midcamp_${Date.now()}`,
          type: "increase_margin",
          trigger: `Mi-campagne (J${currentDay}/${project.durationDays}) avec KPI atteint — fenêtre optimale`,
          optimalDay: currentDay + 2,
          confidence: 90,
          expectedImpact: `Moment idéal pour tester une montée de +5-8 pts : assez de données pour valider, assez de temps pour corriger`,
          expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          status: "pending",
          createdAt: now
        });
      }
    }
    
    return recos;
  })();

  // --- 4. BENCHMARK (snapshot campagne courante) ---
  const currentBenchmark = (() => {
    if (project.budgetTotal <= 0 || project.durationDays <= 0) return null;
    const completionPct = currentDay / project.durationDays;
    const kpiVsTarget = project.targetKpi > 0 
      ? (isFin ? project.targetKpi / Math.max(project.actualKpi, 0.01) : project.actualKpi / project.targetKpi)
      : 0;
    
    // 🔥 V11.0 FIX : Agréger par DATE avant de calculer le pacing accuracy
    let pacingAccuracy = 0;
    if (project.dailyEntries && project.dailyEntries.length > 0) {
      // Agréger spend par jour unique
      const pacingDailyAgg = new Map<string, number>();
      for (const e of project.dailyEntries) {
        pacingDailyAgg.set(e.date, (pacingDailyAgg.get(e.date) || 0) + (e.budgetSpent || 0));
      }
      const dailySpends = [...pacingDailyAgg.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]));
      
      let onTrackDays = 0;
      let cumulSpend = 0;
      dailySpends.forEach(([, spend], idx) => {
        cumulSpend += spend;
        const dayNum = idx + 1;
        const expected = project.budgetTotal * (dayNum / project.durationDays);
        const pct = expected > 0 ? Math.abs((cumulSpend - expected) / expected) * 100 : 0;
        if (pct <= 10) onTrackDays++;
      });
      pacingAccuracy = dailySpends.length > 0 ? (onTrackDays / dailySpends.length) * 100 : 0;
    }
    
    return {
      projectId: project.id,
      projectName: project.name,
      kpiType: project.kpiType,
      funnelType: funnelType,
      avgMargin: dailyAverages.avgMargin,
      maxMarginBeforeDegradation: currentMarginPctCalc,
      avgKpiVsTarget: kpiVsTarget,
      pacingAccuracy,
      totalGainRealized: gainRealized,
      durationDays: project.durationDays,
      completionPct: completionPct * 100,
      snapshotDate: new Date().toISOString()
    };
  })();

  // ========================================
  // 🔥 V5.0 : SCORE DE SANTÉ CAMPAGNE (0-100)
  // ========================================
  const healthScore = (() => {
    if (project.budgetTotal <= 0 || project.durationDays <= 0) return null;
    let score = 0;
    
    // 1. PACING (25 pts)
    const theoSpent = currentDay > 0 ? project.budgetTotal * (currentDay / project.durationDays) : 0;
    const pacAbsDev = theoSpent > 0 ? Math.abs((project.budgetSpent - theoSpent) / theoSpent) * 100 : 0;
    if (pacAbsDev <= 5) score += 25;
    else if (pacAbsDev <= 10) score += 20;
    else if (pacAbsDev <= 20) score += 12;
    else if (pacAbsDev <= 30) score += 5;
    
    // 2. KPI vs OBJECTIF (25 pts)
    // 🔥 V12.0 : Pondérer par la maturité de la campagne
    // Phase d'apprentissage (0-30% de la durée) : le KPI n'est pas encore fiable
    // → Atténuer le score KPI pour ne pas pénaliser la campagne trop tôt
    // Phase mature (>30%) : le KPI est fiable, scoring normal
    // Phase finale (>80%) : le KPI est critique, scoring durci
    if (project.actualKpi > 0 && project.targetKpi > 0) {
      const kR = isFin ? project.actualKpi / project.targetKpi : project.targetKpi / project.actualKpi;
      const completionPct = currentDay / Math.max(1, project.durationDays);
      
      // Facteur de maturité : 
      // - Phase apprentissage (0-30%) : facteur 0.4→0.8 (score atténué)
      // - Phase mature (30-80%) : facteur 1.0 (score normal)
      // - Phase finale (80-100%) : facteur 1.15 (score durci — plus de temps pour corriger)
      let maturityFactor: number;
      if (completionPct < 0.30) {
        // Interpolation linéaire 0.4 → 0.8 sur les 30 premiers %
        maturityFactor = 0.4 + (completionPct / 0.30) * 0.4;
      } else if (completionPct < 0.80) {
        maturityFactor = 1.0;
      } else {
        // Interpolation linéaire 1.0 → 1.15 sur les 20 derniers %
        maturityFactor = 1.0 + ((completionPct - 0.80) / 0.20) * 0.15;
      }
      
      // Score brut (même logique qu'avant)
      let kpiRawScore: number;
      if (kR <= 0.85) kpiRawScore = 25;
      else if (kR <= 1.0) kpiRawScore = 20;
      else if (kR <= 1.15) kpiRawScore = 12;
      else if (kR <= 1.3) kpiRawScore = 5;
      else kpiRawScore = 0;
      
      // Appliquer le facteur de maturité
      // En phase apprentissage : un mauvais KPI pénalise moins (on lui laisse le temps)
      // En phase finale : un mauvais KPI pénalise plus (urgence)
      if (kpiRawScore < 20) {
        // KPI en difficulté → atténuer en phase learning, durcir en phase finale
        score += Math.round(kpiRawScore * maturityFactor);
      } else {
        // KPI OK → pas besoin d'ajuster
        score += kpiRawScore;
      }
    } else { score += 10; }
    
    // 3. MARGE (20 pts)
    if (currentMarginPctCalc >= 20 && currentMarginPctCalc <= 65) score += 20;
    else if (currentMarginPctCalc >= 10 && currentMarginPctCalc <= 70) score += 15;
    else if (currentMarginPctCalc > 70) score += 8;
    else if (currentMarginPctCalc > 0) score += 5;
    
    // 4. ANOMALIES (15 pts)
    const hiAnom = detectedAnomalies.filter(a => a.severity === "high").length;
    const medAnom = detectedAnomalies.filter(a => a.severity === "medium").length;
    if (hiAnom === 0 && medAnom === 0) score += 15;
    else if (hiAnom === 0 && medAnom <= 2) score += 10;
    else if (hiAnom <= 1) score += 5;
    
   // 5. TREND KPI (15 pts) — 🔥 V11.0 FIX : Agréger par DATE (mode adgroup)
    if (project.dailyEntries && project.dailyEntries.length >= 3) {
      const isFin_hs = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
      const hsDailyAgg = new Map<string, { totalSpend: number; totalKpiW: number; totalActions: number }>();
      for (const e of project.dailyEntries) {
        const spend = e.budgetSpent || 0; const kpi = e.kpiActual || 0;
        const ex = hsDailyAgg.get(e.date);
        if (ex) { ex.totalSpend += spend; ex.totalKpiW += spend * kpi; if (isFin_hs && kpi > 0) ex.totalActions += spend / kpi; }
        else { hsDailyAgg.set(e.date, { totalSpend: spend, totalKpiW: spend * kpi, totalActions: isFin_hs && kpi > 0 ? spend / kpi : 0 }); }
      }
      const hsDays = [...hsDailyAgg.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, d]) => ({ kpi: isFin_hs ? (d.totalActions > 0 ? d.totalSpend / d.totalActions : 0) : (d.totalSpend > 0 ? d.totalKpiW / d.totalSpend : 0) }))
        .filter(d => d.kpi > 0);
      const l3 = hsDays.slice(-3);
      const kTrend = l3.length >= 3 && l3[0].kpi > 0 ? (l3[2].kpi - l3[0].kpi) / l3[0].kpi : 0;
      if (isFin) {
        if (kTrend <= -0.05) score += 15;
        else if (kTrend <= 0) score += 12;
        else if (kTrend <= 0.05) score += 8;
        else if (kTrend <= 0.15) score += 3;
      } else {
        if (kTrend >= 0.05) score += 15;
        else if (kTrend >= 0) score += 12;
        else if (kTrend >= -0.05) score += 8;
        else if (kTrend >= -0.15) score += 3;
      }
    } else { score += 7; }
    
    const s = Math.min(100, Math.max(0, score));
    return {
      score: s,
      level: s >= 75 ? "excellent" as const : s >= 50 ? "bon" as const : s >= 30 ? "attention" as const : "critique" as const,
      color: s >= 75 ? "emerald" as const : s >= 50 ? "blue" as const : s >= 30 ? "amber" as const : "red" as const
    };
  })();

  // ========================================
  // 🔥 V5.0 : PROJECTION FIN DE CAMPAGNE
  // ========================================
  const endProjection = (() => {
    if (!project.dailyEntries || project.dailyEntries.length < 3 || project.durationDays <= 0) return null;
    const joursRest = Math.max(0, project.durationDays - currentDay);
    if (joursRest <= 0) return null;
    
    // 🔥 FIX Bug 1 : Agréger par DATE d'abord (critique en mode adgroup)
    const dailyAgg = new Map<string, { totalSpend: number; totalMarginWeighted: number; totalKpiWeighted: number; totalActions: number }>();
    const isFin_proj = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
    
    for (const e of project.dailyEntries) {
      const spend = e.budgetSpent || 0;
      const kpi = e.kpiActual || 0;
      const margin = e.marginPct || 0;
      const existing = dailyAgg.get(e.date);
      if (existing) {
        existing.totalSpend += spend;
        existing.totalMarginWeighted += spend * margin;
        existing.totalKpiWeighted += spend * kpi;
        if (isFin_proj && kpi > 0) existing.totalActions += spend / kpi;
      } else {
        dailyAgg.set(e.date, {
          totalSpend: spend,
          totalMarginWeighted: spend * margin,
          totalKpiWeighted: spend * kpi,
          totalActions: isFin_proj && kpi > 0 ? spend / kpi : 0,
        });
      }
    }
    
    // Convertir en tableau trié par date, avec KPI et marge PONDÉRÉS par spend
    const aggDays = [...dailyAgg.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, d]) => ({
        date,
        spend: d.totalSpend,
        margin: d.totalSpend > 0 ? d.totalMarginWeighted / d.totalSpend : 0,
        kpi: isFin_proj
          ? (d.totalActions > 0 ? d.totalSpend / d.totalActions : 0)
          : (d.totalSpend > 0 ? d.totalKpiWeighted / d.totalSpend : 0),
      }))
      .filter(d => d.spend > 0); // Ignorer les jours à 0
    
    if (aggDays.length < 3) return null;
    
    const lastN = aggDays.slice(-5);
    const n = lastN.length;
    const xM = (n - 1) / 2;
    
    // 🔥 FIX Bug 2 + 5 : Moyennes PONDÉRÉES par spend (pas arithmétiques)
    const totalSpendWindow = lastN.reduce((s, d) => s + d.spend, 0);
    const avgSpend = totalSpendWindow / n; // Moyenne spend par JOUR (correct car agrégé)
    const avgMarg = totalSpendWindow > 0
      ? lastN.reduce((s, d) => s + d.spend * d.margin, 0) / totalSpendWindow
      : 0;
    const avgKpi = isFin_proj
      ? (() => {
          const totalActions = lastN.reduce((s, d) => d.kpi > 0 ? s + d.spend / d.kpi : s, 0);
          return totalActions > 0 ? totalSpendWindow / totalActions : 0;
        })()
      : totalSpendWindow > 0
        ? lastN.reduce((s, d) => s + d.spend * d.kpi, 0) / totalSpendWindow
        : 0;
    
    // Trend KPI (régression linéaire sur les KPI journaliers agrégés)
    const kMean = lastN.reduce((s, d) => s + d.kpi, 0) / n;
    let kNum = 0, kDen = 0;
    for (let i = 0; i < n; i++) { kNum += (i - xM) * (lastN[i].kpi - kMean); kDen += (i - xM) ** 2; }
    const kSlope = kDen > 0 ? kNum / kDen : 0;
    
    // Trend Spend (régression linéaire sur les spends journaliers agrégés)
    const sMean = avgSpend;
    let sNum = 0, sDen = 0;
    for (let i = 0; i < n; i++) { sNum += (i - xM) * (lastN[i].spend - sMean); sDen += (i - xM) ** 2; }
    const sSlope = sDen > 0 ? sNum / sDen : 0;
    
    // 🔥 V12.2 FIX : Projection spend — dampener la régression pour éviter l'extrapolation des week-ends
    // Avant : sSlope × (joursRest / 2) → multiplicateur 10.5 sur 21j restants → un dip weekend fait chuter de 50%
    // Après : sSlope × sqrt(joursRest) → multiplicateur 4.6 sur 21j → effet amorti logarithmiquement
    // Cap réduit de ±50% à ±30% — en programmatique, le trader contrôle le pacing via les bids DSP
    // Un spend moyen qui varierait de plus de ±30% nécessite un ajustement DSP, pas une projection catastrophe
    const slopeContrib = Math.max(-avgSpend * 0.30, Math.min(avgSpend * 0.30, sSlope * Math.sqrt(joursRest)));
    const projDailySpend = Math.max(avgSpend * 0.3, avgSpend + slopeContrib);
    const projTotalSpend = project.budgetSpent + projDailySpend * joursRest;
    
    // 🔥 FIX Bug 3 : KPI projeté MULTIPLICATIF (pas linéaire → ne tombe jamais à 0)
    let projKpiFinal: number;
    if (avgKpi > 0 && kMean > 0) {
      // Trend en % par jour, cappé à ±5%/jour max
      const dailyTrendPct = Math.max(-0.05, Math.min(0.05, kSlope / kMean));
      // Projeter sur joursRest avec décroissance exponentielle (pas linéaire)
      // Cap total à ±60% de changement max
      const totalChangePct = Math.max(-0.60, Math.min(0.60, dailyTrendPct * Math.sqrt(joursRest) * 2));
      projKpiFinal = avgKpi * (1 + totalChangePct);
    } else {
      projKpiFinal = avgKpi;
    }
    // Plancher absolu : jamais en dessous de 10% du KPI moyen
    projKpiFinal = Math.max(avgKpi * 0.10, projKpiFinal);
    
  // 🔥 V12.0 FIX : Capper le spend futur projeté au budget restant (le gain ne peut PAS dépasser le budget)
    const projFutureSpend = Math.min(budgetRemaining, projDailySpend * joursRest);
    // 🔥 V12.0 FIX CRITIQUE : Gain passé = marge CUMULÉE de toute la campagne (pas la dernière entrée)
    // Gain futur = marge moyenne des 5 derniers jours (tendance récente)
    const projGainFinal = (project.budgetSpent * (dailyAverages.avgMargin / 100)) + (projFutureSpend * (avgMarg / 100));
    const projPacing = project.budgetTotal > 0 ? (projTotalSpend / project.budgetTotal) * 100 : 0;
    
    return {
      kpiFinal: projKpiFinal, gainFinal: projGainFinal, spendFinal: projTotalSpend,
      pacingFinal: projPacing, dailySpendNeeded: budgetRemaining / Math.max(1, joursRest),
      dailySpendTrend: projDailySpend, joursRestants: joursRest,
      kpiTrendDir: kSlope > 0.001 ? "up" as const : kSlope < -0.001 ? "down" as const : "stable" as const,
      kpiSlope: kSlope
    };
  })();

  // ========================================
  // 🔥 V5.0 : COMPARAISON PÉRIODE vs PÉRIODE
  // ========================================
  const periodComparison = (() => {
    if (!project.dailyEntries || project.dailyEntries.length === 0) return null;
    if (!period1Start || !period1End || !period2Start || !period2End) return null;
    const p1E = project.dailyEntries.filter(e => e.date >= period1Start && e.date <= period1End);
    const p2E = project.dailyEntries.filter(e => e.date >= period2Start && e.date <= period2End);
    if (p1E.length === 0 || p2E.length === 0) return null;
    
    const calc = (entries: typeof p1E) => {
      const tot = entries.reduce((s, e) => s + e.budgetSpent, 0);
      const totalGain = entries.reduce((s, e) => s + e.budgetSpent * (e.marginPct / 100), 0);
      const totalImp = entries.reduce((s, e) => e.cpmRevenue > 0 ? s + e.budgetSpent / e.cpmRevenue : s, 0);
      const isFin_calc = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
      let cumulKpi = 0;
      if (tot > 0) {
        if (isFin_calc) {
          const totalActions = entries.reduce((s, e) => e.kpiActual > 0 ? s + e.budgetSpent / e.kpiActual : s, 0);
          cumulKpi = totalActions > 0 ? tot / totalActions : 0;
        } else {
          cumulKpi = entries.reduce((s, e) => s + e.budgetSpent * e.kpiActual, 0) / tot;
        }
      }
      // 🔥 V11.0 FIX : Compter les JOURS uniques, pas les entrées (mode adgroup)
      const uniqueDays = new Set(entries.map(e => e.date)).size;
      return {
        days: uniqueDays, totalSpend: tot,
        avgDailySpend: tot / Math.max(1, uniqueDays),
        avgMargin: tot > 0 ? (totalGain / tot) * 100 : 0,
        avgKpi: cumulKpi,
        avgCpmRevenue: totalImp > 0 ? tot / totalImp : 0,
        totalGain,
      };
    };
    return { p1: calc(p1E), p2: calc(p2E) };
  })();

  const fmtKpi = (val: number) => {
  const formatted = project.kpiType.includes("CPCV") ? val.toFixed(3) : val.toFixed(2);
  
  if (isFin) {
    return `${formatted} ${currSym}`;  // KPI financier → devise
  } else {
    return `${formatted} %`;           // KPI de qualité → pourcentage
  }
};
  

    // 🔥 V4.2 : IMPORT EXCEL INTELLIGENT — Auto-détection des colonnes + TTD
  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 🔥 V7.2 : DÉTECTION FORMAT TTD — Si colonnes TTD détectées, basculer en mode TTD
    const reader2 = new FileReader();
    reader2.onload = (evt2) => {
      try {
        const buf = evt2.target?.result;
        const wb2 = XLSX.read(buf, { type: "binary" });
        const ws2 = wb2.Sheets[wb2.SheetNames[0]];
       const headers2 = ((XLSX.utils.sheet_to_json(ws2, { header: 1 }) as any[])[0] || []) as any[];
        const headerStr = headers2.map((h: any) => String(h).toLowerCase()).join("|");
        
        // Détection TTD : colonnes spécifiques
        const isTTD = headerStr.includes("advertiser cost") && 
                      headerStr.includes("ad group") && 
                      headerStr.includes("partner cost");
        
        if (isTTD) {
          console.log("🔥 TTD format détecté — basculement en mode Import TTD");
          setTtdFile(file);
          setTtdMode(true);
          return; // Stop ici — le TTDImporter prend le relais
        }
      } catch (err) {
        console.warn("Détection TTD échouée, fallback import classique");
      }
      
      // === IMPORT CLASSIQUE (non-TTD) ===
      const readerClassic = new FileReader();
      readerClassic.onload = (evtClassic) => {
        const bstr = evtClassic.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws) as any[];
      
      if (data.length === 0) {
        alert("❌ Fichier vide ou format non reconnu.");
        return;
      }
      
      // --- AUTO-DÉTECTION DES COLONNES ---
      const headers = Object.keys(data[0]);
      const headerLower = headers.map(h => h.toLowerCase().trim());
      
      // Patterns de détection par métrique (ordre de priorité)
      const namePatterns = ["line item", "line_item", "lineitem", "name", "nom", "ligne", "placement", "insertion", "creative", "créatif", "ad group", "adgroup", "campaign", "campagne", "io", "order"];
      const spendPatterns = ["spend", "dépense", "depense", "budget", "cost", "coût", "cout", "revenue", "revenu", "media cost", "media spend", "montant", "amount", "imps cost", "total cost", "net spend"];
      const cpmRevPatterns = ["cpm revenue", "cpm revenu", "cpm rev", "cpm vendu", "cpm sold", "ecpm", "effective cpm", "cpm", "revenue cpm", "cpm facturé"];
      const marginPatterns = ["margin", "marge", "margin %", "marge %", "markup", "mark-up", "take rate", "commission"];
      const kpiPatterns = [project.kpiType.toLowerCase(), "kpi", "performance", "cpa", "cpc", "cpcv", "cpv", "ctr", "vtr", "viewability", "completion rate", "click rate", "conversion rate", "taux"];
      
      const findColumn = (patterns: string[]): string | null => {
        // 1. Match exact
        for (const p of patterns) {
          const idx = headerLower.indexOf(p);
          if (idx >= 0) return headers[idx];
        }
        // 2. Match partiel (le header CONTIENT le pattern)
        for (const p of patterns) {
          const idx = headerLower.findIndex(h => h.includes(p));
          if (idx >= 0) return headers[idx];
        }
        // 3. Match partiel inversé (le pattern CONTIENT le header)
        for (const p of patterns) {
          const idx = headerLower.findIndex(h => p.includes(h) && h.length > 2);
          if (idx >= 0) return headers[idx];
        }
        return null;
      };
      
      const nameCol = findColumn(namePatterns);
      const spendCol = findColumn(spendPatterns);
      const cpmRevCol = findColumn(cpmRevPatterns);
      const marginCol = findColumn(marginPatterns);
      const kpiCol = findColumn(kpiPatterns);
      
      console.log(`📊 V4.2 Import Excel — Colonnes détectées :`);
      console.log(`  Name: "${nameCol}" | Spend: "${spendCol}" | CPM Rev: "${cpmRevCol}" | Margin: "${marginCol}" | KPI: "${kpiCol}"`);
      console.log(`  Headers disponibles : ${headers.join(", ")}`);
      
      // --- PARSING INTELLIGENT DES VALEURS ---
      const parseNum = (val: any): number => {
        if (val === null || val === undefined || val === "") return 0;
        if (typeof val === "number") return val;
        // Nettoyer : enlever €, $, %, espaces, remplacer virgule par point
        const cleaned = String(val).replace(/[€$%\s]/g, "").replace(",", ".").trim();
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
      };
      
      // --- DÉTECTION AUTOMATIQUE : marge en % ou en décimal ---
      let marginIsDecimal = false;
      if (marginCol) {
        const firstMarginValues = data.slice(0, 5).map(r => parseNum(r[marginCol])).filter(v => v > 0);
        if (firstMarginValues.length > 0 && firstMarginValues.every(v => v <= 1)) {
          marginIsDecimal = true; // Ex: 0.35 au lieu de 35
        }
      }
      
      // --- DÉTECTION AUTOMATIQUE : KPI qualité en % ou décimal ---
      let kpiIsDecimal = false;
      if (kpiCol && !isFin) {
        const firstKpiValues = data.slice(0, 5).map(r => parseNum(r[kpiCol])).filter(v => v > 0);
        if (firstKpiValues.length > 0 && firstKpiValues.every(v => v <= 1)) {
          kpiIsDecimal = true; // Ex: 0.65 au lieu de 65%
        }
      }
      
      // --- CONSTRUCTION DES LINE ITEMS ---
      const newItems: LineItem[] = data
        .filter(row => {
          // Filtrer les lignes vides ou les totaux
          const name = nameCol ? String(row[nameCol] || "").trim() : "";
          const spend = spendCol ? parseNum(row[spendCol]) : 0;
          if (name.toLowerCase().includes("total") || name.toLowerCase().includes("somme") || name.toLowerCase().includes("sum")) return false;
          if (!name && spend === 0) return false;
          return true;
        })
        .map((row: any, idx) => {
          let margin = marginCol ? parseNum(row[marginCol]) : currentMarginPctCalc;
          if (marginIsDecimal && margin <= 1) margin = margin * 100;
          
          let kpi = kpiCol ? parseNum(row[kpiCol]) : project.actualKpi;
          if (kpiIsDecimal && kpi <= 1) kpi = kpi * 100;
          
          return {
            id: Date.now().toString() + idx,
            name: nameCol ? String(row[nameCol] || `Line ${idx + 1}`).trim() : `Line ${idx + 1}`,
            spend: spendCol ? parseNum(row[spendCol]) : 0,
            cpmRevenue: cpmRevCol ? parseNum(row[cpmRevCol]) : project.cpmRevenueActual,
            marginPct: Math.max(0, Math.min(100, margin)),
            kpiActual: kpi,
          };
        });

      if (newItems.length === 0) {
        alert("❌ Aucune ligne valide détectée dans le fichier. Vérifiez les colonnes.");
        return;
      }
      
      // --- RÉSUMÉ POUR LE TRADER ---
      const totalSpend = newItems.reduce((s, l) => s + l.spend, 0);
      const avgMargin = newItems.reduce((s, l) => s + l.marginPct, 0) / newItems.length;
      const detectedCols = [nameCol, spendCol, cpmRevCol, marginCol, kpiCol].filter(Boolean);
      
      const summary = `✅ ${newItems.length} lignes importées !\n\n` +
        `📊 Colonnes détectées (${detectedCols.length}/5) :\n` +
        `  • Nom : ${nameCol || "❌ Non trouvé (noms génériques)"}\n` +
        `  • Dépense : ${spendCol || "❌ Non trouvé (0€)"}\n` +
        `  • CPM Revenue : ${cpmRevCol || "⚠️ Non trouvé (défaut: " + project.cpmRevenueActual.toFixed(2) + currSym + ")"}\n` +
        `  • Marge : ${marginCol ? marginCol + (marginIsDecimal ? " (converti de décimal)" : "") : "⚠️ Non trouvé (défaut: " + currentMarginPctCalc.toFixed(1) + "%)"}\n` +
        `  • KPI : ${kpiCol ? kpiCol + (kpiIsDecimal ? " (converti de décimal)" : "") : "⚠️ Non trouvé (défaut: " + project.actualKpi + ")"}\n\n` +
        `💰 Total spend : ${totalSpend.toFixed(2)} ${currSym}\n` +
        `📈 Marge Cumulée : ${avgMargin.toFixed(1)}%`;
      
      alert(summary);
      updateField("lineItems", newItems);
    };
    readerClassic.readAsBinaryString(file);
    };
    reader2.readAsBinaryString(file);
  };
  const handleOptimize = () => {
    if (!marginGoal) {
      alert("Veuillez sélectionner un objectif avant d'optimiser.");
      return;
    }
    // 🏆 V2.0 : Pareto géré par ParetoPanel, skip ici
    if (marginGoal === "pareto") return;
    const now = new Date();
    const startDate = project.startDate ? new Date(project.startDate) : now;
    const joursEcoules = Math.max(1, Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const joursRestants = Math.max(1, project.durationDays - joursEcoules);
    const budgetRestant = project.budgetTotal - project.budgetSpent;
    const budgetJournalierDisponible = budgetRestant / joursRestants;
    
    // 🔥 V2 : Calculs communs
    const maxSpend = Math.max(...project.lineItems.map(li => li.spend || 0), 1);
    const avgDailyAll = project.lineItems.reduce((acc, li) => acc + ((li.spend || 0) / joursEcoules), 0) / Math.max(project.lineItems.length, 1);
    const targetKpi = project.targetKpi || 0.0001;
    
    // 🔥 V3 : Ancre marge campagne (dernière marge globale du suivi campagnes)
    const campaignMargin = currentMarginPctCalc; // = dernière entrée dailyEntries ou fallback sidebar
    
    /** Calcule un facteur de modulation [0.2 - 1.5] basé sur l'écart ligne vs campagne.
     *  Si ligne > campagne → facteur < 1 (conservateur)
     *  Si ligne < campagne → facteur > 1 (pousse plus fort)
     *  Si ligne = campagne → facteur = 1 (neutre) */
    const getMarginModerator = (lineMargin: number): number => {
      if (campaignMargin <= 0) return 1.0;
      const gapRatio = (lineMargin - campaignMargin) / campaignMargin;
      return Math.max(0.2, Math.min(1.5, 1 - gapRatio));
    };
    
    console.log(`📊 V2 : ${joursEcoules}j écoulés, ${joursRestants}j restants, ${budgetJournalierDisponible.toFixed(2)} ${currSym}/jour, maxSpend=${maxSpend.toFixed(0)}`);
    console.log(`📊 V3 : Ancre marge campagne = ${campaignMargin.toFixed(2)}%`);
    
    // 🔥 V11.0 FIX : Calculer agStats UNE SEULE FOIS (opération lourde)
    const agStats = computeAdGroupStats(project);
    
     
  
    // ============================================================
    // 🚀 MODE BOOST KPI
    // ============================================================
    if (marginGoal === "boost_kpi") {
      const isFin = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
      
      const agStatsBoost = agStats;
      const analyzedItems: OptimizationItem[] = project.lineItems.map(li => {
        const actual = li.kpiActual ?? 0;
        const target = targetKpi;
        
        // 🔥 V10.0 : Scoring continu logarithmique (0-10) au lieu de catégoriel
        // 🔥 V12.0 : Ajuster le scoring par tolérance KPI (branding = plus tolérant)
        let perfScore = continuousPerfScore(actual, target, isFin);
        perfScore = Math.min(10, perfScore * getKpiToleranceFactor(project.kpiType));
        let perfCategory = scoreToCategoryFromContinuous(perfScore);
        
       // 🔥 V2 : Pondération volume + fill rate
        const volWeight = calculateVolumeWeight(li.spend || 0, maxSpend);
        perfScore *= volWeight;
        const dailyAvg = (li.spend || 0) / joursEcoules;
        const fillRate = estimateFillRate(dailyAvg, li.spend || 0, joursEcoules);
        
       // 📊 V10.1 : Risk adjustment (Sharpe Ratio) — pénalise les lignes volatiles
        const enrichedBoost = enrichLineItemFromLearning(li, agStatsBoost, project.kpiType, targetKpi, campaignMargin);
        const riskMult = riskAdjustMultiplier(enrichedBoost.calibratedVolatility);
        perfScore *= riskMult;
        
        return { ...li, perfScore, perfCategory, volumeWeight: volWeight, fillRate };
});
      const lockedDailySpend = analyzedItems.filter(li => lockedLines.has(li.id)).reduce((acc, li) => acc + ((li.spend || 0) / joursEcoules), 0);
      const availableDailyBudget = budgetJournalierDisponible - lockedDailySpend;
      const unlockedItems = analyzedItems.filter(li => !lockedLines.has(li.id));
      const totalScore = unlockedItems.reduce((acc, li) => acc + (li.perfScore || 0), 0);
      
      let optimizedItems: OptimizationItem[] = analyzedItems.map(li => {
        if (lockedLines.has(li.id)) {
          const dailyAvg = (li.spend || 0) / joursEcoules;
          return { ...li, dailyBudgetAverage: dailyAvg, dailyBudgetProposed: dailyAvg, totalRemainingBudget: dailyAvg * joursRestants, newMargin: li.marginPct, newCpmRevenue: li.cpmRevenue, action: "🔒 Verrouillée" };
        }
        // 🔥 V12.0 FIX : Les lignes DEAD ne reçoivent AUCUN budget — redistribué aux performantes
        // En programmatique, une ligne à KPI=0 ne convertira pas avec plus de budget (problème ciblage/créa)
        if (li.perfCategory === "dead") {
          const dailyAvg = (li.spend || 0) / joursEcoules;
          return { ...li, dailyBudgetAverage: dailyAvg, dailyBudgetProposed: 0, totalRemainingBudget: 0, newMargin: li.marginPct, newCpmRevenue: li.cpmRevenue, action: "💀 DEAD → Budget coupé (redistribué aux performantes)" };
        }
        const dailyAvg = (li.spend || 0) / joursEcoules;
        const theoreticalDaily = totalScore > 0 ? ((li.perfScore || 0) / totalScore) * availableDailyBudget : dailyAvg;
        let proposedDaily = (theoreticalDaily * 0.7) + (dailyAvg * 0.3);
        
        // 🔥 V2 : Cap dynamique
        const dynamicCap = getDynamicBudgetCap(dailyAvg, avgDailyAll, "boost_kpi");
        const maxChange = dailyAvg * dynamicCap;
        proposedDaily = Math.max(Math.max(0, dailyAvg - maxChange), Math.min(dailyAvg + maxChange, proposedDaily));
        
        // 🔥 V2 : Contrainte fill rate
        const fillRate = li.fillRate || 0.85;
        if (dailyAvg > 0) proposedDaily = Math.min(proposedDaily, (dailyAvg / fillRate) * 1.2);
        
        const totalRemaining = proposedDaily * joursRestants;
        const budgetChange = proposedDaily - dailyAvg;
        const budgetChangePct = dailyAvg > 0 ? (budgetChange / dailyAvg) * 100 : 0;
        let action = "";
        if (li.perfCategory === "star") action = `⭐ STAR → ${proposedDaily.toFixed(2)} ${currSym}/jour (+${budgetChangePct.toFixed(0)}%)`;
        else if (li.perfCategory === "good") action = `✅ GOOD → ${proposedDaily.toFixed(2)} ${currSym}/jour (${budgetChangePct > 0 ? "+" : ""}${budgetChangePct.toFixed(0)}%)`;
        else if (li.perfCategory === "ok") action = `➖ OK → ${proposedDaily.toFixed(2)} ${currSym}/jour (${budgetChangePct > 0 ? "+" : ""}${budgetChangePct.toFixed(0)}%)`;
        else if (li.perfCategory === "underperforming") action = `⚠️ SOUS-PERF → ${proposedDaily.toFixed(2)} ${currSym}/jour (${budgetChangePct.toFixed(0)}%)`;
        else action = `💀 DEAD → ${proposedDaily.toFixed(2)} ${currSym}/jour (${budgetChangePct.toFixed(0)}%)`;
        
        return { ...li, dailyBudgetAverage: dailyAvg, dailyBudgetProposed: proposedDaily, totalRemainingBudget: totalRemaining, spend: li.spend, newMargin: li.marginPct, newCpmRevenue: li.cpmRevenue, action };
      });
      
      if (trend !== null && trend > 0) {
        const totalDailyProposed = optimizedItems.reduce((acc, li) => acc + (li.dailyBudgetProposed || 0), 0);
        const maxAllowedDaily = trend * 1.15;
        if (totalDailyProposed > maxAllowedDaily) {
          const lockedDaily = optimizedItems.filter(li => lockedLines.has(li.id)).reduce((acc, li) => acc + (li.dailyBudgetProposed || 0), 0);
          const unlockedDaily = totalDailyProposed - lockedDaily;
          const ratio = unlockedDaily > 0 ? (maxAllowedDaily - lockedDaily) / unlockedDaily : 1;
          optimizedItems = optimizedItems.map(li => {
            if (lockedLines.has(li.id)) return li;
            const np = (li.dailyBudgetProposed || 0) * ratio;
            return { ...li, dailyBudgetProposed: Number(np.toFixed(2)), totalRemainingBudget: Number((np * joursRestants).toFixed(2)) };
          });
        }
      }
      setProposedOptimizations(optimizedItems);
      return;
    }
         
    // ============================================================
    // 🔥 MODE AGGRESSIF + CONTRAINTE KPI
    // ============================================================
    if (marginGoal === "increase_aggressive") {
      const isFin = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
      const lockedDailySpend = project.lineItems.filter(li => lockedLines.has(li.id)).reduce((acc, li) => acc + ((li.spend || 0) / joursEcoules), 0);
      const totalDailySpend = project.lineItems.reduce((acc, li) => acc + ((li.spend || 0) / joursEcoules), 0);
      
      const analyzedItems: OptimizationItem[] = project.lineItems.map(li => {
        const actual = li.kpiActual ?? 0;
        const target = targetKpi;
       // 🔥 V10.0 : Scoring continu
        // 🔥 V12.0 : Ajuster par tolérance KPI (branding vs performance)
        const perfScoreRaw = continuousPerfScore(actual, target, isFin) * getKpiToleranceFactor(project.kpiType);
        let perfRatio = isFin ? (actual > 0 ? target / actual : 0) : actual / target;
        let perfCategory = scoreToCategoryFromContinuous(Math.min(10, perfScoreRaw));
        const volWeight = calculateVolumeWeight(li.spend || 0, maxSpend);
        const dailyAvg = (li.spend || 0) / joursEcoules;
        const fillRate = estimateFillRate(dailyAvg, li.spend || 0, joursEcoules);
        return { ...li, perfRatio, perfCategory, volumeWeight: volWeight, fillRate };
      });
      
      // 🔥 V2 : MARGE AVEC CONTRAINTE KPI
      const agStats_agg = computeAdGroupStats(project);
      let optimizedItems: OptimizationItem[] = analyzedItems.map(li => {
        let newMargin = li.marginPct;
        let newCpmRevenue = li.cpmRevenue;
        let action = "";
        if (lockedLines.has(li.id)) return { ...li, newMargin, newCpmRevenue, action: "🔒 Verrouillée" };
        
       let targetMargin = li.marginPct;
        // 🔥 V3 : Marges relatives ancrées sur la marge campagne
        const mod = getMarginModerator(li.marginPct);
// 🔥 V8.0 : Learning Engine
const enriched_agg = enrichLineItemFromLearning(li, agStats_agg, project.kpiType, targetKpi, campaignMargin);
if (enriched_agg.calibratedIncrement > 0 && li.perfCategory !== "dead") {
  // Mode agressif : multiplier l'incrément calibré par 2.5
  targetMargin = Math.min(95, li.marginPct + (enriched_agg.calibratedIncrement * 2.5 * mod));
} else {
  switch (li.perfCategory) {
    case "star": targetMargin = Math.min(95, li.marginPct + (40 * mod)); break;
    case "good": targetMargin = Math.min(95, li.marginPct + (30 * mod)); break;
    case "ok": targetMargin = Math.min(95, li.marginPct + (20 * mod)); break;
    case "underperforming": targetMargin = Math.min(95, li.marginPct + (10 * mod)); break;
    case "dead": targetMargin = 0; break;
  }
}
        
        // 🔥 V2 : CONTRAINTE KPI - bisection automatique
        if (targetMargin > 0 && li.kpiActual > 0) {
         targetMargin = clampMarginForKpi(li.kpiActual, li.marginPct, targetMargin, li.cpmRevenue, targetKpi, isFin, project.kpiType, 0.25, getReachElasticity());
        }
        newMargin = targetMargin;
        
        if (newMargin > 0) {
          const cpmCost = li.cpmRevenue * (1 - li.marginPct / 100);
          newCpmRevenue = cpmCost / (1 - newMargin / 100);
        }
        if (respectCpmCap) newCpmRevenue = Math.min(project.cpmSoldCap, newCpmRevenue);
        
        const kpiProj = projectLineKpi(li.kpiActual, li.marginPct, newMargin, li.cpmRevenue, isFin, project.kpiType, getReachElasticity());
        switch (li.perfCategory) {
          case "star": action = `⭐ STAR → Marge ${newMargin.toFixed(0)}% (KPI: ${fmtKpi(kpiProj)})`; break;
          case "good": action = `✅ GOOD → Marge ${newMargin.toFixed(0)}% (KPI: ${fmtKpi(kpiProj)})`; break;
          case "ok": action = `➖ OK → Marge ${newMargin.toFixed(0)}% (KPI: ${fmtKpi(kpiProj)})`; break;
          case "underperforming": action = `⚠️ SOUS-PERF → Marge ${newMargin.toFixed(0)}%`; break;
          case "dead": action = "💀 DEAD → ÉLIMINATION"; break;
        }
        return { ...li, newMargin, newCpmRevenue, action, riskVolatility: enriched_agg.calibratedVolatility };
      });
      
      // SCORING + VOLUME
      const itemsWithScore: OptimizationItem[] = optimizedItems.map(item => {
        if (lockedLines.has(item.id)) return { ...item, allocationScore: 0 };
        let baseScore = 0;
        const cScore = continuousPerfScore(item.kpiActual ?? 0, targetKpi, isFin);         baseScore = Math.max(0, cScore * cScore / 5); // Quadratique : les stars captent exponentiellement plus
        
        // 🔥 V2 : Volume weight
        baseScore *= (item.volumeWeight || 0.1);
        
        // 📊 V10.1 : Risk adjustment — ligne volatile = score réduit
        const riskMultAgg = riskAdjustMultiplier(item.riskVolatility || 0);
        baseScore *= riskMultAgg;
        
        let capBonus = 1.0, marginBonus = 1.0;
        if (respectCpmCap) {
          const currentWeightedCpmRev = totalDailySpend > 0 ? optimizedItems.reduce((acc, l) => { const ds = (l.spend || 0) / joursEcoules; return acc + ds * (l.newCpmRevenue || l.cpmRevenue); }, 0) / totalDailySpend : 0;
          const newCpmRev = item.newCpmRevenue || item.cpmRevenue;
          const cpmGap = currentWeightedCpmRev - project.cpmSoldCap;
          if (cpmGap > 0) { capBonus = newCpmRev < project.cpmSoldCap ? 1.0 + ((project.cpmSoldCap - newCpmRev) / project.cpmSoldCap) * 1.0 : 1.0 - ((newCpmRev - project.cpmSoldCap) / project.cpmSoldCap) * 0.6; }
          else { if (newCpmRev > currentWeightedCpmRev) capBonus = 1.0 + ((newCpmRev - currentWeightedCpmRev) / Math.max(currentWeightedCpmRev, 1)) * 0.4; }
          capBonus = Math.max(0.2, Math.min(2.0, capBonus));
        }
        const marginIncrease = (item.newMargin || item.marginPct) - item.marginPct;
        if (marginIncrease > 50) marginBonus = 2.5; else if (marginIncrease > 30) marginBonus = 2.0; else if (marginIncrease > 15) marginBonus = 1.5;
        return { ...item, allocationScore: baseScore * capBonus * marginBonus, capAlignmentBonus: capBonus };
      });
      
      // REDISTRIBUTION + RENDEMENTS DÉCROISSANTS + FILL RATE
      const unlockedItems = itemsWithScore.filter(li => !lockedLines.has(li.id));
      const totalScore = unlockedItems.reduce((acc, li) => acc + (li.allocationScore || 0), 0);
      let finalItems: OptimizationItem[] = itemsWithScore.map(li => {
        let finalSpend = li.spend || 0;
        if (!lockedLines.has(li.id)) {
          if (li.perfCategory === "dead") { finalSpend = 0; }
          else {
            const theoreticalSpend = totalScore > 0 ? ((li.allocationScore || 0) / totalScore) * budgetRestant : (li.spend || 0);
            finalSpend = (theoreticalSpend * 0.95) + ((li.spend || 0) * 0.05);
            // 🔥 V2 : Cap dynamique
            const dailyAvg = (li.spend || 0) / joursEcoules;
            const dynamicCap = getDynamicBudgetCap(dailyAvg, avgDailyAll, "increase_aggressive");
            const maxChange = (li.spend || 0) * dynamicCap;
            finalSpend = Math.max(Math.max(0, (li.spend || 0) - maxChange), Math.min((li.spend || 0) + maxChange, finalSpend));
            // 🔥 V2 : Fill rate
            const fillRate = li.fillRate || 0.85;
            if ((li.spend || 0) > 0) finalSpend = Math.min(finalSpend, (li.spend || 0) / fillRate * 1.2);
          }
        }
        return { ...li, spend: Number(finalSpend.toFixed(2)), cpmRevenue: Number((li.newCpmRevenue || li.cpmRevenue).toFixed(2)), marginPct: Number((li.newMargin || li.marginPct).toFixed(2)) };
      });
      
      setProposedOptimizations(finalItems);
      return;
    }
 
    // ============================================================
    // 🔥 MODES INCREASE / DECREASE
    // ============================================================
    if (marginGoal === "increase" || marginGoal === "decrease") {
      const totalDailySpend = project.lineItems.reduce((acc, li) => acc + ((li.spend || 0) / joursEcoules), 0);
      const lockedDailySpend = project.lineItems.filter(li => lockedLines.has(li.id)).reduce((acc, li) => acc + ((li.spend || 0) / joursEcoules), 0);
      const availableDailyBudget = budgetJournalierDisponible - lockedDailySpend;
      
      const analyzedItems: OptimizationItem[] = project.lineItems.map(li => {
        const actual = li.kpiActual ?? 0;
        const target = targetKpi;
        // 🔥 V10.0 : Scoring continu
        // 🔥 V12.0 : Ajuster par tolérance KPI (branding vs performance)
        const perfScoreRaw = continuousPerfScore(actual, target, isFin) * getKpiToleranceFactor(project.kpiType);
        let perfRatio = isFin ? (actual > 0 ? target / actual : 0) : actual / target;
        let perfCategory = scoreToCategoryFromContinuous(Math.min(10, perfScoreRaw));
        const volWeight = calculateVolumeWeight(li.spend || 0, maxSpend);
        const dailyAvg = (li.spend || 0) / joursEcoules;
        const fillRate = estimateFillRate(dailyAvg, li.spend || 0, joursEcoules);
        return { ...li, perfRatio, perfCategory, volumeWeight: volWeight, fillRate };
      });
    
      const agStats_incDec = computeAdGroupStats(project);
      let optimizedItems: OptimizationItem[] = analyzedItems.map(li => {
        let newMargin = li.marginPct;
        let newCpmRevenue = li.cpmRevenue;
        let action = "";
        if (lockedLines.has(li.id)) return { ...li, newMargin, newCpmRevenue, action: "🔒 Verrouillée" };
        
       // 📊 V10.1 : Calculer enriched pour les deux branches (increase ET decrease)
        const enriched = enrichLineItemFromLearning(li, agStats_incDec, project.kpiType, targetKpi, campaignMargin);
        
        if (marginGoal === "increase") {
          let targetMargin = li.marginPct;
         const mod = getMarginModerator(li.marginPct);
if (enriched.calibratedIncrement > 0) {
  targetMargin = Math.min(95, li.marginPct + (enriched.calibratedIncrement * mod));
} else {
  switch (li.perfCategory) {
    case "star": targetMargin = Math.min(95, li.marginPct + (15 * mod)); break;
    case "good": targetMargin = Math.min(95, li.marginPct + (10 * mod)); break;
    case "ok": targetMargin = Math.min(95, li.marginPct + (5 * mod)); break;
    case "underperforming": targetMargin = Math.min(95, li.marginPct + (2 * mod)); break;
    case "dead": targetMargin = li.marginPct; break;
  }
}
          // 🔥 V2 : Contrainte KPI
          if (li.kpiActual > 0 && li.perfCategory !== "dead") {
            targetMargin = clampMarginForKpi(li.kpiActual, li.marginPct, targetMargin, li.cpmRevenue, targetKpi, isFin, project.kpiType, 0.20, getReachElasticity());
          }
          newMargin = targetMargin;
         const prefix = li.perfCategory === "star" ? "⭐ STAR" : li.perfCategory === "good" ? "✅ GOOD" : li.perfCategory === "ok" ? "➖ OK" : li.perfCategory === "underperforming" ? "⚠️ SOUS-PERF" : "💀 DEAD";
const funnelBadge = enriched.detectedFunnel !== "unknown" ? ` [${enriched.detectedFunnel.toUpperCase()}]` : "";
action = `${prefix}${funnelBadge} → Marge +${(newMargin - li.marginPct).toFixed(1)}%`;
if (enriched.insight) action += ` • ${enriched.insight}`;
          
          const cpmCost = li.cpmRevenue * (1 - li.marginPct / 100);
          newCpmRevenue = newMargin < 100 ? cpmCost / (1 - newMargin / 100) : li.cpmRevenue;
         } else if (marginGoal === "decrease") {
          // 🔥 V3 : Décréments modulés — inversé car baisse : ligne au-dessus → baisser plus fort
          const modDec = Math.max(0.3, Math.min(2.0, 1 + (li.marginPct - campaignMargin) / Math.max(campaignMargin, 1)));
           // 🔥 V3.5 : CPM Revenue recalculé mathématiquement
          const cpmCostLine = li.cpmRevenue * (1 - li.marginPct / 100);
          switch (li.perfCategory) {
            case "dead": newMargin = Math.max(5, li.marginPct - (10 * modDec)); action = "💀 DEAD → Couper"; break;
            case "underperforming": newMargin = Math.max(5, li.marginPct - (8 * modDec)); action = "⚠️ SOUS-PERF → Baisse agressive"; break;
            case "ok": newMargin = Math.max(5, li.marginPct - (5 * modDec)); action = "➖ OK → Ajust équilibré"; break;
            case "good": newMargin = Math.max(10, li.marginPct - (3 * modDec)); action = "✅ GOOD → Maintenir"; break;
            case "star": newMargin = li.marginPct; action = "⭐ STAR → Parfait !"; break;
          }
          newCpmRevenue = newMargin < 100 ? cpmCostLine / (1 - newMargin / 100) : li.cpmRevenue;
        }
        newMargin = Math.max(5, Math.min(95, newMargin));
        if (respectCpmCap) newCpmRevenue = Math.min(project.cpmSoldCap, newCpmRevenue);
        return { ...li, newMargin, newCpmRevenue, action, riskVolatility: enriched?.calibratedVolatility || 0 };
      });
    
      // SCORING + VOLUME
      const itemsWithScore: OptimizationItem[] = optimizedItems.map(item => {
        if (lockedLines.has(item.id)) return { ...item, allocationScore: 0, capAlignmentBonus: 1.0 };
        let baseScore = 0;
        const cScore2 = continuousPerfScore(item.kpiActual ?? 0, targetKpi, isFin);
        if (marginGoal === "increase") {
          baseScore = Math.max(0, cScore2 * cScore2 / 5); // Stars captent plus
        } else {
          // 🔥 V12.0 FIX : En mode decrease, la logique correcte est :
          // - DEAD (score < 2) : budget = 0, redistribué aux performantes
          //   → Une ligne à CPA=50€ (objectif 10€) ne sera pas sauvée par plus de budget
          //   → Le problème est ciblage/créa/inventaire, pas le budget
          // - UNDERPERFORMING (score 2-4) : budget réduit (-30 à -50%)
          //   → On leur donne une chance avec un meilleur bid, mais sans excès
          // - OK/GOOD (score 4-7) : budget stable ou légèrement augmenté
          //   → Ces lignes vont le plus bénéficier du bid plus élevé (marge réduite)
          // - STAR (score > 7) : budget maintenu (déjà performantes)
          //   → Pas besoin de changer ce qui fonctionne
          if (cScore2 < 2) {
            baseScore = 0; // Dead → coupées (budget redistribué automatiquement via totalScore)
          } else if (cScore2 < 4) {
            baseScore = cScore2 * 0.3; // Underperforming → budget réduit
          } else if (cScore2 < 7) {
            baseScore = cScore2 * 1.2; // OK/Good → favorisées (max bénéfice du bid↑)
          } else {
            baseScore = cScore2 * 0.8; // Star → maintien (déjà performantes)
          }
        }
        // 🔥 V2 : Volume weight
        baseScore *= (item.volumeWeight || 0.1);
        
        // 📊 V10.1 : Risk adjustment — pénaliser les lignes volatiles
        // En mode increase : préférer les lignes stables (plus de budget aux lignes fiables)
        // En mode decrease : inverse — les lignes volatiles ont PLUS besoin de budget pour stabiliser
        if (marginGoal === "increase") {
          const riskMultInc = riskAdjustMultiplier(item.riskVolatility || 0, 2.0);
          baseScore *= riskMultInc;
        } else {
          // En mode decrease/boost KPI : les lignes volatiles reçoivent un BONUS
          // (on veut stabiliser leur KPI en leur donnant plus de budget)
          const riskBonusDec = 1 + (item.riskVolatility || 0) * 1.5;
          baseScore *= Math.min(2.0, riskBonusDec);
        }
        
        let capBonus = 1.0, kpiBonus = 1.0, marginBonus = 1.0;
        
        if (respectCpmCap && marginGoal === "increase") {
          const currentWeightedCpmRev = totalDailySpend > 0 ? optimizedItems.reduce((acc, l) => { const ds = (l.spend || 0) / joursEcoules; return acc + ds * (l.newCpmRevenue || l.cpmRevenue); }, 0) / totalDailySpend : 0;
          const newCpmRev = item.newCpmRevenue || item.cpmRevenue;
          const cpmGap = currentWeightedCpmRev - project.cpmSoldCap;
          if (cpmGap > 0) { capBonus = newCpmRev < project.cpmSoldCap ? 1.0 + ((project.cpmSoldCap - newCpmRev) / project.cpmSoldCap) * 0.6 : 1.0 - ((newCpmRev - project.cpmSoldCap) / project.cpmSoldCap) * 0.4; }
          else { if (newCpmRev > currentWeightedCpmRev) capBonus = 1.0 + ((newCpmRev - currentWeightedCpmRev) / Math.max(currentWeightedCpmRev, 1)) * 0.4; }
          capBonus = Math.max(0.4, Math.min(1.6, capBonus));
          
          const currentWeightedKpi = totalDailySpend > 0 ? project.lineItems.reduce((acc, l) => { const ds = (l.spend || 0) / joursEcoules; return acc + ds * l.kpiActual; }, 0) / totalDailySpend : 0;
          const lineKpi = item.kpiActual;
          if (isFin) { const kpiGap = currentWeightedKpi - targetKpi; if (kpiGap > 0) { kpiBonus = lineKpi < targetKpi ? 1.0 + ((targetKpi - lineKpi) / targetKpi) * 0.5 : 1.0 - ((lineKpi - targetKpi) / Math.max(targetKpi, 0.01)) * 0.3; } else { if (lineKpi < targetKpi * 0.8) kpiBonus = 1.2; } }
          else { const kpiGap = targetKpi - currentWeightedKpi; if (kpiGap > 0) { kpiBonus = lineKpi > targetKpi ? 1.0 + ((lineKpi - targetKpi) / targetKpi) * 0.5 : 1.0 - ((targetKpi - lineKpi) / targetKpi) * 0.3; } else { if (lineKpi > targetKpi * 1.2) kpiBonus = 1.2; } }
          kpiBonus = Math.max(0.5, Math.min(1.5, kpiBonus));
          
          const marginIncrease = (item.newMargin || item.marginPct) - item.marginPct;
          if (marginIncrease > 10) marginBonus = 1.3; else if (marginIncrease > 5) marginBonus = 1.15;
        } else if (respectCpmCap && marginGoal === "decrease") {
          const currentWeightedCpmRev = totalDailySpend > 0 ? project.lineItems.reduce((acc, l) => { const ds = (l.spend || 0) / joursEcoules; return acc + ds * l.cpmRevenue; }, 0) / totalDailySpend : 0;
          const cpmRevRatio = (item.newCpmRevenue || item.cpmRevenue) / project.cpmSoldCap;
          capBonus = currentWeightedCpmRev < project.cpmSoldCap ? 0.8 + (cpmRevRatio * 0.4) : 1.2 - (cpmRevRatio * 0.4);
          capBonus = Math.max(0.5, Math.min(1.5, capBonus));
        }
        
        return { ...item, allocationScore: baseScore * capBonus * kpiBonus * marginBonus, capAlignmentBonus: capBonus };
      });
      
      // REDISTRIBUTION + RENDEMENTS DÉCROISSANTS + FILL RATE
      const unlockedItems = itemsWithScore.filter(li => !lockedLines.has(li.id));
      const totalScore = unlockedItems.reduce((acc, li) => acc + (li.allocationScore || 0), 0);
      
      let finalItems: OptimizationItem[] = itemsWithScore.map(li => {
        if (lockedLines.has(li.id)) {
          const dailyAvg = (li.spend || 0) / joursEcoules;
          return { ...li, dailyBudgetAverage: dailyAvg, dailyBudgetProposed: dailyAvg, totalRemainingBudget: dailyAvg * joursRestants, spend: li.spend, cpmRevenue: Number((li.newCpmRevenue || li.cpmRevenue).toFixed(2)), marginPct: Number((li.newMargin || li.marginPct).toFixed(2)), action: "🔒 Verrouillée" };
        }
        const dailyAvg = (li.spend || 0) / joursEcoules;
        const theoreticalDaily = totalScore > 0 ? ((li.allocationScore || 0) / totalScore) * availableDailyBudget : dailyAvg;
        let proposedDaily = (theoreticalDaily * 0.7) + (dailyAvg * 0.3);
        
        // 🔥 V2 : Cap dynamique
        const dynamicCap = getDynamicBudgetCap(dailyAvg, avgDailyAll, marginGoal);
        const maxChange = dailyAvg * dynamicCap;
        proposedDaily = Math.max(Math.max(0, dailyAvg - maxChange), Math.min(dailyAvg + maxChange, proposedDaily));
        
        // 🔥 V2 : Fill rate
        const fillRate = li.fillRate || 0.85;
        if (dailyAvg > 0) proposedDaily = Math.min(proposedDaily, (dailyAvg / fillRate) * 1.2);
        
        const totalRemaining = proposedDaily * joursRestants;
        let updatedAction = li.action || "";
        const budgetChange = proposedDaily - dailyAvg;
        const budgetChangePct = dailyAvg > 0 ? (budgetChange / dailyAvg) * 100 : 0;
        const actionPrefix = updatedAction.split('→')[0];
        updatedAction = `${actionPrefix}→ ${proposedDaily.toFixed(2)} ${currSym}/jour (${budgetChangePct > 0 ? '+' : ''}${budgetChangePct.toFixed(0)}%)`;
        
        return { ...li, id: li.id, name: li.name, dailyBudgetAverage: dailyAvg, dailyBudgetProposed: Number(proposedDaily.toFixed(2)), totalRemainingBudget: Number(totalRemaining.toFixed(2)), spend: li.spend, cpmRevenue: Number((li.newCpmRevenue || li.cpmRevenue).toFixed(2)), marginPct: Number((li.newMargin || li.marginPct).toFixed(2)), kpiActual: li.kpiActual, action: updatedAction, perfCategory: li.perfCategory, perfRatio: li.perfRatio };
      });
      
      if (trend !== null && trend > 0) {
        const totalDailyProposed = finalItems.reduce((acc, li) => acc + (li.dailyBudgetProposed || 0), 0);
        const maxAllowedDaily = trend * 1.15;
        if (totalDailyProposed > maxAllowedDaily) {
          const lockedDaily = finalItems.filter(li => lockedLines.has(li.id)).reduce((acc, li) => acc + (li.dailyBudgetProposed || 0), 0);
          const unlockedDaily = totalDailyProposed - lockedDaily;
          const ratio = unlockedDaily > 0 ? (maxAllowedDaily - lockedDaily) / unlockedDaily : 1;
          finalItems = finalItems.map(li => {
            if (lockedLines.has(li.id)) return li;
            const np = (li.dailyBudgetProposed || 0) * ratio;
            return { ...li, dailyBudgetProposed: Number(np.toFixed(2)), totalRemainingBudget: Number((np * joursRestants).toFixed(2)) };
          });
        }
      }
      
      setProposedOptimizations(finalItems);
    }
  };
  const applyOptimizations = () => {
    if (proposedOptimizations) {
      // 🔥 V2 : Résumé par ligne dans le snapshot
      const lineChanges = proposedOptimizations.map(li => {
        const original = project.lineItems.find(o => o.id === li.id);
        if (!original) return "";
        const marginDelta = li.marginPct - original.marginPct;
        const spendDelta = (li.spend || 0) - (original.spend || 0);
        if (Math.abs(marginDelta) < 0.01 && Math.abs(spendDelta) < 0.01) return "";
        return `${li.name}: marge ${original.marginPct.toFixed(1)}→${li.marginPct.toFixed(1)}%, spend ${(original.spend||0).toFixed(0)}→${(li.spend||0).toFixed(0)}`;
      }).filter(Boolean);
      
      const modeLabel = marginGoal === "boost_kpi" 
        ? "Redistribution Spends Boost KPI"
        : marginGoal === "increase_aggressive"
          ? "MONTÉE MARGE AGRESSIVE (rentabilité max)"
          : `${marginGoal === "increase" ? "Augmentation" : "Baisse"} de marge`;
      
      const detailNote = lineChanges.length > 0 
        ? `Optimisation multi-lines : ${modeLabel} | ${lineChanges.join(" | ")}`
        : `Optimisation multi-lines : ${modeLabel}`;
      
      const snapshot = createSnapshot("OPTIMIZATION", detailNote);
      const newHistory = [...(project.history || []), snapshot];
      
      onChange({
        ...project,
        lineItems: proposedOptimizations,
        history: newHistory,
        updatedAt: new Date().toISOString()
      });
      
      setProposedOptimizations(null);
      alert("Optimisations appliquées avec succès.");
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-[#f8f9fa] relative">
      {/* Parameters Modal (Option B) */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ animation: "fadeOverlayParams 0.15s ease-out" }}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setIsSidebarOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 w-[480px] max-h-[85vh] overflow-hidden flex flex-col" style={{ animation: "fadeScaleParams 0.2s ease-out" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
                  <Settings className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-gray-900">Paramètres Campagne</h3>
                  <p className="text-xs text-gray-500">Modifier les paramètres de la campagne active</p>
                </div>
              </div>
              <button onClick={() => setIsSidebarOpen(false)} className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors text-sm">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-8">
          {isCompleted && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
              <div className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Campagne terminée
              </div>
              <div className="text-[10px] text-emerald-600 mt-1">Paramètres en lecture seule</div>
            </div>
          )}
          <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
            <div className="text-xs font-bold text-blue-900 mb-3 uppercase tracking-wider">
              Mode de Trading
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => onChange({ ...project, inputMode: "CPM Cost" })}
                className={cn(
                  "flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all",
                  project.inputMode === "CPM Cost"
                    ? "border-blue-600 bg-blue-100 text-blue-900 shadow-md"
                    : "border-blue-200 bg-white text-gray-600 hover:border-blue-400 hover:bg-blue-50"
                )}
              >
                <DollarSign className="w-5 h-5" />
                <span className="text-xs font-bold">Je trade en Cost</span>
              </button>
              
              <button
                onClick={() => onChange({ ...project, inputMode: "Marge %" })}
                className={cn(
                  "flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all",
                  project.inputMode === "Marge %"
                    ? "border-emerald-600 bg-emerald-100 text-emerald-900 shadow-md"
                    : "border-emerald-200 bg-white text-gray-600 hover:border-emerald-400 hover:bg-emerald-50"
                )}
              >
                <Percent className="w-5 h-5" />
                <span className="text-xs font-bold">Je trade en Revenu</span>
              </button>
            </div>
          </div>

          {/* 1. Campagne */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wider">1. Campagne</h3>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Devise</label>
              <select 
                className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                value={project.currency}
                onChange={(e) => updateField("currency", e.target.value)}
              >
                <option>€ (EUR)</option>
                <option>$ (USD)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">
                {project.inputMode === "CPM Cost" ? `Budget Total Rev (${currSym})` : `Budget Total (${currSym})`}
              </label>
              <input 
                type="number" 
                className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                value={project.budgetTotal || ''}
                onChange={(e) => updateField("budgetTotal", Number(e.target.value))}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">
                {project.inputMode === "CPM Cost" ? `Budget Dépensé Rev (${currSym})` : `Budget Dépensé (${currSym})`}
              </label>
              <input 
                type="number" 
                step="0.01"
                className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
               value={project.budgetSpent || ''}
                onChange={(e) => {   const value = e.target.value === '' ? 0 : Number(e.target.value);   updateField("budgetSpent", Math.round(value * 100) / 100); }}
              />
            </div>
            
            {project.inputMode === "CPM Cost" && (
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 font-medium">
                  Budget Dépensé Cost ({currSym})
                </label>
                <div className="relative">
                  <input 
                    type="number"
                    className="w-full text-sm border-gray-200 bg-blue-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-bold text-blue-900"
                    value={(project.budgetSpent * (1 - dailyAverages.avgMargin / 100)).toFixed(2)}
                    readOnly
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-blue-600 font-bold bg-blue-100 px-2 py-0.5 rounded">
                    Auto
                  </div>
                </div>
                <div className="text-[10px] text-gray-500 mt-1.5 italic">
                  = Budget Dépensé Rev × (1 - Marge Cumulée {dailyAverages.avgMargin.toFixed(2)}%)
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-3">
  <div>
    <label className="block text-xs text-gray-500 mb-1.5 font-medium">📅 Date de début</label>
    <input 
      type="date"
      className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
      value={project.startDate || ''}
      onChange={(e) => {
        const newStartDate = e.target.value;
        let newDurationDays = project.durationDays;
        
        // Si une date de fin existe, recalculer la durée
        if (project.endDate && newStartDate) {
          const start = new Date(newStartDate);
          const end = new Date(project.endDate);
          newDurationDays = Math.max(0, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
        }
        
        onChange({
          ...project,
          startDate: newStartDate,
          durationDays: newDurationDays,
          updatedAt: new Date().toISOString()
        });
      }}
    />
  </div>
  
  <div>
    <label className="block text-xs text-gray-500 mb-1.5 font-medium">🏁 Date de fin</label>
    <input 
      type="date"
      className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
      value={project.endDate || ''}
      min={project.startDate || undefined}
      onChange={(e) => {
        const newEndDate = e.target.value;
        let newDurationDays = project.durationDays;
        
        // Si une date de début existe, recalculer la durée
        if (project.startDate && newEndDate) {
          const start = new Date(project.startDate);
          const end = new Date(newEndDate);
          newDurationDays = Math.max(0, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
        }
        
        onChange({
          ...project,
          endDate: newEndDate,
          durationDays: newDurationDays,
          updatedAt: new Date().toISOString()
        });
      }}
    />
  </div>
</div>

{/* Affichage de la durée calculée */}
<div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mt-2">
  <div className="flex items-center justify-between">
    <div className="text-xs text-blue-700 font-medium">Durée de la campagne</div>
    <div className="text-lg font-black text-blue-900">{project.durationDays} jours</div>
  </div>
  
  {/* Barre de progression */}
  {project.durationDays > 0 && (
    <div className="mt-3">
      <div className="w-full bg-blue-100 rounded-full h-2 overflow-hidden">
        <div 
          className="bg-blue-600 h-full rounded-full transition-all duration-300" 
          style={{ width: `${Math.min(100, pctProgress * 100)}%` }}
        ></div>
      </div>
      <div className="flex justify-between items-center mt-1.5">
        <div className="text-[10px] text-blue-600 font-bold">Jour {currentDay}</div>
        <div className="text-[10px] text-blue-600 font-bold">{project.durationDays} jours</div>
      </div>
    </div>
  )}
</div>
          </div>

           {/* 🎯 Objectif de Gain */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mt-3">
            <label className="block text-xs text-emerald-700 mb-1.5 font-bold">🎯 Objectif de Gain ({currSym})</label>
            <input 
              type="number" step="1"
              className="w-full text-sm border-emerald-200 bg-white rounded-lg p-2.5 border focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all font-bold text-emerald-900"
              value={project.gainObjective || ''}
              onChange={(e) => updateField("gainObjective", Number(e.target.value))}
              placeholder="Ex: 5000"
            />
            {project.gainObjective && project.gainObjective > 0 && (
              <div className="mt-2">
                <div className="flex justify-between text-[10px] text-emerald-700 font-bold mb-1">
                  <span>{gainRealized.toFixed(0)} {currSym}</span>
                  <span>{project.gainObjective.toLocaleString()} {currSym}</span>
                </div>
                <div className="w-full bg-emerald-200 rounded-full h-1.5">
                  <div className="bg-emerald-600 h-full rounded-full transition-all" style={{ width: `${Math.min(100, (gainRealized / project.gainObjective) * 100)}%` }}></div>
                </div>
              </div>
            )}
          </div>

          {/* 2. Finance */}
          <div className="space-y-4 pt-6 border-t border-gray-100">
            <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wider">2. Finance</h3>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">CPM Vendu Cap ({currSym})</label>
              <input 
                type="number" step="0.1"
                className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                value={project.cpmSoldCap || ''}
                onChange={(e) => updateField("cpmSoldCap", Number(e.target.value))}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">CPM Revenu Actuel ({currSym})</label>
              <input 
                type="number" step="0.1"
                className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                value={project.cpmRevenueActual || ''}
                onChange={(e) => updateField("cpmRevenueActual", Number(e.target.value))}
              />
            </div>
          </div>

          {/* 3. Achat */}
          <div className="space-y-4 pt-6 border-t border-gray-100">
            <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wider">3. Achat</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 font-medium">CPM Cost ({currSym})</label>
                <input 
                  type="number" 
                  step="0.01"
                  className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  value={
  project.inputMode === "CPM Cost" 
    ? (project.cpmCostActuel ?? '')
    : (cpmCostActuelCalc ?? '')
}
                  onChange={(e) => {
  let value = e.target.value === '' ? 0 : Number(e.target.value);
  
  // Limiter à 2 décimales
  value = Math.round(value * 100) / 100;
  
  if (project.inputMode === "CPM Cost") {
    onChange({
      ...project,
      cpmCostActuel: value
    });
  } else {
    const newMarge = project.cpmRevenueActual > 0 
      ? ((project.cpmRevenueActual - value) / project.cpmRevenueActual) * 100
      : 0;
    onChange({
      ...project,
      inputMode: "Marge %",
      margeInput: Math.round(newMarge * 100) / 100
    });
  }
}}
/>
              </div>
              <div>
  <label className="block text-xs text-gray-500 mb-1.5 font-medium">Marge %</label>
  <input 
    type="number" 
    step="0.01"
    className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
    value={
      project.inputMode === "Marge %" 
        ? (project.margeInput ?? '')
        : (currentMarginPctCalc ?? '')  // Maintenant arrondi à 2 décimales à la source
    }
    onChange={(e) => {
      const inputValue = e.target.value;
      
      // 🔥 Permettre la saisie vide et les valeurs intermédiaires comme "15."
      if (inputValue === '') {
        if (project.inputMode === "Marge %") {
          onChange({ ...project, margeInput: 0 });
        } else {
          onChange({ ...project, cpmCostActuel: project.cpmRevenueActual });
        }
        return;
      }
      
      let newMarge = Number(inputValue);
      
      // 🔥 Limiter à 2 décimales uniquement si la valeur est complète
      if (!inputValue.endsWith('.') && !inputValue.endsWith('.0')) {
        newMarge = Math.round(newMarge * 100) / 100;
      }
      
      if (project.inputMode === "Marge %") {
        // Mode "Marge %" : mise à jour directe
        onChange({
          ...project,
          margeInput: newMarge
        });
      } else {
        // Mode "CPM Cost" : recalculer le CPM Cost depuis la marge
        const newCpmCost = Math.round(project.cpmRevenueActual * (1 - newMarge / 100) * 100) / 100;
        onChange({
          ...project,
          cpmCostActuel: newCpmCost
        });
      }
    }}
  />
</div>
            </div>
          </div>

          {/* 4. KPI */}
          <div className="space-y-4 pt-6 border-t border-gray-100">
            <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wider">4. KPI Objectif</h3>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Type de KPI</label>
              <select 
                className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                value={project.kpiType}
                onChange={(e) => updateField("kpiType", e.target.value)}
              >
                {["CPM", "CPC", "CPCV", "CPA", "CPV", "CTR", "Viewability", "VTR"].map(k => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>

            {(project.kpiType === "CPA" || project.kpiType === "CPV" || project.kpiType === "CPL") && (
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 space-y-3">
                <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Fenêtres d'Attribution</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1 font-bold flex items-center gap-1">
                      <MousePointer2 className="w-3 h-3"/> Post-Clic (J)
                    </label>
                    <input 
  type="number" min="0" max="30"
  className="w-full text-xs border-gray-200 bg-white rounded-md p-2 border outline-none"
  value={attrClick || ''}
  onChange={(e) => {
    const newValue = Number(e.target.value);
    setAttrClick(newValue);
    onChange({
      ...project,
      attrClick: newValue,
      updatedAt: new Date().toISOString()
    });
  }}
/>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1 font-bold flex items-center gap-1">
                      <Clock className="w-3 h-3"/> Post-View (J)
                    </label>
                    <input 
  type="number" min="0" max="30"
  className="w-full text-xs border-gray-200 bg-white rounded-md p-2 border outline-none"
  value={attrView || ''}
  onChange={(e) => {
    const newValue = Number(e.target.value);
    setAttrView(newValue);
    onChange({
      ...project,
      attrView: newValue,
      updatedAt: new Date().toISOString()
    });
  }}
/>
                  </div>
                </div>
              </div>
            )}

           {(project.kpiType === "CPA" || project.kpiType === "CPV") && (
              <div className="bg-purple-50 p-3 rounded-lg border border-purple-100 space-y-3">
                <div className="text-[10px] font-bold text-purple-600 uppercase tracking-wider">Type de Funnel (Élasticité Reach)</div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => setFunnelType("prospecting")}
                    className={cn(
                      "px-2 py-2 rounded-lg text-[10px] font-bold transition-all border-2 flex flex-col items-center gap-1",
                      funnelType === "prospecting"
                        ? "border-purple-600 bg-purple-100 text-purple-900 shadow-md"
                        : "border-purple-200 bg-white text-purple-600 hover:border-purple-400"
                    )}
                  >
                    <span>🎯 Prospecting</span>
                    <span className="text-[8px] font-normal opacity-75">Élasticité 0.60</span>
                  </button>
                  <button
                    onClick={() => setFunnelType("mixed")}
                    className={cn(
                      "px-2 py-2 rounded-lg text-[10px] font-bold transition-all border-2 flex flex-col items-center gap-1",
                      funnelType === "mixed"
                        ? "border-purple-600 bg-purple-100 text-purple-900 shadow-md"
                        : "border-purple-200 bg-white text-purple-600 hover:border-purple-400"
                    )}
                  >
                    <span>⚖️ Mixte</span>
                    <span className="text-[8px] font-normal opacity-75">Élasticité 0.85</span>
                  </button>
                  <button
                    onClick={() => setFunnelType("retargeting")}
                    className={cn(
                      "px-2 py-2 rounded-lg text-[10px] font-bold transition-all border-2 flex flex-col items-center gap-1",
                      funnelType === "retargeting"
                        ? "border-purple-600 bg-purple-100 text-purple-900 shadow-md"
                        : "border-purple-200 bg-white text-purple-600 hover:border-purple-400"
                    )}
                  >
                    <span>🔄 Retargeting</span>
                    <span className="text-[8px] font-normal opacity-75">Élasticité 0.93</span>
                  </button>
                </div>
                <div className="text-[9px] text-purple-700 leading-relaxed">
                  {funnelType === "prospecting" && "🎯 Audiences froides : rendements décroissants forts. Les impressions supplémentaires convertissent beaucoup moins."}
                  {funnelType === "mixed" && "⚖️ Mix prospecting/retargeting : élasticité moyenne (valeur par défaut)."}
                  {funnelType === "retargeting" && "🔄 Audiences chaudes : très sensible au reach. Chaque impression perdue coûte cher en conversions."}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 font-medium">Objectif</label>
                <input 
  type="number" step="0.01"
  className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
  value={project.targetKpi ?? ''}
  onChange={(e) => updateField("targetKpi", Number(e.target.value))}
/>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 font-medium">Actuel</label>
                <input 
                  type="number" step="0.01"
                  className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  value={project.actualKpi ?? ''}
                  onChange={(e) => updateField("actualKpi", Number(e.target.value))}
                />
              </div>
            </div>
          </div>
       </div>
            </div>
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 shrink-0 flex justify-end">
              <button onClick={() => setIsSidebarOpen(false)} className="px-5 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes fadeScaleParams { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes fadeOverlayParams { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
      {/* Main Dashboard - SUITE DE LA PARTIE 2 */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-6xl mx-auto space-y-8">
          
         <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h2 className="text-2xl font-bold text-gray-900">Dashboard Yield</h2>
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="flex items-center gap-2 px-4 py-1.5 text-xs font-bold rounded-full transition-all border-2 bg-white text-blue-600 border-blue-200 hover:border-blue-400 hover:bg-blue-50 shadow-sm"
              >
                <Settings className="w-3.5 h-3.5" />
                Paramètres
              </button>
              <button
                onClick={() => setClientMode(!clientMode)}
                className={cn("px-4 py-1.5 text-xs font-bold rounded-full transition-all border-2",
                  clientMode
                    ? "bg-rose-600 text-white border-rose-600 shadow-lg"
                    : "bg-white text-gray-500 border-gray-200 hover:border-rose-400"
                )}
              >
                {clientMode ? "👁️ MODE CLIENT ACTIF" : "👁️ Mode Client"}
              </button>
            </div>
            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
              <button 
                className={cn("px-4 py-1.5 text-sm font-medium rounded-md transition-colors", dashSource === "sidebar" ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:text-gray-700")}
                onClick={() => setDashSource("sidebar")}
              >
                Général
              </button>
              <button 
                className={cn("px-4 py-1.5 text-sm font-medium rounded-md transition-colors", dashSource === "table" ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:text-gray-700")}
                onClick={() => setDashSource("table")}
              >
                Cumulés Tableau
              </button>
            </div>
          </div>

          {/* 🔥 V7.0 : BANDEAU CAMPAGNE TERMINÉE */}
          {isCompleted && (
            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-5 flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h4 className="font-black text-emerald-900 text-lg">✅ Campagne Terminée</h4>
                <p className="text-sm text-emerald-700 mt-1">
                  Archivée le {project.completedAt ? new Date(project.completedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}.
                  {project.finalBalance && <> Gain final : <strong>{project.finalBalance.totalGain.toFixed(0)} {currSym}</strong> — Marge réelle : <strong>{project.finalBalance.realMarginPct.toFixed(1)}%</strong></>}
                  {' '}— Bilan complet dans <strong>Suivi Campagne</strong>.
                </p>
              </div>
            </div>
          )}

          {/* Metrics Row */}
          <div className={cn("grid gap-6", clientMode ? "grid-cols-3" : "grid-cols-4")}>
            {!clientMode && (
              <MetricCard 
                title="CPM Cost Cumulé (Net)" 
                value={`${dispCpmCost.toFixed(2)} ${currSym}`} 
                icon={DollarSign}
                accent="indigo"
              />
            )}
            <MetricCard 
              title="CPM Revenu Cumulé" 
              value={`${(clientMode ? Math.min(dispCpmRev, project.cpmSoldCap || Infinity) : dispCpmRev).toFixed(2)} ${currSym}`} 
              icon={TrendingUp}
              accent="indigo"
            />
            {!clientMode && (
              <MetricCard 
                title="Marge Cumulée" 
                value={`${dispMargin.toFixed(2)} %`}
                subValue={`${margeEuroDisp.toFixed(2)} ${currSym}`}
                icon={Percent}
                accent="emerald"
              />
            )}
            <MetricCard 
  title={`KPI ${project.kpiType} Cumulé`} 
  value={fmtKpi(dispKpi)} 
  subValue={
    dispKpi === 0 
      ? "💀 AUCUNE PERFORMANCE" 
      : isFin 
        ? (dispKpi <= project.targetKpi ? `✅ ${fmtKpi(project.targetKpi - dispKpi)} ${currSym} Avance` : `🔻 +${fmtKpi(dispKpi - project.targetKpi)} ${currSym} Retard`)
        : (dispKpi >= project.targetKpi ? "✅ OK" : "🔻 KO")
  }
  icon={Target}
  accent={
    dispKpi === 0 
      ? "red"
      : isFin 
        ? (dispKpi <= project.targetKpi ? "emerald" : "red") 
        : (dispKpi >= project.targetKpi ? "emerald" : "red")
  }
/>
            {clientMode && (
              <MetricCard 
                title="Pacing" 
                value={`${(project.budgetTotal > 0 ? (project.budgetSpent / project.budgetTotal * 100) : 0).toFixed(0)} %`}
                subValue={`${project.budgetSpent.toFixed(0)} / ${project.budgetTotal.toFixed(0)} ${currSym}`}
                icon={Activity}
                accent="indigo"
              />
            )}
          </div>

          {/* Tabs */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex border-b border-gray-100 px-2 pt-2">
            {[
                { id: "analyse", label: "💰 Analyse" },
                ...(!clientMode && !isCompleted ? [{ id: "comparateur", label: "🧮 Marge" }] : []),
                ...(!clientMode && !isCompleted ? [{ id: "multilines", label: "🎛️ Optimisation Multi-Lines" }] : []),
                ...(!clientMode ? [{ id: "radar", label: "📡 Radar V4" }] : []),
                { id: "historique", label: "📜 Historique" },
                ...(!clientMode ? [{ id: "notes", label: "📝 Notes" }] : []),
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as any)}
                  className={cn(
                    "px-6 py-4 text-sm font-medium transition-colors border-b-2 rounded-t-lg",
                    activeTab === t.id ? "border-blue-500 text-blue-600 bg-blue-50/50" : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="p-8">
              {activeTab === "analyse" && (
  <div className="space-y-4">
    {/* 🔥 CAS SPÉCIAL : KPI à 0 = AUCUNE PERFORMANCE */}
    {project.actualKpi === 0 ? (
      <div className="p-5 bg-red-50 border border-red-100 rounded-xl flex items-start gap-4 text-red-900">
        <div className="bg-white p-2 rounded-full shadow-sm">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>
        <div>
          <h4 className="font-bold text-lg">💀 AUCUNE PERFORMANCE</h4>
          <p className="text-red-700 mt-1">
            Votre {project.kpiType} est à 0. Cela signifie qu'il n'y a {project.kpiType === "CPA" ? "aucune conversion" : "aucune visite"}. 
            Priorité absolue : relancer la campagne avec un budget plus élevé ou un ciblage plus large.
          </p>
        </div>
      </div>
    ) : isFin && project.actualKpi <= project.targetKpi ? (
      <div className="p-5 bg-emerald-50 border border-emerald-100 rounded-xl flex items-start gap-4 text-emerald-900">
        <div className="bg-white p-2 rounded-full shadow-sm">
          <CheckCircle2 className="w-6 h-6 text-emerald-500" />
        </div>
        <div>
          <h4 className="font-bold text-lg">CONFORT</h4>
          <p className="text-emerald-700 mt-1">Marge de manœuvre disponible. Le KPI est atteint, vous pouvez optimiser la marge.</p>
        </div>
      </div>
    ) : !isFin && project.actualKpi >= project.targetKpi ? (
      <div className="p-5 bg-emerald-50 border border-emerald-100 rounded-xl flex items-start gap-4 text-emerald-900">
        <div className="bg-white p-2 rounded-full shadow-sm">
          <CheckCircle2 className="w-6 h-6 text-emerald-500" />
        </div>
        <div>
          <h4 className="font-bold text-lg">CONFORT</h4>
          <p className="text-emerald-700 mt-1">Qualité au top. Le KPI est atteint.</p>
        </div>
      </div>
    ) : (
      <div className="p-5 bg-red-50 border border-red-100 rounded-xl flex items-start gap-4 text-red-900">
        <div className="bg-white p-2 rounded-full shadow-sm">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>
        <div>
          <h4 className="font-bold text-lg">TENSION</h4>
          <p className="text-red-700 mt-1">Optimisez la performance avant la marge. Le KPI n'est pas atteint.</p>
        </div>
      </div>
    )}
  {/* 🔥 V3.5 : INDICATEUR PACING */}
    {project.startDate && project.durationDays > 0 && project.budgetTotal > 0 && (
      (() => {
        const theoreticalSpent = project.budgetTotal * (currentDay / project.durationDays);
        const pacingDelta = project.budgetSpent - theoreticalSpent;
        const pacingPct = theoreticalSpent > 0 ? (pacingDelta / theoreticalSpent) * 100 : 0;
        const isAhead = pacingPct > 5;
        const isBehind = pacingPct < -5;
        const dailyNeeded = budgetRemaining / Math.max(1, project.durationDays - currentDay);
        const dailyActual = currentDay > 0 ? project.budgetSpent / currentDay : 0;
        
        return (
          <div className={cn(
            "p-5 rounded-xl flex items-start gap-4 border mt-4",
            isAhead ? "bg-blue-50 border-blue-200 text-blue-900" :
            isBehind ? "bg-amber-50 border-amber-200 text-amber-900" :
            "bg-gray-50 border-gray-200 text-gray-900"
          )}>
            <div className={cn("bg-white p-2 rounded-full shadow-sm")}>
              <Activity className={cn("w-6 h-6", isAhead ? "text-blue-500" : isBehind ? "text-amber-500" : "text-gray-500")} />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-lg">
                  {isAhead ? "⚡ EN AVANCE" : isBehind ? "⏳ EN RETARD" : "✅ ON TRACK"}
                </h4>
                <span className={cn("text-sm font-black px-3 py-1 rounded-full",
                  isAhead ? "bg-blue-100 text-blue-700" : isBehind ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                )}>
                  {pacingPct > 0 ? "+" : ""}{pacingPct.toFixed(1)}%
                </span>
              </div>
              <div className="grid grid-cols-4 gap-3 mt-3">
                <div className="bg-white/80 rounded-lg p-2.5 border border-gray-100">
                  <div className="text-[10px] text-gray-500 font-bold uppercase">Théorique J{currentDay}</div>
                  <div className="text-sm font-black mt-0.5">{theoreticalSpent.toFixed(0)} {currSym}</div>
                </div>
                <div className="bg-white/80 rounded-lg p-2.5 border border-gray-100">
                  <div className="text-[10px] text-gray-500 font-bold uppercase">Réel</div>
                  <div className="text-sm font-black mt-0.5">{project.budgetSpent.toFixed(0)} {currSym}</div>
                </div>
                <div className="bg-white/80 rounded-lg p-2.5 border border-gray-100">
                  <div className="text-[10px] text-gray-500 font-bold uppercase">Écart</div>
                  <div className={cn("text-sm font-black mt-0.5", pacingDelta >= 0 ? "text-blue-600" : "text-amber-600")}>
                    {pacingDelta >= 0 ? "+" : ""}{pacingDelta.toFixed(0)} {currSym}
                  </div>
                </div>
                <div className="bg-white/80 rounded-lg p-2.5 border border-gray-100">
                  <div className="text-[10px] text-gray-500 font-bold uppercase">Budget/jour nécessaire</div>
                  <div className="text-sm font-black mt-0.5">{dailyNeeded.toFixed(0)} {currSym}/j</div>
                 <div className="text-[9px] text-gray-400">(actuel: {dailyActual.toFixed(0)})</div>
                </div>
              </div>
            </div>
          </div>
        );
      })()
    )}

    {/* 🔮 V10.3 : PACING PRÉDICTIF */}
    {!clientMode && pacingPrediction && (
      <div className={cn("rounded-xl p-5 border-2 mt-4",
        pacingPrediction.recommendation === "urgent" ? "bg-red-50 border-red-300" :
        pacingPrediction.recommendation === "decelerate" ? "bg-amber-50 border-amber-300" :
        pacingPrediction.recommendation === "accelerate" ? "bg-blue-50 border-blue-300" :
        "bg-emerald-50 border-emerald-300"
      )}>
        <div className="flex items-center justify-between mb-3">
          <h4 className={cn("font-black text-lg flex items-center gap-2",
            pacingPrediction.recommendation === "urgent" ? "text-red-900" :
            pacingPrediction.recommendation === "decelerate" ? "text-amber-900" :
            pacingPrediction.recommendation === "accelerate" ? "text-blue-900" :
            "text-emerald-900"
          )}>
            🔮 Pacing Prédictif
            <span className="text-[10px] font-bold bg-violet-200 text-violet-800 px-2 py-0.5 rounded-full ml-2">
              AR(1) + Monte Carlo ({pacingPrediction.simulationCount} sim.)
            </span>
          </h4>
          <span className={cn("text-xs font-black px-3 py-1 rounded-full",
            pacingPrediction.recommendation === "urgent" ? "bg-red-200 text-red-800" :
            pacingPrediction.recommendation === "decelerate" ? "bg-amber-200 text-amber-800" :
            pacingPrediction.recommendation === "accelerate" ? "bg-blue-200 text-blue-800" :
            "bg-emerald-200 text-emerald-800"
          )}>
            {pacingPrediction.recommendation === "urgent" ? "🚨 URGENT" :
             pacingPrediction.recommendation === "decelerate" ? "📉 DÉCÉLÉRER" :
             pacingPrediction.recommendation === "accelerate" ? "📈 ACCÉLÉRER" :
             "✅ ON TRACK"}
          </span>
        </div>
        <div className={cn("rounded-lg p-4 border mb-4",
          pacingPrediction.recommendation === "urgent" ? "bg-red-100 border-red-300" :
          pacingPrediction.recommendation === "decelerate" ? "bg-amber-100 border-amber-300" :
          pacingPrediction.recommendation === "accelerate" ? "bg-blue-100 border-blue-300" :
          "bg-emerald-100 border-emerald-300"
        )}>
          <p className="text-sm font-medium leading-relaxed">{pacingPrediction.message}</p>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-white/80 rounded-lg p-3 border border-gray-100 text-center">
            <div className="text-[9px] text-gray-500 font-bold uppercase">Budget Projeté Fin</div>
            <div className={cn("text-xl font-black mt-1",
              pacingPrediction.predictedEndSpendPct >= 95 && pacingPrediction.predictedEndSpendPct <= 105 ? "text-emerald-600" :
              pacingPrediction.predictedEndSpendPct >= 85 ? "text-amber-600" : "text-red-600"
            )}>
              {pacingPrediction.predictedEndSpendPct.toFixed(0)}%
            </div>
            <div className="text-[9px] text-gray-400 mt-1">médiane</div>
          </div>
          <div className="bg-white/80 rounded-lg p-3 border border-gray-100 text-center">
            <div className="text-[9px] text-gray-500 font-bold uppercase">Intervalle 90%</div>
            <div className="text-lg font-black text-gray-900 mt-1">
              {pacingPrediction.confidenceInterval[0].toFixed(0)}–{pacingPrediction.confidenceInterval[1].toFixed(0)}%
            </div>
            <div className="text-[9px] text-gray-400 mt-1">5ème–95ème percentile</div>
          </div>
          <div className="bg-white/80 rounded-lg p-3 border border-gray-100 text-center">
            <div className="text-[9px] text-gray-500 font-bold uppercase">Épuisement</div>
            <div className={cn("text-xl font-black mt-1",
              pacingPrediction.daysToDepletion !== null ? "text-red-600" : "text-emerald-600"
            )}>
              {pacingPrediction.daysToDepletion !== null ? `J+${pacingPrediction.daysToDepletion}` : "Aucun"}
            </div>
            <div className="text-[9px] text-gray-400 mt-1">
              {pacingPrediction.daysToDepletion !== null ? "risque détecté" : "pas de risque"}
            </div>
          </div>
          <div className="bg-white/80 rounded-lg p-3 border border-gray-100 text-center">
            <div className="text-[9px] text-gray-500 font-bold uppercase">Ajustement Reco</div>
            <div className={cn("text-xl font-black mt-1",
              pacingPrediction.recommendedDailyAdjustPct > 0 ? "text-blue-600" :
              pacingPrediction.recommendedDailyAdjustPct < 0 ? "text-amber-600" :
              "text-emerald-600"
            )}>
              {pacingPrediction.recommendedDailyAdjustPct > 0 ? "+" : ""}{pacingPrediction.recommendedDailyAdjustPct.toFixed(0)}%
            </div>
            <div className="text-[9px] text-gray-400 mt-1">spend quotidien</div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-4 text-[10px] text-gray-500">
          <span>AR(1): α={pacingPrediction.ar1Alpha.toFixed(1)}, β={pacingPrediction.ar1Beta.toFixed(3)}</span>
          <span>•</span>
          <span>σ={pacingPrediction.residualStdDev.toFixed(1)}</span>
          <span>•</span>
          <span>{pacingPrediction.simulationCount} trajectoires simulées</span>
          <span>•</span>
          <span>β {'<'} 1 = {pacingPrediction.ar1Beta < 0.5 ? "mean-reverting" : pacingPrediction.ar1Beta < 0.9 ? "persistent modéré" : "très persistent"}</span>
        </div>
      </div>
    )}

   {/* ========================================
        🔥 V5.0 : SCORE DE SANTÉ CAMPAGNE
        ======================================== */}
    {!clientMode && healthScore && (
      <div className={cn("p-5 rounded-xl border-2 mt-4",
        healthScore.color === "emerald" ? "bg-emerald-50 border-emerald-300" :
        healthScore.color === "blue" ? "bg-blue-50 border-blue-300" :
        healthScore.color === "amber" ? "bg-amber-50 border-amber-300" :
        "bg-red-50 border-red-300"
      )}>
        <div className="flex items-center gap-5">
          <div className="relative w-24 h-24 shrink-0">
            <svg className="w-24 h-24 -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" fill="none" stroke="#e5e7eb" strokeWidth="10" />
              <circle cx="60" cy="60" r="50" fill="none"
                stroke={healthScore.color === "emerald" ? "#10b981" : healthScore.color === "blue" ? "#3b82f6" : healthScore.color === "amber" ? "#f59e0b" : "#ef4444"}
                strokeWidth="10" strokeLinecap="round"
                strokeDasharray={`${healthScore.score * 3.14} ${314 - healthScore.score * 3.14}`}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={cn("text-2xl font-black",
                healthScore.color === "emerald" ? "text-emerald-700" : healthScore.color === "blue" ? "text-blue-700" :
                healthScore.color === "amber" ? "text-amber-700" : "text-red-700"
              )}>{healthScore.score}</span>
            </div>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Shield className={cn("w-5 h-5",
                healthScore.color === "emerald" ? "text-emerald-600" : healthScore.color === "blue" ? "text-blue-600" :
                healthScore.color === "amber" ? "text-amber-600" : "text-red-600"
              )} />
              <h4 className="font-black text-lg text-gray-900">
                Score de Santé : {healthScore.level === "excellent" ? "EXCELLENT" : healthScore.level === "bon" ? "BON" : healthScore.level === "attention" ? "ATTENTION" : "CRITIQUE"}
              </h4>
            </div>
            <div className="grid grid-cols-5 gap-2 mt-3">
              {[
                { label: "Pacing", max: 25 },
                { label: "KPI", max: 25 },
                { label: "Marge", max: 20 },
                { label: "Anomalies", max: 15 },
                { label: "Trend", max: 15 }
              ].map((item, idx) => {
                const thresholds = [25, 25, 20, 15, 15];
                const cumBefore = thresholds.slice(0, idx).reduce((a, b) => a + b, 0);
                const partScore = Math.max(0, Math.min(item.max, healthScore.score - cumBefore));
                const pct = (partScore / item.max) * 100;
                return (
                  <div key={item.label} className="text-center">
                    <div className="text-[9px] font-bold text-gray-500 uppercase mb-1">{item.label}</div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div className={cn("h-full rounded-full",
                        healthScore.color === "emerald" ? "bg-emerald-500" : healthScore.color === "blue" ? "bg-blue-500" :
                        healthScore.color === "amber" ? "bg-amber-500" : "bg-red-500"
                      )} style={{ width: `${pct}%` }}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    )}

   {/* ========================================
        🔥 V5.0 : OBJECTIF DE GAIN & TRACKER
        ======================================== */}
    {!clientMode && project.gainObjective && project.gainObjective > 0 && (
      <div className="mt-4 bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-black text-emerald-900 flex items-center gap-2 text-sm">
            🎯 Objectif de Gain : {project.gainObjective.toLocaleString()} {currSym}
          </h4>
          <span className={cn("text-xs font-black px-3 py-1 rounded-full",
            gainRealized >= project.gainObjective ? "bg-emerald-200 text-emerald-800" :
            gainRealized >= project.gainObjective * 0.7 ? "bg-amber-200 text-amber-800" :
            "bg-red-200 text-red-800"
          )}>
            {((gainRealized / project.gainObjective) * 100).toFixed(0)}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
          <div className={cn("h-full rounded-full transition-all duration-500",
            gainRealized >= project.gainObjective ? "bg-emerald-500" :
            gainRealized >= project.gainObjective * 0.7 ? "bg-amber-500" : "bg-red-500"
          )} style={{ width: `${Math.min(100, (gainRealized / project.gainObjective) * 100)}%` }}></div>
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>Acquis : <strong className="text-emerald-700">{gainRealized.toFixed(0)} {currSym}</strong></span>
          <span>Restant : <strong>{Math.max(0, project.gainObjective - gainRealized).toFixed(0)} {currSym}</strong></span>
        </div>
     {(() => {
          const expectedGainAtThisPoint = project.gainObjective * (currentDay / Math.max(1, project.durationDays));
          const isOnTrack = gainRealized >= expectedGainAtThisPoint * 0.9;
          return (
            <div className={cn("mt-3 p-2 rounded-lg text-xs font-bold text-center",
              isOnTrack ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
            )}>
              {isOnTrack ? "✅ ON TRACK — Objectif atteignable au rythme actuel" : `⚠️ EN RETARD — Devrait être à ${expectedGainAtThisPoint.toFixed(0)} ${currSym} à J${currentDay}`}
            </div>
          );
        })()}
        {endProjection && (
          <div className="mt-3 pt-3 border-t border-emerald-200 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[10px] text-gray-500 font-bold">Gain Projeté Fin</div>
              <div className={cn("text-sm font-black", endProjection.gainFinal >= project.gainObjective ? "text-emerald-600" : "text-amber-600")}>
                {endProjection.gainFinal.toFixed(0)} {currSym}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500 font-bold">vs Objectif</div>
              <div className={cn("text-sm font-black", endProjection.gainFinal >= project.gainObjective ? "text-emerald-600" : "text-red-600")}>
                {endProjection.gainFinal >= project.gainObjective ? "+" : ""}{(endProjection.gainFinal - project.gainObjective).toFixed(0)} {currSym}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500 font-bold">Probabilité</div>
              {(() => {
                const ratio = endProjection.gainFinal / project.gainObjective;
                const label = ratio >= 1.0 ? "ATTEINT" 
                            : ratio >= 0.90 ? "PROBABLE" 
                            : ratio >= 0.70 ? "DIFFICILE" 
                            : "INSUFFISANT";
                const color = ratio >= 1.0 ? "text-emerald-600" 
                            : ratio >= 0.90 ? "text-amber-600" 
                            : "text-red-600";
                return (
                  <div className={cn("text-sm font-black", color)}>
                    {label}
                    <div className="text-[9px] font-bold text-gray-400 mt-0.5">
                      {(ratio * 100).toFixed(0)}% de l'objectif
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    )}

    {/* ========================================
        🔥 V5.0 : PROJECTION FIN DE CAMPAGNE
        ======================================== */}
    {!clientMode && endProjection && (
      <div className="mt-4 bg-gradient-to-br from-violet-50 to-indigo-50 border-2 border-violet-200 rounded-xl p-5">
        <h4 className="font-black text-violet-900 mb-4 flex items-center gap-2 text-sm">
          🔮 Projection Fin de Campagne
          <span className="text-[10px] font-bold bg-violet-200 text-violet-800 px-2 py-0.5 rounded-full ml-auto">
            Basé sur les 5 derniers jours (agrégés)
          </span>
        </h4>
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-white rounded-lg p-3 border border-violet-100 text-center">
            <div className="text-[10px] text-gray-500 font-bold uppercase">
              {project.kpiType} Projeté
            </div>
            <div className={cn("text-xl font-black mt-1",
              isFin ? (endProjection.kpiFinal <= project.targetKpi ? "text-emerald-600" : "text-red-600")
                    : (endProjection.kpiFinal >= project.targetKpi ? "text-emerald-600" : "text-red-600")
            )}>
              {fmtKpi(endProjection.kpiFinal)}
            </div>
            <div className="text-[9px] text-gray-400 mt-1 flex items-center justify-center gap-1">
              {endProjection.kpiTrendDir === "up" ? "📈" : endProjection.kpiTrendDir === "down" ? "📉" : "➡️"}
              Trend {endProjection.kpiTrendDir === "up" ? "hausse" : endProjection.kpiTrendDir === "down" ? "baisse" : "stable"}
            </div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-violet-100 text-center">
            <div className="text-[10px] text-gray-500 font-bold uppercase">Gain Total Projeté</div>
            <div className="text-xl font-black text-emerald-600 mt-1">{endProjection.gainFinal.toFixed(0)} {currSym}</div>
            <div className="text-[9px] text-gray-400 mt-1">
              dont {gainRealized.toFixed(0)} acquis
            </div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-violet-100 text-center">
            <div className="text-[10px] text-gray-500 font-bold uppercase">Pacing Final</div>
            <div className={cn("text-xl font-black mt-1",
              endProjection.pacingFinal >= 95 && endProjection.pacingFinal <= 105 ? "text-emerald-600" :
              endProjection.pacingFinal >= 85 ? "text-amber-600" : "text-red-600"
            )}>
              {endProjection.pacingFinal.toFixed(0)}%
            </div>
            <div className="text-[9px] text-gray-400 mt-1">
              {endProjection.spendFinal.toFixed(0)} / {project.budgetTotal.toFixed(0)} {currSym}
            </div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-violet-100 text-center">
            <div className="text-[10px] text-gray-500 font-bold uppercase">Spend/Jour Recommandé</div>
            <div className="text-xl font-black text-indigo-600 mt-1">{endProjection.dailySpendNeeded.toFixed(0)} {currSym}</div>
            <div className="text-[9px] text-gray-400 mt-1">
              {endProjection.joursRestants}j restants
            </div>
          </div>
        </div>
        {Math.abs(endProjection.pacingFinal - 100) > 15 && (
          <div className={cn("mt-3 p-3 rounded-lg text-xs font-bold",
            endProjection.pacingFinal < 85 ? "bg-amber-100 text-amber-800" : endProjection.pacingFinal > 115 ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"
          )}>
            {endProjection.pacingFinal < 85
              ? `⚠️ À ce rythme, seulement ${endProjection.pacingFinal.toFixed(0)}% du budget sera dépensé. Spend recommandé : ${endProjection.dailySpendNeeded.toFixed(0)} ${currSym}/jour (actuel ~${endProjection.dailySpendTrend.toFixed(0)} ${currSym}/jour).`
              : `⚠️ À ce rythme, ${endProjection.pacingFinal.toFixed(0)}% du budget sera dépensé. Réduisez le spend quotidien.`
            }
          </div>
        )}
      </div>
    )}

    {/* ========================================
        🔥 V5.0 : GRAPHIQUE ÉVOLUTION DAILY ENTRIES
        ======================================== */}
    {project.dailyEntries && project.dailyEntries.length >= 2 && (
      <div className="mt-4 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h4 className="font-black text-gray-900 mb-4 flex items-center gap-2 text-sm">
          📊 Évolution Quotidienne
          <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full ml-auto">
            {project.dailyEntries.length} jours
          </span>
        </h4>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={[...project.dailyEntries]
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map(e => ({
                  date: new Date(e.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
                  spend: e.budgetSpent,
                  kpi: e.kpiActual,
                  marge: e.marginPct
                }))}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="spend" orientation="left" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `${v >= 1000 ? (v/1000).toFixed(0)+'k' : v.toFixed(0)}`} />
              <YAxis yAxisId="kpi" orientation="right" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                formatter={(value: number, name: string) => {
                  if (name === "Spend") return [`${value.toFixed(0)} ${currSym}`, "Spend"];
                  if (name === "Marge %") return [`${value.toFixed(1)}%`, "Marge %"];
                  return [fmtKpi(value), project.kpiType];
                }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
              <Bar yAxisId="spend" dataKey="spend" fill="#c7d2fe" radius={[4, 4, 0, 0]} name="Spend" barSize={20} />
              <Line yAxisId="kpi" type="monotone" dataKey="kpi" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3, fill: '#ef4444' }} name={project.kpiType} />
              {!clientMode && <Line yAxisId="kpi" type="monotone" dataKey="marge" stroke="#10b981" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2, fill: '#10b981' }} name="Marge %" />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {project.targetKpi > 0 && (
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
            <span>Objectif {project.kpiType} : <strong className="text-gray-900">{fmtKpi(project.targetKpi)}</strong></span>
            <span>•</span>
            {!clientMode && <><span>Marge Cumulée : <strong className="text-gray-900">{dailyAverages.avgMargin.toFixed(1)}%</strong></span><span>•</span></>}
            <span>Spend moyen/jour : <strong className="text-gray-900">{(project.dailyEntries.reduce((s,e) => s + e.budgetSpent, 0) / project.dailyEntries.length).toFixed(0)} {currSym}</strong></span>
          </div>
        )}
      </div>
    )}

    {/* ========================================
        🔥 V5.0 : COMPARAISON PÉRIODE vs PÉRIODE
        ======================================== */}
    {!clientMode && project.dailyEntries && project.dailyEntries.length >= 4 && (
      <div className="mt-4 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h4 className="font-black text-gray-900 mb-4 flex items-center gap-2 text-sm">
          ⚖️ Comparaison Période vs Période
        </h4>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
            <div className="text-xs font-bold text-blue-800 mb-2">📅 Période 1</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-500 font-bold">Du</label>
                <input type="date" className="w-full text-xs border-gray-200 bg-white rounded-md p-1.5 border outline-none"
                  value={period1Start} onChange={(e) => setPeriod1Start(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-bold">Au</label>
                <input type="date" className="w-full text-xs border-gray-200 bg-white rounded-md p-1.5 border outline-none"
                  value={period1End} onChange={(e) => setPeriod1End(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
            <div className="text-xs font-bold text-purple-800 mb-2">📅 Période 2</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-500 font-bold">Du</label>
                <input type="date" className="w-full text-xs border-gray-200 bg-white rounded-md p-1.5 border outline-none"
                  value={period2Start} onChange={(e) => setPeriod2Start(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-bold">Au</label>
                <input type="date" className="w-full text-xs border-gray-200 bg-white rounded-md p-1.5 border outline-none"
                  value={period2End} onChange={(e) => setPeriod2End(e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        {/* Boutons raccourcis */}
        <div className="flex gap-2 mb-4">
          {(() => {
            const srt = [...(project.dailyEntries || [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            if (srt.length < 4) return null;
            const mid = Math.floor(srt.length / 2);
            return (
              <>
                <button onClick={() => {
                  setPeriod1Start(srt[0].date); setPeriod1End(srt[mid - 1].date);
                  setPeriod2Start(srt[mid].date); setPeriod2End(srt[srt.length - 1].date);
                }} className="text-[10px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors">
                  1ère moitié vs 2ème moitié
                </button>
                {srt.length >= 14 && (
                  <button onClick={() => {
                    setPeriod1Start(srt[srt.length - 14].date); setPeriod1End(srt[srt.length - 8].date);
                    setPeriod2Start(srt[srt.length - 7].date); setPeriod2End(srt[srt.length - 1].date);
                  }} className="text-[10px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors">
                    Semaine -2 vs Semaine -1
                  </button>
                )}
              </>
            );
          })()}
        </div>

        {periodComparison ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm text-left">
              <thead className="text-[10px] text-gray-500 uppercase bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2.5 font-bold">Métrique</th>
                  <th className="px-4 py-2.5 font-bold text-blue-700">Période 1 ({periodComparison.p1.days}j)</th>
                  <th className="px-4 py-2.5 font-bold text-purple-700">Période 2 ({periodComparison.p2.days}j)</th>
                  <th className="px-4 py-2.5 font-bold">Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[
                  {
                    label: "Spend Moyen/Jour",
                    v1: periodComparison.p1.avgDailySpend,
                    v2: periodComparison.p2.avgDailySpend,
                    fmt: (v: number) => `${v.toFixed(0)} ${currSym}`,
                    better: "neutral"
                  },
                  {
                    label: "Marge Cumulée",
                    v1: periodComparison.p1.avgMargin,
                    v2: periodComparison.p2.avgMargin,
                    fmt: (v: number) => `${v.toFixed(2)}%`,
                    better: "up"
                  },
                  {
                    label: `${project.kpiType} Moyen`,
                    v1: periodComparison.p1.avgKpi,
                    v2: periodComparison.p2.avgKpi,
                    fmt: (v: number) => fmtKpi(v),
                    better: isFin ? "down" : "up"
                  },
                  {
                    label: "CPM Revenu Cumulé",
                    v1: periodComparison.p1.avgCpmRevenue,
                    v2: periodComparison.p2.avgCpmRevenue,
                    fmt: (v: number) => `${v.toFixed(2)} ${currSym}`,
                    better: "neutral"
                  },
                  {
                    label: "Gain Total",
                    v1: periodComparison.p1.totalGain,
                    v2: periodComparison.p2.totalGain,
                    fmt: (v: number) => `${v.toFixed(0)} ${currSym}`,
                    better: "up"
                  }
                ].map((row) => {
                  const delta = row.v2 - row.v1;
                  const deltaPct = row.v1 > 0 ? (delta / row.v1) * 100 : 0;
                  const isPositive = delta > 0;
                  const isGood = row.better === "neutral" ? null : row.better === "up" ? isPositive : !isPositive;
                  return (
                    <tr key={row.label} className="bg-white hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-xs font-bold text-gray-700">{row.label}</td>
                      <td className="px-4 py-2.5 text-xs text-blue-700 font-semibold">{row.fmt(row.v1)}</td>
                      <td className="px-4 py-2.5 text-xs text-purple-700 font-semibold">{row.fmt(row.v2)}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("text-xs font-black px-2 py-0.5 rounded-full",
                          isGood === null ? "bg-gray-100 text-gray-600" :
                          isGood ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                        )}>
                          {isPositive ? "+" : ""}{deltaPct.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-gray-400">
            Sélectionnez deux périodes ou utilisez un raccourci ci-dessus pour comparer.
          </div>
        )}
      </div>
    )}
  </div>
)}
      

              {activeTab === "comparateur" && (
                <div className="space-y-8">
                  <div className="bg-gray-50 p-6 rounded-xl border border-gray-100">
                    <div className="flex justify-between items-center mb-4">
                      <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Marge</label>
                      <span className={cn("font-bold px-3 py-1 rounded-full text-sm", uplift >= 0 ? "text-blue-600 bg-blue-100" : "text-red-600 bg-red-100")}>
                        {uplift > 0 ? "+" : ""}{uplift.toFixed(1)} Pts
                      </span>
                    </div>
                    <input 
  type="range" min="-30" max="30" step="0.1"
  className={cn("w-full", uplift >= 0 ? "accent-blue-600" : "accent-red-600")}
  value={uplift}
  onChange={(e) => updateUplift(Number(e.target.value))}
/>

                    {(() => {
                      const newMargin = currentMarginPctCalc + uplift;
                      const tmcp = newMargin < 100 ? (newMargin / (100 - newMargin)) * 100 : 0;
                      const budgetRestant = project.budgetTotal - project.budgetSpent;
                      const costDejaDepense = computeTrueCostSpent(project);
                      let costDSP = 0;
                      let totalCostDSP = 0;

                      if (project.inputMode === "CPM Cost") {
                        if (uplift >= 0) {
                          costDSP = budgetRestant * (1 - newMargin / 100);
                          totalCostDSP = costDejaDepense + costDSP;
                        } else {
                          const costRestant = budgetRestant * (1 - newMargin / 100);
                          costDSP = costDejaDepense + costRestant;
                          totalCostDSP = costDSP;
                        }
                      }

                      return (
                        <div className="mt-6 bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between shadow-sm">
                          <div>
                            <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-1">Nouvelle Marge Globale</div>
                            <div className="text-xl font-black text-gray-900">{newMargin.toFixed(2)} %</div>
                          </div>
                          <div className="text-gray-300 px-4">
                            <ArrowRight className="w-6 h-6" />
                          </div>
                          <div className="text-right">
                            {project.inputMode === "CPM Cost" ? (
                              <>
                                <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-1">Cost dans le DSP</div>
                                <div className="text-xl font-black text-blue-600">{costDSP.toFixed(2)} {currSym}</div>
                                <div className="text-[10px] text-gray-400 mt-1">
                                  {uplift >= 0 ? "Budget restant seulement" : "Cost total (dépensé + restant)"}
                                </div>
                                {uplift > 0 && (
                                  <div className="mt-2 pt-2 border-t border-dashed border-gray-200">
                                    <div className="text-[10px] text-gray-500 font-bold uppercase">Total Budget à saisir</div>
                                    <div className="text-sm font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded inline-block mt-0.5">
                                      {totalCostDSP.toFixed(2)} {currSym}
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-1">Total Media Cost Plus</div>
                                <div className="text-xl font-black text-blue-600">{tmcp.toFixed(2)} %</div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* 🎯 ALGORITHME ULTRA-EXPERT CORRECT V3 - OPTION 1 FOURCHETTE RÉDUITE */}
                    <div className="bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-200 rounded-xl p-6 mt-6">
                      <h4 className="font-bold text-purple-900 mb-2 flex items-center gap-2">
                        <Target className="w-5 h-5" />
                        Impact sur le {project.kpiType} Objectif
                      </h4>
                       <div className="flex items-center justify-between mb-6">
                        <p className="text-sm text-purple-700">
                          Fourchette d'impact basée sur 20 ans d'expertise programmatique
                        </p>
                        <button
                          onClick={() => setExpertMode(!expertMode)}
                          className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all border-2",
                            expertMode ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-indigo-600 border-indigo-200 hover:border-indigo-400"
                          )}
                        >
                          {expertMode ? "📊 Mode Expert" : "⚡ Mode Compact"}
                        </button>
                      </div>

                      {(() => {
                        const newMargin = currentMarginPctCalc + uplift;
                        const marginChangePct = Math.abs(uplift / Math.max(currentMarginPctCalc, 0.01));
                        const isFin = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
                        const isIncreasingMargin = uplift > 0;
                        
                        // 🔥 FACTEUR ATTRIBUTION (CPA/CPV UNIQUEMENT)
                        const isAttributionKPI = project.kpiType === "CPA" || project.kpiType === "CPV";
                        const attributionFactor = isAttributionKPI 
                          ? (attrClick + attrView * 0.3) / 8
                          : 1.0;
                        
                        const isLongAttribution = attrClick > 14;
                        
                        // 🎯 COEFFICIENTS BASE PAR KPI
                        const getKPICoefficients = (kpiType: string) => {
                          const coeffs = {
                            CPCV: { 
                              marginImpact: 0.42,
                              volatility: 0.25,
                              competition: 0.35,
                              bidImpactFactor: 0.55
                            },
                            CPA: { 
                              marginImpact: 0.48,
                              volatility: 0.30,
                              competition: 0.40,
                              bidImpactFactor: 0.65
                            },
                            CPC: { 
                              marginImpact: 0.45,
                              volatility: 0.28,
                              competition: 0.38,
                              bidImpactFactor: 0.60
                            },
                            CPV: { 
                              marginImpact: 0.40,
                              volatility: 0.22,
                              competition: 0.32,
                              bidImpactFactor: 0.58
                            },
                            CPM: { 
                              marginImpact: 0.28,
                              volatility: 0.15,
                              competition: 0.22,
                              bidImpactFactor: 0.40
                            },
                            CTR: { 
                              marginImpact: 0.18,
                              volatility: 0.12,
                              competition: 0.15,
                              bidImpactFactor: 0.25
                            },
                            VTR: { 
                              marginImpact: 0.25,
                              volatility: 0.15,
                              competition: 0.20,
                              bidImpactFactor: 0.35
                            },
                            Viewability: { 
                              marginImpact: 0.12,
                              volatility: 0.08,
                              competition: 0.12,
                              bidImpactFactor: 0.20
                            }
                          };
                          return coeffs[kpiType as keyof typeof coeffs] || coeffs.CPA;
                        };
                        
                        // 🔥 V8.0 : Utiliser coefficients calibrés si disponibles
const calibratedFromLearning = getCalibratedCoefficients(project, funnelType, crossCampaignPrior);
const coeffs = calibratedFromLearning.source !== "default"
  ? {
      marginImpact: calibratedFromLearning.marginImpact,
      volatility: calibratedFromLearning.volatility,
      competition: calibratedFromLearning.competition,
      bidImpactFactor: getKPICoefficients(project.kpiType).bidImpactFactor, // garder le bidImpact hardcodé
    }
  : getKPICoefficients(project.kpiType);
                        
                        // Appliquer facteur attribution
                        const finalMarginImpact = isAttributionKPI ? coeffs.marginImpact * attributionFactor : coeffs.marginImpact;
                        
                        // ⭐ OPTION 1 : BID STABLE
                        const option1_cpmCost = cpmCostActuelCalc;
                        const option1_cpmRevenue = option1_cpmCost / (1 - newMargin / 100);
                        
                        const option1_exceedsCap = option1_cpmRevenue > project.cpmSoldCap;
                        const option1_excessAmount = option1_exceedsCap ? option1_cpmRevenue - project.cpmSoldCap : 0;
                        const option1_excessPct = option1_exceedsCap ? (option1_excessAmount / project.cpmSoldCap) * 100 : 0;
                        
                        // ⭐ OPTION 2 : BID AJUSTÉ
                        let option2_cpmCost = cpmCostActuelCalc;
                        let option2_cpmRevenue = option1_cpmRevenue;
                        let option2_bidAdjustmentPct = 0;
                        let option2_explanation = "";
                        let option2_respectsCap = false;
                        
                        if (isIncreasingMargin) {
                          // Montée marge → Baisser bid pour respecter Cap
                          option2_cpmCost = project.cpmSoldCap * (1 - newMargin / 100);
                          option2_cpmRevenue = project.cpmSoldCap;
                          option2_bidAdjustmentPct = ((option2_cpmCost - cpmCostActuelCalc) / cpmCostActuelCalc) * 100;
                          option2_respectsCap = true;
                          
                          option2_explanation = `Pour respecter le CPM Vendu Cap (${project.cpmSoldCap.toFixed(2)} ${currSym}), ${option2_bidAdjustmentPct < 0 ? 'baissez' : 'ajustez'} votre bid à ${option2_cpmCost.toFixed(2)} ${currSym} (${option2_bidAdjustmentPct.toFixed(1)}%)`;
                        } else {
                          // Baisse marge → Monter bid pour volume
                          option2_bidAdjustmentPct = marginChangePct * coeffs.bidImpactFactor * 100;
                          option2_cpmCost = cpmCostActuelCalc * (1 + option2_bidAdjustmentPct / 100);
                          option2_cpmRevenue = option2_cpmCost / (1 - newMargin / 100);
                          
                          if (option2_cpmRevenue > project.cpmSoldCap) {
                            option2_cpmCost = project.cpmSoldCap * (1 - newMargin / 100);
                            option2_cpmRevenue = project.cpmSoldCap;
                            option2_bidAdjustmentPct = ((option2_cpmCost - cpmCostActuelCalc) / cpmCostActuelCalc) * 100;
                            option2_respectsCap = true;
                          }
                          
                          option2_explanation = option2_respectsCap
                            ? `Bid optimal pour le Cap : ${option2_cpmCost.toFixed(2)} ${currSym} (${option2_bidAdjustmentPct > 0 ? '+' : ''}${option2_bidAdjustmentPct.toFixed(1)}%)`
                            : `Pour maximiser le volume, montez votre bid à ${option2_cpmCost.toFixed(2)} ${currSym} (+${option2_bidAdjustmentPct.toFixed(1)}%)`;
                        }
                        
                        // 🔥 CALCUL VOLATILITÉ OPTION 2 - VERSION RÉDUITE (sans pari créative)
                        const bidChangeAmplitude = Math.abs(option2_bidAdjustmentPct) / 100;
                        let volatilityMultiplier = 1.0;
                        
                        // Volatilité RÉDUITE car on ne parie plus sur la créative
                        // Fourchette = uniquement incertitude marché (compétition, volatilité)
                        if (bidChangeAmplitude > 0.50) {
                          volatilityMultiplier = 1.4;  // Au lieu de 2.2
                        } else if (bidChangeAmplitude > 0.30) {
                          volatilityMultiplier = 1.3;  // Au lieu de 1.8
                        } else if (bidChangeAmplitude > 0.20) {
                          volatilityMultiplier = 1.2;  // Au lieu de 1.5
                        } else if (bidChangeAmplitude > 0.10) {
                          volatilityMultiplier = 1.15; // Au lieu de 1.3
                        }
                        
                        // Niveau du nouveau bid (impact réduit aussi)
                        const avgMarketCpm = 3.0;
                        const option2_bidRatio = option2_cpmCost / avgMarketCpm;
                        
                        if (option2_bidRatio < 0.3) {
                          volatilityMultiplier *= 1.2;  // Au lieu de 1.5
                        } else if (option2_bidRatio < 0.5) {
                          volatilityMultiplier *= 1.15; // Au lieu de 1.3
                        } else if (option2_bidRatio < 0.7) {
                          volatilityMultiplier *= 1.1;  // Au lieu de 1.2
                        }
                        
                       const isHighBidChange = Math.abs(option2_bidAdjustmentPct) > 20;
                        
                        // ========================================
                        // 🔥 V3.4 : ANALYSE COMPORTEMENTALE DEPUIS DAILY ENTRIES
                        // ========================================
                        let realKpiVolatility: number | null = null;
                        let realKpiTrendPct: number | null = null;
                        
                       if (project.dailyEntries && project.dailyEntries.length >= 3) {
                          // 🔥 V8.1 : Agréger par DATE d'abord (critique en mode adgroup)
                          const dailyAgg = new Map<string, { totalSpend: number; totalKpiWeighted: number; totalActions: number }>();
                          const isFin_local = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
                          
                          for (const e of project.dailyEntries) {
                            const spend = e.budgetSpent || 0;
                            const kpi = e.kpiActual || 0;
                            if (spend <= 0 || kpi <= 0) continue;
                            const existing = dailyAgg.get(e.date);
                            if (existing) {
                              existing.totalSpend += spend;
                              existing.totalKpiWeighted += spend * kpi;
                              if (isFin_local && kpi > 0) existing.totalActions += spend / kpi;
                            } else {
                              dailyAgg.set(e.date, {
                                totalSpend: spend,
                                totalKpiWeighted: spend * kpi,
                                totalActions: isFin_local && kpi > 0 ? spend / kpi : 0,
                              });
                            }
                          }
                          
                          // KPI journalier agrégé par date
                          const kpiValues: number[] = [...dailyAgg.entries()]
                            .sort((a, b) => a[0].localeCompare(b[0]))
                            .map(([, d]) => {
                              if (isFin_local) {
                                return d.totalActions > 0 ? d.totalSpend / d.totalActions : 0;
                              } else {
                                return d.totalSpend > 0 ? d.totalKpiWeighted / d.totalSpend : 0;
                              }
                            })
                            .filter(v => v > 0);
                          
                          if (kpiValues.length >= 3) {
                            // 1. Volatilité réelle (écart-type des variations jour/jour)
                            const kpiChanges: number[] = [];
                            for (let i = 1; i < kpiValues.length; i++) {
                              if (kpiValues[i - 1] > 0) {
                                kpiChanges.push((kpiValues[i] - kpiValues[i - 1]) / kpiValues[i - 1]);
                              }
                            }
                            if (kpiChanges.length >= 2) {
                              const mean_kc = kpiChanges.reduce((a, b) => a + b, 0) / kpiChanges.length;
                              const variance = kpiChanges.reduce((a, b) => a + (b - mean_kc) ** 2, 0) / kpiChanges.length;
                              realKpiVolatility = Math.sqrt(variance);
                              // 🔥 V8.1 : Cap volatilité à 50% max — au-delà c'est du bruit, pas du signal
                              realKpiVolatility = Math.min(realKpiVolatility, 0.50);
                            }
                            
                            // 2. Trend (régression linéaire sur les 5 derniers jours agrégés)
                            const recentKpis = kpiValues.slice(-5);
                            if (recentKpis.length >= 3) {
                              const n = recentKpis.length;
                              const xMean = (n - 1) / 2;
                              const yMean = recentKpis.reduce((a, b) => a + b, 0) / n;
                              let num = 0, den = 0;
                              for (let i = 0; i < n; i++) {
                                num += (i - xMean) * (recentKpis[i] - yMean);
                                den += (i - xMean) ** 2;
                              }
                              const slope = den > 0 ? num / den : 0;
                              realKpiTrendPct = yMean > 0 ? slope / yMean : 0;
                              // 🔥 V8.1 : Cap trend à ±20%/jour — au-delà c'est du bruit
                              realKpiTrendPct = Math.max(-0.20, Math.min(0.20, realKpiTrendPct));
                            }
                          }
                        }
                        
                        // ========================================
                        // 🔥 CALCUL KPIs PROJETÉS - CORRECTION OPTION 1
                        // ========================================
                        
                        let option1_kpi_optimistic, option1_kpi_pessimistic;
                        let option2_kpi_optimistic, option2_kpi_pessimistic;
                        
                        // 🎯 BASE COMMUNE : Impact mathématique de la marge
                        const marginImpactDirection = isFin ? (isIncreasingMargin ? 1 : -1) : (isIncreasingMargin ? -1 : 1);
                        const baseMarginImpact = 1 + (marginChangePct * finalMarginImpact * marginImpactDirection);
                        
                        // ========================================
        // 🔥 OPTION 1 : CALCUL MATHÉMATIQUE EXACT
        // ========================================
        
        // Bid stable = MÊME inventaire = MÊME conversion rate
        // → Impact PUREMENT MATHÉMATIQUE du ratio CPM Revenue
        
        const currentCpmRevenue = project.cpmRevenueActual;
        const currentCpmCost = cpmCostActuelCalc;
        
        // Nouvelle CPM Revenue avec la nouvelle marge
        const newCpmRevenue_option1 = currentCpmCost / (1 - newMargin / 100);
        
        // Ratio CPM Revenue (impact mathématique pur)
        const cpmRevenueRatio = newCpmRevenue_option1 / currentCpmRevenue;
        
        // Impact EXACT sur le KPI (financier)
        let option1_kpi_exact: number;
        
        // 🔬 V9.1 : DEUX MODÈLES — empirique (calibré) ou théorique (formule)
        // 🔬 V10.2 : Prioriser le modèle de saturation (non-linéaire) sur le modèle linéaire
        const satModel = calibratedStats?.saturationModel;
        const useSaturationModel = satModel && satModel.confidence > 0.3 && satModel.dataPoints >= 7;
        const useEmpiricalModel = !useSaturationModel && calibratedStats && calibratedStats.elasticityConfidence > 0.3 && calibratedStats.marginKpiElasticity !== 0;

        if (useSaturationModel) {
          option1_kpi_exact = satModel!.predict(newMargin);
          option1_kpi_exact = Math.max(project.actualKpi * 0.1, Math.min(project.actualKpi * 5.0, option1_kpi_exact));
          console.log(`🔬 Option 1 SATURATION: predict(${newMargin.toFixed(1)}%)=${option1_kpi_exact.toFixed(4)}, satPoint=${satModel!.saturationPoint.toFixed(1)}%, R²=${satModel!.confidence.toFixed(2)}, n=${satModel!.dataPoints}`);
        } else if (useEmpiricalModel) {
          // ============================================================
          // 🔬 MODÈLE EMPIRIQUE — basé sur les données réelles de la campagne
          // marginKpiElasticity = % changement KPI par point de marge (mesuré par régression)
          // ============================================================
          const marginDeltaPoints = newMargin - currentMarginPctCalc;
          const kpiChangeRatio = 1 + calibratedStats!.marginKpiElasticity * marginDeltaPoints;
          // Plafonner pour éviter les projections absurdes (min 20%, max 300% du KPI actuel)
          const clampedRatio = Math.max(0.2, Math.min(3.0, kpiChangeRatio));
          option1_kpi_exact = project.actualKpi * clampedRatio;
          console.log(`🔬 Option 1 LINÉAIRE: elasticity=${calibratedStats!.marginKpiElasticity.toFixed(4)}, delta=${marginDeltaPoints.toFixed(1)}pts, ratio=${clampedRatio.toFixed(3)}, KPI=${option1_kpi_exact.toFixed(4)}`);
        } else if (isFin) {
          // 🔢 MODÈLE THÉORIQUE (fallback quand pas assez de données)
          if (project.kpiType === "CPA" || project.kpiType === "CPV") {
            const volumeRatio = currentCpmRevenue / newCpmRevenue_option1;
            const reachElasticity = getReachElasticity();
            const reachImpactFactor = Math.pow(volumeRatio, reachElasticity);
            option1_kpi_exact = project.actualKpi * cpmRevenueRatio / reachImpactFactor;
          } else {
            option1_kpi_exact = project.actualKpi * cpmRevenueRatio;
          }
        } else {
          const qualityImpact = isIncreasingMargin ? 0.98 : 1.02;
          option1_kpi_exact = project.actualKpi * qualityImpact;
        }
        
      // 🔥 V8.1 : Ajuster le centre avec le trend réel observé (cappé à ±30% max)
        if (realKpiTrendPct !== null) {
          const trendAdjust = option1_kpi_exact * Math.max(-0.30, Math.min(0.30, realKpiTrendPct * 3));
          option1_kpi_exact += trendAdjust;
        }
        
        // 🔥 FOURCHETTE basée sur la vraie volatilité si disponible
        let option1_uncertainty: number;
        
       if (realKpiVolatility !== null) {
          // Volatilité réelle observée × horizon ~5 jours
          option1_uncertainty = option1_kpi_exact * realKpiVolatility * Math.sqrt(5);
          // Plancher minimum pour éviter une fourchette à zéro
          option1_uncertainty = Math.max(option1_uncertainty, option1_kpi_exact * 0.02);
          // 🔥 V8.1 FIX : Plafond à 40% du KPI exact — empêche optimiste = 0
          option1_uncertainty = Math.min(option1_uncertainty, option1_kpi_exact * 0.40);
        } else if (isFin) {
          if (project.kpiType === "CPA" || project.kpiType === "CPV") {
            const funnelUncertaintyMult = funnelType === "retargeting" ? 1.3 : funnelType === "prospecting" ? 0.8 : 1.0;
            option1_uncertainty = option1_kpi_exact * (isIncreasingMargin ? 0.08 : 0.05) * funnelUncertaintyMult;
          } else {
            option1_uncertainty = option1_kpi_exact * 0.03;
          }
        } else {
          option1_uncertainty = option1_kpi_exact * 0.05;
        }
        
        if (isFin) {
          // KPI financier : plus bas = mieux = optimiste
          option1_kpi_optimistic = option1_kpi_exact - option1_uncertainty;
          option1_kpi_pessimistic = option1_kpi_exact + option1_uncertainty;
        } else {
          // KPI qualité (VTR, CTR, Viewability) : plus haut = mieux = optimiste
          option1_kpi_optimistic = option1_kpi_exact + option1_uncertainty;
          option1_kpi_pessimistic = option1_kpi_exact - option1_uncertainty;
        }

        // 🔥 V8.1 : Sanity caps — empêcher les projections absurdes
        if (isFin) {
          option1_kpi_optimistic = Math.max(0.001, option1_kpi_optimistic);
          option1_kpi_pessimistic = Math.max(0.001, option1_kpi_pessimistic);
          const maxReasonableKpi = project.actualKpi * 10;
          option1_kpi_pessimistic = Math.min(option1_kpi_pessimistic, maxReasonableKpi);
        } else {
          option1_kpi_optimistic = Math.max(0, Math.min(100, option1_kpi_optimistic));
          option1_kpi_pessimistic = Math.max(0, Math.min(100, option1_kpi_pessimistic));
        }
                        
                        // 🎯 BID IMPACT pour Option 2
                        const bidImpactDirection = isFin ? 1 : -1;
                        const bidImpactMagnitude = Math.abs(option2_bidAdjustmentPct) / 100;
                        
                        // Impact CERTAIN du changement d'inventaire
                        // Pas de "pari créative", juste la réalité du shift d'inventaire
                        const inventoryShiftImpact = bidImpactMagnitude * coeffs.bidImpactFactor * bidImpactDirection;
                        
                        // OPTION 2 : Calcul déterministe
                        // 1. Impact marge (mathématique)
                        const option2_center_base = project.actualKpi * baseMarginImpact;
                        
                        // 2. Impact inventaire (CERTAIN, pas optimiste/pessimiste)
                        const inventoryImpact = project.actualKpi * inventoryShiftImpact;
                        
                       // 3. Centre = impact marge + impact inventaire
                        let option2_center = option2_center_base + inventoryImpact;
                        
                       // 🔥 V8.1 : Ajuster le centre avec le trend réel observé (cappé à ±30% max)
                        if (realKpiTrendPct !== null) {
                          option2_center += option2_center * Math.max(-0.30, Math.min(0.30, realKpiTrendPct * 3));
                        }
                        
                        // 🔥 FOURCHETTE basée sur la vraie volatilité si disponible
                        let adjustedVolatility: number;
                        if (realKpiVolatility !== null) {
                          // Volatilité réelle × horizon × multiplicateur bid
                          adjustedVolatility = project.actualKpi * realKpiVolatility * Math.sqrt(5) * Math.min(volatilityMultiplier, 1.4);
                          adjustedVolatility = Math.max(adjustedVolatility, project.actualKpi * 0.02);
                          // 🔥 V8.1 FIX : Plafond à 60% du centre — empêche optimiste = 0
                          adjustedVolatility = Math.min(adjustedVolatility, Math.abs(option2_center) * 0.60);
                        } else {
                          const marketUncertainty = project.actualKpi * (coeffs.volatility + coeffs.competition);
                          adjustedVolatility = marketUncertainty * Math.min(volatilityMultiplier, 1.4);
                        }
                        
                       if (isFin) {
                          // KPI financier : plus bas = mieux = optimiste
                          option2_kpi_optimistic = option2_center - (adjustedVolatility / 2);
                          option2_kpi_pessimistic = option2_center + (adjustedVolatility / 2);
                        } else {
                          // KPI qualité : plus haut = mieux = optimiste
                          option2_kpi_optimistic = option2_center + (adjustedVolatility / 2);
                          option2_kpi_pessimistic = option2_center - (adjustedVolatility / 2);
                        }

                        // 🔥 V8.1 : Sanity caps option 2
                        if (isFin) {
                          option2_kpi_optimistic = Math.max(0.001, option2_kpi_optimistic);
                          option2_kpi_pessimistic = Math.max(0.001, option2_kpi_pessimistic);
                          const maxReasonableKpi2 = project.actualKpi * 10;
                          option2_kpi_pessimistic = Math.min(option2_kpi_pessimistic, maxReasonableKpi2);
                        } else {
                          option2_kpi_optimistic = Math.max(0, Math.min(100, option2_kpi_optimistic));
                          option2_kpi_pessimistic = Math.max(0, Math.min(100, option2_kpi_pessimistic));
                        }
                        
                        // Vérifier si objectif atteint
                        
                        // Vérifier si objectif atteint
                        const targetKpi = project.targetKpi;
                        const option1_meetsTarget_optimistic = isFin ? option1_kpi_optimistic <= targetKpi : option1_kpi_optimistic >= targetKpi;
                        const option1_meetsTarget_pessimistic = isFin ? option1_kpi_pessimistic <= targetKpi : option1_kpi_pessimistic >= targetKpi;
                        const option2_meetsTarget_optimistic = isFin ? option2_kpi_optimistic <= targetKpi : option2_kpi_optimistic >= targetKpi;
                        const option2_meetsTarget_pessimistic = isFin ? option2_kpi_pessimistic <= targetKpi : option2_kpi_pessimistic >= targetKpi;
                        
                        // Calculer les ranges pour affichage
                        const option1_range = option1_kpi_pessimistic - option1_kpi_optimistic;
                        const option2_range = option2_kpi_pessimistic - option2_kpi_optimistic;
                        
                        // ========================================
                        // EXPLICATIONS ULTRA-EXPERTES PAR KPI
                        // ========================================
                        
                        const getKPIExplanations = (kpiType: string, isIncreasing: boolean) => {
                          const explanations: any = {
                            CPCV: {
                              up: { 
                                impact: "Marge monte → Bid baisse → Inventaire moins premium. Completion rate CHUTE (shift mathématique vers outstream, banner vidéo). Impact CERTAIN : CPCV grimpe.",
                                option2: "Baisser modérément permet de rester sur mid-tier. Limite la dégradation.",
                                range: "Fourchette = incertitude marché (compétition, volatilité). PAS de pari créative."
                              },
                              down: { 
                                impact: "Marge baisse → Bid monte → Accès inventaire PREMIUM (in-stream, player grand format). Completion rate MONTE (shift mathématique certain). CPCV BAISSE.",
                                option2: "Monter agressivement = dominer l'inventaire premium. Effet garanti.",
                                range: "Fourchette = incertitude marché normale. Impact inventaire est CERTAIN."
                              }
                            },
                            CPA: {
                              up: { 
                                impact: isLongAttribution 
                                  ? `🔥 CRITIQUE (J+${attrClick}) : Reach baisse → MOINS d'impressions sur toute la fenêtre → Conversions BAISSENT mathématiquement (reach = volume). CPA MONTE.`
                                  : `🔥 CRITIQUE : Reach baisse → MOINS impressions dans fenêtre J+${attrClick} clic / J+${attrView} view → Conversions baissent mathématiquement. CPA MONTE.`,
                                option2: `Ajuster bid maintient VOLUME. Impact mathématique prévisible pour ${attrClick} jours.`,
                                range: "Fourchette = volatilité compétition (enchères fluctuantes). Pas de pari créative."
                              },
                              down: { 
                                impact: isLongAttribution 
                                  ? `🚀 OPPORTUNITÉ (J+${attrClick}) : Reach MASSIF ${attrClick} jours → Multi-touch sur TOUTE fenêtre → Conversions MONTENT mathématiquement. CPA BAISSE.`
                                  : `🚀 BOOST : Reach ↑ → Plus impressions fenêtre J+${attrClick} → Multi-touch maximisé → Conversions ↑ mathématiquement. CPA baisse.`,
                                option2: "Baisse marge + boost bid = MULTIPLICATEUR conversions. Effet déterministe.",
                                range: "Fourchette = volatilité marché (niveau compétition variable). Impact reach CERTAIN."
                              }
                            },
                            CPC: {
                              up: { 
                                impact: "Baisser bid = perte positions premium → CTR BAISSE (mathématique) → Moins clics pour même coût → CPC MONTE.",
                                option2: "Modéré = rester mid-funnel. Éviter l'effondrement total.",
                                range: "Fourchette = volatilité marché (compétition variable). Pas de pari créative."
                              },
                              down: { 
                                impact: "Monter bid = positions PREMIUM (above-fold, native) → CTR ↑ (mathématique) → Plus clics même coût → CPC BAISSE.",
                                option2: "Agressif = domination premium. Effet garanti.",
                                range: "Fourchette = incertitude compétition. Impact positions CERTAIN."
                              }
                            },
                            CPV: {
                              up: { 
                                impact: isLongAttribution 
                                  ? `🔥 CRITIQUE (J+${attrClick}) : Shift vers LOW-INTENT → Visites trash (bounce élevé) CERTAIN → CPV grimpe.`
                                  : `🔥 QUALITÉ BAISSE : Moins placements contextuels → LOW-INTENT mathématique → CPV monte.`,
                                option2: `Ajuster = mid-tier QUALIFIÉ. Impact déterministe.`,
                                range: "Fourchette = volatilité marché (niveau fraud variable). Pas de pari créative."
                              },
                              down: { 
                                impact: isLongAttribution 
                                  ? `🚀 OPPORTUNITÉ (J+${attrClick}) : Premium intent-based → ULTRA-QUALIFIÉ mathématiquement → CPV BAISSE.`
                                  : `🚀 QUALITÉ MONTE : Meilleur contextuel → ULTRA-QUALIFIÉ certain → CPV baisse.`,
                                option2: "Baisse + boost = volume QUALIFIÉ. Effet garanti.",
                                range: "Fourchette = volatilité marché normale. Impact qualité CERTAIN."
                              }
                            },
                            CPM: {
                              up: { 
                                impact: "Baisser bid = inventaire RÉSIDUEL → Fill rate CHUTE → CPM peut monter (paradoxe résiduel).",
                                option2: "Ajuster = inventaire standard. Impact prévisible.",
                                range: "Fourchette = volatilité fill rate (inventaire variable)."
                              },
                              down: { 
                                impact: "Monter bid = inventaire PREMIUM → Fill rate ÉLEVÉ → CPM baisse (économies d'échelle).",
                                option2: "Hausser = premium, fill rate max. Effet garanti.",
                                range: "Fourchette = volatilité marché normale."
                              }
                            },
                            CTR: {
                              up: { 
                                impact: "Bid plus bas = visibilité réduite (below-fold) → CTR BAISSE (mathématique).",
                                option2: "Éviter l'invisible total.",
                                range: "Fourchette = volatilité positions (enchères variables)."
                              },
                              down: { 
                                impact: "Bid plus haut = visibilité ↑ (above-fold) → CTR ↑ (mathématique).",
                                option2: "Hausser = premium. Effet certain.",
                                range: "Fourchette = volatilité marché normale."
                              }
                            },
                            VTR: {
                              up: { 
                                impact: "Moins bid = shift OUTSTREAM low → VTR chute (mathématique).",
                                option2: "Ajuster = in-stream mid. Impact prévisible.",
                                range: "Fourchette = volatilité inventaire."
                              },
                              down: { 
                                impact: "Plus bid = IN-STREAM premium → VTR ↑ (mathématique).",
                                option2: "Hausser = in-stream. Effet garanti.",
                                range: "Fourchette = volatilité marché normale."
                              }
                            },
                            Viewability: {
                              up: { 
                                impact: "Viewability dépend peu du bid (technique). Impact FAIBLE.",
                                option2: "Minimal.",
                                range: "Fourchette = stabilité technique."
                              },
                              down: { 
                                impact: "Plus bid = léger premium → Impact MARGINAL.",
                                option2: "Un peu.",
                                range: "Fourchette = quasi nulle."
                              }
                            }
                          };
                          return explanations[kpiType]?.[isIncreasing ? 'up' : 'down'] || explanations.CPA[isIncreasing ? 'up' : 'down'];
                        };
                        
                        const kpiExplanations = getKPIExplanations(project.kpiType, isIncreasingMargin);
                        
                        return (
                          <div className="space-y-6">
                            {/* ALERTES */}
                            {isLongAttribution && isAttributionKPI && (
                              <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-4">
                                <div className="flex items-center gap-2 text-orange-900 mb-2">
                                  <AlertTriangle className="w-5 h-5" />
                                  <span className="font-black">FENÊTRE ATTRIBUTION LONGUE (J+{attrClick})</span>
                                </div>
                                <p className="text-sm text-orange-700">
                                  Sensibilité EXTRÊME au bid. Impact MULTIPLIÉ ×{attributionFactor.toFixed(2)} sur {project.kpiType}.
                                </p>
                              </div>
                            )}
                            
                            {isHighBidChange && (
                              <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4">
                                <div className="flex items-center gap-2 text-amber-900 mb-2">
                                  <AlertTriangle className="w-5 h-5" />
                                  <span className="font-black">CHANGEMENT BID IMPORTANT</span>
                                </div>
                                <p className="text-sm text-amber-700">
                                  Le Bid Shading détecte un ajustement de bid de {option2_bidAdjustmentPct > 0 ? '+' : ''}{option2_bidAdjustmentPct.toFixed(1)}%
                                  → Fourchette ÉLARGIE ×{volatilityMultiplier.toFixed(2)} (incertitude marché : compétition variable, volatilité)
                                </p>
                              </div>
                            )}
                            {/* 🔬 V10.2 : ALERTE ZONE DE SATURATION */}
                            {useSaturationModel && (
                              <div className={cn("rounded-xl p-4 border-2",
                                newMargin > satModel!.saturationPoint 
                                  ? "bg-red-50 border-red-300" 
                                  : newMargin > satModel!.saturationPoint - 5
                                    ? "bg-amber-50 border-amber-300"
                                    : "bg-emerald-50 border-emerald-300"
                              )}>
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-lg">{newMargin > satModel!.saturationPoint ? "🚨" : newMargin > satModel!.saturationPoint - 5 ? "⚠️" : "✅"}</span>
                                  <span className={cn("font-black text-sm",
                                    newMargin > satModel!.saturationPoint ? "text-red-900" :
                                    newMargin > satModel!.saturationPoint - 5 ? "text-amber-900" : "text-emerald-900"
                                  )}>
                                    MODÈLE DE SATURATION — Point critique : {satModel!.saturationPoint.toFixed(1)}%
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 gap-3 mt-3">
                                  <div className="bg-white/80 rounded-lg p-2.5 border border-gray-100 text-center">
                                    <div className="text-[9px] text-gray-500 font-bold uppercase">Marge Proposée</div>
                                    <div className={cn("text-lg font-black mt-0.5",
                                      newMargin > satModel!.saturationPoint ? "text-red-600" : "text-emerald-600"
                                    )}>{newMargin.toFixed(1)}%</div>
                                  </div>
                                  <div className="bg-white/80 rounded-lg p-2.5 border border-gray-100 text-center">
                                    <div className="text-[9px] text-gray-500 font-bold uppercase">Zone Confort Max</div>
                                    <div className="text-lg font-black text-amber-600 mt-0.5">{satModel!.saturationPoint.toFixed(1)}%</div>
                                  </div>
                                  <div className="bg-white/80 rounded-lg p-2.5 border border-gray-100 text-center">
                                    <div className="text-[9px] text-gray-500 font-bold uppercase">Écart</div>
                                    <div className={cn("text-lg font-black mt-0.5",
                                      newMargin > satModel!.saturationPoint ? "text-red-600" : "text-emerald-600"
                                    )}>
                                      {(newMargin - satModel!.saturationPoint) > 0 ? "+" : ""}{(newMargin - satModel!.saturationPoint).toFixed(1)} pts
                                    </div>
                                  </div>
                                </div>
                                <p className={cn("text-xs mt-3 leading-relaxed",
                                  newMargin > satModel!.saturationPoint ? "text-red-700" : 
                                  newMargin > satModel!.saturationPoint - 5 ? "text-amber-700" : "text-emerald-700"
                                )}>
                                  {newMargin > satModel!.saturationPoint
                                    ? `🚨 Vous dépassez le point de saturation de +${(newMargin - satModel!.saturationPoint).toFixed(1)} pts. Au-delà de ${satModel!.saturationPoint.toFixed(1)}%, la dégradation du ${project.kpiType} s'accélère exponentiellement.`
                                    : newMargin > satModel!.saturationPoint - 5
                                      ? `⚠️ Vous approchez du point de saturation (${satModel!.saturationPoint.toFixed(1)}%). Encore ${(satModel!.saturationPoint - newMargin).toFixed(1)} pts avant accélération.`
                                      : `✅ Marge confortable — bien en dessous du point de saturation (${satModel!.saturationPoint.toFixed(1)}%).`
                                  }
                                </p>
                              </div>
                            )}

                            {/* BID SHADING ENGINE — 3 Scénarios */}
                            <BidShadingPanel
                              currentCpmCost={cpmCostActuelCalc}
                              currentCpmRevenue={project.cpmRevenueActual}
                              currentMarginPct={currentMarginPctCalc}
                              currentKpi={project.actualKpi}
                              targetKpi={project.targetKpi}
                              cpmSoldCap={project.cpmSoldCap}
                              kpiType={project.kpiType}
                              targetMarginPct={newMargin}
                              budgetDailyAvg={project.budgetTotal > 0 && project.durationDays > 0 ? project.budgetTotal / project.durationDays : 0}
                              daysRemaining={Math.max(1, project.durationDays - currentDay)}
                              currSym={currSym}
                              dailySpends={project.dailyEntries?.map(e => e.budgetSpent || 0)}
                              dailyEntries={project.dailyEntries}
                              calibratedStats={calibratedStats}
                              crossCampaignPrior={crossCampaignPrior}
                              realKpiVolatility={realKpiVolatility}
                              realKpiTrendPct={realKpiTrendPct}
                              fmtKpi={fmtKpi}
                              isFin={isFin}
                              expertMode={expertMode}
                            />
                            {/* 🔥 V11.0 : SCORE DE RISQUE CLIENT — Recalculé sans dépendances Option 1/2 */}
                            {(() => {
                              // Calcul du risque basé sur les variables disponibles dans le scope
                              const newCpmRevenue_risk = cpmCostActuelCalc / (1 - newMargin / 100);
                              const capExcessRisk = project.cpmSoldCap > 0 && newCpmRevenue_risk > project.cpmSoldCap
                                ? ((newCpmRevenue_risk - project.cpmSoldCap) / project.cpmSoldCap) * 100 : 0;
                              let riskScore = 0;
                              if (capExcessRisk > 0) riskScore += Math.min(50, capExcessRisk * 3);
                              riskScore += Math.min(20, Math.abs(uplift) * 1.5);
                              // Approximation KPI risk via margin change
                              if (Math.abs(uplift) > 10) riskScore += 15;
                              else if (Math.abs(uplift) > 5) riskScore += 8;
                              if (newMargin > 70) riskScore += 10;
                              riskScore = Math.min(100, Math.max(0, riskScore));
                              const riskLevel = riskScore >= 60 ? "HIGH" : riskScore >= 30 ? "MEDIUM" : "LOW";
                              const riskColor = riskLevel === "HIGH" ? "red" : riskLevel === "MEDIUM" ? "amber" : "emerald";

                              return (
                                <div className={cn("rounded-xl p-4 border-2 mt-4",
                                  riskColor === "red" ? "bg-red-50 border-red-300" : riskColor === "amber" ? "bg-amber-50 border-amber-300" : "bg-emerald-50 border-emerald-300"
                                )}>
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <AlertTriangle className={cn("w-5 h-5", riskColor === "red" ? "text-red-500" : riskColor === "amber" ? "text-amber-500" : "text-emerald-500")} />
                                      <span className={cn("font-black text-sm", riskColor === "red" ? "text-red-900" : riskColor === "amber" ? "text-amber-900" : "text-emerald-900")}>
                                        Risque Client
                                      </span>
                                    </div>
                                    <div className={cn("px-3 py-1 rounded-full text-xs font-black",
                                      riskColor === "red" ? "bg-red-200 text-red-800" : riskColor === "amber" ? "bg-amber-200 text-amber-800" : "bg-emerald-200 text-emerald-800"
                                    )}>
                                      {riskScore}/100 — {riskLevel === "HIGH" ? "ÉLEVÉ" : riskLevel === "MEDIUM" ? "MODÉRÉ" : "FAIBLE"}
                                    </div>
                                  </div>
                                  <div className="w-full bg-white/50 rounded-full h-2 mt-2">
                                    <div className={cn("h-full rounded-full transition-all", riskColor === "red" ? "bg-red-500" : riskColor === "amber" ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${riskScore}%` }}></div>
                                  </div>
                                  <div className={cn("text-xs mt-2 leading-relaxed", riskColor === "red" ? "text-red-700" : riskColor === "amber" ? "text-amber-700" : "text-emerald-700")}>
                                    {capExcessRisk > 0 && `⚠️ CPM Rev dépasse le Cap de +${capExcessRisk.toFixed(1)}%. `}
                                    {newMargin > 70 && `⚠️ Marge > 70% visible sur reporting. `}
                                    {riskScore < 30 && "✅ Faible probabilité de détection sur reporting client."}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })()}
                    </div>
                         
                    

                    <div className="mt-8 pt-8 border-t border-gray-100">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                         <h3 className="text-lg font-bold text-gray-900">
  {uplift >= 0 ? "Projection des Gains" : "Projection des Pertes"}
</h3>
                          <p className="text-sm text-gray-500">Évolution de la marge cumulée</p>
                        </div>
                        <div className={cn("border rounded-xl px-6 py-3 text-right", uplift >= 0 ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100")}>
                          <div className={cn("font-bold text-xs uppercase tracking-wider mb-1", uplift >= 0 ? "text-emerald-800" : "text-red-800")}>
  {uplift >= 0 ? "Gain Potentiel" : "Pertes Potentielles"}
</div>
                          <div className={cn("text-2xl font-black", uplift >= 0 ? "text-emerald-600" : "text-red-600")}>
                            {uplift > 0 ? "+" : ""}{(budgetRemaining * (uplift / 100)).toFixed(0)} {currSym}
                          </div>
                        </div>
                      </div>

                      <div className="h-80 w-full bg-gray-50 rounded-xl p-4 border border-gray-100">
                        {(() => {
                          const gainPotentiel = budgetRemaining * (uplift / 100);
                          const data = [];
                          for (let i = 0; i <= project.durationDays; i++) {
                            if (i <= currentDay) {
                              data.push({ day: i, Acquis: (gainRealized / currentDay) * i });
                            } else {
                              const stepsRemaining = project.durationDays - currentDay;
                              const step = i - currentDay;
                              data.push({
                                day: i,
                                Actuel: gainRealized + (gainRemaining / stepsRemaining) * step,
                                Optimisé: gainRealized + ((gainRemaining + gainPotentiel) / stepsRemaining) * step
                              });
                            }
                          }
                          return (
                            <ResponsiveContainer width="100%" height="100%">
                             <LineChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
  <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} />
  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={(val) => `${val}${currSym}`} />
  <Tooltip 
    contentStyle={{ borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
    formatter={(value: number) => [`${value.toFixed(0)} ${currSym}`]}
  />
  <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
  <Line type="monotone" dataKey="Acquis" stroke="#0f172a" strokeWidth={3} dot={false} />
  <Line type="monotone" dataKey="Actuel" stroke="#94a3b8" strokeWidth={3} strokeDasharray="5 5" dot={false} />
  <Line 
    type="monotone" 
    dataKey="Optimisé" 
    stroke={uplift >= 0 ? "#3b82f6" : "#ef4444"}
    strokeWidth={3} 
    strokeDasharray="5 5" 
    dot={false}
    name={uplift >= 0 ? "Optimisé" : "Baissée"}
  />
</LineChart>
                            </ResponsiveContainer>
                          );
                        })()}
                     </div>

                      {/* 🔥 V3.5 : SIMULATEUR MULTI-PHASES */}
                      <div className="mt-8 pt-8 border-t border-gray-100">
                        <h3 className="text-lg font-bold text-gray-900 mb-2">🔮 Simulateur Multi-Phases</h3>
                        <p className="text-sm text-gray-500 mb-4">Montée de marge sur la 1ère moitié restante, retour à la normale ensuite.</p>
                        
                        {(() => {
                          const joursRestants = Math.max(1, project.durationDays - currentDay);
                          const phase1Days = Math.floor(joursRestants / 2);
                          const phase2Days = joursRestants - phase1Days;
                          
                          const margin1 = currentMarginPctCalc + uplift;
                          const margin2 = currentMarginPctCalc;
                          
                          const dailyBudget = budgetRemaining / joursRestants;
                          const gainPhase1 = dailyBudget * phase1Days * (margin1 / 100);
                          const gainPhase2 = dailyBudget * phase2Days * (margin2 / 100);
                          const gainTotal = gainRealized + gainPhase1 + gainPhase2;
                          const gainSansChangement = gainRealized + budgetRemaining * (currentMarginPctCalc / 100);
                          const gainDelta = gainTotal - gainSansChangement;
                          
                          const kpiPhase1 = projectLineKpi(project.actualKpi, currentMarginPctCalc, margin1, project.cpmRevenueActual, isFin, project.kpiType, getReachElasticity());
                          const weightedKpi = (kpiPhase1 * phase1Days + project.actualKpi * phase2Days) / joursRestants;
                          
                          return (
                            <div className="bg-gradient-to-br from-violet-50 to-purple-50 border-2 border-violet-200 rounded-xl p-5">
                              <div className="grid grid-cols-2 gap-6">
                                <div>
                                  <div className="text-xs font-bold text-violet-900 uppercase tracking-wider mb-3">Phase 1 : Marge {margin1.toFixed(1)}%</div>
                                  <div className="bg-white rounded-lg p-3 border border-violet-100 mb-2">
                                    <div className="text-xs text-gray-500">Durée</div>
                                    <div className="text-lg font-black text-violet-700">{phase1Days} jours</div>
                                  </div>
                                  <div className="bg-white rounded-lg p-3 border border-violet-100">
                                    <div className="text-xs text-gray-500">Gain Phase 1</div>
                                    <div className="text-lg font-black text-violet-700">{gainPhase1.toFixed(0)} {currSym}</div>
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">Phase 2 : Retour {margin2.toFixed(1)}%</div>
                                  <div className="bg-white rounded-lg p-3 border border-gray-100 mb-2">
                                    <div className="text-xs text-gray-500">Durée</div>
                                    <div className="text-lg font-black text-gray-700">{phase2Days} jours</div>
                                  </div>
                                  <div className="bg-white rounded-lg p-3 border border-gray-100">
                                    <div className="text-xs text-gray-500">Gain Phase 2</div>
                                    <div className="text-lg font-black text-gray-700">{gainPhase2.toFixed(0)} {currSym}</div>
                                  </div>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-violet-200">
                                <div className="bg-white rounded-lg p-3 border border-violet-100 text-center">
                                  <div className="text-xs text-gray-500 font-bold uppercase">Gain Total</div>
                                  <div className="text-xl font-black text-violet-700 mt-1">{gainTotal.toFixed(0)} {currSym}</div>
                                </div>
                                <div className={cn("rounded-lg p-3 border text-center", gainDelta >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200")}>
                                  <div className="text-xs text-gray-500 font-bold uppercase">vs Sans Changement</div>
                                  <div className={cn("text-xl font-black mt-1", gainDelta >= 0 ? "text-emerald-600" : "text-red-600")}>
                                    {gainDelta >= 0 ? "+" : ""}{gainDelta.toFixed(0)} {currSym}
                                  </div>
                                </div>
                                <div className="bg-white rounded-lg p-3 border border-violet-100 text-center">
                                  <div className="text-xs text-gray-500 font-bold uppercase">{project.kpiType} Pondéré</div>
                                  <div className={cn("text-xl font-black mt-1", 
                                    isFin ? (weightedKpi <= project.targetKpi ? "text-emerald-600" : "text-red-600") : (weightedKpi >= project.targetKpi ? "text-emerald-600" : "text-red-600")
                                  )}>
                                    {fmtKpi(weightedKpi)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "multilines" && (
                <div className="space-y-6">
                  {/* 🔥 V7.2 : MODE TTD IMPORTER */}
                  {ttdMode ? (
                    <TTDImporter
                      kpiType={project.kpiType}
                      targetKpi={project.targetKpi}
                      initialFile={ttdFile}
                      onBack={() => { setTtdMode(false); setTtdFile(null); }}
                      onApplyToLineItems={(lineItems) => {
                        updateField("lineItems", lineItems);
                      }}
                    />
                  ) : (
                  <>
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-bold text-gray-900">Gestion des Line Items</h3>
                    <div className="flex gap-3">
                      <label className="cursor-pointer flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm">
                        <Upload className="w-4 h-4" />
                        Importer Excel
                        <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} />
                      </label>
                    </div>
                  </div>

{/* 🏆 V2.0 : PARETO PANEL INTERACTIF */}
                  <ParetoPanel
                    project={project}
                    onChange={onChange}
                    lineItems={project.lineItems}
                    lockedLines={lockedLines}
                    toggleLock={toggleLock}
                    currentMargin={currentMarginPctCalc}
                    isFin={isFin}
                    reachElasticity={getReachElasticity()}
                    currSym={currSym}
                    fmtKpi={fmtKpi}
                    createSnapshot={createSnapshot}
                  />
                    
                  
                   
                   {/* 🔥 TABLEAU ÉDITABLE DES LINE ITEMS */}
                  {project.lineItems.length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
                      <table className="w-full text-sm text-left">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-4 py-3 font-bold w-8"></th>
                            <th className="px-4 py-3 font-bold">Line Item</th>
                            <th className="px-4 py-3 font-bold">
                              <div>Dépense ({currSym})</div>
                              <div className="text-[9px] font-normal normal-case text-blue-500 mt-0.5">Globale cumulée (Rev)</div>
                            </th>
                           <th className="px-4 py-3 font-bold">
                              <div>CPM Revenu</div>
                              <div className="text-[9px] font-normal normal-case text-blue-500 mt-0.5">Cumulé global</div>
                            </th>
                            <th className="px-4 py-3 font-bold">
                              <div>Marge %</div>
                              <div className="text-[9px] font-normal normal-case text-blue-500 mt-0.5">Actuelle appliquée</div>
                            </th>
                            <th className="px-4 py-3 font-bold">
                              <div>{project.kpiType}</div>
                              <div className="text-[9px] font-normal normal-case text-blue-500 mt-0.5">Global cumulé</div>
                            </th>
                            <th className="px-4 py-3 font-bold w-10"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {project.lineItems.map((li, idx) => (
                            <tr key={li.id} className={cn("bg-white hover:bg-gray-50 transition-colors", lockedLines.has(li.id) && "bg-amber-50/50")}>
                              <td className="px-4 py-3">
                                <button
  onClick={() => toggleLock(li.id)}
  className={cn("p-1.5 rounded-lg transition-colors", lockedLines.has(li.id) ? "text-amber-600 bg-amber-100" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100")}
  title={lockedLines.has(li.id) ? "Déverrouiller le budget (marge optimisable)" : "Verrouiller le budget (marge reste optimisable)"}
>
  {lockedLines.has(li.id) ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
</button>
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="text"
                                  className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-medium"
                                  value={li.name}
                                  onChange={(e) => {
                                    const updated = [...project.lineItems];
                                    updated[idx] = { ...updated[idx], name: e.target.value };
                                    updateField("lineItems", updated);
                                  }}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="number"
                                  step="0.01"
                                  className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                  value={li.spend || ''}
                                  onChange={(e) => {
                                    const updated = [...project.lineItems];
                                    updated[idx] = { ...updated[idx], spend: Number(e.target.value) };
                                    updateField("lineItems", updated);
                                  }}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="number"
                                  step="0.01"
                                  className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                  value={li.cpmRevenue || ''}
                                  onChange={(e) => {
                                    const updated = [...project.lineItems];
                                    updated[idx] = { ...updated[idx], cpmRevenue: Number(e.target.value) };
                                    updateField("lineItems", updated);
                                  }}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="number"
                                  step="0.01"
                                  className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                  value={li.marginPct || ''}
                                  onChange={(e) => {
                                    const updated = [...project.lineItems];
                                    updated[idx] = { ...updated[idx], marginPct: Number(e.target.value) };
                                    updateField("lineItems", updated);
                                  }}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="number"
                                  step="0.01"
                                  className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                  value={li.kpiActual ?? ''}
                                  onChange={(e) => {
                                    const updated = [...project.lineItems];
                                    updated[idx] = { ...updated[idx], kpiActual: Number(e.target.value) };
                                    updateField("lineItems", updated);
                                  }}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => {
                                    const updated = project.lineItems.filter(l => l.id !== li.id);
                                    updateField("lineItems", updated);
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Supprimer cette ligne"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      updateField("lineItems", [
                        ...project.lineItems,
                        { id: Date.now().toString(), name: "Nouvelle Ligne", spend: 0, cpmRevenue: project.cpmRevenueActual, marginPct: currentMarginPctCalc, kpiActual: project.actualKpi }
                      ]);
                    }}
                    className="text-sm text-blue-600 font-bold hover:text-blue-700 bg-blue-50 px-4 py-2 rounded-lg transition-colors"
                  >
                    + Ajouter une ligne
                  </button>
               </>
                  )}
                </div> 
            )}

              {activeTab === "radar" && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                      <Radio className="w-5 h-5 text-indigo-600" />
                      Radar Trader V4.0
                    </h3>
                    <div className="text-sm text-gray-500">
                      {triggeredAlerts.length} alerte(s) • {detectedAnomalies.length} anomalie(s) • {timingRecos.length} reco(s)
                    </div>
                  </div>
{/* 🧠 V8.0 : LEARNING ENGINE INSIGHTS */}
{(() => {
  const learningInsights = generateLearningInsights(project);
  if (learningInsights.length === 0) return null;
  return (
    <div className="space-y-3">
      <h4 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
        🧠 Learning Engine
        <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
          {project.trackingMode === "adgroup" ? "Ad Group" : "Global"}
        </span>
      </h4>
      {learningInsights.map((insight, idx) => (
        <div key={idx} className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs text-purple-800">
          {insight}
        </div>
      ))}
    </div>
  );
})()}
                  {/* ALERTES AUTOMATIQUES */}
                  <div className="space-y-3">
                    <h4 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                      <Bell className="w-4 h-4 text-red-500" />
                      Alertes Automatiques
                    </h4>
                    {triggeredAlerts.length === 0 ? (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-700 flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        Aucune alerte active. Tous les indicateurs sont dans les seuils normaux.
                      </div>
                    ) : (
                      triggeredAlerts.map((alert, idx) => (
                        <div key={idx} className={cn("rounded-xl p-4 border-2 flex items-start gap-3",
                          alert.severity === "critical" ? "bg-red-50 border-red-300" :
                          alert.severity === "warning" ? "bg-amber-50 border-amber-300" :
                          "bg-blue-50 border-blue-200"
                        )}>
                          <div className={cn("p-1.5 rounded-lg mt-0.5",
                            alert.severity === "critical" ? "bg-red-100" :
                            alert.severity === "warning" ? "bg-amber-100" : "bg-blue-100"
                          )}>
                            <AlertTriangle className={cn("w-4 h-4",
                              alert.severity === "critical" ? "text-red-600" :
                              alert.severity === "warning" ? "text-amber-600" : "text-blue-600"
                            )} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className={cn("text-xs font-black uppercase",
                                alert.severity === "critical" ? "text-red-900" :
                                alert.severity === "warning" ? "text-amber-900" : "text-blue-900"
                              )}>
                                {alert.ruleName}
                              </span>
                              <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                                alert.severity === "critical" ? "bg-red-200 text-red-800" :
                                alert.severity === "warning" ? "bg-amber-200 text-amber-800" : "bg-blue-200 text-blue-800"
                              )}>
                                {alert.severity === "critical" ? "CRITIQUE" : alert.severity === "warning" ? "ATTENTION" : "INFO"}
                              </span>
                            </div>
                            <p className={cn("text-xs mt-1 leading-relaxed",
                              alert.severity === "critical" ? "text-red-700" :
                              alert.severity === "warning" ? "text-amber-700" : "text-blue-700"
                            )}>
                              {alert.message}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
{/* 🔄 V10.4 : CHANGEMENTS DE RÉGIME (CUSUM) */}
                  <div className="space-y-3">
                    <h4 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                      <TrendUp className="w-4 h-4 text-indigo-500" />
                      Changements de Régime (CUSUM)
                    </h4>
                    {regimeChanges.length === 0 ? (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-500">
                        Pas assez de données (minimum 8 jours) ou aucun changement de régime détecté.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {regimeChanges.map((regime, idx) => (
                          <div key={idx} className={cn("rounded-xl p-4 border-2",
                            regime.isStructural && regime.confidence > 0.6 ? "bg-indigo-50 border-indigo-300" :
                            regime.isStructural ? "bg-amber-50 border-amber-300" :
                            "bg-gray-50 border-gray-200"
                          )}>
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{regime.isStructural ? "🔄" : "⚡"}</span>
                                <span className={cn("text-xs font-black uppercase",
                                  regime.isStructural ? "text-indigo-900" : "text-amber-900"
                                )}>
                                  {regime.isStructural ? "Régime Structurel" : "Shift Récent"} — {regime.metricLabel}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={cn("text-xs font-black px-2 py-0.5 rounded-full",
                                  regime.direction === "up" ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-700"
                                )}>
                                  {regime.direction === "up" ? "↑" : "↓"} {Math.abs(regime.changePct).toFixed(0)}%
                                </span>
                                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                                  regime.confidence >= 0.7 ? "bg-emerald-100 text-emerald-700" :
                                  regime.confidence >= 0.4 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                                )}>
                                  Conf. {(regime.confidence * 100).toFixed(0)}%
                                </span>
                              </div>
                            </div>
                            <p className={cn("text-xs leading-relaxed",
                              regime.isStructural ? "text-indigo-700" : "text-amber-700"
                            )}>
                              {regime.message}
                            </p>
                            <div className="grid grid-cols-4 gap-2 mt-3">
                              <div className="bg-white/80 rounded-lg p-2 border border-gray-100 text-center">
                                <div className="text-[9px] text-gray-500 font-bold uppercase">Avant</div>
                                <div className="text-xs font-black text-gray-700 mt-0.5">
                                  {regime.metric === "margin" ? `${regime.beforeMean.toFixed(1)}%` : `${regime.beforeMean.toFixed(2)}`}
                                </div>
                              </div>
                              <div className="bg-white/80 rounded-lg p-2 border border-gray-100 text-center">
                                <div className="text-[9px] text-gray-500 font-bold uppercase">Après</div>
                                <div className={cn("text-xs font-black mt-0.5",
                                  regime.direction === "up" ? "text-blue-600" : "text-red-600"
                                )}>
                                  {regime.metric === "margin" ? `${regime.afterMean.toFixed(1)}%` : `${regime.afterMean.toFixed(2)}`}
                                </div>
                              </div>
                              <div className="bg-white/80 rounded-lg p-2 border border-gray-100 text-center">
                                <div className="text-[9px] text-gray-500 font-bold uppercase">Depuis</div>
                                <div className="text-xs font-black text-gray-700 mt-0.5">
                                  {new Date(regime.breakpointDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                                </div>
                              </div>
                              <div className="bg-white/80 rounded-lg p-2 border border-gray-100 text-center">
                                <div className="text-[9px] text-gray-500 font-bold uppercase">Durée</div>
                                <div className="text-xs font-black text-gray-700 mt-0.5">{regime.daysInNewRegime}j</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* DÉTECTION D'ANOMALIES */}
                  <div className="space-y-3">
                    <h4 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                      <Eye className="w-4 h-4 text-purple-500" />
                      Anomalies Détectées (dailyEntries)
                    </h4>
                    {detectedAnomalies.length === 0 ? (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-500">
                        Pas assez de données (minimum 4 jours) ou aucune anomalie détectée.
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-purple-200">
                        <table className="w-full text-sm text-left">
                          <thead className="text-[10px] text-purple-800 uppercase bg-purple-50 border-b border-purple-200">
                            <tr>
                              <th className="px-4 py-2.5 font-bold">Date</th>
                              <th className="px-4 py-2.5 font-bold">Type</th>
                              <th className="px-4 py-2.5 font-bold">Métrique</th>
                              <th className="px-4 py-2.5 font-bold">Attendu</th>
                              <th className="px-4 py-2.5 font-bold">Réel</th>
                              <th className="px-4 py-2.5 font-bold">Écart</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-purple-100">
                            {detectedAnomalies.slice(-10).reverse().map((a) => (
                              <tr key={a.id} className="bg-white hover:bg-purple-50/50">
                                <td className="px-4 py-2 text-xs font-medium text-gray-700">{a.date}</td>
                                <td className="px-4 py-2">
                                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                                    a.severity === "high" ? "bg-red-100 text-red-700" :
                                    a.severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                                  )}>
                                    {a.type === "spend_spike" ? "📈 Spend Spike" :
                                     a.type === "spend_drop" ? "📉 Spend Drop" :
                                     a.type === "kpi_spike" ? "📈 KPI Spike" :
                                     a.type === "kpi_drop" ? "📉 KPI Drop" :
                                     a.type === "margin_shift" ? "⚡ Marge Shift" : "💥 CPM Jump"}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-xs text-gray-600">{a.metric}</td>
                                <td className="px-4 py-2 text-xs text-gray-500">{a.expectedValue.toFixed(2)}</td>
                                <td className="px-4 py-2 text-xs font-bold text-gray-900">{a.actualValue.toFixed(2)}</td>
                                <td className={cn("px-4 py-2 text-xs font-black",
                                  // 🔥 V11.5 FIX : Couleur contextuelle — vert si bonne déviation, rouge si mauvaise
                                  a.severity === "low" ? "text-emerald-600" :
                                  a.deviationPct > 0 ? "text-red-600" : "text-emerald-600"
                                )}>
                                  {a.deviationPct > 0 ? "+" : ""}{a.deviationPct.toFixed(0)}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* RECOMMANDATIONS DE TIMING */}
                  <div className="space-y-3">
                    <h4 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                      <Zap className="w-4 h-4 text-amber-500" />
                      Recommandations de Timing
                    </h4>
                    {timingRecos.length === 0 ? (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-500">
                        Pas de recommandation active. L'algorithme analyse en continu vos dailyEntries.
                      </div>
                    ) : (
                      timingRecos.map((reco) => (
                        <div key={reco.id} className={cn("rounded-xl p-4 border-2",
                          reco.type === "increase_margin" ? "bg-emerald-50 border-emerald-300" :
                          reco.type === "decrease_margin" ? "bg-red-50 border-red-300" :
                          reco.type === "boost_budget" ? "bg-blue-50 border-blue-300" :
                          reco.type === "reduce_budget" ? "bg-amber-50 border-amber-300" :
                          "bg-gray-50 border-gray-300"
                        )}>
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">
                                {reco.type === "increase_margin" ? "📈" :
                                 reco.type === "decrease_margin" ? "📉" :
                                 reco.type === "boost_budget" ? "🚀" :
                                 reco.type === "reduce_budget" ? "⏸️" : "⏳"}
                              </span>
                              <span className={cn("text-xs font-black uppercase",
                                reco.type === "increase_margin" ? "text-emerald-900" :
                                reco.type === "decrease_margin" ? "text-red-900" :
                                "text-blue-900"
                              )}>
                                {reco.type === "increase_margin" ? "Monter la Marge" :
                                 reco.type === "decrease_margin" ? "Baisser la Marge" :
                                 reco.type === "boost_budget" ? "Augmenter Budget" :
                                 reco.type === "reduce_budget" ? "Réduire Budget" : "Pause"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-gray-500">Confiance</span>
                              <span className={cn("text-xs font-black px-2 py-0.5 rounded-full",
                                reco.confidence >= 80 ? "bg-emerald-100 text-emerald-700" :
                                reco.confidence >= 60 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                              )}>
                                {reco.confidence}%
                              </span>
                            </div>
                          </div>
                          <div className="bg-white/60 rounded-lg p-3 border border-gray-100 mb-2">
                            <p className="text-xs text-gray-600 mb-1 font-bold">Déclencheur :</p>
                            <p className="text-xs text-gray-800">{reco.trigger}</p>
                          </div>
                          <div className="bg-white/60 rounded-lg p-3 border border-gray-100">
                            <p className="text-xs text-gray-600 mb-1 font-bold">Impact attendu :</p>
                            <p className="text-xs text-gray-800">{reco.expectedImpact}</p>
                          </div>
                          <div className="text-[10px] text-gray-400 mt-2">
                            Agir à J{reco.optimalDay} • Expire dans {Math.max(0, Math.ceil((new Date(reco.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))}j
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* BENCHMARK CAMPAGNE COURANTE */}
                  <div className="space-y-3">
                    <h4 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                      <BarChart3 className="w-4 h-4 text-indigo-500" />
                      Benchmark Campagne
                    </h4>
                    {currentBenchmark ? (
                      <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border-2 border-indigo-200 rounded-xl p-5">
                        <div className="grid grid-cols-4 gap-4">
                          <div className="bg-white rounded-lg p-3 border border-indigo-100 text-center">
                            <div className="text-[10px] text-gray-500 font-bold uppercase">Marge Cumulée</div>
                            <div className="text-xl font-black text-indigo-700 mt-1">{currentBenchmark.avgMargin.toFixed(1)}%</div>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-indigo-100 text-center">
                            <div className="text-[10px] text-gray-500 font-bold uppercase">KPI vs Objectif</div>
                            <div className={cn("text-xl font-black mt-1",
                              currentBenchmark.avgKpiVsTarget >= 1 ? "text-emerald-600" : "text-red-600"
                            )}>
                              {(currentBenchmark.avgKpiVsTarget * 100).toFixed(0)}%
                            </div>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-indigo-100 text-center">
                            <div className="text-[10px] text-gray-500 font-bold uppercase">Pacing Accuracy</div>
                            <div className={cn("text-xl font-black mt-1",
                              currentBenchmark.pacingAccuracy >= 70 ? "text-emerald-600" :
                              currentBenchmark.pacingAccuracy >= 50 ? "text-amber-600" : "text-red-600"
                            )}>
                              {currentBenchmark.pacingAccuracy.toFixed(0)}%
                            </div>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-indigo-100 text-center">
                            <div className="text-[10px] text-gray-500 font-bold uppercase">Gain Réalisé</div>
                            <div className="text-xl font-black text-emerald-600 mt-1">{currentBenchmark.totalGainRealized.toFixed(0)} {currSym}</div>
                          </div>
                        </div>
                        <div className="mt-4 pt-4 border-t border-indigo-200 flex items-center justify-between">
                          <div className="text-xs text-indigo-700">
                            {currentBenchmark.kpiType} • {currentBenchmark.funnelType} • J{currentDay}/{currentBenchmark.durationDays} ({currentBenchmark.completionPct.toFixed(0)}%)
                          </div>
                          <div className="text-[10px] text-indigo-500">
                            Snapshot : {new Date(currentBenchmark.snapshotDate).toLocaleDateString('fr-FR')}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-500">
                        Remplissez les paramètres campagne pour générer le benchmark.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "historique" && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-gray-900">Historique des Modifications</h3>
                    <div className="text-sm text-gray-500">
                      {project.history?.length || 0} entrée(s)
                    </div>
                  </div>

                  {(!project.history || project.history.length === 0) ? (
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
                      <div className="text-gray-400 text-4xl mb-3">📜</div>
                      <h4 className="font-bold text-gray-700 mb-1">Aucun historique</h4>
                      <p className="text-sm text-gray-500">
                        Les modifications futures seront enregistrées ici automatiquement.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gray-200"></div>
                        <div className="space-y-6">
                          {[...project.history].reverse().map((snap, idx) => {
                            const date = new Date(snap.timestamp);
                            const isRecent = (Date.now() - date.getTime()) < 24 * 60 * 60 * 1000;
                            
                            return (
                              <div key={idx} className="relative pl-16">
                                <div className={cn(
                                  "absolute left-6 w-4 h-4 rounded-full border-4",
                                  snap.action === "MARGIN_UP" ? "bg-emerald-500 border-emerald-100" :
                                  snap.action === "MARGIN_DOWN" ? "bg-amber-500 border-amber-100" :
                                  snap.action === "OPTIMIZATION" ? "bg-blue-500 border-blue-100" :
                                  "bg-gray-400 border-gray-100"
                                )}></div>
                                
                                <div className={cn(
                                  "bg-white border rounded-xl p-5 shadow-sm",
                                  isRecent && "border-blue-300 bg-blue-50/30"
                                )}>
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                      <div className={cn(
                                        "px-3 py-1 rounded-full text-xs font-bold",
                                        snap.action === "MARGIN_UP" ? "bg-emerald-100 text-emerald-700" :
                                        snap.action === "MARGIN_DOWN" ? "bg-amber-100 text-amber-700" :
                                        snap.action === "OPTIMIZATION" ? "bg-blue-100 text-blue-700" :
                                        "bg-gray-100 text-gray-700"
                                      )}>
                                        {snap.action === "MARGIN_UP" ? "📈 MONTÉE MARGE" :
                                         snap.action === "MARGIN_DOWN" ? "📉 BAISSE MARGE" :
                                         snap.action === "OPTIMIZATION" ? "🎛️ OPTIMISATION" :
                                         snap.action === "DAILY_UPDATE" ? "📅 SUIVI QUOTIDIEN" :
                                         "💾 SAUVEGARDE"}
                                      </div>
                                      {isRecent && (
                                        <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full font-bold">
                                          RÉCENT
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <div className="text-xs text-gray-500 font-medium">
                                        {date.toLocaleDateString('fr-FR', { 
                                          day: '2-digit', 
                                          month: 'short', 
                                          year: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit'
                                        })}
                                      </div>
                                      <button
                                        onClick={() => handleDeleteHistoryEntry(project.history!.length - 1 - idx)}
                                        className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-red-50"
                                        title="Supprimer cette entrée"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>
                                  
                                  <div className="grid grid-cols-4 gap-4 mb-3">
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                      <div className="text-xs text-gray-500 mb-1">Marge</div>
                                      <div className="text-lg font-black text-gray-900">
                                        {snap.marginPct.toFixed(2)} %
                                      </div>
                                    </div>
                                    
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                      <div className="text-xs text-gray-500 mb-1">
                                        {snap.action === "DAILY_UPDATE" ? "Budget de l'entrée" : "Budget Cumulé"}
                                      </div>
                                      <div className="text-lg font-black text-gray-900">
                                        {snap.budgetSpent.toLocaleString()} {currSym}
                                      </div>
                                    </div>
                                    
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                      <div className="text-xs text-gray-500 mb-1">CPM Cost</div>
                                      <div className="text-lg font-black text-gray-900">
                                        {snap.cpmCostActuel.toFixed(2)} {currSym}
                                      </div>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                      <div className="text-xs text-gray-500 mb-1">Gain Réalisé</div>
                                      <div className="text-lg font-black text-emerald-600">
                                        {snap.gainRealized.toFixed(0)} {currSym}
                                      </div>
                                    </div>
                                  </div>
                                  
                                {snap.note && (
                                    snap.note.startsWith("__PARETO_V11__") ? (() => {
                                      try {
                                        const pd = JSON.parse(snap.note.slice(14));
                                        const _cs = pd.currSym || "€";
                                        const _fmtK = (v: number) => pd.kpiType?.includes("CPCV") ? `${v.toFixed(3)} ${_cs}` : pd.isFin ? `${v.toFixed(2)} ${_cs}` : `${v.toFixed(2)} %`;
                                        return (
                                          <div className="space-y-3">
                                            {/* CARTE PARETO VISUELLE */}
                                            <div className={cn("rounded-xl p-4 border-2", pd.isMarginLocked ? "bg-gradient-to-r from-indigo-50 to-violet-50 border-violet-300" : "bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-300")}>
                                              <div className="flex items-center justify-between mb-3">
                                                <div>
                                                  <div className="text-base font-black text-gray-900">{pd.label}</div>
                                                  <div className="text-xs text-gray-500 mt-0.5">{pd.description}</div>
                                                </div>
                                                {pd.isMarginLocked && (
                                                  <span className="text-[9px] font-black bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-3 py-1 rounded-full uppercase">🔒 Recommandé</span>
                                                )}
                                              </div>
                                              
                                              {/* Métriques clés */}
                                              <div className="grid grid-cols-4 gap-2 mb-3">
                                                <div className="bg-white rounded-lg p-2 text-center border border-gray-100">
                                                  <div className="text-[9px] text-gray-500 font-bold uppercase">Marge</div>
                                                  <div className="text-sm font-black text-gray-900">{pd.weightedMargin.toFixed(1)}%</div>
                                                </div>
                                                <div className="bg-white rounded-lg p-2 text-center border border-gray-100">
                                                  <div className="text-[9px] text-gray-500 font-bold uppercase">Gain Projeté</div>
                                                  <div className="text-sm font-black text-emerald-600">{pd.totalGainProjected.toFixed(0)} {_cs}</div>
                                                </div>
                                                <div className="bg-white rounded-lg p-2 text-center border border-gray-100">
                                                  <div className="text-[9px] text-gray-500 font-bold uppercase">KPI Projeté</div>
                                                  <div className="text-sm font-black text-gray-900">{_fmtK(pd.weightedKpi)}</div>
                                                </div>
                                                <div className="bg-white rounded-lg p-2 text-center border border-gray-100">
                                                  <div className="text-[9px] text-gray-500 font-bold uppercase">CPM Rev</div>
                                                  <div className="text-sm font-black text-gray-900">{pd.weightedCpmRevenue.toFixed(2)} {_cs}</div>
                                                </div>
                                              </div>
                                              
                                              {/* Comparaison Actuel / Projeté / Delta */}
                                              <div className="rounded-lg border border-gray-200 overflow-hidden">
                                                <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-200">
                                                  <span className="text-[9px] font-bold text-gray-500 uppercase">Gain actuel (sans changement)</span>
                                                  <span className="text-xs font-black text-gray-700">{pd.currentGainProjected.toFixed(0)} {_cs}</span>
                                                </div>
                                                <div className="flex items-center justify-between px-3 py-1.5 bg-white border-b border-gray-200">
                                                  <span className="text-[9px] font-bold text-gray-500 uppercase">Gain avec cette solution</span>
                                                  <span className="text-xs font-black text-gray-900">{pd.totalGainProjected.toFixed(0)} {_cs}</span>
                                                </div>
                                                <div className={cn("flex items-center justify-between px-3 py-2",
                                                  pd.gainDeltaVsCurrent > 0 ? "bg-emerald-50" : pd.gainDeltaVsCurrent < 0 ? "bg-red-50" : "bg-gray-50"
                                                )}>
                                                  <span className={cn("text-[9px] font-black uppercase",
                                                    pd.gainDeltaVsCurrent > 0 ? "text-emerald-700" : pd.gainDeltaVsCurrent < 0 ? "text-red-700" : "text-gray-600"
                                                  )}>
                                                    {pd.gainDeltaVsCurrent > 0 ? "📈 Gain supplémentaire" : pd.gainDeltaVsCurrent < 0 ? "📉 Perte potentielle" : "= Identique"}
                                                  </span>
                                                  <span className={cn("text-sm font-black",
                                                    pd.gainDeltaVsCurrent > 0 ? "text-emerald-700" : pd.gainDeltaVsCurrent < 0 ? "text-red-700" : "text-gray-600"
                                                  )}>
                                                    {pd.gainDeltaVsCurrent > 0 ? "+" : ""}{pd.gainDeltaVsCurrent.toFixed(0)} {_cs}
                                                  </span>
                                                </div>
                                              </div>
                                              
                                              {/* Cuts */}
                                              {pd.cutLines > 0 && (
                                                <div className="mt-2 bg-red-50 rounded-lg p-2 text-center">
                                                  <span className="text-[10px] font-black text-red-700">
                                                    🔪 {pd.cutLines} ligne(s) coupée(s) — {pd.freedBudgetPct.toFixed(0)}% budget redistribué
                                                  </span>
                                                </div>
                                              )}
                                              
                                              {/* Tags */}
                                              {pd.tags && pd.tags.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-2">
                                                  {pd.tags.map((tag: string) => (
                                                    <span key={tag} className={cn("text-[9px] font-bold px-2 py-0.5 rounded-full",
                                                      tag === "kpi-safe" ? "bg-emerald-100 text-emerald-700" :
                                                      tag === "kpi-risk" ? "bg-red-100 text-red-700" :
                                                      tag === "high-margin" ? "bg-amber-100 text-amber-700" :
                                                      tag === "margin-locked" ? "bg-indigo-100 text-indigo-700" :
                                                      tag === "has-cuts" ? "bg-red-100 text-red-700" :
                                                      tag === "cap-safe" ? "bg-teal-100 text-teal-700" :
                                                      tag === "stable" ? "bg-gray-100 text-gray-600" :
                                                      tag === "gain-vs-current" ? "bg-emerald-100 text-emerald-700" :
                                                      tag === "loss-vs-current" ? "bg-red-100 text-red-700" :
                                                      "bg-violet-100 text-violet-700"
                                                    )}>
                                                      {tag === "kpi-safe" ? "✅ KPI Safe" :
                                                       tag === "margin-locked" ? "🔒 Marge Intacte" :
                                                       tag === "has-cuts" ? "🔪 Lignes Coupées" :
                                                       tag === "cap-safe" ? "🔒 Cap OK" :
                                                       tag === "high-margin" ? "💰 High Margin" :
                                                       tag === "stable" ? "📊 Stable" :
                                                       tag === "gain-vs-current" ? "📈 Gain" :
                                                       tag === "loss-vs-current" ? "📉 Perte" : tag}
                                                    </span>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                            
                                            {/* TABLEAU RÉPARTITION PAR LIGNE */}
                                            <div className="overflow-x-auto rounded-lg border border-violet-200">
                                              <table className="w-full text-xs text-left">
                                                <thead className="text-[9px] text-violet-800 uppercase bg-violet-50 border-b border-violet-200">
                                                  <tr>
                                                    <th className="px-3 py-2 font-bold">Line Item</th>
                                                    <th className="px-3 py-2 font-bold">Statut</th>
                                                    <th className="px-3 py-2 font-bold">Marge</th>
                                                    <th className="px-3 py-2 font-bold">Budget/Jour</th>
                                                    <th className="px-3 py-2 font-bold">CPM Rev</th>
                                                    <th className="px-3 py-2 font-bold">KPI Proj.</th>
                                                  </tr>
                                                </thead>
                                                <tbody className="divide-y divide-violet-100">
                                                  {pd.lines.map((line: any, lIdx: number) => (
                                                    <tr key={lIdx} className={cn(
                                                      line.cutReason?.startsWith("💀") ? "bg-red-50" :
                                                      line.cutReason?.startsWith("⚠️") ? "bg-amber-50" : "bg-white"
                                                    )}>
                                                      <td className="px-3 py-1.5 font-medium text-gray-900">
                                                        {line.name}
                                                        {line.cutReason && (
                                                          <div className={cn("text-[8px] font-bold mt-0.5",
                                                            line.cutReason.startsWith("💀") ? "text-red-600" : "text-amber-600"
                                                          )}>{line.cutReason}</div>
                                                        )}
                                                      </td>
                                                      <td className="px-3 py-1.5 text-center">
                                                        {line.cutReason?.startsWith("💀") ? (
                                                          <span className="text-[8px] font-black bg-red-200 text-red-800 px-1.5 py-0.5 rounded-full">💀 CUT</span>
                                                        ) : line.cutReason?.startsWith("⚠️") ? (
                                                          <span className="text-[8px] font-black bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full">⚠️ RÉDUIT</span>
                                                        ) : (
                                                          <span className="text-[8px] font-black bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">✅ ACTIF</span>
                                                        )}
                                                      </td>
                                                      <td className="px-3 py-1.5">
                                                        <span className="font-bold text-gray-900">{line.newMargin.toFixed(1)}%</span>
                                                        {Math.abs(line.marginDelta) > 0.1 ? (
                                                          <span className={cn("text-[9px] ml-1", line.marginDelta > 0 ? "text-emerald-600" : "text-red-600")}>
                                                            ({line.marginDelta > 0 ? "+" : ""}{line.marginDelta.toFixed(1)})
                                                          </span>
                                                        ) : pd.isMarginLocked ? (
                                                          <span className="text-[8px] ml-1 text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded">STABLE</span>
                                                        ) : null}
                                                      </td>
                                                      <td className="px-3 py-1.5">
                                                        <span className="font-bold text-gray-900">{line.newDailyBudget.toFixed(2)} {_cs}</span>
                                                        {Math.abs(line.budgetDeltaPct) > 1 && (
                                                          <span className={cn("text-[9px] ml-1", line.budgetDeltaPct > 0 ? "text-emerald-600" : "text-red-600")}>
                                                            ({line.budgetDeltaPct > 0 ? "+" : ""}{line.budgetDeltaPct.toFixed(0)}%)
                                                          </span>
                                                        )}
                                                      </td>
                                                      <td className="px-3 py-1.5 text-gray-700">{line.newCpmRevenue.toFixed(2)} {_cs}</td>
                                                      <td className="px-3 py-1.5 font-bold text-gray-900">{_fmtK(line.projectedKpi)}</td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          </div>
                                        );
                                      } catch (e) {
                                        return (
                                          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-800">
                                            <strong>Note :</strong> {snap.note.slice(14)}
                                          </div>
                                        );
                                      }
                                    })() : (
                                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-800">
                                      <strong>Note :</strong> {snap.note}
                                    </div>
                                  )
                                  )}
                                  {/* 🔥 V6.0 : VERDICT DE DÉCISION (J+3) */}
                                  {(snap.action === "MARGIN_UP" || snap.action === "MARGIN_DOWN") && project.dailyEntries && project.dailyEntries.length > 0 && (() => {
                                    const snapDate = new Date(snap.timestamp);
                                    const target3d = new Date(snapDate.getTime() + 3 * 24 * 60 * 60 * 1000);
                                    const kpiBefore = snap.actualKpi;
                                    const entryAfter = project.dailyEntries!
                                      .filter(e => new Date(e.date) >= target3d)
                                      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
                                    
                                    if (!entryAfter || kpiBefore === 0) return null;
                                    const kpiAfter = entryAfter.kpiActual;
                                    const kpiDeltaPct = ((kpiAfter - kpiBefore) / kpiBefore) * 100;
                                    const isGoodDecision = isFin
                                      ? (snap.action === "MARGIN_UP" ? kpiAfter <= project.targetKpi * 1.1 : kpiAfter < kpiBefore)
                                      : (snap.action === "MARGIN_UP" ? kpiAfter >= project.targetKpi * 0.9 : kpiAfter > kpiBefore);
                                    
                                    return (
                                      <div className={cn("mt-3 p-3 rounded-lg border text-xs",
                                        isGoodDecision ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
                                      )}>
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="font-black">{isGoodDecision ? "✅ BONNE DÉCISION" : "❌ DÉCISION RISQUÉE"}</span>
                                          <span className="text-gray-500">J+3 : {entryAfter.date}</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 mt-2">
                                          <div><span className="text-gray-500">KPI Avant :</span> <strong>{fmtKpi(kpiBefore)}</strong></div>
                                          <div><span className="text-gray-500">KPI J+3 :</span> <strong>{fmtKpi(kpiAfter)}</strong></div>
                                          <div><span className="text-gray-500">Delta :</span> <strong className={cn(
                                            kpiDeltaPct > 0 ? (isFin ? "text-red-600" : "text-emerald-600") : (isFin ? "text-emerald-600" : "text-red-600")
                                          )}>{kpiDeltaPct > 0 ? "+" : ""}{kpiDeltaPct.toFixed(1)}%</strong></div>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="bg-white border border-gray-100 rounded-xl p-6 mt-8">
                        <h4 className="font-bold text-gray-900 mb-4">Évolution de la Marge</h4>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart 
                              data={project.history.map(snap => ({
                                date: new Date(snap.timestamp).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
                                marge: snap.marginPct,
                                gain: snap.gainRealized
                              }))}
                              margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                              <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                              <YAxis 
                                yAxisId="left"
                                tick={{ fontSize: 12, fill: '#64748b' }} 
                                axisLine={false} 
                                tickLine={false}
                                tickFormatter={(val) => `${val.toFixed(0)}%`}
                              />
                              <YAxis 
                                yAxisId="right"
                                orientation="right"
                                tick={{ fontSize: 12, fill: '#64748b' }} 
                                axisLine={false} 
                                tickLine={false}
                                tickFormatter={(val) => `${val.toFixed(2)}${currSym}`}
                              />
                              <Tooltip 
                                contentStyle={{ borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                formatter={(value: number, name: string) => {
                                  if (name === `Gain (${currSym})`) {
                                    return [`${value.toFixed(2)} ${currSym}`, name];
                                  }
                                  return [`${value.toFixed(2)}%`, name];
                                }}
                              />
                              <Legend />
                              <Line 
                                yAxisId="left"
                                type="monotone" 
                                dataKey="marge" 
                                stroke="#3b82f6" 
                                strokeWidth={3} 
                                name="Marge %"
                                dot={{ r: 4 }}
                              />
                              <Line 
                                yAxisId="right"
                                type="monotone" 
                                dataKey="gain" 
                                stroke="#10b981" 
                                strokeWidth={3} 
                                name={`Gain (${currSym})`}
                                dot={{ r: 4 }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === "notes" && (
                <div className="space-y-6">
                  {!project?.id ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
                      <div className="text-4xl mb-3">⚠️</div>
                      <h4 className="font-bold text-amber-900 mb-2">Projet non sauvegardé</h4>
                      <p className="text-sm text-amber-700">
                        Vous devez sauvegarder votre projet avant de pouvoir ajouter des notes.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold text-gray-900">Notes de campagne</h3>
                        <div className="text-sm text-gray-500">
                          {project.notes?.length || 0} note(s)
                        </div>
                      </div>

                      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                        <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                          <span className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center text-sm">✍️</span>
                          Ajouter une note
                        </h4>
                        <textarea
                          id="note-input"
                          placeholder="Écrivez votre note ici..."
                          className="w-full h-32 text-sm border-gray-200 bg-gray-50 rounded-lg p-3 border focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none"
                        />
                        <div className="flex justify-end mt-3">
                          <button
                            onClick={() => {
                              const input = document.getElementById('note-input') as HTMLTextAreaElement;
                              const content = input?.value.trim();
                              
                              if (!content) {
                                alert("Veuillez écrire une note avant de sauvegarder.");
                                return;
                              }
                              
                              const newNote: ProjectNote = {
                                id: Date.now().toString(),
                                timestamp: new Date().toISOString(),
                                content
                              };
                              
                              const updatedNotes = [...(project.notes || []), newNote];
                              
                              onChange({
                                ...project,
                                notes: updatedNotes,
                                updatedAt: new Date().toISOString()
                              });
                              
                              input.value = '';
                              alert("✅ Note sauvegardée !");
                            }}
                            className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm"
                          >
                            💾 Sauvegarder la note
                          </button>
                        </div>
                      </div>

                      {(!project.notes || project.notes.length === 0) ? (
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
                          <div className="text-4xl mb-3">📝</div>
                          <h4 className="font-bold text-gray-700 mb-1">Aucune note</h4>
                          <p className="text-sm text-gray-500">
                            Ajoutez votre première note pour documenter vos optimisations.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {[...project.notes].reverse().map((note) => {
                            const date = new Date(note.timestamp);
                            const isToday = date.toDateString() === new Date().toDateString();
                            
                            return (
                              <div key={note.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                                <div className="flex items-start justify-between mb-3">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center shrink-0">
                                      📝
                                    </div>
                                    <div>
                                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                        {date.toLocaleDateString('fr-FR', { 
                                          weekday: 'long',
                                          day: 'numeric', 
                                          month: 'long', 
                                          year: 'numeric'
                                        })}
                                      </div>
                                      <div className="text-xs text-gray-400 mt-0.5">
                                        {date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                        {isToday && (
                                          <span className="ml-2 bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-[10px] font-bold">
                                            AUJOURD'HUI
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => {
                                      if (confirm("Supprimer cette note ?")) {
                                        const updatedNotes = project.notes?.filter(n => n.id !== note.id) || [];
                                        onChange({
                                          ...project,
                                          notes: updatedNotes,
                                          updatedAt: new Date().toISOString()
                                        });
                                      }
                                    }}
                                    className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-red-50"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                                    {note.content}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function MetricCard({ title, value, subValue, accent, icon: Icon }: { title: string, value: string, subValue?: string, accent: "indigo" | "emerald" | "red", icon: any }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm flex flex-col justify-between min-h-[110px]">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{title}</div>
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center",
          accent === "indigo" ? "bg-blue-50 text-blue-600" :
          accent === "emerald" ? "bg-emerald-50 text-emerald-600" :
          "bg-red-50 text-red-600"
        )}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div>
        <div className="text-2xl font-black text-gray-900">{value}</div>
        {subValue && (
          <div className={cn("text-xs font-bold mt-1.5 flex items-center gap-1", 
            accent === "emerald" ? "text-emerald-500" : 
            accent === "red" ? "text-red-500" : "text-gray-500"
          )}>
            {subValue}
          </div>
        )}
      </div>
    </div>
  );
}
