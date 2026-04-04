import { ProjectData } from "../types";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from "recharts";
import { TrendingUp, DollarSign, Percent, Target, BarChart3 } from "lucide-react";
import { cn } from "../utils/cn";

interface InsightsProps {
  project: ProjectData;
}

export function Insights({ project }: InsightsProps) {
  const currSym = project.currency.includes("EUR") ? "€" : "$";
  const isFin = !["Viewability", "VTR", "CTR"].includes(project.kpiType);

// Fonction de formatage avec devise ou %
const fmtKpi = (val: number) => {
  const formatted = project.kpiType.includes("CPCV") ? val.toFixed(3) : val.toFixed(2);
  
  if (isFin) {
    return `${formatted} ${currSym}`;  // KPI financier → devise
  } else {
    return `${formatted} %`;           // KPI de qualité → pourcentage
  }
};
  
  // Préparer les données pour les graphiques
  const dailyData = (project.dailyEntries || [])
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(entry => ({
      date: new Date(entry.date).toLocaleDateString('fr-FR', { 
        day: '2-digit', 
        month: 'short' 
      }),
      fullDate: entry.date,
      budgetSpent: entry.budgetSpent,
      cpmRevenue: entry.cpmRevenue,
      marginPct: entry.marginPct,
      kpiActual: entry.kpiActual,
      gain: entry.budgetSpent * (entry.marginPct / 100),
      cpmCost: entry.cpmRevenue * (1 - entry.marginPct / 100)
    }));

  // Calculer les données cumulatives
  let cumulativeBudget = 0;
  let cumulativeGain = 0;
  
  const cumulativeData = dailyData.map(day => {
    cumulativeBudget += day.budgetSpent;
    cumulativeGain += day.gain;
    
    return {
      ...day,
      cumulativeBudget,
      cumulativeGain
    };
  });

  // Statistiques
  const stats = (() => {
    const totalDays = dailyData.length;
    const totalBudget = cumulativeBudget;
    const totalGain = cumulativeGain;
    if (totalDays === 0 || totalBudget === 0) return { totalDays, totalBudget, totalGain, avgMargin: 0, avgCpmRevenue: 0, avgKpi: 0 };
    // Marge cumulée = gain total / budget total
    const avgMargin = (totalGain / totalBudget) * 100;
    // CPM Revenue cumulé = total spend / total impressions
    const totalImp = dailyData.reduce((s, d) => d.cpmRevenue > 0 ? s + d.budgetSpent / d.cpmRevenue : s, 0);
    const avgCpmRevenue = totalImp > 0 ? totalBudget / totalImp : 0;
    // KPI cumulé (harmonique pour financier, pondéré pour qualité)
    let avgKpi = 0;
    if (isFin) {
      const totalActions = dailyData.reduce((s, d) => d.kpiActual > 0 ? s + d.budgetSpent / d.kpiActual : s, 0);
      avgKpi = totalActions > 0 ? totalBudget / totalActions : 0;
    } else {
      avgKpi = dailyData.reduce((s, d) => s + d.budgetSpent * d.kpiActual, 0) / totalBudget;
    }
    return { totalDays, totalBudget, totalGain, avgMargin, avgCpmRevenue, avgKpi };
  })();

  if (dailyData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 text-slate-500 p-8">
        <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4">
          <BarChart3 className="w-8 h-8 text-slate-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-700 mb-2">Aucune donnée à afficher</h2>
        <p className="text-center max-w-md">
          Commencez par enregistrer des données quotidiennes dans l'onglet <strong>Suivi Campagne</strong> pour voir vos graphiques d'évolution ici.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 h-full overflow-y-auto bg-[#f8f9fa]">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div>
          <h2 className="text-2xl font-bold text-gray-900">📊 Insights & Évolution</h2>
          <p className="text-gray-500 mt-1">
            Visualisez les tendances et performances de votre campagne
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-6">
          <MetricCard 
            title="Budget Total" 
            value={`${stats.totalBudget.toFixed(0)} ${currSym}`}
            icon={DollarSign}
            color="blue"
          />
          <MetricCard 
            title="Gain Total" 
            value={`${stats.totalGain.toFixed(0)} ${currSym}`}
            icon={TrendingUp}
            color="emerald"
          />
          <MetricCard 
            title="Marge Cumulée" 
            value={`${stats.avgMargin.toFixed(2)} %`}
            icon={Percent}
            color="purple"
          />
          <MetricCard 
            title={`${project.kpiType} Cumulé`} 
            value={fmtKpi(stats.avgKpi)}
            icon={Target}
            color="amber"
          />
        </div>

        {/* Graphique 1 : Budget Cumulé & Gain Cumulé */}
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100 p-6">
            <h3 className="text-lg font-bold text-blue-900">💰 Évolution Cumulative : Budget & Gain</h3>
            <p className="text-sm text-blue-700 mt-1">
              Suivi de votre budget dépensé et du gain accumulé au fil des jours
            </p>
          </div>
          <div className="p-6">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cumulativeData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorBudget" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorGain" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} 
                    axisLine={false} 
                    tickLine={false} 
                  />
                  <YAxis 
                    tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} 
                    axisLine={false} 
                    tickLine={false}
                    tickFormatter={(val) => `${val.toLocaleString()} ${currSym}`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      borderRadius: '12px', 
                      border: '1px solid #e2e8f0', 
                      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                      fontWeight: 'bold'
                    }}
                    formatter={(value: number) => `${value.toFixed(0)} ${currSym}`}
                    labelFormatter={(label, payload) => {
                      if (payload && payload[0]) {
                        return new Date(payload[0].payload.fullDate).toLocaleDateString('fr-FR', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long'
                        });
                      }
                      return label;
                    }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                  <Area 
                    type="monotone" 
                    dataKey="cumulativeBudget" 
                    stroke="#3b82f6" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorBudget)"
                    name="Budget Cumulé"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="cumulativeGain" 
                    stroke="#10b981" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorGain)"
                    name="Gain Cumulé"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Graphique 2 : Marge % par Jour */}
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-purple-50 to-pink-50 border-b border-purple-100 p-6">
            <h3 className="text-lg font-bold text-purple-900">📊 Évolution de la Marge</h3>
            <p className="text-sm text-purple-700 mt-1">
              Performance de votre marge jour après jour
            </p>
          </div>
          <div className="p-6">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} 
                    axisLine={false} 
                    tickLine={false} 
                  />
                  <YAxis 
                    tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} 
                    axisLine={false} 
                    tickLine={false}
                    tickFormatter={(val) => `${val}%`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      borderRadius: '12px', 
                      border: '1px solid #e2e8f0', 
                      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                      fontWeight: 'bold'
                    }}
                    formatter={(value: number) => `${value.toFixed(2)} %`}
                  />
                  <Legend iconType="circle" />
                  <Line 
                    type="monotone" 
                    dataKey="marginPct" 
                    stroke="#9333ea" 
                    strokeWidth={3}
                    name="Marge %"
                    dot={{ r: 5, fill: '#9333ea' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Graphique 3 : CPM Revenue vs CPM Cost */}
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100 p-6">
            <h3 className="text-lg font-bold text-amber-900">💵 CPM : Revenu vs Cost</h3>
            <p className="text-sm text-amber-700 mt-1">
              Comparaison entre votre CPM de vente et votre CPM d'achat
            </p>
          </div>
          <div className="p-6">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} 
                    axisLine={false} 
                    tickLine={false} 
                  />
                  <YAxis 
                    tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} 
                    axisLine={false} 
                    tickLine={false}
                    tickFormatter={(val) => `${val.toFixed(2)} ${currSym}`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      borderRadius: '12px', 
                      border: '1px solid #e2e8f0', 
                      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                      fontWeight: 'bold'
                    }}
                    formatter={(value: number) => `${value.toFixed(2)} ${currSym}`}
                  />
                  <Legend iconType="circle" />
                  <Line 
                    type="monotone" 
                    dataKey="cpmRevenue" 
                    stroke="#f59e0b" 
                    strokeWidth={3}
                    name="CPM Revenue"
                    dot={{ r: 5, fill: '#f59e0b' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="cpmCost" 
                    stroke="#ef4444" 
                    strokeWidth={3}
                    strokeDasharray="5 5"
                    name="CPM Cost"
                    dot={{ r: 5, fill: '#ef4444' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Graphique 4 : KPI par Jour */}
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100 p-6">
            <h3 className="text-lg font-bold text-emerald-900">🎯 Évolution du {project.kpiType}</h3>
            <p className="text-sm text-emerald-700 mt-1">
              Performance de votre KPI objectif au fil du temps
            </p>
          </div>
          <div className="p-6">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} 
                    axisLine={false} 
                    tickLine={false} 
                  />
                  <YAxis 
                    tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} 
                    axisLine={false} 
                    tickLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      borderRadius: '12px', 
                      border: '1px solid #e2e8f0', 
                      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                      fontWeight: 'bold'
                    }}
                    formatter={(value: number) => fmtKpi(value)}
                  />
                  <Legend iconType="circle" />
                  <Bar 
                    dataKey="kpiActual" 
                    fill="#10b981" 
                    name={project.kpiType}
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, color }: { 
  title: string; 
  value: string; 
  icon: any; 
  color: "blue" | "emerald" | "purple" | "amber";
}) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">{title}</div>
        <div className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center",
          color === "blue" && "bg-blue-100 text-blue-600",
          color === "emerald" && "bg-emerald-100 text-emerald-600",
          color === "purple" && "bg-purple-100 text-purple-600",
          color === "amber" && "bg-amber-100 text-amber-600"
        )}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="text-3xl font-black text-gray-900">{value}</div>
    </div>
  );
}
