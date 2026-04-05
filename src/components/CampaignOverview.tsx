import { useMemo } from "react";
import { ProjectData } from "../types";

interface Props {
  projects: ProjectData[];
  currentProjectId?: string;
  onSelectProject: (id: string) => void;
}

export function CampaignOverview({ projects, currentProjectId, onSelectProject }: Props) {
  const activeProjects = useMemo(() => {
    return projects
      .filter(p => p.status === "active")
      .map(p => {
        const margin = p.cpmRevenueActual > 0
          ? ((p.cpmRevenueActual - p.cpmCostActuel) / p.cpmRevenueActual) * 100
          : 0;
        const pacing = p.budgetTotal > 0 ? (p.budgetSpent / p.budgetTotal) * 100 : 0;
        const isFin = ["CPA", "CPV", "CPC", "CPCV", "CPL", "CPI"].includes(p.kpiType);
        const kpiMet = p.targetKpi > 0
          ? (isFin ? p.actualKpi <= p.targetKpi : p.actualKpi >= p.targetKpi)
          : true;
        const endDate = p.endDate ? new Date(p.endDate) : null;
        const daysLeft = endDate ? Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / 86400000)) : null;
        const entries = p.dailyEntries || [];

        // Urgence scoring: plus c'est haut, plus c'est urgent
        let urgency = 0;
        if (!kpiMet) urgency += 30;
        if (margin < 20) urgency += 20;
        if (daysLeft !== null && daysLeft < 5) urgency += 25;
        if (pacing < 50 && daysLeft !== null && daysLeft < p.durationDays * 0.3) urgency += 15;
        if (pacing > 95) urgency += 10;

        return { ...p, margin, pacing, kpiMet, daysLeft, entries, urgency, isFin };
      })
      .sort((a, b) => b.urgency - a.urgency);
  }, [projects]);

  if (activeProjects.length === 0) return null;

  const fmtKpi = (v: number) => v < 0.1 ? v.toFixed(3) : v < 1 ? v.toFixed(3) : v.toFixed(2);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid #f3f4f6" }}>
        <div>
          <div className="text-sm font-bold text-gray-900">Campagnes actives</div>
          <div className="text-[10px] text-gray-400">{activeProjects.length} campagne{activeProjects.length > 1 ? "s" : ""} — triees par urgence</div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> On target</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Off target</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wider" style={{ borderBottom: "1px solid #f9fafb" }}>
              <th className="text-left px-5 py-2.5">Campagne</th>
              <th className="text-right px-3 py-2.5">Budget</th>
              <th className="text-right px-3 py-2.5">Pacing</th>
              <th className="text-right px-3 py-2.5">Marge</th>
              <th className="text-right px-3 py-2.5">KPI</th>
              <th className="text-right px-3 py-2.5">Objectif</th>
              <th className="text-center px-3 py-2.5">Status</th>
              <th className="text-right px-5 py-2.5">Jours</th>
            </tr>
          </thead>
          <tbody>
            {activeProjects.map(p => {
              const isSelected = p.id === currentProjectId;
              return (
                <tr
                  key={p.id}
                  onClick={() => onSelectProject(p.id)}
                  className="cursor-pointer transition-colors"
                  style={{
                    background: isSelected ? "rgba(59,130,246,0.04)" : "transparent",
                    borderBottom: "1px solid #f9fafb",
                  }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#fafafa"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                      <div>
                        <div className="text-sm font-semibold text-gray-900 truncate max-w-[200px]">{p.name}</div>
                        <div className="text-[10px] text-gray-400">{p.kpiType} • {p.entries.length}j track</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="text-xs font-bold text-gray-700" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {p.budgetSpent.toFixed(0)} / {p.budgetTotal.toFixed(0)}€
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-12 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${Math.min(100, p.pacing)}%`,
                          background: p.pacing >= 85 && p.pacing <= 105 ? "#22c55e" : p.pacing >= 70 ? "#f59e0b" : "#ef4444",
                        }} />
                      </div>
                      <span className="text-xs font-bold" style={{
                        fontVariantNumeric: "tabular-nums",
                        color: p.pacing >= 85 && p.pacing <= 105 ? "#059669" : p.pacing >= 70 ? "#d97706" : "#dc2626",
                      }}>
                        {Math.min(100, p.pacing).toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="text-xs font-bold" style={{
                      fontVariantNumeric: "tabular-nums",
                      color: p.margin >= 60 ? "#059669" : p.margin >= 30 ? "#2563eb" : p.margin >= 15 ? "#d97706" : "#dc2626",
                    }}>
                      {p.margin.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="text-xs font-bold text-gray-700" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {p.actualKpi > 0 ? fmtKpi(p.actualKpi) : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="text-xs text-gray-400" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {p.targetKpi > 0 ? fmtKpi(p.targetKpi) : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${p.kpiMet ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                      {p.kpiMet ? "ON" : "OFF"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className="text-xs font-bold" style={{
                      fontVariantNumeric: "tabular-nums",
                      color: p.daysLeft !== null && p.daysLeft < 5 ? "#dc2626" : p.daysLeft !== null && p.daysLeft < 10 ? "#d97706" : "#374151",
                    }}>
                      {p.daysLeft !== null ? `${p.daysLeft}j` : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
