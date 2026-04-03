import { useMemo, useState, useEffect } from "react";
import { ProjectData } from "../types";
import { cn } from "../utils/cn";
import { supabase, isSupabaseEnabled } from "../lib/supabase";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Trophy, TrendingUp, Clock, Target, DollarSign, Users, Shield, CheckCircle2, AlertTriangle, BarChart3, RefreshCw, Loader2 } from "lucide-react";

interface AppROIProps {
  projects: ProjectData[];
}

const TASKS: Record<string, { label: string; before: number; after: number }> = {
  daily_entry:       { label: "Saisie quotidienne",       before: 15, after: 2 },
  bulk_entry:        { label: "Saisie bulk (5 jours)",    before: 45, after: 5 },
  kpi_calculation:   { label: "Calcul KPI harmonique",    before: 10, after: 0 },
  weekly_export:     { label: "Export hebdomadaire",       before: 25, after: 2 },
  margin_simulation: { label: "Simulation marge",         before: 20, after: 3 },
  multiline_optim:   { label: "Optimisation multi-lines", before: 45, after: 5 },
  pacing_check:      { label: "Vérification pacing",      before: 8,  after: 1 },
  anomaly_detection: { label: "Détection anomalies",      before: 15, after: 0 },
  period_comparison: { label: "Comparaison périodes",      before: 30, after: 2 },
  portfolio_view:    { label: "Vue consolidée",           before: 20, after: 1 },
};

export function AppROI({ projects: localProjects }: AppROIProps) {
  const [allProjects, setAllProjects] = useState<(ProjectData & { userName?: string; userInitials?: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<"week" | "month" | "quarter">("month");
  const [selectedTrader, setSelectedTrader] = useState<string>("all");

  // 🔥 ADMIN : charger TOUS les projets de TOUS les users
  const fetchAllProjects = async () => {
    setIsLoading(true);
    setLoadError(null);

    if (!isSupabaseEnabled() || !supabase) {
      setAllProjects(localProjects.filter(p => p.id && p.budgetTotal > 0));
      setIsLoading(false);
      return;
    }

    try {
      const { data: projectsData, error: projError } = await supabase
        .from('projects')
        .select('id, user_id, name, data, last_modified')
        .order('last_modified', { ascending: false });
      if (projError) throw projError;

      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, name, initials');
      if (usersError) throw usersError;

      const userMap = new Map<string, { name: string; initials: string }>();
      if (usersData) usersData.forEach((u: any) => userMap.set(u.id, { name: u.name, initials: u.initials }));

      if (projectsData) {
        const loaded = projectsData
          .map((row: any) => {
            const pd = row.data as ProjectData;
            const user = userMap.get(row.user_id);
            return { ...pd, id: row.id, name: row.name, lastModified: row.last_modified, userName: user?.name || "Inconnu", userInitials: user?.initials || "??" };
          })
          .filter((p: any) => p.budgetTotal > 0);
        setAllProjects(loaded);
      }
    } catch (err: any) {
      setLoadError(err.message);
      setAllProjects(localProjects.filter(p => p.id && p.budgetTotal > 0));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchAllProjects(); }, []);

  const traders = useMemo(() => {
    const m = new Map<string, string>();
    allProjects.forEach(p => m.set((p as any).userName || "—", (p as any).userInitials || "??"));
    return Array.from(m.entries()).map(([name, initials]) => ({ name, initials }));
  }, [allProjects]);

  const filteredProjects = useMemo(() => {
    if (selectedTrader === "all") return allProjects;
    return allProjects.filter(p => (p as any).userName === selectedTrader);
  }, [allProjects, selectedTrader]);

  const activeProjects = useMemo(() => filteredProjects.filter(p => p.id && p.budgetTotal > 0), [filteredProjects]);
  const completedProjects = useMemo(() => activeProjects.filter(p => p.status === "completed"), [activeProjects]);

  const roiMetrics = useMemo(() => {
    if (activeProjects.length === 0) return null;
    const isFin = (k: string) => !["Viewability", "VTR", "CTR"].includes(k);
    let totalGainWith = 0, totalGainWithout = 0, kpiOk = 0, kpiTotal = 0;

    const pm = activeProjects.map(p => {
      let margin = 0;
      if (p.status === "completed" && p.finalBalance) margin = p.finalBalance.realMarginPct;
      else if (p.dailyEntries?.length) { const ts = p.dailyEntries.reduce((s,e)=>s+e.budgetSpent,0); margin = ts > 0 ? p.dailyEntries.reduce((s,e)=>s+e.budgetSpent*(e.marginPct/100),0)/ts*100 : 0; }
      else if (p.inputMode === "CPM Cost") margin = p.cpmRevenueActual > 0 ? ((p.cpmRevenueActual - p.cpmCostActuel) / p.cpmRevenueActual) * 100 : 0;
      else margin = p.margeInput;

      const gain = p.budgetSpent * (margin / 100);
      const gainW = p.budgetSpent * (Math.max(5, margin - 7) / 100);
      totalGainWith += gain; totalGainWithout += gainW;

      if (p.targetKpi > 0 && p.actualKpi > 0) { kpiTotal++; if (isFin(p.kpiType) ? p.actualKpi <= p.targetKpi : p.actualKpi >= p.targetKpi) kpiOk++; }

      return { name: p.name, trader: (p as any).userName || "—", traderInitials: (p as any).userInitials || "??", margin, gain, gainDelta: gain - gainW, budgetSpent: p.budgetSpent, budgetTotal: p.budgetTotal, kpiType: p.kpiType, kpiAchieved: p.targetKpi > 0 && p.actualKpi > 0 ? (isFin(p.kpiType) ? p.actualKpi <= p.targetKpi : p.actualKpi >= p.targetKpi) : null, entriesCount: p.dailyEntries?.length || 0, isCompleted: p.status === "completed" };
    });

    const totalEntries = activeProjects.reduce((s,p) => s + (p.dailyEntries?.length || 0), 0);
    const totalActions = activeProjects.reduce((s,p) => s + (p.history?.length || 0), 0);
    const timeSavedMin = Object.values(TASKS).reduce((t,task) => t + (task.before - task.after), 0);

    const anomalies = activeProjects.reduce((s, p) => {
      if (!p.dailyEntries || p.dailyEntries.length < 4) return s;
      const sorted = [...p.dailyEntries].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      let c = 0;
      for (let i = 3; i < sorted.length; i++) { const avg = sorted.slice(i-3,i).reduce((a,e) => a+e.budgetSpent, 0)/3; if (avg > 0 && Math.abs((sorted[i].budgetSpent - avg)/avg) > 0.8) c++; }
      return s + c;
    }, 0);

    const traderMap = new Map<string, { projects: number; entries: number; gain: number; margin: number; budget: number }>();
    pm.forEach(p => {
      const e = traderMap.get(p.trader) || { projects:0, entries:0, gain:0, margin:0, budget:0 };
      e.projects++; e.entries += p.entriesCount; e.gain += p.gain; e.margin += p.margin; e.budget += p.budgetTotal;
      traderMap.set(p.trader, e);
    });
    const traderStats = Array.from(traderMap.entries()).map(([n,s]) => ({ name: n, ...s, avgMargin: s.projects > 0 ? s.margin / s.projects : 0 })).sort((a,b) => b.gain - a.gain);

    const mult = selectedPeriod === "week" ? 1 : selectedPeriod === "month" ? 4 : 12;
    return { pm, totalGainWith, totalGainWithout, gainDelta: totalGainWith - totalGainWithout, avgMargin: pm.reduce((s,p)=>s+p.margin,0)/pm.length, kpiRate: kpiTotal > 0 ? (kpiOk/kpiTotal)*100 : 0, kpiOk, kpiTotal, timeSavedMin, timeSavedH: timeSavedMin/60, totalEntries, totalActions, anomalies, totalProjects: activeProjects.length, completedCount: completedProjects.length, tradersCount: traders.length, traderStats, mult, avgEntries: totalEntries / Math.max(1, activeProjects.length) };
  }, [activeProjects, completedProjects, selectedPeriod, traders]);

  const timeSavingsData = useMemo(() => Object.values(TASKS).map(t => ({ name: t.label, "Avant (min)": t.before, "Après (min)": t.after })), []);
  const kpiStatusData = useMemo(() => { if (!roiMetrics) return []; const a = roiMetrics.kpiOk, b = roiMetrics.kpiTotal - a, c = roiMetrics.totalProjects - roiMetrics.kpiTotal; return [{ name: "Atteint", value: a, fill: "#10b981" }, { name: "Non atteint", value: b, fill: "#ef4444" }, ...(c > 0 ? [{ name: "Sans objectif", value: c, fill: "#94a3b8" }] : [])].filter(d => d.value > 0); }, [roiMetrics]);
  const gainData = useMemo(() => { if (!roiMetrics) return []; return roiMetrics.pm.filter(p => p.gainDelta > 0).sort((a,b) => b.gainDelta - a.gainDelta).slice(0,10).map(p => ({ name: p.name.length > 15 ? p.name.substring(0,15)+"…" : p.name, "Gain": Number(p.gainDelta.toFixed(0)) })); }, [roiMetrics]);

  if (isLoading) return (<div className="flex flex-col items-center justify-center h-full bg-[#f8f9fa]"><Loader2 className="w-12 h-12 text-purple-500 animate-spin mb-4" /><h2 className="text-xl font-bold text-gray-700">Chargement ROI admin...</h2><p className="text-sm text-gray-500">Récupération des campagnes de tous les utilisateurs</p></div>);
  if (!roiMetrics || activeProjects.length === 0) return (<div className="flex flex-col items-center justify-center h-full bg-[#f8f9fa] p-8"><div className="w-20 h-20 bg-purple-100 rounded-2xl flex items-center justify-center mb-4"><Trophy className="w-10 h-10 text-purple-400" /></div><h2 className="text-xl font-bold text-gray-700 mb-2">Aucune donnée ROI</h2><p className="text-center max-w-md text-gray-500">Alimentez des campagnes pour activer le dashboard.</p>{loadError && <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{loadError}</div>}</div>);

  return (
    <div className="p-8 h-full overflow-y-auto bg-[#f8f9fa]">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* HEADER */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl flex items-center justify-center shadow-lg"><Trophy className="w-6 h-6 text-white" /></div>
              Preuve de Valeur — Cockpit Yield
              <span className="text-xs font-black bg-purple-100 text-purple-700 px-2 py-1 rounded-full">ADMIN</span>
            </h2>
            <p className="text-gray-500 mt-1">{roiMetrics.totalProjects} campagnes • {roiMetrics.tradersCount} traders • {roiMetrics.totalEntries} saisies</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2"><Users className="w-4 h-4 text-gray-400" />
              <select value={selectedTrader} onChange={(e) => setSelectedTrader(e.target.value)} className="text-sm border border-gray-200 bg-white rounded-lg px-3 py-2 font-bold text-gray-700 focus:ring-2 focus:ring-purple-500 outline-none shadow-sm">
                <option value="all">Tous ({traders.length})</option>
                {traders.map(t => <option key={t.name} value={t.name}>{t.initials} — {t.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
              {(["week","month","quarter"] as const).map(p => <button key={p} onClick={() => setSelectedPeriod(p)} className={cn("px-3 py-1.5 rounded-md text-xs font-bold transition-all", selectedPeriod === p ? "bg-purple-600 text-white" : "text-gray-500 hover:bg-gray-50")}>{p === "week" ? "Sem" : p === "month" ? "Mois" : "Trim"}</button>)}
            </div>
            <button onClick={fetchAllProjects} className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors" title="Rafraîchir"><RefreshCw className="w-4 h-4" /></button>
          </div>
        </div>
        {loadError && <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Supabase indisponible. Données locales uniquement.</div>}

        {/* KPI CARDS */}
        <div className="grid grid-cols-5 gap-4">
          <KPICard title="Taux KPI Atteint" value={`${roiMetrics.kpiRate.toFixed(0)}%`} sub={`${roiMetrics.kpiOk}/${roiMetrics.kpiTotal}`} icon={Target} color={roiMetrics.kpiRate >= 70 ? "emerald" : roiMetrics.kpiRate >= 50 ? "amber" : "red"} badge="🎯" />
          <KPICard title="Temps Gagné/Sem/Trader" value={`${roiMetrics.timeSavedH.toFixed(1)}h`} sub={`${roiMetrics.timeSavedMin} min`} icon={Clock} color="blue" badge="⏱️" />
          <KPICard title="Gain Additionnel" value={`+${roiMetrics.gainDelta.toFixed(0)}€`} sub="vs sans app" icon={DollarSign} color="emerald" badge="💰" />
          <KPICard title="Erreurs Évitées" value={`${roiMetrics.totalEntries + roiMetrics.anomalies}`} sub={`${roiMetrics.totalEntries} prev + ${roiMetrics.anomalies} anom`} icon={Shield} color="purple" badge="🛡️" />
          <KPICard title="Traders Actifs" value={`${roiMetrics.tradersCount}`} sub={`${roiMetrics.totalProjects} camp.`} icon={Users} color="blue" badge="👥" />
        </div>

        {/* TRADER TABLE */}
        {roiMetrics.traderStats.length > 1 && (
          <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 border-b border-purple-100 p-6">
              <h3 className="text-lg font-bold text-purple-900 flex items-center gap-2"><Users className="w-5 h-5" /> 👥 Performance par Trader</h3>
            </div>
            <div className="p-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200"><tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Trader</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase">Campagnes</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase">Saisies</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase">Budget Géré</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase">Marge Moy.</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase">Gain Total</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {roiMetrics.traderStats.map((t, i) => (
                    <tr key={t.name} className="hover:bg-purple-50/30">
                      <td className="px-4 py-3 font-bold text-gray-900">{i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`} {t.name}</td>
                      <td className="px-4 py-3 text-center font-bold">{t.projects}</td>
                      <td className="px-4 py-3 text-center font-bold text-blue-600">{t.entries}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{(t.budget/1000).toFixed(1)}k€</td>
                      <td className="px-4 py-3 text-center"><span className={cn("font-bold px-2 py-0.5 rounded-full text-xs", t.avgMargin >= 30 ? "bg-emerald-100 text-emerald-700" : t.avgMargin >= 20 ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700")}>{t.avgMargin.toFixed(1)}%</span></td>
                      <td className="px-4 py-3 text-center font-black text-emerald-600">+{t.gain.toFixed(0)}€</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* KPI + CAMPAGNES */}
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100 p-6">
            <h3 className="text-lg font-bold text-emerald-900 flex items-center gap-2"><Target className="w-5 h-5" /> 🎯 Argument #1 : KPI Clients</h3>
          </div>
          <div className="p-6 grid grid-cols-3 gap-6">
            <div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={kpiStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={5} dataKey="value">{kpiStatusData.map((e,i)=><Cell key={i} fill={e.fill}/>)}</Pie><Tooltip formatter={(v: number) => [`${v}`, ""]} /><Legend wrapperStyle={{fontSize:'12px'}} /></PieChart></ResponsiveContainer></div>
            <div className="col-span-2 space-y-2 max-h-64 overflow-y-auto">
              {roiMetrics.pm.map((p,i) => (
                <div key={i} className={cn("flex items-center justify-between p-3 rounded-lg border", p.kpiAchieved === true ? "bg-emerald-50 border-emerald-200" : p.kpiAchieved === false ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200")}>
                  <div className="flex items-center gap-2">
                    {p.kpiAchieved === true ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : p.kpiAchieved === false ? <AlertTriangle className="w-4 h-4 text-red-500" /> : <BarChart3 className="w-4 h-4 text-gray-400" />}
                    <span className="text-sm font-bold text-gray-900 truncate max-w-[160px]">{p.name}</span>
                    <span className="text-[9px] font-black bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">{p.traderInitials}</span>
                    {p.isCompleted && <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">✓</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-bold text-gray-600">{p.kpiType}</span>
                    <span className="font-black text-indigo-600">{p.margin.toFixed(1)}%</span>
                    <span className="font-black text-emerald-600">+{p.gain.toFixed(0)}€</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* TEMPS GAGNÉ */}
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100 p-6">
            <h3 className="text-lg font-bold text-blue-900 flex items-center gap-2"><Clock className="w-5 h-5" /> ⏱️ Argument #2 : Temps Gagné</h3>
          </div>
          <div className="p-6 grid grid-cols-2 gap-6">
            <div className="h-80"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeSavingsData} layout="vertical" margin={{left:10,right:20}}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" tick={{fontSize:10,fill:'#64748b'}} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{fontSize:10,fill:'#64748b'}} axisLine={false} tickLine={false} width={140} />
                <Tooltip contentStyle={{borderRadius:'8px',fontSize:'12px'}} formatter={(v: number)=>[`${v} min`,""]} />
                <Legend wrapperStyle={{fontSize:'11px'}} />
                <Bar dataKey="Avant (min)" fill="#ef4444" radius={[0,4,4,0]} barSize={12} />
                <Bar dataKey="Après (min)" fill="#10b981" radius={[0,4,4,0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer></div>
            <div className="space-y-4">
              <div className="bg-blue-50 rounded-xl p-5 border-2 border-blue-200">
                <div className="text-xs font-bold text-blue-600 uppercase mb-2">Économie / Trader / Semaine</div>
                <div className="text-4xl font-black text-blue-900">{roiMetrics.timeSavedH.toFixed(1)}h</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-100 text-center">
                  <div className="text-xs font-bold text-indigo-600 uppercase mb-1">/ Mois</div>
                  <div className="text-2xl font-black text-indigo-900">{(roiMetrics.timeSavedH*4).toFixed(0)}h</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-4 border border-purple-100 text-center">
                  <div className="text-xs font-bold text-purple-600 uppercase mb-1">/ An</div>
                  <div className="text-2xl font-black text-purple-900">{(roiMetrics.timeSavedH*48).toFixed(0)}h</div>
                  <div className="text-[10px] text-purple-500">{((roiMetrics.timeSavedH*48)/8).toFixed(0)} jours</div>
                </div>
              </div>
              <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-200">
                <div className="text-xs font-bold text-emerald-700 mb-1">💶 Valeur ({roiMetrics.tradersCount} traders × 45€/h)</div>
                <div className="text-2xl font-black text-emerald-700">{(roiMetrics.timeSavedH * roiMetrics.tradersCount * 45 * roiMetrics.mult).toFixed(0)} € / {selectedPeriod === "week" ? "sem" : selectedPeriod === "month" ? "mois" : "trim"}</div>
              </div>
            </div>
          </div>
        </div>

        {/* GAINS */}
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-50 to-green-50 border-b border-emerald-100 p-6">
            <h3 className="text-lg font-bold text-emerald-900 flex items-center gap-2"><DollarSign className="w-5 h-5" /> 💰 Argument #3 : Gains Financiers</h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-200 text-center"><div className="text-xs font-bold text-gray-500 uppercase mb-2">Avec App</div><div className="text-3xl font-black text-emerald-600">{roiMetrics.totalGainWith.toFixed(0)} €</div></div>
              <div className="bg-red-50 rounded-xl p-5 border border-red-200 text-center"><div className="text-xs font-bold text-red-500 uppercase mb-2">Sans App (est.)</div><div className="text-3xl font-black text-red-600">{roiMetrics.totalGainWithout.toFixed(0)} €</div><div className="text-[10px] text-red-400 mt-1">Hypothèse : marge -7pts</div></div>
              <div className="bg-emerald-50 rounded-xl p-5 border-2 border-emerald-300 text-center"><div className="text-xs font-bold text-emerald-600 uppercase mb-2">Delta App</div><div className="text-3xl font-black text-emerald-700">+{roiMetrics.gainDelta.toFixed(0)} €</div></div>
            </div>
            {gainData.length > 0 && <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={gainData} margin={{left:10,right:20,bottom:20}}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/><XAxis dataKey="name" tick={{fontSize:10,fill:'#64748b'}} angle={-20} axisLine={false} tickLine={false} height={50}/><YAxis tick={{fontSize:10,fill:'#64748b'}} axisLine={false} tickLine={false} tickFormatter={v=>`${v}€`}/><Tooltip contentStyle={{borderRadius:'8px',fontSize:'12px'}} formatter={(v: number)=>[`+${v}€`,""]}/><Bar dataKey="Gain" fill="#10b981" radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></div>}
          </div>
        </div>

        {/* ERREURS */}
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-purple-50 to-pink-50 border-b border-purple-100 p-6"><h3 className="text-lg font-bold text-purple-900 flex items-center gap-2"><Shield className="w-5 h-5" /> 📉 Argument #4 : Erreurs Évitées</h3></div>
          <div className="p-6 grid grid-cols-3 gap-6">
            <div className="bg-purple-50 rounded-xl p-5 border border-purple-200 text-center"><div className="text-4xl mb-2">🎯</div><div className="text-2xl font-black text-purple-900">{roiMetrics.totalEntries}</div><div className="text-xs font-bold text-purple-700 mt-1">Previews KPI</div></div>
            <div className="bg-pink-50 rounded-xl p-5 border border-pink-200 text-center"><div className="text-4xl mb-2">🔍</div><div className="text-2xl font-black text-pink-900">{roiMetrics.anomalies}</div><div className="text-xs font-bold text-pink-700 mt-1">Anomalies Auto</div></div>
            <div className="bg-indigo-50 rounded-xl p-5 border border-indigo-200 text-center"><div className="text-4xl mb-2">🧮</div><div className="text-2xl font-black text-indigo-900">{roiMetrics.totalEntries}</div><div className="text-xs font-bold text-indigo-700 mt-1">Calculs Auto</div></div>
          </div>
        </div>

        {/* ROI FINAL */}
        <div className="bg-gradient-to-br from-purple-600 to-indigo-700 rounded-2xl p-8 text-white shadow-xl">
          <h3 className="text-xl font-black mb-6 flex items-center gap-3"><Trophy className="w-6 h-6" /> Résumé ROI ({roiMetrics.tradersCount} traders)</h3>
          <div className="grid grid-cols-5 gap-5">
            <div className="bg-white/10 rounded-xl p-4 text-center"><div className="text-[10px] font-bold uppercase opacity-80 mb-2">KPI Atteints</div><div className="text-3xl font-black">{roiMetrics.kpiRate.toFixed(0)}%</div></div>
            <div className="bg-white/10 rounded-xl p-4 text-center"><div className="text-[10px] font-bold uppercase opacity-80 mb-2">H/An/Trader</div><div className="text-3xl font-black">{(roiMetrics.timeSavedH*48).toFixed(0)}h</div></div>
            <div className="bg-white/10 rounded-xl p-4 text-center"><div className="text-[10px] font-bold uppercase opacity-80 mb-2">Gain Add.</div><div className="text-3xl font-black">+{roiMetrics.gainDelta.toFixed(0)}€</div></div>
            <div className="bg-white/10 rounded-xl p-4 text-center"><div className="text-[10px] font-bold uppercase opacity-80 mb-2">Traders</div><div className="text-3xl font-black">{roiMetrics.tradersCount}</div></div>
            <div className="bg-white/10 rounded-xl p-4 text-center"><div className="text-[10px] font-bold uppercase opacity-80 mb-2">Saisies</div><div className="text-3xl font-black">{roiMetrics.totalEntries}</div></div>
          </div>
          <div className="mt-6 pt-6 border-t border-white/20 text-center">
            <div className="text-sm opacity-80 mb-2">ROI Annualisé ({roiMetrics.tradersCount} traders × 45€/h + gains)</div>
            <div className="text-5xl font-black">{((roiMetrics.timeSavedH * roiMetrics.tradersCount * 45 * 48) + (roiMetrics.gainDelta * 4)).toFixed(0)} €</div>
          </div>
        </div>

        {/* ADOPTION */}
        <div className="grid grid-cols-5 gap-4">
          {[{ l:"Campagnes", v: roiMetrics.totalProjects, c:"gray" }, { l:"Terminées", v: roiMetrics.completedCount, c:"emerald" }, { l:"Moy Entrées", v: roiMetrics.avgEntries.toFixed(1), c:"blue" }, { l:"Actions", v: roiMetrics.totalActions, c:"purple" }, { l:"Traders", v: roiMetrics.tradersCount, c:"indigo" }].map(x => (
            <div key={x.l} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
              <div className="text-[10px] font-bold text-gray-500 uppercase mb-2">{x.l}</div>
              <div className={`text-2xl font-black text-${x.c}-600`}>{x.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KPICard({ title, value, sub, icon: Icon, color, badge }: { title: string; value: string; sub: string; icon: any; color: "emerald"|"blue"|"red"|"amber"|"purple"; badge?: string }) {
  const colors = { emerald: "bg-emerald-50 border-emerald-200 text-emerald-700", blue: "bg-blue-50 border-blue-200 text-blue-700", red: "bg-red-50 border-red-200 text-red-700", amber: "bg-amber-50 border-amber-200 text-amber-700", purple: "bg-purple-50 border-purple-200 text-purple-700" };
  const iconColors = { emerald: "bg-emerald-200 text-emerald-700", blue: "bg-blue-200 text-blue-700", red: "bg-red-200 text-red-700", amber: "bg-amber-200 text-amber-700", purple: "bg-purple-200 text-purple-700" };
  const badgeColors = { emerald: "bg-emerald-200 text-emerald-800", blue: "bg-blue-200 text-blue-800", red: "bg-red-200 text-red-800", amber: "bg-amber-200 text-amber-800", purple: "bg-purple-200 text-purple-800" };
  const textColors = { emerald: "text-emerald-700", blue: "text-blue-700", red: "text-red-700", amber: "text-amber-700", purple: "text-purple-700" };
  return (
    <div className={cn("rounded-xl p-4 border-2 shadow-sm", colors[color].split(' ').slice(0,2).join(' '))}>
      <div className="flex items-center justify-between mb-2">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", iconColors[color])}><Icon className="w-4 h-4" /></div>
        {badge && <span className={cn("text-[9px] font-black px-1.5 py-0.5 rounded-full", badgeColors[color])}>{badge}</span>}
      </div>
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">{title}</div>
      <div className={cn("text-2xl font-black", textColors[color])}>{value}</div>
      <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}

