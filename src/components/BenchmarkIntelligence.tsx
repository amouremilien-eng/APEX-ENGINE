import { useMemo, useState } from "react";
import { ProjectData } from "../types";
import { cn } from "../utils/cn";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, ScatterChart, Scatter, ZAxis } from "recharts";
import { Brain, Target, TrendingUp, Percent, DollarSign, Award, ChevronDown, ChevronRight, Zap, BarChart3, Activity, Filter, CheckCircle2 } from "lucide-react";

interface BenchmarkIntelligenceProps {
  projects: ProjectData[];
}

interface KPIGroupStats {
  kpiType: string;
  count: number;
  completedCount: number;
  activeCount: number;
  avgMargin: number;
  medianMargin: number;
  bestMargin: number;
  worstMargin: number;
  avgKpiActual: number;
  avgKpiTarget: number;
  kpiAchievementRate: number;
  avgGainPerCampaign: number;
  totalGain: number;
  avgBudget: number;
  totalBudget: number;
  avgDuration: number;
  avgDailyEntries: number;
  topPerformers: { name: string; margin: number; kpiRatio: number; isCompleted: boolean }[];
  marginDistribution: { range: string; count: number; color: string }[];
}

interface InsightCard {
  id: string;
  type: "success" | "warning" | "tip" | "record";
  title: string;
  message: string;
  metric?: string;
  value?: string;
  kpiType?: string;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function BenchmarkIntelligence({ projects }: BenchmarkIntelligenceProps) {
  const [selectedKpiType, setSelectedKpiType] = useState<string>("all");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed">("all");

  // Filtrer les projets qui ont des données exploitables
  const activeProjects = useMemo(() => {
    let filtered = projects.filter(p => p.id && p.budgetTotal > 0 && p.budgetSpent > 0);
    if (statusFilter === "active") filtered = filtered.filter(p => p.status !== "completed");
    if (statusFilter === "completed") filtered = filtered.filter(p => p.status === "completed");
    return filtered;
  }, [projects, statusFilter]);

  // Compteurs globaux
  const completedCount = useMemo(() => projects.filter(p => p.id && p.status === "completed").length, [projects]);
  const activeCount = useMemo(() => projects.filter(p => p.id && p.status !== "completed" && p.budgetTotal > 0).length, [projects]);

  // Calcul de la marge pour un projet
  const getProjectMargin = (p: ProjectData): number => {
    // 🔥 V7.0 : Utiliser finalBalance si campagne terminée
    if (p.status === "completed" && p.finalBalance) {
      return p.finalBalance.realMarginPct;
    }
    if (p.dailyEntries && p.dailyEntries.length > 0) {
      const totalSpent = p.dailyEntries.reduce((s, e) => s + e.budgetSpent, 0);
      if (totalSpent > 0) {
        return p.dailyEntries.reduce((s, e) => s + e.budgetSpent * e.marginPct, 0) / totalSpent;
      }
    }
    if (p.inputMode === "CPM Cost") {
      return p.cpmRevenueActual > 0 ? ((p.cpmRevenueActual - p.cpmCostActuel) / p.cpmRevenueActual) * 100 : 0;
    }
    return p.margeInput;
  };

  // Vérifier si KPI atteint
  const isKpiAchieved = (p: ProjectData): boolean => {
    // 🔥 V7.0 : Utiliser finalBalance si campagne terminée
    if (p.status === "completed" && p.finalBalance) {
      return p.finalBalance.kpiAchieved;
    }
    if (p.targetKpi <= 0 || p.actualKpi <= 0) return false;
    const isFin = !["Viewability", "VTR", "CTR"].includes(p.kpiType);
    return isFin ? p.actualKpi <= p.targetKpi : p.actualKpi >= p.targetKpi;
  };

  const getKpiRatio = (p: ProjectData): number => {
    // 🔥 V7.0 : Utiliser finalBalance si campagne terminée
    if (p.status === "completed" && p.finalBalance) {
      return p.finalBalance.kpiVsTarget;
    }
    if (p.targetKpi <= 0 || p.actualKpi <= 0) return 0;
    const isFin = !["Viewability", "VTR", "CTR"].includes(p.kpiType);
    return isFin ? p.targetKpi / p.actualKpi : p.actualKpi / p.targetKpi;
  };

  // Stats groupées par type de KPI
  const kpiGroups: KPIGroupStats[] = useMemo(() => {
    const kpiTypes = [...new Set(activeProjects.map(p => p.kpiType))];

    return kpiTypes.map(kpiType => {
      const group = activeProjects.filter(p => p.kpiType === kpiType);
      const margins = group.map(p => getProjectMargin(p));
      const gains = group.map(p => p.budgetSpent * (getProjectMargin(p) / 100));
      const kpiAchieved = group.filter(p => isKpiAchieved(p)).length;

      const ranges = [
        { range: "0-15%", min: 0, max: 15, color: "#ef4444" },
        { range: "15-30%", min: 15, max: 30, color: "#f59e0b" },
        { range: "30-50%", min: 30, max: 50, color: "#3b82f6" },
        { range: "50-70%", min: 50, max: 70, color: "#10b981" },
        { range: "70%+", min: 70, max: 100, color: "#8b5cf6" },
      ];

      const marginDistribution = ranges.map(r => ({
        range: r.range,
        count: margins.filter(m => m >= r.min && m < (r.max === 100 ? 101 : r.max)).length,
        color: r.color,
      }));

      const topPerformers = group
        .map(p => ({
          name: p.name,
          margin: getProjectMargin(p),
          kpiRatio: getKpiRatio(p),
          isCompleted: p.status === "completed",
        }))
        .filter(p => p.kpiRatio > 0)
        .sort((a, b) => {
          const aScore = a.kpiRatio >= 1 ? 1000 + a.margin : a.margin;
          const bScore = b.kpiRatio >= 1 ? 1000 + b.margin : b.margin;
          return bScore - aScore;
        })
        .slice(0, 5);

      const avgKpiActual = group.length > 0
        ? group.reduce((s, p) => s + p.actualKpi, 0) / group.length : 0;
      const avgKpiTarget = group.length > 0
        ? group.filter(p => p.targetKpi > 0).reduce((s, p) => s + p.targetKpi, 0) / Math.max(1, group.filter(p => p.targetKpi > 0).length) : 0;

      return {
        kpiType,
        count: group.length,
        completedCount: group.filter(p => p.status === "completed").length,
        activeCount: group.filter(p => p.status !== "completed").length,
        avgMargin: margins.length > 0 ? margins.reduce((a, b) => a + b, 0) / margins.length : 0,
        medianMargin: median(margins),
        bestMargin: margins.length > 0 ? Math.max(...margins) : 0,
        worstMargin: margins.length > 0 ? Math.min(...margins) : 0,
        avgKpiActual,
        avgKpiTarget,
        kpiAchievementRate: group.length > 0 ? (kpiAchieved / group.length) * 100 : 0,
        avgGainPerCampaign: gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : 0,
        totalGain: gains.reduce((a, b) => a + b, 0),
        avgBudget: group.length > 0 ? group.reduce((s, p) => s + p.budgetTotal, 0) / group.length : 0,
        totalBudget: group.reduce((s, p) => s + p.budgetTotal, 0),
        avgDuration: group.length > 0 ? group.reduce((s, p) => s + p.durationDays, 0) / group.length : 0,
        avgDailyEntries: group.length > 0 ? group.reduce((s, p) => s + (p.dailyEntries?.length || 0), 0) / group.length : 0,
        topPerformers,
        marginDistribution,
      };
    }).sort((a, b) => b.count - a.count);
  }, [activeProjects]);

  // Stats globales
  const globalStats = useMemo(() => {
    if (activeProjects.length === 0) return null;
    const margins = activeProjects.map(p => getProjectMargin(p));
    const totalGain = activeProjects.reduce((s, p) => s + p.budgetSpent * (getProjectMargin(p) / 100), 0);
    const kpiAchieved = activeProjects.filter(p => isKpiAchieved(p)).length;
    const totalBudget = activeProjects.reduce((s, p) => s + p.budgetTotal, 0);
    const totalSpent = activeProjects.reduce((s, p) => s + p.budgetSpent, 0);

    let bestCampaign = activeProjects[0];
    let bestGain = 0;
    activeProjects.forEach(p => {
      const g = p.budgetSpent * (getProjectMargin(p) / 100);
      if (g > bestGain) { bestGain = g; bestCampaign = p; }
    });

    let bestKpiCampaign = activeProjects[0];
    let bestKpiRatio = 0;
    activeProjects.forEach(p => {
      const r = getKpiRatio(p);
      if (r > bestKpiRatio) { bestKpiRatio = r; bestKpiCampaign = p; }
    });

    return {
      totalCampaigns: activeProjects.length,
      avgMargin: margins.reduce((a, b) => a + b, 0) / margins.length,
      medianMargin: median(margins),
      totalGain,
      kpiAchievementRate: (kpiAchieved / activeProjects.length) * 100,
      totalBudget,
      totalSpent,
      bestCampaignName: bestCampaign.name,
      bestCampaignGain: bestGain,
      bestKpiCampaignName: bestKpiCampaign.name,
      bestKpiRatio,
      kpiTypes: [...new Set(activeProjects.map(p => p.kpiType))],
    };
  }, [activeProjects]);

  // Génération d'insights
  const insights: InsightCard[] = useMemo(() => {
    const cards: InsightCard[] = [];
    kpiGroups.forEach(group => {
      if (group.count < 2) return;
      if (group.kpiAchievementRate >= 80) {
        cards.push({ id: `success_${group.kpiType}`, type: "success", title: `${group.kpiType} : Excellente maîtrise`, message: `Sur vos ${group.count} campagnes ${group.kpiType}, l'objectif KPI est atteint dans ${group.kpiAchievementRate.toFixed(0)}% des cas avec une marge moyenne de ${group.avgMargin.toFixed(1)}%.`, kpiType: group.kpiType, value: `${group.kpiAchievementRate.toFixed(0)}%` });
      } else if (group.kpiAchievementRate < 50 && group.count >= 3) {
        cards.push({ id: `warning_${group.kpiType}`, type: "warning", title: `${group.kpiType} : Taux de réussite faible`, message: `Seulement ${group.kpiAchievementRate.toFixed(0)}% de vos ${group.count} campagnes ${group.kpiType} atteignent l'objectif.`, kpiType: group.kpiType, value: `${group.kpiAchievementRate.toFixed(0)}%` });
      }
      if (group.topPerformers.length >= 2) {
        const achievedMargins = group.topPerformers.filter(p => p.kpiRatio >= 1).map(p => p.margin);
        if (achievedMargins.length >= 2) {
          const optimalRange = `${Math.min(...achievedMargins).toFixed(0)}-${Math.max(...achievedMargins).toFixed(0)}%`;
          cards.push({ id: `tip_margin_${group.kpiType}`, type: "tip", title: `${group.kpiType} : Zone de marge optimale`, message: `Vos top performers ${group.kpiType} opèrent avec une marge entre ${optimalRange}. C'est votre sweet spot entre rentabilité et performance KPI.`, kpiType: group.kpiType, value: optimalRange });
        }
      }
      if (group.bestMargin > 60) {
        cards.push({ id: `record_margin_${group.kpiType}`, type: "record", title: `${group.kpiType} : Record de marge`, message: `Votre meilleure marge en ${group.kpiType} est de ${group.bestMargin.toFixed(1)}%. Écart avec la médiane : +${(group.bestMargin - group.medianMargin).toFixed(1)} pts.`, kpiType: group.kpiType, value: `${group.bestMargin.toFixed(1)}%` });
      }
    });
    if (globalStats && globalStats.totalGain > 0) {
      cards.push({ id: "global_gain", type: "success", title: "Gain cumulé toutes campagnes", message: `${globalStats.totalCampaigns} campagnes ont généré ${globalStats.totalGain.toFixed(0)}€ de gain total avec une marge moyenne de ${globalStats.avgMargin.toFixed(1)}%.`, value: `${globalStats.totalGain.toFixed(0)}€` });
    }
    if (kpiGroups.length >= 2) {
      const best = kpiGroups.reduce((a, b) => a.avgMargin > b.avgMargin ? a : b);
      const worst = kpiGroups.reduce((a, b) => a.avgMargin < b.avgMargin ? a : b);
      if (best.kpiType !== worst.kpiType) {
        cards.push({ id: "compare_kpi_types", type: "tip", title: "Comparaison par type de KPI", message: `Les campagnes ${best.kpiType} sont les plus rentables (marge ${best.avgMargin.toFixed(1)}%) vs ${worst.kpiType} (${worst.avgMargin.toFixed(1)}%). Écart de ${(best.avgMargin - worst.avgMargin).toFixed(1)} pts.` });
      }
    }

    // 🔥 V7.0 : Insight spécial campagnes terminées
    if (completedCount > 0) {
      const completedProjects = activeProjects.filter(p => p.status === "completed" && p.finalBalance);
      if (completedProjects.length > 0) {
        const avgFinalMargin = completedProjects.reduce((s, p) => s + (p.finalBalance?.realMarginPct || 0), 0) / completedProjects.length;
        const achievedCount = completedProjects.filter(p => p.finalBalance?.kpiAchieved).length;
        cards.push({
          id: "completed_summary",
          type: "success",
          title: `${completedCount} campagne${completedCount > 1 ? "s" : ""} terminée${completedCount > 1 ? "s" : ""} — Bilan`,
          message: `Marge finale moyenne : ${avgFinalMargin.toFixed(1)}%. KPI atteint dans ${completedProjects.length > 0 ? ((achievedCount / completedProjects.length) * 100).toFixed(0) : 0}% des cas. Ces données servent de référence historique fiable.`,
          value: `${completedCount} ✓`,
        });
      }
    }

    return cards.sort((a, b) => {
      const order = { record: 0, success: 1, tip: 2, warning: 3 };
      return order[a.type] - order[b.type];
    });
  }, [kpiGroups, globalStats, completedCount, activeProjects]);

  // Scatter data
  const scatterData = useMemo(() => {
    return activeProjects
      .filter(p => selectedKpiType === "all" || p.kpiType === selectedKpiType)
      .filter(p => p.targetKpi > 0 && p.actualKpi > 0)
      .map(p => ({
        name: p.name,
        margin: getProjectMargin(p),
        kpiRatio: getKpiRatio(p) * 100,
        budget: p.budgetTotal,
        kpiAchieved: isKpiAchieved(p),
        kpiType: p.kpiType,
        isCompleted: p.status === "completed",
      }));
  }, [activeProjects, selectedKpiType]);

  const filteredGroups = selectedKpiType === "all" ? kpiGroups : kpiGroups.filter(g => g.kpiType === selectedKpiType);
  const filteredInsights = selectedKpiType === "all" ? insights : insights.filter(i => !i.kpiType || i.kpiType === selectedKpiType);

  if (activeProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#f8f9fa] text-gray-500 p-8">
        <div className="w-20 h-20 bg-indigo-100 rounded-2xl flex items-center justify-center mb-4">
          <Brain className="w-10 h-10 text-indigo-400" />
        </div>
        <h2 className="text-xl font-bold text-gray-700 mb-2">Aucune donnée de benchmark</h2>
        <p className="text-center max-w-md">
          Créez et alimentez vos campagnes pour que l'intelligence accumulée vous donne des insights sur vos performances historiques.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 h-full overflow-y-auto bg-[#f8f9fa]">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                <Brain className="w-6 h-6 text-white" />
              </div>
              Benchmark Intelligence
            </h2>
            <p className="text-gray-500 mt-1">
              Intelligence sur {activeProjects.length} campagne{activeProjects.length > 1 ? "s" : ""}
              {completedCount > 0 && (
                <span className="ml-2 text-emerald-600 font-bold">
                  ({completedCount} terminée{completedCount > 1 ? "s" : ""} • {activeCount} active{activeCount > 1 ? "s" : ""})
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* 🔥 V7.0 : Filtre Statut */}
            {completedCount > 0 && (
              <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
                {[
                  { id: "all", label: "Toutes" },
                  { id: "active", label: "Actives" },
                  { id: "completed", label: "Terminées" },
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => setStatusFilter(f.id as any)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                      statusFilter === f.id ? "bg-indigo-600 text-white shadow-sm" : "text-gray-500 hover:bg-gray-50"
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}

            {/* Filtre KPI */}
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={selectedKpiType}
              onChange={(e) => setSelectedKpiType(e.target.value)}
              className="text-sm border border-gray-200 bg-white rounded-xl px-4 py-2.5 font-bold text-gray-700 focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
            >
              <option value="all">Tous les KPI ({activeProjects.length})</option>
              {kpiGroups.map(g => (
                <option key={g.kpiType} value={g.kpiType}>
                  {g.kpiType} ({g.count} campagne{g.count > 1 ? "s" : ""})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Stats globales */}
        {globalStats && (
          <div className="grid grid-cols-5 gap-4">
            <StatCard title="Campagnes" value={`${globalStats.totalCampaigns}`} icon={BarChart3} color="indigo" />
            <StatCard title="Marge Moyenne" value={`${globalStats.avgMargin.toFixed(1)}%`} sub={`Médiane : ${globalStats.medianMargin.toFixed(1)}%`} icon={Percent} color="emerald" />
            <StatCard title="Taux Réussite KPI" value={`${globalStats.kpiAchievementRate.toFixed(0)}%`} sub={`${Math.round(globalStats.kpiAchievementRate * globalStats.totalCampaigns / 100)}/${globalStats.totalCampaigns} atteints`} icon={Target} color={globalStats.kpiAchievementRate >= 70 ? "emerald" : globalStats.kpiAchievementRate >= 50 ? "amber" : "red"} />
            <StatCard title="Gain Total" value={`${globalStats.totalGain.toFixed(0)} €`} sub={`${(globalStats.totalGain / Math.max(1, globalStats.totalCampaigns)).toFixed(0)} €/campagne`} icon={DollarSign} color="emerald" />
            <StatCard title="Budget Géré" value={`${(globalStats.totalBudget / 1000).toFixed(0)}k €`} sub={`${(globalStats.totalSpent / 1000).toFixed(0)}k dépensés`} icon={Activity} color="indigo" />
          </div>
        )}

        {/* Insights */}
        {filteredInsights.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" /> Insights Automatiques
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {filteredInsights.map(insight => (
                <div key={insight.id} className={cn("rounded-xl p-5 border-2 transition-all hover:shadow-md",
                  insight.type === "success" && "bg-emerald-50 border-emerald-200",
                  insight.type === "warning" && "bg-amber-50 border-amber-200",
                  insight.type === "tip" && "bg-blue-50 border-blue-200",
                  insight.type === "record" && "bg-purple-50 border-purple-200"
                )}>
                  <div className="flex items-start gap-3">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm font-black",
                      insight.type === "success" && "bg-emerald-200 text-emerald-700",
                      insight.type === "warning" && "bg-amber-200 text-amber-700",
                      insight.type === "tip" && "bg-blue-200 text-blue-700",
                      insight.type === "record" && "bg-purple-200 text-purple-700"
                    )}>
                      {insight.type === "success" ? "✅" : insight.type === "warning" ? "⚠️" : insight.type === "tip" ? "💡" : "🏆"}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className={cn("font-bold text-sm",
                          insight.type === "success" && "text-emerald-900",
                          insight.type === "warning" && "text-amber-900",
                          insight.type === "tip" && "text-blue-900",
                          insight.type === "record" && "text-purple-900"
                        )}>{insight.title}</h4>
                        {insight.value && (
                          <span className={cn("text-xs font-black px-2 py-0.5 rounded-full",
                            insight.type === "success" && "bg-emerald-200 text-emerald-800",
                            insight.type === "warning" && "bg-amber-200 text-amber-800",
                            insight.type === "tip" && "bg-blue-200 text-blue-800",
                            insight.type === "record" && "bg-purple-200 text-purple-800"
                          )}>{insight.value}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">{insight.message}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Scatter Chart */}
        {scatterData.length >= 3 && (
          <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-indigo-100 p-6">
              <h3 className="text-lg font-bold text-indigo-900 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Marge vs Performance KPI — Toutes campagnes
              </h3>
              <p className="text-sm text-indigo-700 mt-1">
                Chaque point = une campagne. {completedCount > 0 && "⬛ = terminée, ⬤ = en cours."} Zone verte = KPI atteint + marge élevée.
              </p>
            </div>
            <div className="p-6">
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="margin" name="Marge %" type="number" domain={['dataMin - 5', 'dataMax + 5']} tickFormatter={(v: number) => `${v.toFixed(0)}%`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} label={{ value: "Marge %", position: "insideBottom", offset: -5, fontSize: 11, fill: '#94a3b8' }} />
                    <YAxis dataKey="kpiRatio" name="KPI Ratio %" type="number" domain={[0, 'dataMax + 10']} tickFormatter={(v: number) => `${v.toFixed(0)}%`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} label={{ value: "KPI Ratio %", angle: -90, position: "insideLeft", fontSize: 11, fill: '#94a3b8' }} />
                    <ZAxis dataKey="budget" range={[40, 400]} name="Budget" />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                      formatter={(value: number, name: string) => {
                        if (name === "Marge %") return [`${value.toFixed(1)}%`, name];
                        if (name === "KPI Ratio %") return [`${value.toFixed(0)}%`, name];
                        if (name === "Budget") return [`${value.toFixed(0)} €`, name];
                        return [value, name];
                      }}
                      labelFormatter={(_, payload) => {
                        if (payload && payload[0]) {
                          const d = payload[0].payload;
                          return `${d.name}${d.isCompleted ? " ✓" : ""}`;
                        }
                        return '';
                      }}
                    />
                    <Scatter data={scatterData.filter(d => d.kpiAchieved)} fill="#10b981" name="KPI Atteint" />
                    <Scatter data={scatterData.filter(d => !d.kpiAchieved)} fill="#ef4444" name="KPI Non atteint" />
                    <Legend />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Détail par type de KPI */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-500" /> Détail par type de KPI
          </h3>

          {filteredGroups.map(group => {
            const isExpanded = expandedGroup === group.kpiType;
            const currSym = "€";

            return (
              <div key={group.kpiType} className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
                <button onClick={() => setExpandedGroup(isExpanded ? null : group.kpiType)} className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl flex items-center justify-center text-white font-black text-sm shadow-md">{group.kpiType}</div>
                    <div className="text-left">
                      <div className="font-bold text-gray-900 text-lg flex items-center gap-2">
                        {group.count} campagne{group.count > 1 ? "s" : ""} {group.kpiType}
                        {group.completedCount > 0 && (
                          <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                            {group.completedCount} ✓
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500">
                        Marge moy. {group.avgMargin.toFixed(1)}% • KPI atteint {group.kpiAchievementRate.toFixed(0)}% • Gain {group.totalGain.toFixed(0)} {currSym}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className={cn("px-3 py-1 rounded-full text-xs font-black",
                      group.kpiAchievementRate >= 70 ? "bg-emerald-100 text-emerald-700" :
                      group.kpiAchievementRate >= 50 ? "bg-amber-100 text-amber-700" :
                      "bg-red-100 text-red-700"
                    )}>{group.kpiAchievementRate.toFixed(0)}% réussite</div>
                    {isExpanded ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-6 pb-6 space-y-6 border-t border-gray-100 pt-6">
                    <div className="grid grid-cols-4 gap-4">
                      <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                        <div className="text-[10px] font-bold text-indigo-600 uppercase">Marge Moyenne</div>
                        <div className="text-2xl font-black text-indigo-900 mt-1">{group.avgMargin.toFixed(1)}%</div>
                        <div className="text-[10px] text-indigo-600 mt-1">Médiane : {group.medianMargin.toFixed(1)}%</div>
                      </div>
                      <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                        <div className="text-[10px] font-bold text-emerald-600 uppercase">Gain Moyen / Campagne</div>
                        <div className="text-2xl font-black text-emerald-900 mt-1">{group.avgGainPerCampaign.toFixed(0)} {currSym}</div>
                        <div className="text-[10px] text-emerald-600 mt-1">Total : {group.totalGain.toFixed(0)} {currSym}</div>
                      </div>
                      <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                        <div className="text-[10px] font-bold text-amber-600 uppercase">Budget Moyen</div>
                        <div className="text-2xl font-black text-amber-900 mt-1">{group.avgBudget.toFixed(0)} {currSym}</div>
                        <div className="text-[10px] text-amber-600 mt-1">Durée moy. : {group.avgDuration.toFixed(0)}j</div>
                      </div>
                      <div className="bg-purple-50 rounded-xl p-4 border border-purple-100">
                        <div className="text-[10px] font-bold text-purple-600 uppercase">Fourchette Marge</div>
                        <div className="text-2xl font-black text-purple-900 mt-1">{group.worstMargin.toFixed(0)} — {group.bestMargin.toFixed(0)}%</div>
                        <div className="text-[10px] text-purple-600 mt-1">Écart : {(group.bestMargin - group.worstMargin).toFixed(0)} pts</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Distribution des marges</h4>
                        <div className="h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={group.marginDistribution} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                              <XAxis dataKey="range" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                              <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '11px' }} formatter={(value: number) => [`${value} campagne${value > 1 ? "s" : ""}`, "Nombre"]} />
                              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                                {group.marginDistribution.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Top Performers {group.kpiType}</h4>
                        {group.topPerformers.length > 0 ? (
                          <div className="space-y-2">
                            {group.topPerformers.map((perf, idx) => (
                              <div key={idx} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3 border border-gray-100">
                                <div className="flex items-center gap-3">
                                  <span className="text-sm font-black text-gray-400 w-6">
                                    {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`}
                                  </span>
                                  <span className="text-sm font-bold text-gray-900 truncate max-w-[180px] flex items-center gap-1.5">
                                    {perf.name}
                                    {/* 🔥 V7.0 : Badge ✓ si campagne terminée */}
                                    {perf.isCompleted && (
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                    )}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">{perf.margin.toFixed(1)}%</span>
                                  <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", perf.kpiRatio >= 1 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                                    {perf.kpiRatio >= 1 ? "✓ KPI" : "✗ KPI"}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-400 text-center py-8">Pas assez de données pour classer</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, sub, icon: Icon, color }: { title: string; value: string; sub?: string; icon: any; color: "indigo" | "emerald" | "amber" | "red" }) {
  return (
    <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{title}</div>
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center",
          color === "indigo" && "bg-indigo-100 text-indigo-600",
          color === "emerald" && "bg-emerald-100 text-emerald-600",
          color === "amber" && "bg-amber-100 text-amber-600",
          color === "red" && "bg-red-100 text-red-600"
        )}><Icon className="w-4 h-4" /></div>
      </div>
      <div className="text-2xl font-black text-gray-900">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}
