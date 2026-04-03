// ============================================================
// 🔥 V8.2 : LEARNING ENGINE — Tous modes de suivi
// ============================================================
// Supporte les 3 modes : Global, Ad Group, Sous-Campagne
// Pas de store séparé. Tout est calculé dynamiquement depuis
// les dailyEntries enrichies.
// ============================================================

export type FunnelTag = "prospecting" | "retargeting" | "mixed" | "awareness" | "conversion" | "unknown";

export interface AdGroupStats {
  name: string;
  funnelTag: FunnelTag;
  funnelConfidence: number;
  totalSpend: number;
  totalGain: number;
  avgMargin: number;
  avgKpi: number;
  kpiValues: number[];
  kpiStdDev: number;
  daysTracked: number;
  avgDailySpend: number;
  perfCategory: "dead" | "underperforming" | "ok" | "good" | "star";
  perfStability: number;
  marginKpiElasticity: number;
  elasticityConfidence: number;
  marginCeiling: number;
  optimalMarginRange: [number, number];
  calibratedMarginIncrement: number;
  calibratedVolatility: number;
  learningInsight: string;
}

export interface SaturationModel {
  predict: (margin: number) => number;
  saturationPoint: number;
  asymptote: number;
  inflectionSlope: number;
  confidence: number;
  dataPoints: number;
}

export interface CampaignLearningStats {
  realKpiVolatility: number;
  realSpendVolatility: number;
  marginKpiElasticity: number;
  elasticityConfidence: number;
  marginCeiling: number;
  optimalMarginRange: [number, number];
  bestDaysOfWeek: number[];
  worstDaysOfWeek: number[];
  saturationModel: SaturationModel | null;
}

export interface CalibratedCoefficients {
  marginImpact: number;
  volatility: number;
  competition: number;
  bidImpactFactor: number;
  reachElasticity: number;
  source: "adgroup_learning" | "campaign_learning" | "default";
  confidence: number;
  insight: string;
}
// 🔥 V10.0 : Prior bayésien cross-campagne
export interface CrossCampaignPrior {
  kpiType: string;
  funnelType: string;
  avgElasticity: number;
  elasticityStdDev: number;
  avgVolatility: number;
  avgMarginCeiling: number;
  optimalMarginLow: number;
  optimalMarginHigh: number;
  sampleSize: number;
  confidence: number;
}

// 🔥 V10.0 : Calculer un prior à partir de campagnes terminées
export function computeCrossCampaignPrior(
  completedProjects: any[],
  targetKpiType: string,
  targetFunnelType: string = "mixed"
): CrossCampaignPrior | null {
  // Filtrer par KPI type
  const matching = completedProjects.filter(p => 
    p.kpiType === targetKpiType && 
    p.status === "completed" &&
    p.dailyEntries && p.dailyEntries.length >= 5
  );
  
  if (matching.length === 0) return null;
  
  // Calculer les stats de chaque campagne terminée
  const stats = matching.map(p => computeCampaignLearningStats(p)).filter(Boolean) as CampaignLearningStats[];
  if (stats.length === 0) return null;
  
  // Moyennes
  const elasticities = stats.filter(s => s.elasticityConfidence > 0.2).map(s => s.marginKpiElasticity);
  const volatilities = stats.map(s => s.realKpiVolatility).filter(v => v > 0);
  const ceilings = stats.map(s => s.marginCeiling).filter(c => c < 95);
  const optLows = stats.map(s => s.optimalMarginRange[0]);
  const optHighs = stats.map(s => s.optimalMarginRange[1]);
  
  const avgEl = elasticities.length > 0 ? mean(elasticities) : 0;
  const stdEl = elasticities.length > 1 ? stdDev(elasticities) : 0.05;
  
  return {
    kpiType: targetKpiType,
    funnelType: targetFunnelType,
    avgElasticity: avgEl,
    elasticityStdDev: stdEl,
    avgVolatility: volatilities.length > 0 ? mean(volatilities) : 0.15,
    avgMarginCeiling: ceilings.length > 0 ? mean(ceilings) : 80,
    optimalMarginLow: optLows.length > 0 ? mean(optLows) : 20,
    optimalMarginHigh: optHighs.length > 0 ? mean(optHighs) : 55,
    sampleSize: matching.length,
    confidence: Math.min(0.9, 0.3 + matching.length * 0.05), // 0.3 + 5% par campagne, max 90%
  };
}

// 🔥 V10.0 : Fusion bayésienne prior + données courantes
export function getBayesianElasticity(
  campaignStats: CampaignLearningStats | null,
  prior: CrossCampaignPrior | null
): { elasticity: number; confidence: number; source: string } {
  // Cas 1 : Pas de prior → utiliser les données campagne ou défaut
  if (!prior) {
    if (campaignStats && campaignStats.elasticityConfidence > 0.3) {
      return { elasticity: campaignStats.marginKpiElasticity, confidence: campaignStats.elasticityConfidence, source: "campaign_only" };
    }
    return { elasticity: 0, confidence: 0, source: "no_data" };
  }
  
  // Cas 2 : Prior mais pas de données campagne → utiliser le prior
  if (!campaignStats || campaignStats.elasticityConfidence <= 0.2) {
    return { elasticity: prior.avgElasticity, confidence: prior.confidence * 0.6, source: `prior_${prior.sampleSize}_campaigns` };
  }
  
  // Cas 3 : Les deux → fusion bayésienne
  // Plus on a de confiance dans les données campagne, moins le prior pèse
  const priorWeight = prior.sampleSize / (prior.sampleSize + campaignStats.elasticityConfidence * 30);
  const dataWeight = 1 - priorWeight;
  
  const blendedElasticity = prior.avgElasticity * priorWeight + campaignStats.marginKpiElasticity * dataWeight;
  const blendedConfidence = Math.min(0.95, prior.confidence * priorWeight + campaignStats.elasticityConfidence * dataWeight);
  
  return { 
    elasticity: blendedElasticity, 
    confidence: blendedConfidence, 
    source: `bayesian_${prior.sampleSize}camp_R²=${campaignStats.elasticityConfidence.toFixed(2)}` 
  };
}
// --- DÉTECTION FUNNEL TAG ---
const FUNNEL_PATTERNS: Record<FunnelTag, RegExp[]> = {
  retargeting: [/retarget/i, /remarketing/i, /\brt\b/i, /\bretarg\b/i, /\brtg\b/i, /lower.?funnel/i, /bottom.?funnel/i, /site.?visit/i, /cart.?abandon/i, /\bbofu\b/i, /\blf\b/i, /dynamic.?retarg/i, /\bdrt\b/i, /re-?engagement/i, /past.?visit/i, /existing.?user/i],
  prospecting: [/prospect/i, /\btg\b/i, /upper.?funnel/i, /top.?funnel/i, /\btofu\b/i, /\buf\b/i, /reach/i, /broad/i, /new.?audience/i, /cold.?audience/i, /lookalike/i, /\blal\b/i, /similar.?audience/i, /contextual/i, /open.?web/i, /\bpmp\b/i],
  awareness: [/awareness/i, /brand/i, /branding/i, /notoriété/i, /\bvideo.?view/i, /\bvv\b/i, /\btvc\b/i],
  conversion: [/conversion/i, /\bcnv\b/i, /\bconv\b/i, /performance/i, /\bcpa\b/i, /\bcpi\b/i, /lead.?gen/i, /purchase/i],
  mixed: [/mixed/i, /mid.?funnel/i, /\bmofu\b/i, /consideration/i],
  unknown: [],
};

export function detectFunnelTag(name: string): { tag: FunnelTag; confidence: number } {
  const normalized = name.toLowerCase().trim();
  let bestTag: FunnelTag = "unknown";
  let bestScore = 0;
  for (const [tag, patterns] of Object.entries(FUNNEL_PATTERNS) as [FunnelTag, RegExp[]][]) {
    if (tag === "unknown") continue;
    let matchCount = 0;
    for (const pattern of patterns) { if (pattern.test(normalized)) matchCount++; }
    if (matchCount > bestScore) { bestScore = matchCount; bestTag = tag; }
  }
  const confidence = bestScore === 0 ? 0 : bestScore === 1 ? 0.6 : bestScore === 2 ? 0.85 : 0.95;
  return { tag: bestTag, confidence };
}

// --- UTILITAIRES ---
function mean(arr: number[]): number { return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdDev(arr: number[]): number { if (arr.length < 2) return 0; const m = mean(arr); return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length); }
function linearRegression(x: number[], y: number[]): { slope: number; rSquared: number } {
  const n = x.length; if (n < 2) return { slope: 0, rSquared: 0 };
  const xM = mean(x), yM = mean(y); let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - xM) * (y[i] - yM); den += (x[i] - xM) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const ssTot = y.reduce((a, b) => a + (b - yM) ** 2, 0);
  const ssRes = y.reduce((a, yi, i) => a + (yi - (slope * x[i] + (yM - slope * xM))) ** 2, 0);
  return { slope, rSquared: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0 };
}
// 🔥 V10.0 : SCORING CONTINU — Score logarithmique 0-10 au lieu de catégories fixes
export function continuousPerfScore(actual: number, target: number, isFin: boolean): number {
  if (actual === 0) return 0;
  if (target <= 0) return 5; // pas de target = neutre
  // ratio > 1 = meilleur que le target
  const ratio = isFin ? target / actual : actual / target;
  if (ratio <= 0) return 0;
  // Score continu 0-10, logarithmique
  // ratio=1 → score=5 (exactement au target)
  // ratio=2 → score=8.5 (très bon)
  // ratio=0.5 → score=1.5 (mauvais)
  return Math.max(0, Math.min(10, 5 + 5 * Math.log2(Math.max(0.01, ratio))));
}

// 🔥 V10.0 : Convertir un score continu en catégorie (pour compatibilité UI)
export function scoreToCategoryFromContinuous(score: number): "dead" | "underperforming" | "ok" | "good" | "star" {
  if (score >= 8) return "star";
  if (score >= 6.5) return "good";
  if (score >= 4) return "ok";
  if (score >= 2) return "underperforming";
  return "dead";
}

// 🔥 V10.0 : RÉGRESSION LINÉAIRE PONDÉRÉE PAR RÉCENCE (Exponential Decay)
export function weightedLinearRegression(
  x: number[], y: number[], dates: string[], halfLifeDays: number = 7
): { slope: number; rSquared: number } {
  const n = x.length;
  if (n < 2) return { slope: 0, rSquared: 0 };
  
  const now = Date.now();
  // Calculer les poids exponentiels (demi-vie = halfLifeDays jours)
  const weights = dates.map(d => {
    const daysAgo = (now - new Date(d).getTime()) / (86400000);
    return Math.pow(0.5, daysAgo / halfLifeDays);
  });
  
  const totalW = weights.reduce((a, b) => a + b, 0);
  if (totalW === 0) return { slope: 0, rSquared: 0 };
  
  // Moyennes pondérées
  const xM = weights.reduce((s, w, i) => s + w * x[i], 0) / totalW;
  const yM = weights.reduce((s, w, i) => s + w * y[i], 0) / totalW;
  
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += weights[i] * (x[i] - xM) * (y[i] - yM);
    den += weights[i] * (x[i] - xM) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  
  // R² pondéré
  const ssTot = weights.reduce((s, w, i) => s + w * (y[i] - yM) ** 2, 0);
  const ssRes = weights.reduce((s, w, i) => {
    const pred = slope * x[i] + (yM - slope * xM);
    return s + w * (y[i] - pred) ** 2;
  }, 0);
  
  return { slope, rSquared: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0 };
}
// ============================================================
// 🔬 V10.2 : MODÈLE DE SATURATION LOGISTIQUE (courbe en S)
// ============================================================
export function fitSaturationModel(
  margins: number[],
  kpis: number[],
  isFin: boolean
): SaturationModel | null {
  if (margins.length < 5 || kpis.length < 5) return null;
  const pairs = margins.map((m, i) => ({ m, k: kpis[i] }))
    .filter(p => p.m > 0 && p.k > 0)
    .sort((a, b) => a.m - b.m);
  if (pairs.length < 5) return null;
  const ms = pairs.map(p => p.m);
  const ks = pairs.map(p => p.k);
  const n = ms.length;
  const kpiMin = Math.min(...ks);
  const kpiMax = Math.max(...ks);
  const kpiRange = kpiMax - kpiMin;
  const marginMid = (Math.min(...ms) + Math.max(...ms)) / 2;
  let L = isFin ? kpiRange * 2 : -kpiRange * 2;
  let k = 0.1;
  let x0 = marginMid;
  let base = isFin ? kpiMin * 0.8 : kpiMax * 1.1;
  const learningRate = 0.001;
  for (let iter = 0; iter < 80; iter++) {
    let dL = 0, dk = 0, dx0 = 0, dBase = 0;
    for (let i = 0; i < n; i++) {
      const z = -k * (ms[i] - x0);
      const expZ = Math.exp(Math.max(-50, Math.min(50, z)));
      const sigmoid = 1 / (1 + expZ);
      const predicted = L * sigmoid + base;
      const error = predicted - ks[i];
      dL += error * sigmoid;
      dk += error * L * sigmoid * (1 - sigmoid) * (-(ms[i] - x0));
      dx0 += error * L * sigmoid * (1 - sigmoid) * k;
      dBase += error;
    }
    const lr = learningRate / (1 + iter * 0.01);
    L -= lr * dL / n;
    k -= lr * dk / n;
    x0 -= lr * dx0 / n;
    base -= lr * dBase / n;
    k = Math.max(0.01, Math.min(1.0, k));
    x0 = Math.max(Math.min(...ms) - 10, Math.min(Math.max(...ms) + 10, x0));
  }
  const kpiMean = ks.reduce((a, b) => a + b, 0) / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const z = -k * (ms[i] - x0);
    const expZ = Math.exp(Math.max(-50, Math.min(50, z)));
    const predicted = L / (1 + expZ) + base;
    ssRes += (ks[i] - predicted) ** 2;
    ssTot += (ks[i] - kpiMean) ** 2;
  }
  const rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  if (rSquared < 0.15) return null;
  const predict = (margin: number): number => {
    const z = -k * (margin - x0);
    const expZ = Math.exp(Math.max(-50, Math.min(50, z)));
    return L / (1 + expZ) + base;
  };
  const saturationPoint = isFin ? x0 - (1 / k) : x0 + (1 / k);
  return {
    predict,
    saturationPoint: Math.max(5, Math.min(95, saturationPoint)),
    asymptote: L + base,
    inflectionSlope: Math.abs(L * k / 4),
    confidence: rSquared,
    dataPoints: n,
  };
}
// ============================================================
// 🔮 V10.3 : PACING PRÉDICTIF — AR(1) + Monte Carlo
// ============================================================

export interface PredictivePacing {
  predictedEndSpendPct: number;
  daysToDepletion: number | null;
  confidenceInterval: [number, number];
  recommendation: "accelerate" | "maintain" | "decelerate" | "urgent";
  recommendedDailyAdjustPct: number;
  message: string;
  ar1Alpha: number;
  ar1Beta: number;
  residualStdDev: number;
  simulationCount: number;
}

export function predictPacing(
  dailySpends: number[],
  budgetTotal: number,
  budgetSpent: number,
  daysRemaining: number,
  currSym: string = "€"
): PredictivePacing | null {
  if (dailySpends.length < 5 || daysRemaining <= 0 || budgetTotal <= 0) return null;

  const n = dailySpends.length;
  const budgetRemaining = budgetTotal - budgetSpent;
  const targetDailySpend = budgetRemaining / daysRemaining;

  // 1. ESTIMATION AR(1) : spend(t) = α + β × spend(t-1) + ε
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 1; i < n; i++) {
    x.push(dailySpends[i - 1]);
    y.push(dailySpends[i]);
  }
  const m = x.length;
  if (m < 3) return null;

  const xMean = x.reduce((a, b) => a + b, 0) / m;
  const yMean = y.reduce((a, b) => a + b, 0) / m;
  let num = 0, den = 0;
  for (let i = 0; i < m; i++) {
    num += (x[i] - xMean) * (y[i] - yMean);
    den += (x[i] - xMean) ** 2;
  }
  const beta = den > 0 ? num / den : 0;
  const alpha = yMean - beta * xMean;
  const betaClamped = Math.max(-0.99, Math.min(0.99, beta));

  // 2. VOLATILITÉ (résidus)
  const residuals: number[] = [];
  for (let i = 0; i < m; i++) {
    residuals.push(y[i] - (alpha + betaClamped * x[i]));
  }
  const residualMean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const residualVariance = residuals.reduce((a, r) => a + (r - residualMean) ** 2, 0) / Math.max(1, residuals.length - 2);
  const sigma = Math.sqrt(residualVariance);

  // 3. MONTE CARLO (500 trajectoires)
  const NUM_SIM = 500;
  const lastSpend = dailySpends[n - 1];
  const endSpends: number[] = [];
  const depletionDays: number[] = [];

  const randn = (): number => {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(Math.max(1e-10, u1))) * Math.cos(2 * Math.PI * u2);
  };

  for (let sim = 0; sim < NUM_SIM; sim++) {
    let cumSpend = budgetSpent;
    let prev = lastSpend;
    let depDay: number | null = null;
    for (let d = 1; d <= daysRemaining; d++) {
      let next = alpha + betaClamped * prev + sigma * randn();
      next = Math.max(0, next);
      next = Math.min(next, budgetTotal - cumSpend);
      cumSpend += next;
      prev = next;
      if (depDay === null && cumSpend >= budgetTotal * 0.98) depDay = d;
    }
    endSpends.push(cumSpend);
    if (depDay !== null) depletionDays.push(depDay);
  }

  // 4. ANALYSE
  endSpends.sort((a, b) => a - b);
  const p5 = endSpends[Math.floor(NUM_SIM * 0.05)];
  const p50 = endSpends[Math.floor(NUM_SIM * 0.50)];
  const p95 = endSpends[Math.floor(NUM_SIM * 0.95)];
  const predictedEndSpendPct = (p50 / budgetTotal) * 100;
  const ciLow = (p5 / budgetTotal) * 100;
  const ciHigh = (p95 / budgetTotal) * 100;

  let daysToDepletion: number | null = null;
  const depProb = depletionDays.length / NUM_SIM;
  if (depletionDays.length > 0) {
    depletionDays.sort((a, b) => a - b);
    const medDep = depletionDays[Math.floor(depletionDays.length / 2)];
    if (depProb > 0.20 && medDep < daysRemaining - 1) daysToDepletion = medDep;
  }

  // 5. RECOMMANDATION
  let recommendation: PredictivePacing["recommendation"];
  let recommendedDailyAdjustPct = 0;
  let message = "";
  const avgRecent = dailySpends.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, dailySpends.length);
  const spendGapPct = targetDailySpend > 0 ? ((avgRecent - targetDailySpend) / targetDailySpend) * 100 : 0;

  if (daysToDepletion !== null && daysToDepletion < daysRemaining * 0.85) {
    recommendation = "urgent";
    recommendedDailyAdjustPct = -Math.min(50, Math.abs(spendGapPct) * 0.8);
    message = `🚨 URGENT : Budget épuisé dans ~${daysToDepletion}j (sur ${daysRemaining}j restants) avec ${(depProb * 100).toFixed(0)}% de probabilité. Réduisez le spend de ${Math.abs(recommendedDailyAdjustPct).toFixed(0)}% dès demain (${avgRecent.toFixed(0)} → ${(avgRecent * (1 + recommendedDailyAdjustPct / 100)).toFixed(0)} ${currSym}/j).`;
  } else if (predictedEndSpendPct < 85) {
    recommendation = "accelerate";
    recommendedDailyAdjustPct = Math.min(50, ((100 - predictedEndSpendPct) / predictedEndSpendPct) * 100 * 0.6);
    message = `📈 ACCÉLÉRER : Projection médiane = ${predictedEndSpendPct.toFixed(0)}% du budget (IC 90% : ${ciLow.toFixed(0)}–${ciHigh.toFixed(0)}%). Augmentez le spend de +${recommendedDailyAdjustPct.toFixed(0)}% (${avgRecent.toFixed(0)} → ${(avgRecent * (1 + recommendedDailyAdjustPct / 100)).toFixed(0)} ${currSym}/j).`;
  } else if (predictedEndSpendPct > 105 || daysToDepletion !== null) {
    recommendation = "decelerate";
    recommendedDailyAdjustPct = -Math.min(40, Math.abs(spendGapPct) * 0.6);
    message = `📉 DÉCÉLÉRER : Projection médiane = ${predictedEndSpendPct.toFixed(0)}% du budget (IC 90% : ${ciLow.toFixed(0)}–${ciHigh.toFixed(0)}%). ${daysToDepletion ? `Épuisement possible dans ${daysToDepletion}j.` : ''} Réduisez de ${Math.abs(recommendedDailyAdjustPct).toFixed(0)}% (${avgRecent.toFixed(0)} → ${(avgRecent * (1 + recommendedDailyAdjustPct / 100)).toFixed(0)} ${currSym}/j).`;
  } else {
    recommendation = "maintain";
    recommendedDailyAdjustPct = 0;
    message = `✅ ON TRACK : Projection médiane = ${predictedEndSpendPct.toFixed(0)}% du budget (IC 90% : ${ciLow.toFixed(0)}–${ciHigh.toFixed(0)}%). Le rythme actuel (${avgRecent.toFixed(0)} ${currSym}/j) mène à un pacing optimal.`;
  }

  return {
    predictedEndSpendPct,
    daysToDepletion,
    confidenceInterval: [ciLow, ciHigh],
    recommendation,
    recommendedDailyAdjustPct,
    message,
    ar1Alpha: alpha,
    ar1Beta: betaClamped,
    residualStdDev: sigma,
    simulationCount: NUM_SIM,
  };
}
// ============================================================
// 🔄 V10.4 : DÉTECTION DE CHANGEMENT DE RÉGIME (CUSUM)
// ============================================================

export interface RegimeChange {
  metric: "spend" | "kpi" | "margin" | "cpmRevenue";
  metricLabel: string;
  breakpointDate: string;
  direction: "up" | "down";
  beforeMean: number;
  afterMean: number;
  changePct: number;
  confidence: number;       // 0-1 : force du signal CUSUM
  daysInNewRegime: number;
  isStructural: boolean;    // true = changement durable (≥3j), false = spike ponctuel
  message: string;
}

/**
 * CUSUM (Cumulative Sum) + Breakpoint Detection.
 * 
 * Pour chaque métrique (spend, KPI, marge, CPM Revenue) :
 * 1. Calculer la moyenne mobile sur une fenêtre glissante
 * 2. Accumuler les déviations positives (S+) et négatives (S-)
 * 3. Quand S+ ou S- dépasse le seuil h → détection de rupture
 * 4. Vérifier si la rupture est structurelle (≥3 jours dans le nouveau régime)
 * 
 * @param dailyEntries - Entrées quotidiennes triées chronologiquement
 * @param kpiType - Type de KPI pour le formatage
 * @param currSym - Symbole devise
 */
export function detectRegimeChanges(
  dailyEntries: any[],
  kpiType: string = "CPA",
  currSym: string = "€"
): RegimeChange[] {
  if (!dailyEntries || dailyEntries.length < 8) return [];

  // Agréger par date (critique en mode adgroup/sous-campagne)
  const dailyAgg = new Map<string, { spend: number; kpi: number; margin: number; cpmRev: number; count: number }>();
  for (const e of dailyEntries) {
    const ex = dailyAgg.get(e.date);
    if (ex) {
      const ts = ex.spend + (e.budgetSpent || 0);
      ex.kpi = ts > 0 ? (ex.kpi * ex.spend + (e.kpiActual || 0) * (e.budgetSpent || 0)) / ts : ex.kpi;
      ex.margin = ts > 0 ? (ex.margin * ex.spend + (e.marginPct || 0) * (e.budgetSpent || 0)) / ts : ex.margin;
      ex.cpmRev = ts > 0 ? (ex.cpmRev * ex.spend + (e.cpmRevenue || 0) * (e.budgetSpent || 0)) / ts : ex.cpmRev;
      ex.spend = ts;
      ex.count++;
    } else {
      dailyAgg.set(e.date, {
        spend: e.budgetSpent || 0,
        kpi: e.kpiActual || 0,
        margin: e.marginPct || 0,
        cpmRev: e.cpmRevenue || 0,
        count: 1,
      });
    }
  }

  const days = [...dailyAgg.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => ({ date, ...d }));

  if (days.length < 8) return [];

  const results: RegimeChange[] = [];

  // Analyser chaque métrique
  const metrics: { key: "spend" | "kpi" | "margin" | "cpmRev"; label: string; field: "spend" | "kpi" | "margin" | "cpmRev"; threshold: number; minChangePct: number }[] = [
    { key: "spend", label: "Budget Journalier", field: "spend", threshold: 4.0, minChangePct: 25 },
    { key: "kpi", label: kpiType, field: "kpi", threshold: 3.5, minChangePct: 15 },
    { key: "margin", label: "Marge %", field: "margin", threshold: 3.0, minChangePct: 10 },
    { key: "cpmRev", label: "CPM Revenue", field: "cpmRev", threshold: 3.5, minChangePct: 10 },
  ];

  for (const metric of metrics) {
    const values = days.map(d => d[metric.field]);
    const n = values.length;

    // Ignorer si toutes les valeurs sont 0
    if (values.every(v => v === 0)) continue;

    // Moyenne et écart-type globaux
    const globalMean = values.reduce((a, b) => a + b, 0) / n;
    if (globalMean === 0) continue;
    const globalStd = Math.sqrt(values.reduce((a, v) => a + (v - globalMean) ** 2, 0) / n);
    if (globalStd === 0) continue;

    // CUSUM : détecter le point de rupture le plus récent
    // Slack parameter k = 0.5σ (sensibilité standard)
    const k = globalStd * 0.5;
    const h = globalStd * metric.threshold; // Seuil de détection

    let sPlus = 0;  // CUSUM positif (détecte hausse)
    let sMinus = 0;  // CUSUM négatif (détecte baisse)
    let lastBreakIdx: number | null = null;
    let lastDirection: "up" | "down" = "up";

    for (let i = 0; i < n; i++) {
      sPlus = Math.max(0, sPlus + (values[i] - globalMean - k));
      sMinus = Math.max(0, sMinus - (values[i] - globalMean + k));

      if (sPlus > h) {
        lastBreakIdx = i;
        lastDirection = "up";
        sPlus = 0; // Reset après détection
      }
      if (sMinus > h) {
        lastBreakIdx = i;
        lastDirection = "down";
        sMinus = 0; // Reset après détection
      }
    }

    if (lastBreakIdx === null || lastBreakIdx < 3) continue;

    // Trouver le vrai point de rupture (chercher en arrière depuis la détection)
    // Le breakpoint est le dernier point où la CUSUM était à 0 avant la détection
    let breakpointIdx = lastBreakIdx;
    for (let i = lastBreakIdx; i >= Math.max(0, lastBreakIdx - 5); i--) {
      const deviation = Math.abs(values[i] - globalMean);
      if (deviation < globalStd * 0.3) {
        breakpointIdx = i + 1;
        break;
      }
    }
    breakpointIdx = Math.max(1, Math.min(n - 2, breakpointIdx));

    // Calculer les moyennes avant/après le breakpoint
    const beforeValues = values.slice(Math.max(0, breakpointIdx - 5), breakpointIdx);
    const afterValues = values.slice(breakpointIdx);

    if (beforeValues.length < 2 || afterValues.length < 2) continue;

    const beforeMean = beforeValues.reduce((a, b) => a + b, 0) / beforeValues.length;
    const afterMean = afterValues.reduce((a, b) => a + b, 0) / afterValues.length;

    if (beforeMean === 0) continue;
    const changePct = ((afterMean - beforeMean) / beforeMean) * 100;

    // Filtrer les changements trop faibles
    if (Math.abs(changePct) < metric.minChangePct) continue;

    // Vérifier si c'est structurel (≥3 jours consécutifs dans le nouveau régime)
    const daysInNewRegime = afterValues.length;
    const isStructural = daysInNewRegime >= 3;

    // Confiance basée sur la cohérence du nouveau régime
    const afterStd = afterValues.length > 1
      ? Math.sqrt(afterValues.reduce((a, v) => a + (v - afterMean) ** 2, 0) / afterValues.length)
      : globalStd;
    const coherence = afterMean !== 0 ? 1 - Math.min(1, afterStd / Math.abs(afterMean)) : 0;
    const confidence = Math.min(0.95, coherence * 0.6 + (isStructural ? 0.3 : 0.1) + Math.min(0.1, daysInNewRegime * 0.02));

    const direction = changePct > 0 ? "up" as const : "down" as const;
    const breakpointDate = days[breakpointIdx].date;

    // Message trader-friendly
    const metricKey = metric.key === "cpmRev" ? "cpmRevenue" : metric.key;
    const fmtBefore = metric.key === "margin" ? `${beforeMean.toFixed(1)}%` : `${beforeMean.toFixed(2)} ${currSym}`;
    const fmtAfter = metric.key === "margin" ? `${afterMean.toFixed(1)}%` : `${afterMean.toFixed(2)} ${currSym}`;

    let message: string;
    if (isStructural) {
      message = `🔄 CHANGEMENT DE RÉGIME : ${metric.label} est passé de ${fmtBefore} à ${fmtAfter} (${changePct > 0 ? "+" : ""}${changePct.toFixed(0)}%) depuis le ${new Date(breakpointDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}. Ce shift dure depuis ${daysInNewRegime}j — c'est structurel, pas un outlier.`;
    } else {
      message = `⚡ SHIFT RÉCENT : ${metric.label} ${direction === "up" ? "en hausse" : "en baisse"} de ${Math.abs(changePct).toFixed(0)}% depuis ${daysInNewRegime}j (${fmtBefore} → ${fmtAfter}). À confirmer.`;
    }

    results.push({
      metric: metricKey as RegimeChange["metric"],
      metricLabel: metric.label,
      breakpointDate,
      direction,
      beforeMean,
      afterMean,
      changePct,
      confidence,
      daysInNewRegime,
      isStructural,
      message,
    });
  }

  // Trier par confiance décroissante
  return results.sort((a, b) => b.confidence - a.confidence);
}

// --- STATS PAR GROUPE (Ad Group / Sous-Campagne / Global) ---
// 🔥 V8.2 : Supporte les 3 modes de tracking
export function computeAdGroupStats(project: any): AdGroupStats[] | null {
  if (!project.dailyEntries || project.dailyEntries.length === 0) return null;

  const trackingMode = project.trackingMode || "global";
  const isFin = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
  const targetKpi = project.targetKpi || 0;

  // 🔥 V8.2 : Grouper selon le mode de suivi
  const groups = new Map<string, any[]>();

  if (trackingMode === "adgroup") {
    // Mode Ad Group : grouper par entry.adGroup
    for (const entry of project.dailyEntries) {
      const ag = entry.adGroup || "__global__";
      if (!groups.has(ag)) groups.set(ag, []);
      groups.get(ag)!.push(entry);
    }
    if (groups.size === 1 && groups.has("__global__")) return null;
  } else if (trackingMode === "campaign") {
    // Mode Sous-Campagne : grouper par entry.subCampaign
    for (const entry of project.dailyEntries) {
      const sc = entry.subCampaign || "__global__";
      if (!groups.has(sc)) groups.set(sc, []);
      groups.get(sc)!.push(entry);
    }
    if (groups.size === 1 && groups.has("__global__")) return null;
  } else {
    // Mode Global : une seule série = toute la campagne
    if (project.dailyEntries.length < 5) return null;
    groups.set(project.name || "Campagne", [...project.dailyEntries]);
  }

  const results: AdGroupStats[] = [];
  for (const [name, entries] of groups) {
    if (name === "__global__") continue;
    const sorted = [...entries].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // 🔥 V8.2 : En mode global, agréger par date d'abord (éviter doublons)
    let effectiveSorted = sorted;
    if (trackingMode === "global") {
      const dailyAgg = new Map<string, any>();
      for (const e of sorted) {
        const ex = dailyAgg.get(e.date);
        if (ex) {
          const ts = ex.budgetSpent + e.budgetSpent;
          ex.kpiActual = ts > 0 ? (ex.kpiActual * ex.budgetSpent + e.kpiActual * e.budgetSpent) / ts : 0;
          ex.marginPct = ts > 0 ? (ex.marginPct * ex.budgetSpent + e.marginPct * e.budgetSpent) / ts : 0;
          ex.budgetSpent = ts;
          ex.cpmRevenue = ts > 0 ? (ex.cpmRevenue * (ts - e.budgetSpent) + e.cpmRevenue * e.budgetSpent) / ts : 0;
        } else {
          dailyAgg.set(e.date, { ...e });
        }
      }
      effectiveSorted = [...dailyAgg.values()].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }

    const totalSpend = effectiveSorted.reduce((s: number, e: any) => s + e.budgetSpent, 0);
    const totalGain = effectiveSorted.reduce((s: number, e: any) => s + e.budgetSpent * (e.marginPct / 100), 0);
    const avgMargin = totalSpend > 0 ? (totalGain / totalSpend) * 100 : 0;
    let avgKpi = 0;
    if (totalSpend > 0) {
      if (isFin) { const ta = effectiveSorted.reduce((s: number, e: any) => e.kpiActual > 0 ? s + e.budgetSpent / e.kpiActual : s, 0); avgKpi = ta > 0 ? totalSpend / ta : 0; }
      else { avgKpi = effectiveSorted.reduce((s: number, e: any) => s + e.budgetSpent * e.kpiActual, 0) / totalSpend; }
    }
    const kpiValues = effectiveSorted.map((e: any) => e.kpiActual);
    const kpiStd = stdDev(kpiValues);
    const { tag: funnelTag, confidence: funnelConfidence } = detectFunnelTag(name);
    let perfCategory: AdGroupStats["perfCategory"] = "ok";
    let perfScoreContinuous = 5.0;
    if (targetKpi > 0 && avgKpi > 0) {
      perfScoreContinuous = continuousPerfScore(avgKpi, targetKpi, isFin);
      perfCategory = scoreToCategoryFromContinuous(perfScoreContinuous);
    } else if (avgKpi === 0 && totalSpend > 0) {
      perfCategory = "dead";
      perfScoreContinuous = 0;
    }
    let perfStability = 0.5;
    if (effectiveSorted.length >= 6) {
      const third = Math.floor(effectiveSorted.length / 3);
      const chunks = [effectiveSorted.slice(0, third), effectiveSorted.slice(third, third * 2), effectiveSorted.slice(third * 2)];
      let same = 0;
      for (const chunk of chunks) {
        const cs = chunk.reduce((s: number, e: any) => s + e.budgetSpent, 0);
        const ck = isFin ? (cs > 0 ? cs / Math.max(0.001, chunk.reduce((s: number, e: any) => e.kpiActual > 0 ? s + e.budgetSpent / e.kpiActual : s, 0)) : 0) : (cs > 0 ? chunk.reduce((s: number, e: any) => s + e.budgetSpent * e.kpiActual, 0) / cs : 0);
        if (targetKpi <= 0 || ck <= 0) { same++; continue; }
        const r = isFin ? targetKpi / ck : ck / targetKpi;
        const cc = r >= 1.5 ? "star" : r >= 1.2 ? "good" : r >= 0.9 ? "ok" : r >= 0.7 ? "underperforming" : "dead";
        if (cc === perfCategory) same++;
      }
      perfStability = same / 3;
    }
    let marginKpiElasticity = 0, elasticityConfidence = 0;
    if (effectiveSorted.length >= 5) {
      const mD: number[] = [], kD: number[] = [], rDates: string[] = [];
      for (let i = 1; i < effectiveSorted.length; i++) {
        const md = effectiveSorted[i].marginPct - effectiveSorted[i - 1].marginPct;
        if (Math.abs(md) > 0.5 && effectiveSorted[i - 1].kpiActual > 0) {
          mD.push(md);
          kD.push((effectiveSorted[i].kpiActual - effectiveSorted[i - 1].kpiActual) / effectiveSorted[i - 1].kpiActual);
          rDates.push(effectiveSorted[i].date);
        }
      }
      if (mD.length >= 3) {
        // 🔥 V10.0 : Régression pondérée par récence (demi-vie 7 jours)
        const reg = weightedLinearRegression(mD, kD, rDates, 7);
        marginKpiElasticity = reg.slope;
        elasticityConfidence = reg.rSquared;
      }
    }
    let marginCeiling = 95, optLow = 10, optHigh = 70;
    if (effectiveSorted.length >= 5 && targetKpi > 0) {
      const pairs = effectiveSorted.filter((e: any) => e.kpiActual > 0 && e.marginPct > 0).map((e: any) => ({ margin: e.marginPct, kpi: e.kpiActual }));
      if (pairs.length >= 5) {
        const sbm = [...pairs].sort((a, b) => a.margin - b.margin);
        for (let i = sbm.length - 1; i >= 0; i--) { const ok = isFin ? sbm[i].kpi <= targetKpi * 1.15 : sbm[i].kpi >= targetKpi * 0.85; if (ok) { marginCeiling = sbm[i].margin; break; } }
        const okM = pairs.filter((p: any) => isFin ? p.kpi <= targetKpi * 1.15 : p.kpi >= targetKpi * 0.85).map((p: any) => p.margin);
        if (okM.length >= 2) { optLow = Math.min(...okM); optHigh = Math.max(...okM); }
      }
    }
    let calibratedMarginIncrement = getDefaultIncrement(perfCategory);
    if (elasticityConfidence > 0.3) {
      const ef = Math.abs(marginKpiElasticity);
      const mult = ef < 0.02 ? 1.5 : ef < 0.05 ? 1.2 : ef < 0.1 ? 1.0 : ef < 0.2 ? 0.7 : 0.5;
      calibratedMarginIncrement *= mult;
    }
    if (marginCeiling < 95) calibratedMarginIncrement = Math.min(calibratedMarginIncrement, Math.max(0, (marginCeiling - avgMargin) * 0.8));
    const calibratedVolatility = avgKpi > 0 ? kpiStd / avgKpi : 0.2;
    const insights: string[] = [];
    if (funnelTag !== "unknown") insights.push(`🏷️ ${funnelTag.toUpperCase()}`);
    if (perfStability >= 0.8) insights.push(`📊 ${perfCategory} stable`);
    else if (perfStability < 0.4) insights.push(`⚠️ Instable`);
    if (elasticityConfidence > 0.3) insights.push(`📐 Élast. ${(marginKpiElasticity * 100).toFixed(1)}%/pt`);
    if (marginCeiling < 80) insights.push(`🚧 Plafond ${marginCeiling.toFixed(0)}%`);
    results.push({ name, funnelTag, funnelConfidence, totalSpend, totalGain, avgMargin, avgKpi, kpiValues, kpiStdDev: kpiStd, daysTracked: effectiveSorted.length, avgDailySpend: totalSpend / Math.max(1, effectiveSorted.length), perfCategory, perfStability, marginKpiElasticity, elasticityConfidence, marginCeiling, optimalMarginRange: [optLow, optHigh], calibratedMarginIncrement, calibratedVolatility, learningInsight: insights.join(" | ") });
  }
  return results.sort((a, b) => b.totalSpend - a.totalSpend);
}

// --- STATS CAMPAGNE GLOBALE ---
export function computeCampaignLearningStats(project: any): CampaignLearningStats | null {
  const entries = project.dailyEntries;
  if (!entries || entries.length < 5) return null;
  const dailyAgg = new Map<string, { spend: number; kpi: number; margin: number; count: number }>();
  for (const e of entries) {
    const ex = dailyAgg.get(e.date);
    if (ex) { const ts = ex.spend + e.budgetSpent; ex.kpi = (ex.kpi * ex.spend + e.kpiActual * e.budgetSpent) / ts; ex.margin = (ex.margin * ex.spend + e.marginPct * e.budgetSpent) / ts; ex.spend = ts; ex.count++; }
    else dailyAgg.set(e.date, { spend: e.budgetSpent, kpi: e.kpiActual, margin: e.marginPct, count: 1 });
  }
  const days = [...dailyAgg.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, d]) => ({ date, ...d }));
  if (days.length < 5) return null;
  const kC: number[] = [], sC: number[] = [];
  for (let i = 1; i < days.length; i++) {
    if (days[i - 1].kpi > 0) kC.push((days[i].kpi - days[i - 1].kpi) / days[i - 1].kpi);
    if (days[i - 1].spend > 0) sC.push((days[i].spend - days[i - 1].spend) / days[i - 1].spend);
  }
 const mD: number[] = [], kD: number[] = [], elDates: string[] = [];
  for (let i = 1; i < days.length; i++) {
    const md = days[i].margin - days[i - 1].margin;
    if (Math.abs(md) > 0.5 && days[i - 1].kpi > 0) {
      mD.push(md);
      kD.push((days[i].kpi - days[i - 1].kpi) / days[i - 1].kpi);
      elDates.push(days[i].date);
    }
  }
  // 🔥 V10.0 : Régression pondérée par récence
  const el = mD.length >= 3 ? weightedLinearRegression(mD, kD, elDates, 7) : { slope: 0, rSquared: 0 };
  const dowS: Record<number, number[]> = {};
  for (const d of days) { const dow = new Date(d.date).getDay(); if (!dowS[dow]) dowS[dow] = []; dowS[dow].push(d.spend); }
  const oa = mean(days.map(d => d.spend));
  const bestD = Object.entries(dowS).filter(([, s]) => mean(s) > oa * 1.1).map(([d]) => Number(d));
  const worstD = Object.entries(dowS).filter(([, s]) => mean(s) < oa * 0.9).map(([d]) => Number(d));
  const isFin = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
  let mc = 95, ol = 10, oh = 70;
  if (project.targetKpi > 0) {
    const pairs = days.filter(d => d.kpi > 0 && d.margin > 0).map(d => ({ margin: d.margin, kpi: d.kpi }));
    if (pairs.length >= 5) {
      const sbm = [...pairs].sort((a, b) => a.margin - b.margin);
      for (let i = sbm.length - 1; i >= 0; i--) { const ok = isFin ? sbm[i].kpi <= project.targetKpi * 1.15 : sbm[i].kpi >= project.targetKpi * 0.85; if (ok) { mc = sbm[i].margin; break; } }
      const okM = pairs.filter(p => isFin ? p.kpi <= project.targetKpi * 1.15 : p.kpi >= project.targetKpi * 0.85).map(p => p.margin);
      if (okM.length >= 2) { ol = Math.min(...okM); oh = Math.max(...okM); }
    }
  }
  // 🔬 V10.2 : Fit du modèle de saturation
  const satModel = (() => {
    const isFin_sat = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
    const validDays = days.filter(d => d.margin > 0 && d.kpi > 0);
    if (validDays.length < 5) return null;
    return fitSaturationModel(validDays.map(d => d.margin), validDays.map(d => d.kpi), isFin_sat);
  })();

  return { realKpiVolatility: stdDev(kC), realSpendVolatility: stdDev(sC), marginKpiElasticity: el.slope, elasticityConfidence: el.rSquared, marginCeiling: mc, optimalMarginRange: [ol, oh], bestDaysOfWeek: bestD, worstDaysOfWeek: worstD, saturationModel: satModel };
}

// --- COEFFICIENTS CALIBRÉS ---
export function getCalibratedCoefficients(
  project: any, 
  funnelType: string = "mixed",
  crossCampaignPrior: CrossCampaignPrior | null = null  // 🔥 V10.0
): CalibratedCoefficients {
  const kpi = project.kpiType;
  const cs = computeCampaignLearningStats(project);
  
  // 🔥 V10.0 : Fusion bayésienne avec le prior cross-campagne
  const bayesian = getBayesianElasticity(cs, crossCampaignPrior);
  
  if (cs && cs.elasticityConfidence > 0.3) {
    const v = cs.realKpiVolatility;
    return {
      marginImpact: Math.min(0.8, Math.max(0.1, Math.abs(bayesian.elasticity) * 10)),
      volatility: v > 0 ? Math.min(0.5, v) : gV(kpi),
      competition: v > 0 ? Math.min(0.5, v * 1.5) : gV(kpi) * 1.5,
      bidImpactFactor: gB(kpi),
      reachElasticity: gR(funnelType),
      source: "campaign_learning",
      confidence: bayesian.confidence,
      insight: `Calibré bayésien: ${bayesian.source} (conf=${bayesian.confidence.toFixed(2)})`
    };
  }
  
  // 🔥 V10.0 : Si pas de données campagne MAIS prior disponible → utiliser le prior
  if (crossCampaignPrior && crossCampaignPrior.sampleSize >= 3) {
    return {
      marginImpact: Math.min(0.8, Math.max(0.1, Math.abs(crossCampaignPrior.avgElasticity) * 10)),
      volatility: crossCampaignPrior.avgVolatility > 0 ? Math.min(0.5, crossCampaignPrior.avgVolatility) : gV(kpi),
      competition: crossCampaignPrior.avgVolatility > 0 ? Math.min(0.5, crossCampaignPrior.avgVolatility * 1.5) : gV(kpi) * 1.5,
      bidImpactFactor: gB(kpi),
      reachElasticity: gR(funnelType),
      source: "campaign_learning", // Apparaît comme calibré (car c'est le prior cross-campagne)
      confidence: crossCampaignPrior.confidence * 0.6,
      insight: `🧬 Prior: ${crossCampaignPrior.sampleSize} campagnes ${kpi} (conf=${(crossCampaignPrior.confidence * 0.6).toFixed(2)})`
    };
  }
  
  return { marginImpact: gM(kpi), volatility: gV(kpi), competition: gV(kpi) * 1.5, bidImpactFactor: gB(kpi), reachElasticity: gR(funnelType), source: "default", confidence: 0.3, insight: "Coefficients par défaut" };
}

// --- INSIGHTS ---
// 🔥 V8.2 : Labels adaptés au mode de tracking
export function generateLearningInsights(project: any): string[] {
  const insights: string[] = [];
  const cs = computeCampaignLearningStats(project);
  if (cs) {
    if (cs.realKpiVolatility > 0) { const l = cs.realKpiVolatility > 0.2 ? "HAUTE" : cs.realKpiVolatility > 0.1 ? "MOYENNE" : "FAIBLE"; insights.push(`📊 Volatilité KPI ${l} (${(cs.realKpiVolatility * 100).toFixed(1)}%/jour)`); }
    if (cs.elasticityConfidence > 0.3) { const d = cs.marginKpiElasticity > 0 ? "hausse" : "baisse"; insights.push(`📐 Marge ↑1pt → KPI ${d} ${(Math.abs(cs.marginKpiElasticity) * 100).toFixed(1)}%`); }
    if (cs.marginCeiling < 80) insights.push(`🚧 Plafond marge : ${cs.marginCeiling.toFixed(0)}%`);
    insights.push(`🎯 Zone optimale : ${cs.optimalMarginRange[0].toFixed(0)}-${cs.optimalMarginRange[1].toFixed(0)}%`);
  }
  const ag = computeAdGroupStats(project);
  if (ag && ag.length > 0) {
    const trackingMode = project.trackingMode || "global";
    const groupLabel = trackingMode === "adgroup" ? "ad groups" : trackingMode === "campaign" ? "sous-campagnes" : "séries";
    insights.push(`🧠 ${ag.length} ${groupLabel} analysé${ag.length > 1 ? "s" : ""}`);
    const tags: Record<string, number> = {}; ag.forEach(a => { tags[a.funnelTag] = (tags[a.funnelTag] || 0) + 1; });
    const ts = Object.entries(tags).filter(([t]) => t !== "unknown").map(([t, c]) => `${t}: ${c}`).join(", ");
    if (ts) insights.push(`🏷️ Funnel : ${ts}`);
    const stars = ag.filter(a => a.perfCategory === "star" && a.perfStability >= 0.6);
    if (stars.length > 0) insights.push(`⭐ Stars : ${stars.map(s => s.name).slice(0, 3).join(", ")}`);
    const dead = ag.filter(a => a.perfCategory === "dead" && a.daysTracked >= 3);
    if (dead.length > 0) insights.push(`💀 Dead : ${dead.map(s => s.name).slice(0, 3).join(", ")}`);
  }
  return insights;
}

// --- ENRICHIR UN LINE ITEM ---
export function enrichLineItemFromLearning(li: any, agStats: AdGroupStats[] | null, kpiType: string, targetKpi: number, campaignMargin: number): { learnedCategory: "dead" | "underperforming" | "ok" | "good" | "star"; categoryConfidence: number; calibratedIncrement: number; calibratedVolatility: number; detectedFunnel: FunnelTag; insight: string; } {
  const match = agStats?.find(ag => { const al = ag.name.toLowerCase().trim(), ll = li.name.toLowerCase().trim(); return al === ll || al.includes(ll) || ll.includes(al); });
  if (match && match.daysTracked >= 3) {
    const cs = computePerfScore(li.kpiActual, targetKpi, kpiType);
    const hs = catToScore(match.perfCategory);
    const blended = cs * 0.6 + hs * 0.4;
    let inc = match.calibratedMarginIncrement;
    if (campaignMargin > 0) { const gr = (li.marginPct - campaignMargin) / campaignMargin; inc *= Math.max(0.2, Math.min(1.5, 1 - gr)); }
    return { learnedCategory: scoreToCat(blended), categoryConfidence: match.perfStability, calibratedIncrement: inc, calibratedVolatility: match.calibratedVolatility, detectedFunnel: match.funnelTag, insight: match.learningInsight };
  }
  // 🔥 V8.2 : En mode global, utiliser les stats campagne si 1 seul groupe disponible
  if (agStats && agStats.length === 1 && agStats[0].daysTracked >= 5) {
    const campStats = agStats[0];
    return {
      learnedCategory: campStats.perfCategory,
      categoryConfidence: campStats.perfStability,
      calibratedIncrement: campStats.calibratedMarginIncrement,
      calibratedVolatility: campStats.calibratedVolatility,
      detectedFunnel: detectFunnelTag(li.name).tag,
      insight: campStats.learningInsight,
    };
  }
  const { tag } = detectFunnelTag(li.name);
  const score = computePerfScore(li.kpiActual, targetKpi, kpiType);
  return { learnedCategory: scoreToCat(score), categoryConfidence: 0.3, calibratedIncrement: getDefaultIncrement(scoreToCat(score)), calibratedVolatility: gV(kpiType), detectedFunnel: tag, insight: tag !== "unknown" ? `🏷️ ${tag.toUpperCase()}` : "" };
}
// ============================================================
// 📊 V10.1 : RISK-ADJUSTED SCORING (Sharpe Ratio du Trading)
// ============================================================

/**
 * Calcule un multiplicateur de risque inspiré du Sharpe Ratio.
 * 
 * Sharpe Ratio = (Return - RiskFreeRate) / Volatility
 * Ici : riskMultiplier = 1 / (1 + volatility × riskAversion)
 * 
 * @param volatility - Écart-type du KPI en fraction (0.10 = 10%, 0.30 = 30%)
 * @param riskAversion - Sensibilité au risque (2.0 = modéré, 4.0 = conservateur)
 * @returns Multiplicateur [0.20 - 1.0] appliqué au score de performance
 * 
 * Exemples avec riskAversion=2.0 :
 *   volatility=0.02 (2%)  → 0.96 (quasi pas de pénalité)
 *   volatility=0.05 (5%)  → 0.91
 *   volatility=0.10 (10%) → 0.83
 *   volatility=0.20 (20%) → 0.71
 *   volatility=0.30 (30%) → 0.63
 *   volatility=0.50 (50%) → 0.50
 */
export function riskAdjustMultiplier(
  volatility: number,
  riskAversion: number = 2.0
): number {
  // Pas assez de données → pas de pénalité
  if (volatility <= 0.01) return 1.0;
  
  // Clamp volatility à 1.0 max (100% = ligne complètement aléatoire)
  const clampedVol = Math.min(1.0, Math.max(0, volatility));
  
  // Formule Sharpe-inspired : pénalise proportionnellement à la volatilité
  const multiplier = 1 / (1 + clampedVol * riskAversion);
  
  // Plancher à 0.20 : même une ligne très volatile garde 20% de son score
  // (pour ne pas l'éliminer complètement, le trader peut avoir des raisons)
  return Math.max(0.20, multiplier);
}

/**
 * Version composée : applique le risk adjustment directement sur un score.
 * Retourne aussi le détail pour affichage UI.
 */
export function computeRiskAdjustedScore(
  rawScore: number,
  volatility: number,
  riskAversion: number = 2.0
): { adjustedScore: number; riskMultiplier: number; riskLevel: "low" | "medium" | "high" } {
  const riskMultiplier = riskAdjustMultiplier(volatility, riskAversion);
  const adjustedScore = rawScore * riskMultiplier;
  
  const riskLevel: "low" | "medium" | "high" = 
    volatility <= 0.10 ? "low" : 
    volatility <= 0.25 ? "medium" : "high";
  
  return { adjustedScore, riskMultiplier, riskLevel };
}
// --- HELPERS ---
function computePerfScore(kpi: number, target: number, kpiType: string): number {   const isFin = !["Viewability", "VTR", "CTR"].includes(kpiType);   return continuousPerfScore(kpi, target, isFin); }
function catToScore(c: string): number { switch (c) { case "star": return 5; case "good": return 4; case "ok": return 2.5; case "underperforming": return 1; case "dead": return 0; default: return 2.5; } }
function scoreToCat(s: number): "dead" | "underperforming" | "ok" | "good" | "star" {   return scoreToCategoryFromContinuous(s); }
function getDefaultIncrement(c: string): number { switch (c) { case "star": return 15; case "good": return 10; case "ok": return 5; case "underperforming": return 2; case "dead": return 0; default: return 5; } }
function gM(k: string): number { const d: Record<string, number> = { CPCV: 0.42, CPA: 0.48, CPC: 0.45, CPV: 0.40, CPM: 0.28, CTR: 0.18, VTR: 0.25, Viewability: 0.12 }; return d[k] || 0.40; }
function gV(k: string): number { const d: Record<string, number> = { CPCV: 0.25, CPA: 0.30, CPC: 0.28, CPV: 0.22, CPM: 0.15, CTR: 0.12, VTR: 0.15, Viewability: 0.08 }; return d[k] || 0.20; }
function gB(k: string): number { const d: Record<string, number> = { CPCV: 0.55, CPA: 0.65, CPC: 0.60, CPV: 0.58, CPM: 0.40, CTR: 0.25, VTR: 0.35, Viewability: 0.20 }; return d[k] || 0.50; }
function gR(f: string): number { switch (f) { case "retargeting": return 0.93; case "prospecting": return 0.60; case "awareness": return 0.55; case "conversion": return 0.90; default: return 0.85; } }
