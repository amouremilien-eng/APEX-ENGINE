// ============================================================
// 🎯 BidShadingPanel.tsx — Bloomberg Terminal Ads V1.0
// Comparateur 3 Scénarios avec Fourchette Optimiste/Pessimiste
// ============================================================
//
// REMPLACE la grille Option 1 / Option 2 dans CockpitYield.tsx
// S'insère entre le slider de marge et le score de risque client
//
// INTÉGRATION :
//   1. Importer ce composant dans CockpitYield.tsx
//   2. Remplacer le bloc {/* COMPARAISON OPTIONS */} (grid grid-cols-2)
//      par <BidShadingPanel ... />
//   3. Le composant gère internement les 3 scénarios + Optimiste/Pessimiste
// ============================================================

import { useState, useMemo } from "react";
import { cn } from "../utils/cn";
import {
  AlertTriangle, CheckCircle2, TrendingUp, TrendingDown,
  Shield, Target, Zap, Lock, Info, ChevronDown, ChevronUp
} from "lucide-react";
import {
  computeBidShadingScenarios,
  type BidShadingScenario,
  type BidShadingResult,
  type BidShadingWarning,
} from "../BidShadingEngine";
import type { CampaignLearningStats, CrossCampaignPrior } from "../LearningEngine";

// ============================================================
// TYPES
// ============================================================

interface BidShadingPanelProps {
  // Données actuelles
  currentCpmCost: number;
  currentCpmRevenue: number;
  currentMarginPct: number;
  currentKpi: number;
  targetKpi: number;
  cpmSoldCap: number;
  kpiType: string;
  // Marge cible (slider)
  targetMarginPct: number;
  // Contexte campagne
  budgetDailyAvg: number;
  daysRemaining: number;
  currSym: string;
  // Données historiques
  dailySpends?: number[];
  dailyEntries?: Array<{ budgetSpent: number; cpmRevenue: number; marginPct: number; kpiActual: number; date: string }>;
  // LearningEngine
  calibratedStats?: CampaignLearningStats | null;
  crossCampaignPrior?: CrossCampaignPrior | null;
  // Volatilité observée (depuis CockpitYield)
  realKpiVolatility?: number | null;
  realKpiTrendPct?: number | null;
  // Formatage
  fmtKpi: (val: number) => string;
  isFin: boolean;
  // Mode expert
  expertMode?: boolean;
}

// ============================================================
// COMPOSANT PRINCIPAL
// ============================================================

export function BidShadingPanel(props: BidShadingPanelProps) {
  const {
    currentCpmCost, currentCpmRevenue, currentMarginPct, currentKpi,
    targetKpi, cpmSoldCap, kpiType, targetMarginPct,
    budgetDailyAvg, daysRemaining, currSym,
    dailySpends, dailyEntries, calibratedStats, crossCampaignPrior,
    realKpiVolatility, realKpiTrendPct,
    fmtKpi, isFin, expertMode = false,
  } = props;

  const [selectedScenario, setSelectedScenario] = useState<string>("shading_optimal");
  const [showDetails, setShowDetails] = useState(false);

  // --- CALCUL DES 3 SCÉNARIOS ---
  const result: BidShadingResult = useMemo(() => {
    return computeBidShadingScenarios(
      currentCpmCost, currentCpmRevenue, currentMarginPct, currentKpi,
      targetKpi, cpmSoldCap, kpiType, targetMarginPct,
      budgetDailyAvg, daysRemaining,
      dailySpends, dailyEntries, calibratedStats, crossCampaignPrior,
      realKpiVolatility, realKpiTrendPct
    );
  }, [
    currentCpmCost, currentCpmRevenue, currentMarginPct, currentKpi,
    targetKpi, cpmSoldCap, kpiType, targetMarginPct,
    budgetDailyAvg, daysRemaining,
    dailySpends?.length, dailyEntries?.length,
    calibratedStats?.elasticityConfidence,
    realKpiVolatility, realKpiTrendPct,
  ]);

  const { scenarios, winRateCurve, marketContext } = result;

  // --- SCÉNARIO RECOMMANDÉ ---
  // Le scénario avec le meilleur ratio gain/risque
  const recommended = useMemo(() => {
    const scored = scenarios.map(s => {
      let score = s.gainDeltaVsCurrent;
      if (s.capRespected) score += 500;
      if (s.warnings.some(w => w.severity === "danger")) score -= 2000;
      if (s.warnings.some(w => w.severity === "warning")) score -= 500;
      if (s.id === "shading_optimal") score += 200; // Léger bonus pour l'optimal
      return { ...s, _score: score };
    });
    scored.sort((a, b) => b._score - a._score);
    return scored[0]?.id || "shading_optimal";
  }, [scenarios]);

  // --- COULEURS PAR SCÉNARIO ---
  const SCENARIO_STYLES: Record<string, { border: string; bg: string; accent: string; text: string; badge: string }> = {
    stable: {
      border: "border-purple-200", bg: "bg-purple-50", accent: "bg-purple-100 text-purple-600",
      text: "text-purple-900", badge: "bg-purple-600",
    },
    shading_optimal: {
      border: "border-blue-200", bg: "bg-blue-50", accent: "bg-blue-100 text-blue-600",
      text: "text-blue-900", badge: "bg-gradient-to-r from-blue-600 to-indigo-600",
    },
    aggressive: {
      border: "border-pink-200", bg: "bg-pink-50", accent: "bg-pink-100 text-pink-600",
      text: "text-pink-900", badge: "bg-pink-600",
    },
  };

  return (
    <div className="space-y-4">
      {/* HEADER — Contexte Marché */}
      <div className="bg-gradient-to-r from-slate-50 to-gray-50 border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gray-900 text-white rounded-lg flex items-center justify-center text-xs font-black">BS</div>
            <div>
              <h4 className="font-black text-gray-900 text-sm">Bid Shading Engine</h4>
              <p className="text-[10px] text-gray-500">
                Confiance : {(winRateCurve.confidence * 100).toFixed(0)}% ({winRateCurve.source})
                {" • "}Marché : {marketContext.estimatedMarketCpm.toFixed(2)} {currSym}
                {" • "}Position : P{marketContext.currentBidPercentile}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn("px-2 py-1 rounded-full text-[10px] font-bold",
              marketContext.competitionLevel === "high" ? "bg-red-100 text-red-700" :
              marketContext.competitionLevel === "medium" ? "bg-amber-100 text-amber-700" :
              "bg-emerald-100 text-emerald-700"
            )}>
              Compétition {marketContext.competitionLevel === "high" ? "Forte" :
                marketContext.competitionLevel === "medium" ? "Moyenne" : "Faible"}
            </span>
            <span className={cn("px-2 py-1 rounded-full text-[10px] font-bold",
              marketContext.currentBidPosition === "below_market" ? "bg-amber-100 text-amber-700" :
              marketContext.currentBidPosition === "above_market" ? "bg-emerald-100 text-emerald-700" :
              "bg-blue-100 text-blue-700"
            )}>
              {marketContext.currentBidPosition === "below_market" ? "Sous le marché" :
               marketContext.currentBidPosition === "above_market" ? "Au-dessus du marché" :
               "Au marché"}
            </span>
          </div>
        </div>
      </div>

      {/* 3 SCÉNARIOS */}
      <div className="grid grid-cols-3 gap-4">
        {scenarios.map((scenario) => {
          const style = SCENARIO_STYLES[scenario.id] || SCENARIO_STYLES.stable;
          const isReco = scenario.id === recommended;
          const isSelected = scenario.id === selectedScenario;

          const meetsTarget_opt = isFin
            ? scenario.kpiOptimistic <= targetKpi
            : scenario.kpiOptimistic >= targetKpi;
          const meetsTarget_pess = isFin
            ? scenario.kpiPessimistic <= targetKpi
            : scenario.kpiPessimistic >= targetKpi;

          return (
            <div
              key={scenario.id}
              onClick={() => setSelectedScenario(scenario.id)}
              className={cn(
                "relative bg-white border-2 rounded-xl p-4 cursor-pointer transition-all",
                isSelected ? `${style.border} ring-2 ring-offset-1 ring-blue-300` : "border-gray-200 hover:border-gray-300",
                isReco && "ring-1 ring-emerald-200"
              )}
            >
              {/* Badge recommandé */}
              {isReco && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[9px] font-black px-2.5 py-0.5 rounded-full whitespace-nowrap">
                  RECOMMANDÉ
                </div>
              )}

              {/* Header */}
              <div className="flex items-center gap-2 mb-3">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black", style.accent)}>
                  {scenario.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <h5 className={cn("font-bold text-sm truncate", style.text)}>{scenario.label}</h5>
                  <p className="text-[10px] text-gray-500 truncate">{scenario.description.slice(0, 50)}</p>
                </div>
              </div>

              {/* CPM Cost (Bid) */}
              <div className={cn("rounded-lg p-2.5 mb-2", style.bg)}>
                <div className="text-[10px] text-gray-500">CPM Cost (Bid)</div>
                <div className={cn("text-lg font-black", style.text)}>
                  {scenario.newCpmCost.toFixed(2)} {currSym}
                </div>
                {scenario.bidAdjustmentPct !== 0 && (
                  <div className={cn("text-[10px] font-bold flex items-center gap-1",
                    scenario.bidAdjustmentPct < 0 ? "text-red-600" : "text-emerald-600"
                  )}>
                    {scenario.bidAdjustmentPct > 0 ? "↑" : "↓"} {Math.abs(scenario.bidAdjustmentPct).toFixed(1)}%
                    {scenario.capRespected && (
                      <span className="bg-emerald-100 text-emerald-700 px-1 py-0.5 rounded text-[8px] font-bold">CAP OK</span>
                    )}
                  </div>
                )}
                {scenario.bidAdjustmentPct === 0 && (
                  <div className="text-[10px] text-emerald-600 font-bold">INCHANGÉ</div>
                )}
              </div>

              {/* CPM Revenue + Marge */}
              <div className="flex items-center justify-between mb-1 px-1">
                <span className="text-[10px] text-gray-500">CPM Revenue</span>
                <span className="text-xs font-bold text-gray-800">{(scenario.newCpmRevenue || 0).toFixed(2)} {currSym}</span>
              </div>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[10px] text-gray-500">Marge</span>
                <span className={cn("text-xs font-bold", scenario.effectiveMarginPct >= 40 ? "text-emerald-600" : scenario.effectiveMarginPct >= 20 ? "text-blue-600" : "text-amber-600")}>
                  {(scenario.effectiveMarginPct || 0).toFixed(1)}%
                </span>
              </div>

              {/* KPI Optimiste / Pessimiste */}
              <div className="bg-gradient-to-br from-gray-50 to-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-bold text-gray-700 flex items-center justify-between">
                  <span>{kpiType} Projeté</span>
                  <span className={cn("text-white px-1.5 py-0.5 rounded text-[8px]", style.badge)}>
                    {scenario.id === "stable" ? "EXACT" :
                     scenario.id === "shading_optimal" ? "OPTIMAL" : "AGRESSIF"}
                  </span>
                </div>

                {/* Optimiste */}
                <div className={cn("p-2 rounded border",
                  meetsTarget_opt ? "bg-emerald-50 border-emerald-300" : "bg-orange-50 border-orange-300"
                )}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[9px] font-bold text-gray-600">😊 Optimiste</span>
                    {meetsTarget_opt
                      ? <span className="text-emerald-600 text-[10px]">✓</span>
                      : <span className="text-orange-600 text-[10px]">⚠</span>}
                  </div>
                  <div className={cn("text-base font-black",
                    meetsTarget_opt ? "text-emerald-600" : "text-orange-600"
                  )}>
                    {fmtKpi(scenario.kpiOptimistic)}
                  </div>
                </div>

                {/* Pessimiste */}
                <div className={cn("p-2 rounded border",
                  meetsTarget_pess ? "bg-emerald-50 border-emerald-300" : "bg-red-50 border-red-300"
                )}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[9px] font-bold text-gray-600">😰 Pessimiste</span>
                    {meetsTarget_pess
                      ? <span className="text-emerald-600 text-[10px]">✓</span>
                      : <span className="text-red-600 text-[10px]">✗</span>}
                  </div>
                  <div className={cn("text-base font-black",
                    meetsTarget_pess ? "text-emerald-600" : "text-red-600"
                  )}>
                    {fmtKpi(scenario.kpiPessimistic)}
                  </div>
                </div>

                <div className="text-[9px] text-gray-500 pt-1 border-t border-gray-100">
                  Objectif : <strong>{fmtKpi(targetKpi)}</strong>
                </div>
              </div>

              {/* Gain */}
              <div className={cn("mt-2 rounded-lg p-2.5 text-center",
                scenario.gainDeltaVsCurrent >= 0 ? "bg-emerald-50" : "bg-red-50"
              )}>
                <div className="text-[10px] text-gray-500">Gain additionnel</div>
                <div className={cn("text-sm font-black",
                  scenario.gainDeltaVsCurrent >= 0 ? "text-emerald-600" : "text-red-600"
                )}>
                  {scenario.gainDeltaVsCurrent >= 0 ? "+" : ""}{scenario.gainDeltaVsCurrent.toFixed(0)} {currSym}
                </div>
                <div className="text-[9px] text-gray-400">sur {daysRemaining}j restants</div>
              </div>

              {/* Warnings */}
              {scenario.warnings.length > 0 && (
                <div className="mt-2 space-y-1">
                  {scenario.warnings.slice(0, 2).map((w, i) => (
                    <div key={i} className={cn("text-[9px] rounded px-2 py-1 flex items-center gap-1",
                      w.severity === "danger" ? "bg-red-50 text-red-700" :
                      w.severity === "warning" ? "bg-amber-50 text-amber-700" :
                      "bg-blue-50 text-blue-700"
                    )}>
                      <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                      <span className="truncate">{w.message.slice(0, 60)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* DÉTAILS DU SCÉNARIO SÉLECTIONNÉ */}
      {expertMode && (
        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-200 rounded-xl p-5">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-2 w-full"
          >
            <div className="w-8 h-8 bg-indigo-600 text-white rounded-lg flex items-center justify-center text-xs">💡</div>
            <h5 className="font-black text-indigo-900 text-sm flex-1 text-left">
              Analyse Bid Shading — {scenarios.find(s => s.id === selectedScenario)?.label}
            </h5>
            {showDetails ? <ChevronUp className="w-4 h-4 text-indigo-600" /> : <ChevronDown className="w-4 h-4 text-indigo-600" />}
          </button>

          {showDetails && (() => {
            const selected = scenarios.find(s => s.id === selectedScenario);
            if (!selected) return null;

            return (
              <div className="mt-4 space-y-3">
                {/* Win Rate Analysis */}
                <div className="bg-white/60 rounded-lg p-3 border border-indigo-100">
                  <p className="font-bold mb-1.5 text-indigo-900 text-xs">📊 Courbe de Win Rate</p>
                  <p className="text-[11px] text-indigo-800 leading-relaxed">
                    Modèle logistique calibré ({winRateCurve.source}) —
                    Win rate actuel : <strong>{(winRateCurve.predict(currentCpmCost) * 100).toFixed(0)}%</strong> à {currentCpmCost.toFixed(2)} {currSym}.
                    Point d'inflexion marché : <strong>{winRateCurve.x0.toFixed(2)} {currSym}</strong> (pente k={winRateCurve.k.toFixed(2)}).
                    {selected.bidAdjustmentPct !== 0 && (
                      <> Avec le nouveau bid à {selected.newCpmCost.toFixed(2)} {currSym}, win rate projeté : <strong>{(selected.winRateEstimated * 100).toFixed(0)}%</strong> ({selected.winRateDelta > 0 ? "+" : ""}{(selected.winRateDelta * 100).toFixed(0)} pts).</>
                    )}
                  </p>
                </div>

                {/* Impact Inventaire */}
                <div className="bg-pink-50/60 rounded-lg p-3 border border-pink-200">
                  <p className="font-bold mb-1.5 text-pink-900 text-xs">🎯 Impact Inventaire</p>
                  <p className="text-[11px] text-pink-800 leading-relaxed">
                    Score qualité inventaire : <strong>{selected.inventoryQualityScore}/100</strong>.
                    {selected.bidAdjustmentPct < -10 && (
                      <> Bid en baisse de {Math.abs(selected.bidAdjustmentPct).toFixed(1)}% → perte de positions premium (above-fold, in-stream video).
                      Impact {kpiType} : fourchette élargie pour refléter l'incertitude du nouvel inventaire.</>
                    )}
                    {selected.bidAdjustmentPct > 10 && (
                      <> Bid en hausse de +{selected.bidAdjustmentPct.toFixed(1)}% → accès à l'inventaire premium.
                      Impact {kpiType} positif attendu, mais attention au coût marginal.</>
                    )}
                    {Math.abs(selected.bidAdjustmentPct) <= 10 && (
                      <> Changement de bid modéré — impact inventaire limité, qualité stable.</>
                    )}
                  </p>
                </div>

                {/* Comparaison Fourchettes */}
                <div className="bg-purple-50/60 rounded-lg p-3 border border-purple-200">
                  <p className="font-bold mb-1.5 text-purple-900 text-xs">📐 Comparaison des Fourchettes</p>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {scenarios.map(s => {
                      const range = Math.abs(s.kpiPessimistic - s.kpiOptimistic);
                      return (
                        <div key={s.id} className="text-center">
                          <div className="text-[9px] font-bold text-gray-600">{s.label}</div>
                          <div className="text-xs font-black text-purple-700">{fmtKpi(range)}</div>
                          <div className="text-[9px] text-gray-400">range</div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-purple-700 mt-2">
                    Bid Stable = impact mathématique pur (range minimal).
                    Bid Shading = optimisation intelligente.
                    Cap-Aligned = approche agressive (range maximal).
                  </p>
                </div>

                {/* Warnings détaillés */}
                {selected.warnings.length > 0 && (
                  <div className="bg-amber-50/60 rounded-lg p-3 border border-amber-200">
                    <p className="font-bold mb-1.5 text-amber-900 text-xs">⚠️ Alertes ({selected.warnings.length})</p>
                    <div className="space-y-1">
                      {selected.warnings.map((w, i) => (
                        <div key={i} className={cn("text-[11px] py-1 px-2 rounded",
                          w.severity === "danger" ? "bg-red-100 text-red-800" :
                          w.severity === "warning" ? "bg-amber-100 text-amber-800" :
                          "bg-blue-100 text-blue-800"
                        )}>
                          {w.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
