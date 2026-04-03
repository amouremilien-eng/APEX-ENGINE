import { ProjectData } from "../types";
import { AlertsPanel } from "./AlertsPanel";
import { useAlerts } from "../hooks/useAlerts";
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  DollarSign, 
  Percent,
  Calendar,
  Activity,
  CheckCircle2,
  AlertCircle,
  Minus,
  ArrowRight
} from "lucide-react";
import { cn } from "../utils/cn";

interface PortfolioOverviewProps {
  projects: ProjectData[];
  onSelectProject: (id: string) => void;
}

export function PortfolioOverview({ projects, onSelectProject }: PortfolioOverviewProps) {
  const alerts = useAlerts(projects);
  
  // Filtrer les projets actifs (qui ont un ID)
  const activeProjects = projects.filter(p => p.id && p.budgetTotal > 0);

  // Calculs consolidés
  const totalBudget = activeProjects.reduce((acc, p) => acc + p.budgetTotal, 0);
  const totalSpent = activeProjects.reduce((acc, p) => acc + p.budgetSpent, 0);
  const totalRemaining = totalBudget - totalSpent;

  // Calculer la marge moyenne pondérée
  let avgMargin = 0;
  if (totalSpent > 0) {
    let totalMarginWeighted = 0;
    activeProjects.forEach(p => {
      let margin = 0;
      if (p.inputMode === "CPM Cost") {
        if (p.cpmRevenueActual > 0) {
          margin = ((p.cpmRevenueActual - p.cpmCostActuel) / p.cpmRevenueActual) * 100;
        }
      } else {
        margin = p.margeInput;
      }
      totalMarginWeighted += p.budgetSpent * margin;
    });
    avgMargin = totalMarginWeighted / totalSpent;
  }

  const totalGain = totalSpent * (avgMargin / 100);
  const projectedGain = totalBudget * (avgMargin / 100);

  const currSym = activeProjects[0]?.currency.includes("EUR") ? "€" : "$";

  // Statistiques par santé
  const healthyCount = activeProjects.filter(p => {
    const alerts = useAlerts([p]);
    const hasWarning = alerts.some(a => a.severity === "danger" || a.severity === "warning");
    return !hasWarning;
  }).length;

  const warningCount = activeProjects.filter(p => {
    const alerts = useAlerts([p]);
    const hasWarning = alerts.some(a => a.severity === "warning");
    const hasDanger = alerts.some(a => a.severity === "danger");
    return hasWarning && !hasDanger;
  }).length;

  const criticalCount = activeProjects.filter(p => {
    const alerts = useAlerts([p]);
    return alerts.some(a => a.severity === "danger");
  }).length;

  if (activeProjects.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Activity className="w-12 h-12 text-gray-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">Aucune campagne active</h3>
          <p className="text-gray-500 mb-6">
            Créez votre première campagne pour commencer à suivre vos performances.
          </p>
        </div>
      </div>
    );
  }

  const getProjectHealth = (project: ProjectData): { status: "healthy" | "warning" | "critical"; icon: any; color: string } => {
    const projectAlerts = useAlerts([project]);
    const hasDanger = projectAlerts.some(a => a.severity === "danger");
    const hasWarning = projectAlerts.some(a => a.severity === "warning");

    if (hasDanger) {
      return { status: "critical", icon: AlertCircle, color: "text-red-600 bg-red-50 border-red-200" };
    } else if (hasWarning) {
      return { status: "warning", icon: AlertCircle, color: "text-amber-600 bg-amber-50 border-amber-200" };
    } else {
      return { status: "healthy", icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50 border-emerald-200" };
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8 bg-gray-50">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div>
          <h1 className="text-3xl font-black text-gray-900 mb-2">Portfolio Overview</h1>
          <p className="text-gray-500">Vue consolidée de toutes vos campagnes actives</p>
        </div>

        {/* Métriques consolidées */}
        <div className="grid grid-cols-4 gap-6">
          <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                Campagnes Actives
              </div>
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Activity className="w-5 h-5 text-blue-600" />
              </div>
            </div>
            <div className="text-3xl font-black text-gray-900 mb-2">
              {activeProjects.length}
            </div>
            <div className="flex gap-2 text-xs">
              <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-bold">
                {healthyCount} ✓
              </span>
              {warningCount > 0 && (
                <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-bold">
                  {warningCount} ⚠
                </span>
              )}
              {criticalCount > 0 && (
                <span className="bg-red-100 text-red-700 px-2 py-1 rounded-full font-bold">
                  {criticalCount} 🚨
                </span>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                Budget Total
              </div>
              <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-indigo-600" />
              </div>
            </div>
            <div className="text-3xl font-black text-gray-900 mb-1">
              {totalBudget.toLocaleString()} {currSym}
            </div>
            <div className="text-sm text-gray-500">
              Dépensé : {totalSpent.toLocaleString()} {currSym}
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2 mt-3">
              <div 
                className="bg-indigo-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, (totalSpent / totalBudget) * 100)}%` }}
              ></div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                Marge Moyenne
              </div>
              <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                <Percent className="w-5 h-5 text-emerald-600" />
              </div>
            </div>
            <div className="text-3xl font-black text-emerald-600 mb-1">
              {avgMargin.toFixed(1)} %
            </div>
            <div className="text-sm text-gray-500">
              Pondérée par budget dépensé
            </div>
          </div>

          <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl p-6 border border-emerald-400 shadow-lg text-white">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-bold uppercase tracking-wider opacity-90">
                Gain Cumulé
              </div>
              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>
            <div className="text-3xl font-black mb-1">
              {Math.round(totalGain).toLocaleString()} {currSym}
            </div>
            <div className="text-sm opacity-90">
              Projection : {Math.round(projectedGain).toLocaleString()} {currSym}
            </div>
          </div>
        </div>

        {/* Alertes compactes */}
        <AlertsPanel alerts={alerts} compact />

        {/* Liste des campagnes */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-xl font-bold text-gray-900">Toutes les campagnes</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Statut
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Campagne
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Budget
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Progression
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Marge
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    KPI
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Gain
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeProjects.map((project) => {
                  const health = getProjectHealth(project);
                  const HealthIcon = health.icon;
                  
                  let margin = 0;
                  if (project.inputMode === "CPM Cost") {
                    if (project.cpmRevenueActual > 0) {
                      margin = ((project.cpmRevenueActual - project.cpmCostActuel) / project.cpmRevenueActual) * 100;
                    }
                  } else {
                    margin = project.margeInput;
                  }

                  const gain = project.budgetSpent * (margin / 100);
                  const progression = project.budgetTotal > 0 ? (project.budgetSpent / project.budgetTotal) * 100 : 0;

                  const isFin = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
                  const kpiStatus = project.targetKpi > 0 && project.actualKpi > 0
                    ? isFin 
                      ? project.actualKpi <= project.targetKpi 
                      : project.actualKpi >= project.targetKpi
                    : null;

                  return (
                    <tr key={project.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center border-2", health.color)}>
                          <HealthIcon className="w-5 h-5" />
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-bold text-gray-900">{project.name}</div>
                        <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                          <Calendar className="w-3 h-3" />
                          {project.durationDays} jours
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-bold text-gray-900">
                          {project.budgetSpent.toLocaleString()} {currSym}
                        </div>
                        <div className="text-xs text-gray-500">
                          / {project.budgetTotal.toLocaleString()} {currSym}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-100 rounded-full h-2 w-24">
                            <div 
                              className={cn(
                                "h-2 rounded-full transition-all",
                                progression > 90 ? "bg-emerald-500" : "bg-blue-500"
                              )}
                              style={{ width: `${Math.min(100, progression)}%` }}
                            ></div>
                          </div>
                          <span className="text-sm font-bold text-gray-700 min-w-[3rem] text-right">
                            {progression.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-lg font-black text-emerald-600">
                          {margin.toFixed(1)}%
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900">
                            {project.actualKpi.toFixed(2)}
                          </span>
                          {kpiStatus !== null && (
                            kpiStatus ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-red-500" />
                            )
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          vs {project.targetKpi.toFixed(2)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-lg font-black text-emerald-600">
                          {Math.round(gain).toLocaleString()} {currSym}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => onSelectProject(project.id)}
                          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors"
                        >
                          Voir
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Alertes détaillées */}
        <AlertsPanel alerts={alerts} />
      </div>
    </div>
  );
}
