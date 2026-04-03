// ============================================================
// 💰 BidShadingEngine.ts — V1.0 Bloomberg Terminal Ads
// Bid Shading Intelligent pour Trading Desk
// ============================================================
//
// Ce module calcule le BID OPTIMAL pour chaque changement de marge,
// en tenant compte de :
//   1. La courbe de win rate estimée (logistique)
//   2. L'impact KPI par type (financier vs qualité)
//   3. Le CPM Cap vendu au client
//   4. La volatilité historique observée
//   5. Le modèle de saturation du LearningEngine
//
// S'intègre dans le comparateur Optimiste/Pessimiste du CockpitYield
// comme 3ème scénario entre "Bid Stable" et "Bid Agressif".
//
// DÉPENDANCES :
//   - LearningEngine.ts (fitSaturationModel, computeCampaignLearningStats, etc.)
//   - Types : ProjectData, LineItem depuis ./types
// ============================================================

import type { CampaignLearningStats, SaturationModel, CrossCampaignPrior } from "./LearningEngine";

// ============================================================
// TYPES
// ============================================================

export interface BidShadingScenario {
  id: "stable" | "shading_optimal" | "aggressive";
  label: string;
  emoji: string;
  description: string;
  // Bid
  newCpmCost: number;
  newCpmRevenue: number;
  bidAdjustmentPct: number;
  // Marge
  newMarginPct: number;
  effectiveMarginPct: number; // Marge réelle après ajustement
  // KPI projeté
  kpiProjected: number;
  kpiOptimistic: number;
  kpiPessimistic: number;
  // Gain
  gainPerDay: number;
  gainProjectedTotal: number;
  gainDeltaVsCurrent: number;
  // Métriques de risque
  winRateEstimated: number;
  winRateDelta: number; // Changement vs win rate actuel
  inventoryQualityScore: number; // 0-100, qualité de l'inventaire accessible
  capRespected: boolean;
  capExcessPct: number;
  // Confiance
  confidence: number; // 0-1
  confidenceSource: string;
  // Alertes spécifiques
  warnings: BidShadingWarning[];
}

export interface BidShadingWarning {
  type: "cap_exceeded" | "kpi_risk" | "win_rate_low" | "volatility_high" | "bid_floor" | "margin_ceiling";
  severity: "info" | "warning" | "danger";
  message: string;
}

export interface WinRateCurve {
  // Paramètres du modèle logistique : winRate = L / (1 + exp(-k * (bid - x0)))
  L: number;       // Asymptote (win rate max atteignable)
  k: number;       // Pente (sensibilité au bid)
  x0: number;      // Point d'inflexion (bid médian du marché)
  confidence: number;
  source: "empirical" | "estimated" | "default";
  predict: (bid: number) => number;
}

export interface BidShadingResult {
  scenarios: BidShadingScenario[];
  winRateCurve: WinRateCurve;
  optimalBid: number;
  optimalMargin: number;
  marketContext: MarketContext;
}

export interface MarketContext {
  estimatedMarketCpm: number;
  currentBidPosition: "below_market" | "at_market" | "above_market";
  currentBidPercentile: number; // 0-100
  competitionLevel: "low" | "medium" | "high";
  inventoryPressure: number; // 0-1
}

// ============================================================
// CONFIGURATION PAR TYPE DE KPI
// ============================================================

interface KpiShadingConfig {
  // Sensibilité du KPI au changement de bid
  bidSensitivity: number;
  // Facteur de qualité inventaire (impact du bid sur la qualité)
  qualityElasticity: number;
  // Tolérance acceptable de dégradation KPI
  maxDegradationPct: number;
  // Direction : "lower_is_better" pour CPA/CPC, "higher_is_better" pour CTR/VTR
  direction: "lower_is_better" | "higher_is_better";
  // Plafond de pertinence
  maxBidChangePct: number;
}

const KPI_SHADING_CONFIG: Record<string, KpiShadingConfig> = {
  // KPIs financiers — bid plus élevé = plus de conversions mais plus cher par conversion
  "CPA": {
    bidSensitivity: 0.65,      // Forte corrélation bid → volume conversions
    qualityElasticity: 0.30,   // Impact modéré sur la qualité
    maxDegradationPct: 0.25,   // ±25% acceptable
    direction: "lower_is_better",
    maxBidChangePct: 40,
  },
  "CPC": {
    bidSensitivity: 0.45,
    qualityElasticity: 0.35,
    maxDegradationPct: 0.20,
    direction: "lower_is_better",
    maxBidChangePct: 35,
  },
  "CPCV": {
    bidSensitivity: 0.55,
    qualityElasticity: 0.40,
    maxDegradationPct: 0.20,
    direction: "lower_is_better",
    maxBidChangePct: 35,
  },
  "CPV": {
    bidSensitivity: 0.50,
    qualityElasticity: 0.35,
    maxDegradationPct: 0.25,
    direction: "lower_is_better",
    maxBidChangePct: 40,
  },
  "CPM": {
    bidSensitivity: 0.20,      // CPM = on paie directement le bid, sensibilité faible
    qualityElasticity: 0.15,
    maxDegradationPct: 0.30,
    direction: "lower_is_better",
    maxBidChangePct: 30,
  },
  // KPIs qualité — bid plus élevé = meilleur inventaire = meilleure qualité
  "CTR": {
    bidSensitivity: 0.35,      // Bid → position premium → meilleur CTR
    qualityElasticity: 0.70,   // Très sensible au placement (above-fold vs below-fold)
    maxDegradationPct: 0.30,   // Branding = plus tolérant
    direction: "higher_is_better",
    maxBidChangePct: 30,
  },
  "VTR": {
    bidSensitivity: 0.45,      // Bid → format premium → meilleur VTR
    qualityElasticity: 0.75,   // Très sensible (in-stream vs outstream)
    maxDegradationPct: 0.30,
    direction: "higher_is_better",
    maxBidChangePct: 35,
  },
  "Viewability": {
    bidSensitivity: 0.25,
    qualityElasticity: 0.40,   // Modéré (above-fold effect)
    maxDegradationPct: 0.25,
    direction: "higher_is_better",
    maxBidChangePct: 25,
  },
};

function getKpiConfig(kpiType: string): KpiShadingConfig {
  return KPI_SHADING_CONFIG[kpiType] || {
    bidSensitivity: 0.35,
    qualityElasticity: 0.30,
    maxDegradationPct: 0.25,
    direction: "lower_is_better",
    maxBidChangePct: 35,
  };
}

// ============================================================
// 1. ESTIMATION DE LA COURBE DE WIN RATE
// ============================================================

/**
 * Estime la courbe de win rate en fonction du bid.
 *
 * En l'absence de données de win rate réelles (qui viendraient de l'API DSP),
 * on construit un modèle à partir de :
 *   - Le CPM Cost actuel (notre bid actuel)
 *   - Le CPM Revenue (prix du marché vu côté sell-side)
 *   - Les variations historiques de spend (proxy du fill rate / win rate)
 *   - Le CPM Cap vendu (borne haute du marché pour ce deal)
 *
 * Modèle : winRate(bid) = L / (1 + exp(-k * (bid - x0)))
 *
 * Quand l'API DSP sera connectée, cette fonction sera remplacée par
 * les vraies données de bid landscape / win rate par exchange.
 */
export function estimateWinRateCurve(
  currentCpmCost: number,
  currentCpmRevenue: number,
  cpmSoldCap: number,
  dailySpends?: number[],
  dailyEntries?: Array<{ budgetSpent: number; cpmRevenue: number; marginPct: number }>
): WinRateCurve {
  // --- ESTIMATION DU MARCHÉ ---
  // Le CPM Revenue reflète le prix de clearing du marché
  // Le CPM Cost est notre bid (ce qu'on paie réellement)
  // Le ratio cost/revenue donne une idée de notre position dans les enchères

  const bidToRevenueRatio = currentCpmRevenue > 0 ? currentCpmCost / currentCpmRevenue : 0.5;

  // Estimation du CPM marché médian
  // Le CPM Revenue est un bon proxy du prix de clearing médian
  const estimatedMarketCpm = currentCpmRevenue > 0 ? currentCpmRevenue * 0.85 : 3.0;

  // --- ESTIMATION DU FILL RATE ACTUEL (proxy win rate) ---
  let currentFillRate = 0.65; // Défaut

  if (dailySpends && dailySpends.length >= 5) {
    // Coefficient de variation du spend = proxy de la régularité de livraison
    const nonZero = dailySpends.filter(s => s > 0);
    if (nonZero.length >= 3) {
      const mean = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
      if (mean > 0) {
        const cv = Math.sqrt(nonZero.reduce((a, s) => a + (s - mean) ** 2, 0) / nonZero.length) / mean;
        // CV bas = spend régulier = fill rate élevé
        // CV < 0.2 → fill rate ~85%
        // CV = 0.5 → fill rate ~55%
        // CV > 1.0 → fill rate ~30%
        currentFillRate = Math.max(0.25, Math.min(0.90, 0.90 - cv * 0.7));
      }
    }
  }

  // --- PARAMÈTRES DU MODÈLE LOGISTIQUE ---

  // L = win rate max atteignable (asymptote)
  // Même avec un bid très élevé, on ne gagne pas 100% des enchères (floors SSP, compétition, etc.)
  const L = Math.min(0.92, currentFillRate + 0.20);

  // x0 = point d'inflexion = bid médian du marché
  const x0 = estimatedMarketCpm;

  // k = pente de la courbe
  // Calibrer k tel que winRate(currentCpmCost) ≈ currentFillRate
  // currentFillRate = L / (1 + exp(-k * (currentCpmCost - x0)))
  // => exp(-k * (currentCpmCost - x0)) = L / currentFillRate - 1
  // => k = -ln(L / currentFillRate - 1) / (currentCpmCost - x0)
  const fillRatio = L / Math.max(0.01, currentFillRate) - 1;
  const bidDelta = currentCpmCost - x0;
  let k: number;
  if (Math.abs(bidDelta) < 0.01 || fillRatio <= 0) {
    k = 1.0; // Défaut si bid ≈ marché
  } else {
    k = -Math.log(Math.max(0.01, fillRatio)) / bidDelta;
    k = Math.max(0.3, Math.min(5.0, k)); // Cap entre 0.3 et 5.0
  }

  // --- CONFIANCE ---
  let confidence = 0.3; // Base
  let source: WinRateCurve["source"] = "default";

  if (dailyEntries && dailyEntries.length >= 10) {
    // On a assez de données pour une estimation empirique
    confidence = Math.min(0.75, 0.3 + dailyEntries.length * 0.02);
    source = "estimated";

    // Vérifier la cohérence : les jours à haut CPM Revenue devraient avoir un meilleur fill rate
    const sorted = [...dailyEntries].sort((a, b) => a.cpmRevenue - b.cpmRevenue);
    const lowHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const highHalf = sorted.slice(Math.floor(sorted.length / 2));
    const avgSpendLow = lowHalf.reduce((s, e) => s + e.budgetSpent, 0) / Math.max(1, lowHalf.length);
    const avgSpendHigh = highHalf.reduce((s, e) => s + e.budgetSpent, 0) / Math.max(1, highHalf.length);

    if (avgSpendHigh > avgSpendLow * 1.1) {
      confidence = Math.min(0.80, confidence + 0.10); // Cohérent = plus de confiance
    }
  }

  if (dailySpends && dailySpends.length >= 15) {
    confidence = Math.min(0.85, confidence + 0.05);
    source = "estimated";
  }

  const predict = (bid: number): number => {
    const z = -k * (bid - x0);
    const expZ = Math.exp(Math.max(-50, Math.min(50, z)));
    return L / (1 + expZ);
  };

  return { L, k, x0, confidence, source, predict };
}

// ============================================================
// 2. CALCUL DU BID OPTIMAL
// ============================================================

/**
 * Calcule le bid optimal qui maximise le ratio gain/risque
 * tout en respectant les contraintes KPI et CPM Cap.
 *
 * L'optimisation cherche le bid qui :
 *   - Maximise la marge (gain)
 *   - Maintient le win rate au-dessus d'un seuil minimum
 *   - Respecte le CPM Cap vendu au client
 *   - Garde le KPI dans la fourchette acceptable
 *
 * Algorithme : recherche par balayage sur [bidMin, bidMax] avec scoring composite.
 */
export function computeOptimalBid(
  currentCpmCost: number,
  currentCpmRevenue: number,
  currentMarginPct: number,
  targetMarginPct: number,
  cpmSoldCap: number,
  currentKpi: number,
  targetKpi: number,
  kpiType: string,
  winRateCurve: WinRateCurve,
  budgetDailyAvg: number,
  daysRemaining: number,
  calibratedStats?: CampaignLearningStats | null,
  crossCampaignPrior?: CrossCampaignPrior | null
): { optimalBid: number; optimalMargin: number; score: number; breakdown: OptimalBidBreakdown } {

  const config = getKpiConfig(kpiType);
  const isFin = config.direction === "lower_is_better";

  // --- BORNES DE RECHERCHE ---
  // Bid minimum : ne pas descendre en dessous de 20% du marché (risque de ne rien gagner)
  const bidMin = Math.max(0.5, currentCpmCost * 0.60);
  // Bid maximum : plafonné par le CPM Cap ou 150% du bid actuel
  const bidMax = cpmSoldCap > 0
    ? Math.min(cpmSoldCap, currentCpmCost * 1.50)
    : currentCpmCost * 1.50;

  // --- BALAYAGE ---
  const steps = 50;
  const bidStep = (bidMax - bidMin) / steps;

  let bestScore = -Infinity;
  let bestBid = currentCpmCost;
  let bestMargin = currentMarginPct;
  let bestBreakdown: OptimalBidBreakdown = getDefaultBreakdown();

  for (let i = 0; i <= steps; i++) {
    const candidateBid = bidMin + i * bidStep;

    // CPM Revenue correspondant pour atteindre la marge cible
    const candidateCpmRevenue = candidateBid / (1 - targetMarginPct / 100);

    // Vérification Cap
    const respectsCap = cpmSoldCap <= 0 || candidateCpmRevenue <= cpmSoldCap * 1.02;

    // Si le CPM Revenue dépasse le cap, recalculer la marge effective
    let effectiveMargin = targetMarginPct;
    let effectiveCpmRevenue = candidateCpmRevenue;

    if (cpmSoldCap > 0 && candidateCpmRevenue > cpmSoldCap) {
      effectiveCpmRevenue = cpmSoldCap;
      effectiveMargin = ((effectiveCpmRevenue - candidateBid) / effectiveCpmRevenue) * 100;
      if (effectiveMargin < 0) continue; // Bid trop élevé pour le cap
    }

    // Win rate estimé
    const winRate = winRateCurve.predict(candidateBid);
    if (winRate < 0.15) continue; // Win rate trop bas, pas viable

    // KPI projeté
    const projectedKpi = projectKpiFromBid(
      currentKpi, currentCpmCost, candidateBid, currentCpmRevenue, effectiveCpmRevenue,
      isFin, kpiType, config, calibratedStats, currentMarginPct, effectiveMargin
    );

    // Vérification contrainte KPI
    const kpiDegradation = isFin
      ? (projectedKpi - targetKpi) / Math.max(targetKpi, 0.001)
      : (targetKpi - projectedKpi) / Math.max(targetKpi, 0.001);

    if (kpiDegradation > config.maxDegradationPct) continue; // KPI trop dégradé

    // --- SCORING COMPOSITE ---
    // Gain projeté (objectif principal)
    const gainPerDay = budgetDailyAvg * winRate * (effectiveMargin / 100);
    const gainScore = gainPerDay / Math.max(1, budgetDailyAvg * 0.01); // Normalisé

    // Bonus win rate (préférer un win rate stable)
    const winRateScore = winRate * 10;

    // Pénalité risque KPI
    const kpiRiskPenalty = Math.max(0, kpiDegradation) * 20;

    // Pénalité cap
    const capPenalty = respectsCap ? 0 : 5;

    // Pénalité changement de bid trop brutal
    const bidChangePct = Math.abs(candidateBid - currentCpmCost) / currentCpmCost;
    const stabilityPenalty = bidChangePct > 0.30 ? bidChangePct * 5 : 0;

    // Score final
    const score = gainScore + winRateScore - kpiRiskPenalty - capPenalty - stabilityPenalty;

    if (score > bestScore) {
      bestScore = score;
      bestBid = candidateBid;
      bestMargin = effectiveMargin;
      bestBreakdown = {
        gainScore,
        winRateScore,
        kpiRiskPenalty,
        capPenalty,
        stabilityPenalty,
        projectedKpi,
        winRate,
        kpiDegradation,
      };
    }
  }

  return {
    optimalBid: Math.round(bestBid * 100) / 100,
    optimalMargin: Math.round(bestMargin * 100) / 100,
    score: bestScore,
    breakdown: bestBreakdown,
  };
}

export interface OptimalBidBreakdown {
  gainScore: number;
  winRateScore: number;
  kpiRiskPenalty: number;
  capPenalty: number;
  stabilityPenalty: number;
  projectedKpi: number;
  winRate: number;
  kpiDegradation: number;
}

function getDefaultBreakdown(): OptimalBidBreakdown {
  return {
    gainScore: 0, winRateScore: 0, kpiRiskPenalty: 0,
    capPenalty: 0, stabilityPenalty: 0, projectedKpi: 0,
    winRate: 0, kpiDegradation: 0,
  };
}

// ============================================================
// 3. PROJECTION KPI DEPUIS UN CHANGEMENT DE BID
// ============================================================

/**
 * Projette l'impact sur le KPI d'un changement de bid.
 *
 * Deux composantes :
 *   A. Impact mathématique du ratio CPM Revenue (comme Option 1 actuelle)
 *   B. Impact inventaire : bid plus bas = perte de positions premium
 *      bid plus haut = accès au premium
 *
 * Si le modèle de saturation du LearningEngine est disponible (R² > 0.3),
 * on l'utilise prioritairement car il capture la non-linéarité réelle.
 */
function projectKpiFromBid(
  currentKpi: number,
  currentBid: number,
  newBid: number,
  currentCpmRevenue: number,
  newCpmRevenue: number,
  isFin: boolean,
  kpiType: string,
  config: KpiShadingConfig,
  calibratedStats?: CampaignLearningStats | null,
  currentMargin?: number,
  newMargin?: number,
): number {
  if (currentKpi === 0) return 0;
  if (Math.abs(newBid - currentBid) < 0.01) return currentKpi;

  // --- PRIORITÉ 1 : Modèle de saturation (non-linéaire, le plus fiable) ---
  if (calibratedStats?.saturationModel &&
      calibratedStats.saturationModel.confidence > 0.3 &&
      calibratedStats.saturationModel.dataPoints >= 7 &&
      newMargin !== undefined) {
    const predicted = calibratedStats.saturationModel.predict(newMargin);
    // Cap raisonnable : 10% à 500% du KPI actuel
    return Math.max(currentKpi * 0.10, Math.min(currentKpi * 5.0, predicted));
  }

  // --- PRIORITÉ 2 : Modèle linéaire empirique ---
  if (calibratedStats &&
      calibratedStats.elasticityConfidence > 0.3 &&
      calibratedStats.marginKpiElasticity !== 0 &&
      currentMargin !== undefined && newMargin !== undefined) {
    const marginDelta = newMargin - currentMargin;
    const kpiChangeRatio = 1 + calibratedStats.marginKpiElasticity * marginDelta;
    return currentKpi * Math.max(0.20, Math.min(3.0, kpiChangeRatio));
  }

  // --- PRIORITÉ 3 : Modèle théorique ---

  // A. Impact ratio CPM Revenue (mathématique)
  const cpmRevenueRatio = currentCpmRevenue > 0 ? newCpmRevenue / currentCpmRevenue : 1;

  // B. Impact inventaire (bid change → quality shift)
  const bidChangeRatio = currentBid > 0 ? newBid / currentBid : 1;

  if (isFin) {
    // KPI financier (CPA, CPC, etc.)
    // Bid plus bas → moins de volume → CPA monte
    // Bid plus haut → plus de volume → CPA baisse (économie d'échelle)

    // Impact volume : bid → reach → conversions
    const volumeRatio = Math.pow(bidChangeRatio, config.bidSensitivity);

    // CPA projeté = (spend / conversions) × impact bid
    // Si on bid plus haut : spend monte (ratio CPM Rev) mais conversions montent aussi (volume)
    // Net : CPA = currentCPA × (cpmRevenueRatio / volumeRatio)
    const projectedKpi = currentKpi * cpmRevenueRatio / volumeRatio;

    return Math.max(currentKpi * 0.20, Math.min(currentKpi * 5.0, projectedKpi));
  } else {
    // KPI qualité (CTR, VTR, Viewability)
    // Bid plus haut → accès inventaire premium → CTR monte
    // Bid plus bas → inventaire dégradé → CTR baisse

    // Impact logarithmique (rendements décroissants)
    const qualityShift = Math.sign(bidChangeRatio - 1)
      * Math.log(1 + Math.abs(bidChangeRatio - 1))
      * config.qualityElasticity;

    const projectedKpi = currentKpi * (1 + Math.max(-0.40, Math.min(0.40, qualityShift)));

    return Math.max(0, Math.min(100, projectedKpi));
  }
}

// ============================================================
// 4. GÉNÉRATION DES 3 SCÉNARIOS BID SHADING
// ============================================================

/**
 * Génère les 3 scénarios du comparateur Bloomberg Terminal Ads :
 *
 *   1. BID STABLE — Même bid, marge ajustée (ancien Option 1)
 *   2. BID SHADING OPTIMAL — Bid calculé pour maximiser gain/risque
 *   3. BID CAP-ALIGNED — Bid ajusté pour respecter exactement le CPM Cap
 *
 * Chaque scénario inclut la fourchette Optimiste/Pessimiste calibrée
 * sur la vraie volatilité KPI observée.
 */
export function computeBidShadingScenarios(
  // Données actuelles
  currentCpmCost: number,
  currentCpmRevenue: number,
  currentMarginPct: number,
  currentKpi: number,
  targetKpi: number,
  cpmSoldCap: number,
  kpiType: string,
  // Marge cible (slider du trader)
  targetMarginPct: number,
  // Contexte campagne
  budgetDailyAvg: number,
  daysRemaining: number,
  // Données historiques
  dailySpends?: number[],
  dailyEntries?: Array<{ budgetSpent: number; cpmRevenue: number; marginPct: number; kpiActual: number; date: string }>,
  // LearningEngine
  calibratedStats?: CampaignLearningStats | null,
  crossCampaignPrior?: CrossCampaignPrior | null,
  // Volatilité observée
  realKpiVolatility?: number | null,
  realKpiTrendPct?: number | null,
): BidShadingResult {

  const config = getKpiConfig(kpiType);
  const isFin = config.direction === "lower_is_better";

  // --- COURBE DE WIN RATE ---
  const winRateCurve = estimateWinRateCurve(
    currentCpmCost, currentCpmRevenue, cpmSoldCap, dailySpends, dailyEntries
  );

  // --- CONTEXTE MARCHÉ ---
  const currentWinRate = winRateCurve.predict(currentCpmCost);
  const marketContext = computeMarketContext(currentCpmCost, currentCpmRevenue, cpmSoldCap, winRateCurve);

  // --- SCÉNARIO 1 : BID STABLE ---
  const scenario1 = computeStableScenario(
    currentCpmCost, currentCpmRevenue, currentMarginPct, targetMarginPct,
    currentKpi, targetKpi, kpiType, config, isFin, cpmSoldCap,
    budgetDailyAvg, daysRemaining, currentWinRate, winRateCurve,
    calibratedStats, realKpiVolatility, realKpiTrendPct
  );

  // --- SCÉNARIO 2 : BID SHADING OPTIMAL ---
  const optimalResult = computeOptimalBid(
    currentCpmCost, currentCpmRevenue, currentMarginPct, targetMarginPct,
    cpmSoldCap, currentKpi, targetKpi, kpiType, winRateCurve,
    budgetDailyAvg, daysRemaining, calibratedStats, crossCampaignPrior
  );

  const scenario2 = computeOptimalScenario(
    optimalResult, currentCpmCost, currentCpmRevenue, currentMarginPct,
    currentKpi, targetKpi, kpiType, config, isFin, cpmSoldCap,
    budgetDailyAvg, daysRemaining, currentWinRate, winRateCurve,
    calibratedStats, realKpiVolatility, realKpiTrendPct
  );

  // --- SCÉNARIO 3 : BID CAP-ALIGNED (AGRESSIF) ---
  const scenario3 = computeCapAlignedScenario(
    currentCpmCost, currentCpmRevenue, currentMarginPct, targetMarginPct,
    currentKpi, targetKpi, kpiType, config, isFin, cpmSoldCap,
    budgetDailyAvg, daysRemaining, currentWinRate, winRateCurve,
    calibratedStats, realKpiVolatility, realKpiTrendPct
  );

  return {
    scenarios: [scenario1, scenario2, scenario3],
    winRateCurve,
    optimalBid: optimalResult.optimalBid,
    optimalMargin: optimalResult.optimalMargin,
    marketContext,
  };
}

// ============================================================
// SCÉNARIO 1 : BID STABLE
// ============================================================

function computeStableScenario(
  currentCpmCost: number, currentCpmRevenue: number,
  currentMarginPct: number, targetMarginPct: number,
  currentKpi: number, targetKpi: number,
  kpiType: string, config: KpiShadingConfig, isFin: boolean,
  cpmSoldCap: number, budgetDailyAvg: number, daysRemaining: number,
  currentWinRate: number, winRateCurve: WinRateCurve,
  calibratedStats?: CampaignLearningStats | null,
  realKpiVolatility?: number | null,
  realKpiTrendPct?: number | null,
): BidShadingScenario {

  // Bid inchangé, CPM Revenue change
  const newCpmRevenue = currentCpmCost / (1 - targetMarginPct / 100);

  // KPI projeté
  const kpiProjected = projectKpiFromBid(
    currentKpi, currentCpmCost, currentCpmCost, currentCpmRevenue, newCpmRevenue,
    isFin, kpiType, config, calibratedStats, currentMarginPct, targetMarginPct
  );

  // Trend ajustement
  let adjustedKpi = kpiProjected;
  if (realKpiTrendPct !== null && realKpiTrendPct !== undefined) {
    adjustedKpi += kpiProjected * Math.max(-0.30, Math.min(0.30, realKpiTrendPct * 3));
  }

  // Fourchette Optimiste/Pessimiste
  const { optimistic, pessimistic } = computeKpiRange(
    adjustedKpi, isFin, realKpiVolatility, currentKpi, config
  );

  // Win rate : inchangé (même bid)
  const capExcess = cpmSoldCap > 0 ? Math.max(0, (newCpmRevenue - cpmSoldCap) / cpmSoldCap * 100) : 0;

  // Gain
  const currentGainPerDay = budgetDailyAvg * (currentMarginPct / 100);
  const gainPerDay = budgetDailyAvg * (targetMarginPct / 100);

  // Warnings
  const warnings: BidShadingWarning[] = [];
  if (capExcess > 5) {
    warnings.push({
      type: "cap_exceeded",
      severity: capExcess > 15 ? "danger" : "warning",
      message: `CPM Revenue ${newCpmRevenue.toFixed(2)} dépasse le Cap de +${capExcess.toFixed(1)}%`,
    });
  }

  return {
    id: "stable",
    label: "Bid Stable",
    emoji: "🔒",
    description: "Même bid, marge ajustée uniquement — impact mathématique pur",
    newCpmCost: currentCpmCost,
    newCpmRevenue: Math.round(newCpmRevenue * 100) / 100,
    bidAdjustmentPct: 0,
    newMarginPct: targetMarginPct,
    effectiveMarginPct: targetMarginPct,
    kpiProjected: Math.round(adjustedKpi * 1000) / 1000,
    kpiOptimistic: Math.round(optimistic * 1000) / 1000,
    kpiPessimistic: Math.round(pessimistic * 1000) / 1000,
    gainPerDay: Math.round(gainPerDay * 100) / 100,
    gainProjectedTotal: Math.round(gainPerDay * daysRemaining * 100) / 100,
    gainDeltaVsCurrent: Math.round((gainPerDay - currentGainPerDay) * daysRemaining * 100) / 100,
    winRateEstimated: Math.round(currentWinRate * 1000) / 1000,
    winRateDelta: 0,
    inventoryQualityScore: 75, // Neutre — même inventaire
    capRespected: capExcess <= 2,
    capExcessPct: Math.round(capExcess * 10) / 10,
    confidence: winRateCurve.confidence,
    confidenceSource: "Modèle mathématique (bid constant)",
    warnings,
  };
}

// ============================================================
// SCÉNARIO 2 : BID SHADING OPTIMAL
// ============================================================

function computeOptimalScenario(
  optimalResult: { optimalBid: number; optimalMargin: number; score: number; breakdown: OptimalBidBreakdown },
  currentCpmCost: number, currentCpmRevenue: number,
  currentMarginPct: number,
  currentKpi: number, targetKpi: number,
  kpiType: string, config: KpiShadingConfig, isFin: boolean,
  cpmSoldCap: number, budgetDailyAvg: number, daysRemaining: number,
  currentWinRate: number, winRateCurve: WinRateCurve,
  calibratedStats?: CampaignLearningStats | null,
  realKpiVolatility?: number | null,
  realKpiTrendPct?: number | null,
): BidShadingScenario {

  const { optimalBid, optimalMargin, breakdown } = optimalResult;
  const bidAdjPct = ((optimalBid - currentCpmCost) / currentCpmCost) * 100;
  const newCpmRevenue = optimalBid / (1 - optimalMargin / 100);

  // KPI projeté (déjà calculé dans breakdown)
  let adjustedKpi = breakdown.projectedKpi;
  if (realKpiTrendPct !== null && realKpiTrendPct !== undefined) {
    adjustedKpi += breakdown.projectedKpi * Math.max(-0.30, Math.min(0.30, realKpiTrendPct * 3));
  }

  // Fourchette — plus large car on change le bid
  const volatilityMultiplier = Math.abs(bidAdjPct) > 20 ? 1.3 : Math.abs(bidAdjPct) > 10 ? 1.15 : 1.0;
  const adjustedVolatility = realKpiVolatility != null ? realKpiVolatility * volatilityMultiplier : null;
  const { optimistic, pessimistic } = computeKpiRange(
    adjustedKpi, isFin, adjustedVolatility, currentKpi, config
  );

  // Win rate
  const optimalWinRate = winRateCurve.predict(optimalBid);
  const winRateDelta = optimalWinRate - currentWinRate;

  // Score qualité inventaire
  const inventoryQuality = optimalBid >= currentCpmCost
    ? Math.min(95, 75 + (optimalBid / currentCpmCost - 1) * 100)  // Bid plus haut = meilleur inventaire
    : Math.max(30, 75 - (1 - optimalBid / currentCpmCost) * 150); // Bid plus bas = inventaire dégradé

  // Cap
  const capExcess = cpmSoldCap > 0 ? Math.max(0, (newCpmRevenue - cpmSoldCap) / cpmSoldCap * 100) : 0;

  // Gain
  const currentGainPerDay = budgetDailyAvg * (currentMarginPct / 100);
  const gainPerDay = budgetDailyAvg * (optimalMargin / 100) * (optimalWinRate / Math.max(0.01, currentWinRate));

  // Warnings
  const warnings: BidShadingWarning[] = [];

  if (optimalWinRate < 0.30) {
    warnings.push({ type: "win_rate_low", severity: "warning",
      message: `Win rate estimé à ${(optimalWinRate * 100).toFixed(0)}% — risque de sous-livraison` });
  }
  if (capExcess > 2) {
    warnings.push({ type: "cap_exceeded", severity: capExcess > 10 ? "danger" : "warning",
      message: `CPM Revenue ${newCpmRevenue.toFixed(2)} dépasse le Cap de +${capExcess.toFixed(1)}%` });
  }
  if (breakdown.kpiDegradation > config.maxDegradationPct * 0.7) {
    warnings.push({ type: "kpi_risk", severity: "warning",
      message: `KPI proche de la limite de dégradation (${(breakdown.kpiDegradation * 100).toFixed(0)}% vs max ${(config.maxDegradationPct * 100).toFixed(0)}%)` });
  }
  if (Math.abs(bidAdjPct) > 25) {
    warnings.push({ type: "volatility_high", severity: "info",
      message: `Changement de bid important (${bidAdjPct > 0 ? '+' : ''}${bidAdjPct.toFixed(1)}%) — surveiller les premiers jours` });
  }

  return {
    id: "shading_optimal",
    label: "Bid Shading Optimal",
    emoji: "🎯",
    description: `Bid ajusté à ${optimalBid.toFixed(2)} pour maximiser gain/risque — le point d'équilibre intelligent`,
    newCpmCost: optimalBid,
    newCpmRevenue: Math.round(newCpmRevenue * 100) / 100,
    bidAdjustmentPct: Math.round(bidAdjPct * 10) / 10,
    newMarginPct: optimalMargin,
    effectiveMarginPct: optimalMargin,
    kpiProjected: Math.round(adjustedKpi * 1000) / 1000,
    kpiOptimistic: Math.round(optimistic * 1000) / 1000,
    kpiPessimistic: Math.round(pessimistic * 1000) / 1000,
    gainPerDay: Math.round(gainPerDay * 100) / 100,
    gainProjectedTotal: Math.round(gainPerDay * daysRemaining * 100) / 100,
    gainDeltaVsCurrent: Math.round((gainPerDay - currentGainPerDay) * daysRemaining * 100) / 100,
    winRateEstimated: Math.round(optimalWinRate * 1000) / 1000,
    winRateDelta: Math.round(winRateDelta * 1000) / 1000,
    inventoryQualityScore: Math.round(inventoryQuality),
    capRespected: capExcess <= 2,
    capExcessPct: Math.round(capExcess * 10) / 10,
    confidence: Math.round(winRateCurve.confidence * 100) / 100,
    confidenceSource: `Bid Shading (${winRateCurve.source}, score=${optimalResult.score.toFixed(1)})`,
    warnings,
  };
}

// ============================================================
// SCÉNARIO 3 : BID CAP-ALIGNED (AGRESSIF)
// ============================================================

function computeCapAlignedScenario(
  currentCpmCost: number, currentCpmRevenue: number,
  currentMarginPct: number, targetMarginPct: number,
  currentKpi: number, targetKpi: number,
  kpiType: string, config: KpiShadingConfig, isFin: boolean,
  cpmSoldCap: number, budgetDailyAvg: number, daysRemaining: number,
  currentWinRate: number, winRateCurve: WinRateCurve,
  calibratedStats?: CampaignLearningStats | null,
  realKpiVolatility?: number | null,
  realKpiTrendPct?: number | null,
): BidShadingScenario {

  const isIncreasing = targetMarginPct > currentMarginPct;

  let newCpmCost: number;
  let newCpmRevenue: number;
  let effectiveMargin: number;
  let description: string;

  if (isIncreasing && cpmSoldCap > 0) {
    // Montée marge → aligner sur le Cap pour maximiser la marge
    newCpmRevenue = cpmSoldCap;
    newCpmCost = cpmSoldCap * (1 - targetMarginPct / 100);
    effectiveMargin = targetMarginPct;
    description = `Bid baissé à ${newCpmCost.toFixed(2)} pour atteindre ${targetMarginPct.toFixed(1)}% au CPM Cap`;
  } else if (!isIncreasing) {
    // Baisse marge → monter le bid pour plus de volume
    const bidBoostFactor = 1 + (currentMarginPct - targetMarginPct) / 100 * config.bidSensitivity;
    newCpmCost = currentCpmCost * Math.min(1.40, bidBoostFactor);
    newCpmRevenue = newCpmCost / (1 - targetMarginPct / 100);

    // Re-cap si nécessaire
    if (cpmSoldCap > 0 && newCpmRevenue > cpmSoldCap) {
      newCpmRevenue = cpmSoldCap;
      newCpmCost = cpmSoldCap * (1 - targetMarginPct / 100);
    }
    effectiveMargin = ((newCpmRevenue - newCpmCost) / newCpmRevenue) * 100;
    description = `Bid monté à ${newCpmCost.toFixed(2)} pour maximiser le volume — approche agressive`;
  } else {
    // Pas de cap, montée marge → même bid
    newCpmCost = currentCpmCost;
    newCpmRevenue = currentCpmCost / (1 - targetMarginPct / 100);
    effectiveMargin = targetMarginPct;
    description = "Pas de CPM Cap défini — comportement identique au Bid Stable";
  }

  const bidAdjPct = ((newCpmCost - currentCpmCost) / currentCpmCost) * 100;

  // KPI projeté
  const kpiProjected = projectKpiFromBid(
    currentKpi, currentCpmCost, newCpmCost, currentCpmRevenue, newCpmRevenue,
    isFin, kpiType, config, calibratedStats, currentMarginPct, effectiveMargin
  );

  let adjustedKpi = kpiProjected;
  if (realKpiTrendPct !== null && realKpiTrendPct !== undefined) {
    adjustedKpi += kpiProjected * Math.max(-0.30, Math.min(0.30, realKpiTrendPct * 3));
  }

  // Fourchette plus large (agressif = plus d'incertitude)
  const volatilityMultiplier = Math.abs(bidAdjPct) > 30 ? 1.4 : Math.abs(bidAdjPct) > 15 ? 1.25 : 1.1;
  const adjustedVolatility = realKpiVolatility != null ? realKpiVolatility * volatilityMultiplier : null;
  const { optimistic, pessimistic } = computeKpiRange(
    adjustedKpi, isFin, adjustedVolatility, currentKpi, config
  );

  // Win rate
  const newWinRate = winRateCurve.predict(newCpmCost);
  const winRateDelta = newWinRate - currentWinRate;

  // Qualité inventaire
  const inventoryQuality = newCpmCost >= currentCpmCost
    ? Math.min(95, 75 + (newCpmCost / currentCpmCost - 1) * 100)
    : Math.max(25, 75 - (1 - newCpmCost / currentCpmCost) * 200);

  // Cap
  const capExcess = cpmSoldCap > 0 ? Math.max(0, (newCpmRevenue - cpmSoldCap) / cpmSoldCap * 100) : 0;

  // Gain
  const currentGainPerDay = budgetDailyAvg * (currentMarginPct / 100);
  const gainPerDay = budgetDailyAvg * (effectiveMargin / 100) * (newWinRate / Math.max(0.01, currentWinRate));

  // Warnings
  const warnings: BidShadingWarning[] = [];
  if (newWinRate < 0.25) {
    warnings.push({ type: "win_rate_low", severity: "danger",
      message: `Win rate très bas (${(newWinRate * 100).toFixed(0)}%) — livraison à risque` });
  }
  if (Math.abs(bidAdjPct) > 30) {
    warnings.push({ type: "volatility_high", severity: "warning",
      message: `Changement de bid de ${bidAdjPct > 0 ? '+' : ''}${bidAdjPct.toFixed(0)}% — risque de volatilité élevé` });
  }

  const kpiDeg = isFin
    ? Math.max(0, (adjustedKpi - targetKpi) / Math.max(targetKpi, 0.001))
    : Math.max(0, (targetKpi - adjustedKpi) / Math.max(targetKpi, 0.001));
  if (kpiDeg > config.maxDegradationPct * 0.5) {
    warnings.push({ type: "kpi_risk", severity: kpiDeg > config.maxDegradationPct ? "danger" : "warning",
      message: `Dégradation KPI estimée à ${(kpiDeg * 100).toFixed(0)}%` });
  }

  return {
    id: "aggressive",
    label: "Bid Cap-Aligned",
    emoji: "⚡",
    description,
    newCpmCost: Math.round(newCpmCost * 100) / 100,
    newCpmRevenue: Math.round(newCpmRevenue * 100) / 100,
    bidAdjustmentPct: Math.round(bidAdjPct * 10) / 10,
    newMarginPct: targetMarginPct,
    effectiveMarginPct: Math.round(effectiveMargin * 100) / 100,
    kpiProjected: Math.round(adjustedKpi * 1000) / 1000,
    kpiOptimistic: Math.round(optimistic * 1000) / 1000,
    kpiPessimistic: Math.round(pessimistic * 1000) / 1000,
    gainPerDay: Math.round(gainPerDay * 100) / 100,
    gainProjectedTotal: Math.round(gainPerDay * daysRemaining * 100) / 100,
    gainDeltaVsCurrent: Math.round((gainPerDay - currentGainPerDay) * daysRemaining * 100) / 100,
    winRateEstimated: Math.round(newWinRate * 1000) / 1000,
    winRateDelta: Math.round(winRateDelta * 1000) / 1000,
    inventoryQualityScore: Math.round(inventoryQuality),
    capRespected: capExcess <= 2,
    capExcessPct: Math.round(capExcess * 10) / 10,
    confidence: Math.round(winRateCurve.confidence * 0.85 * 100) / 100, // Moins de confiance (agressif)
    confidenceSource: isIncreasing ? "Cap-aligned (marge montée)" : "Volume-push (marge baissée)",
    warnings,
  };
}

// ============================================================
// 5. UTILITAIRES
// ============================================================

/**
 * Calcule la fourchette Optimiste/Pessimiste
 * Réutilise la même logique que CockpitYield V8.1 mais centralisée.
 */
function computeKpiRange(
  kpiCenter: number,
  isFin: boolean,
  realKpiVolatility: number | null | undefined,
  currentKpi: number,
  config: KpiShadingConfig,
): { optimistic: number; pessimistic: number } {

  let uncertainty: number;

  if (realKpiVolatility != null && realKpiVolatility > 0) {
    // Volatilité réelle × horizon ~5 jours
    uncertainty = kpiCenter * realKpiVolatility * Math.sqrt(5);
    // Plancher minimum
    uncertainty = Math.max(uncertainty, kpiCenter * 0.02);
    // Plafond à 40% du centre
    uncertainty = Math.min(uncertainty, kpiCenter * 0.40);
  } else {
    // Défaut basé sur le type de KPI
    const defaultVolPct = isFin ? 0.08 : 0.05;
    uncertainty = kpiCenter * defaultVolPct;
  }

  let optimistic: number;
  let pessimistic: number;

  if (isFin) {
    // Financier : plus bas = mieux = optimiste
    optimistic = kpiCenter - uncertainty;
    pessimistic = kpiCenter + uncertainty;
  } else {
    // Qualité : plus haut = mieux = optimiste
    optimistic = kpiCenter + uncertainty;
    pessimistic = kpiCenter - uncertainty;
  }

  // Sanity caps
  if (isFin) {
    optimistic = Math.max(0.001, optimistic);
    pessimistic = Math.max(0.001, pessimistic);
    pessimistic = Math.min(pessimistic, currentKpi * 10);
  } else {
    optimistic = Math.max(0, Math.min(100, optimistic));
    pessimistic = Math.max(0, Math.min(100, pessimistic));
  }

  return { optimistic, pessimistic };
}

/**
 * Évalue le contexte marché actuel.
 */
function computeMarketContext(
  currentCpmCost: number,
  currentCpmRevenue: number,
  cpmSoldCap: number,
  winRateCurve: WinRateCurve,
): MarketContext {
  const estimatedMarketCpm = winRateCurve.x0; // Point d'inflexion ≈ médiane marché

  let currentBidPosition: MarketContext["currentBidPosition"];
  if (currentCpmCost < estimatedMarketCpm * 0.85) {
    currentBidPosition = "below_market";
  } else if (currentCpmCost > estimatedMarketCpm * 1.15) {
    currentBidPosition = "above_market";
  } else {
    currentBidPosition = "at_market";
  }

  // Percentile approximé via la CDF logistique
  const z = winRateCurve.k * (currentCpmCost - winRateCurve.x0);
  const cdf = 1 / (1 + Math.exp(-z));
  const currentBidPercentile = Math.round(cdf * 100);

  // Niveau de compétition (estimé via la pente de la courbe)
  // k élevé = courbe raide = beaucoup de compétiteurs proches → haute compétition
  let competitionLevel: MarketContext["competitionLevel"];
  if (winRateCurve.k > 2.5) competitionLevel = "high";
  else if (winRateCurve.k > 1.0) competitionLevel = "medium";
  else competitionLevel = "low";

  // Pression inventaire : ratio bid/cap — plus on est proche du cap, plus la pression est forte
  const inventoryPressure = cpmSoldCap > 0
    ? Math.min(1.0, currentCpmRevenue / cpmSoldCap)
    : 0.5;

  return {
    estimatedMarketCpm: Math.round(estimatedMarketCpm * 100) / 100,
    currentBidPosition,
    currentBidPercentile,
    competitionLevel,
    inventoryPressure: Math.round(inventoryPressure * 100) / 100,
  };
}
