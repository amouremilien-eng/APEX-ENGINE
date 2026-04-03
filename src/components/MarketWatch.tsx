// src/components/MarketWatch.tsx

import { useState, useMemo } from "react";
import { cn } from "../utils/cn";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { TrendingUp, TrendingDown, Info, DollarSign, Activity, Target, AlertCircle } from "lucide-react";
import { 
  generateMarketHistory, 
  getCurrentPrice, 
  getAvailableFormats, 
  getAvailableCountries,
  calculateRSI 
} from "../utils/marketPricing";

interface MarketWatchProps {
  currentCost: number;
}

export function MarketWatch({ currentCost }: MarketWatchProps) {
  const [country, setCountry] = useState("France");
  const [format, setFormat] = useState("Video Pre-roll");
  const [timeRange, setTimeRange] = useState(365);

  const availableCountries = getAvailableCountries();
  const availableFormats = getAvailableFormats();

  // Historique des prix
  const history = useMemo(() => {
    return generateMarketHistory(format, country, timeRange);
  }, [format, country, timeRange]);

  // Prix actuel du marché
  const marketPrice = useMemo(() => {
    return getCurrentPrice(format, country);
  }, [format, country]);

  // Statistiques
  const stats = useMemo(() => {
    const prices = history.map(h => h.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const priceChange = ((lastPrice / firstPrice) - 1) * 100;
    
    // Volatilité (écart-type)
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((acc, p) => acc + Math.pow(p - mean, 2), 0) / prices.length;
    const volatility = Math.sqrt(variance);
    
    // RSI
    const rsi = calculateRSI(prices, 14);
    
    return { min, max, priceChange, volatility, mean, rsi };
  }, [history]);

  // Comparaison vs ton cost
  const comparison = useMemo(() => {
    if (currentCost === 0) return null;
    
    const diff = currentCost - marketPrice;
    const diffPct = (diff / marketPrice) * 100;
    
    let status: "excellent" | "good" | "warning" | "danger";
    let message: string;
    
    if (diffPct <= -10) {
      status = "excellent";
      message = "Excellent ! Tu achètes 10%+ moins cher que le marché.";
    } else if (diffPct <= 0) {
      status = "good";
      message = "Bon prix. Tu es dans la fourchette basse du marché.";
    } else if (diffPct <= 10) {
      status = "warning";
      message = "Attention. Tu paies un peu plus cher que le marché.";
    } else {
      status = "danger";
      message = "Alerte ! Tu surpaies de +10% vs le marché.";
    }
    
    return { diff, diffPct, status, message };
  }, [currentCost, marketPrice]);

  // Signal trading simple
  const signal = useMemo(() => {
    const { rsi, priceChange } = stats;
    
    if (rsi < 30 && priceChange < -5) {
      return { 
        type: "BUY" as const, 
        label: "ACHETER", 
        reason: "Prix en correction + RSI oversold" 
      };
    }
    
    if (rsi > 70 && priceChange > 10) {
      return { 
        type: "SELL" as const, 
        label: "AUGMENTER MARGE", 
        reason: "Prix surchauffe + RSI overbought" 
      };
    }
    
    return { 
      type: "HOLD" as const, 
      label: "STABLE", 
      reason: "Marché équilibré" 
    };
  }, [stats]);

  // Données graphique avec MA7
  const chartData = useMemo(() => {
    return history.map((h, idx) => {
      let ma7 = h.price;
      if (idx >= 6) {
        ma7 = history.slice(idx - 6, idx + 1).reduce((acc, p) => acc + p.price, 0) / 7;
      }
      
      const dateObj = new Date(h.date);
      let dateLabel = dateObj.toLocaleDateString('fr-FR', { 
        day: '2-digit', 
        month: 'short'
      });
      
      if (timeRange > 90) {
        dateLabel = dateObj.toLocaleDateString('fr-FR', { 
          month: 'short',
          year: '2-digit'
        });
      }
      
      return {
        dateLabel,
        fullDate: h.date,
        price: h.price,
        ma7
      };
    });
  }, [history, timeRange]);

  return (
    <div className="p-8 h-full overflow-y-auto bg-[#f8f9fa]">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Market Watch</h2>
          <div className="text-sm text-gray-500 font-medium flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            Prix actualisés en temps réel
          </div>
        </div>

        {/* 🔴 ENCADRÉ CRITIQUE : TARGETING PUR + OPEN WEB + RSI EXPLIQUÉ */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-2xl p-5 shadow-md space-y-4">
          <div className="flex items-start gap-4">
            <div className="bg-white p-3 rounded-xl shadow-sm shrink-0">
              <Info className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-bold text-blue-900 text-lg mb-2">
                📊 Prix Open Auction • Targeting Pur
              </h3>
              <p className="text-blue-800 text-sm leading-relaxed mb-3">
                Les prix affichés représentent le <strong>marché libre (Open Auction)</strong> sur l'Open Web 
                en <strong>Targeting pur</strong> (audiences contextuelles, géo, socio-démo).
              </p>
              <div className="bg-blue-100 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 font-medium space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold">✅ Inclus :</span>
                  <span>Contextual, Geo-Targeting, Démographie</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold">❌ Exclus :</span>
                  <span>Retargeting, Deals privés (PMP), Programmatic Guaranteed</span>
                </div>
              </div>
            </div>
          </div>

          {/* Explication RSI */}
          <div className="flex items-start gap-4 bg-white/60 rounded-xl p-4 border border-blue-200">
            <div className="bg-indigo-100 p-2 rounded-lg shrink-0">
              <AlertCircle className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h4 className="font-bold text-indigo-900 text-sm mb-1">
                📈 RSI (Relative Strength Index)
              </h4>
              <p className="text-indigo-800 text-xs leading-relaxed">
                Indicateur de momentum sur 14 jours. <strong>RSI &lt; 30 = Oversold</strong> (marché survendu, 
                signal d'achat). <strong>RSI &gt; 70 = Overbought</strong> (marché surchauffé, signal de vente). 
                Entre 30-70 = zone neutre.
              </p>
            </div>
          </div>
        </div>

        {/* Filtres */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 grid grid-cols-3 gap-5">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
              🌍 Pays
            </label>
            <select 
              className="w-full text-sm border-gray-200 bg-gray-50 rounded-xl p-3 border focus:ring-2 focus:ring-blue-500 outline-none font-medium transition-all"
              value={country} 
              onChange={(e) => setCountry(e.target.value)}
            >
              {availableCountries.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
              📦 Format
            </label>
            <select 
              className="w-full text-sm border-gray-200 bg-gray-50 rounded-xl p-3 border focus:ring-2 focus:ring-blue-500 outline-none font-medium transition-all"
              value={format} 
              onChange={(e) => setFormat(e.target.value)}
            >
              {availableFormats.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
              📅 Période
            </label>
            <select 
              className="w-full text-sm border-gray-200 bg-gray-50 rounded-xl p-3 border focus:ring-2 focus:ring-blue-500 outline-none font-medium transition-all"
              value={timeRange} 
              onChange={(e) => setTimeRange(Number(e.target.value))}
            >
              <option value={7}>7 jours</option>
              <option value={30}>30 jours</option>
              <option value={90}>3 mois</option>
              <option value={180}>6 mois</option>
              <option value={365}>1 an</option>
            </select>
          </div>
        </div>

        {/* Signal Trading */}
        <div className={cn(
          "rounded-2xl p-5 flex items-center gap-5 border-2 shadow-sm",
          signal.type === "BUY" ? "bg-emerald-50 border-emerald-300" :
          signal.type === "SELL" ? "bg-red-50 border-red-300" :
          "bg-gray-50 border-gray-300"
        )}>
          <div className={cn(
            "text-4xl font-black px-6 py-3 rounded-xl shadow-md",
            signal.type === "BUY" ? "bg-emerald-500 text-white" :
            signal.type === "SELL" ? "bg-red-500 text-white" :
            "bg-gray-400 text-white"
          )}>
            {signal.type === "BUY" ? "🟢" : signal.type === "SELL" ? "🔴" : "⏸️"}
          </div>
          <div className="flex-1">
            <div className={cn(
              "text-2xl font-black mb-1",
              signal.type === "BUY" ? "text-emerald-900" :
              signal.type === "SELL" ? "text-red-900" :
              "text-gray-900"
            )}>
              {signal.label}
            </div>
            <div className={cn(
              "text-sm font-medium",
              signal.type === "BUY" ? "text-emerald-700" :
              signal.type === "SELL" ? "text-red-700" :
              "text-gray-700"
            )}>
              {signal.reason}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">RSI (14)</div>
            <div className={cn(
              "text-3xl font-black",
              stats.rsi < 30 ? "text-emerald-600" :
              stats.rsi > 70 ? "text-red-600" :
              "text-gray-600"
            )}>
              {stats.rsi.toFixed(0)}
            </div>
            <div className={cn(
              "text-xs font-bold mt-1",
              stats.rsi < 30 ? "text-emerald-600" :
              stats.rsi > 70 ? "text-red-600" :
              "text-gray-500"
            )}>
              {stats.rsi < 30 ? "Oversold" : stats.rsi > 70 ? "Overbought" : "Neutre"}
            </div>
          </div>
        </div>

        {/* Comparaison vs Ton Cost */}
        {comparison && (
          <div className={cn(
            "rounded-2xl p-5 border-2 flex items-center justify-between",
            comparison.status === "excellent" ? "bg-emerald-50 border-emerald-300" :
            comparison.status === "good" ? "bg-blue-50 border-blue-300" :
            comparison.status === "warning" ? "bg-amber-50 border-amber-300" :
            "bg-red-50 border-red-300"
          )}>
            <div>
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                Ton CPM Cost vs Marché
              </div>
              <div className={cn(
                "text-2xl font-black",
                comparison.status === "excellent" ? "text-emerald-600" :
                comparison.status === "good" ? "text-blue-600" :
                comparison.status === "warning" ? "text-amber-600" :
                "text-red-600"
              )}>
                {comparison.diffPct > 0 ? "+" : ""}{comparison.diffPct.toFixed(1)}%
              </div>
              <div className={cn(
                "text-sm font-medium mt-1",
                comparison.status === "excellent" ? "text-emerald-700" :
                comparison.status === "good" ? "text-blue-700" :
                comparison.status === "warning" ? "text-amber-700" :
                "text-red-700"
              )}>
                {comparison.message}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500 font-bold mb-1">Ton Cost</div>
              <div className="text-2xl font-black text-gray-900">
                {currentCost.toFixed(2)} €
              </div>
              <div className="text-xs text-gray-500 font-bold mt-2">Marché</div>
              <div className="text-lg font-bold text-gray-700">
                {marketPrice.toFixed(2)} €
              </div>
            </div>
          </div>
        )}

        {/* Graphique */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-6 border-b border-gray-100 bg-gray-50/50">
            <h3 className="text-lg font-bold text-gray-900">Évolution du Prix Open Web</h3>
            <div className="text-sm text-gray-600 mt-1">
              {format} • {country} • Derniers {timeRange} jours
            </div>
          </div>
          <div className="p-6">
            <div className="h-96 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="dateLabel" 
                    tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }} 
                    axisLine={false} 
                    tickLine={false}
                    interval={Math.floor(chartData.length / 8)}
                  />
                  <YAxis 
                    tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 600 }} 
                    axisLine={false} 
                    tickLine={false} 
                    tickFormatter={(val) => `${val.toFixed(2)}€`}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      borderRadius: '12px', 
                      border: '1px solid #e2e8f0', 
                      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', 
                      fontWeight: 'bold',
                      fontSize: '13px'
                    }}
                    formatter={(value: number, name: string) => [
                      `${value.toFixed(2)} €`, 
                      name === "price" ? "Prix" : "MA7"
                    ]}
                    labelFormatter={(label, payload) => {
                      if (payload && payload[0]) {
                        return new Date(payload[0].payload.fullDate).toLocaleDateString('fr-FR', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric'
                        });
                      }
                      return label;
                    }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="price" 
                    stroke="#3b82f6" 
                    strokeWidth={3} 
                    fillOpacity={1} 
                    fill="url(#colorPrice)" 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="ma7" 
                    stroke="#f59e0b" 
                    strokeWidth={2} 
                    strokeDasharray="5 5" 
                    fill="none" 
                  />
                  {currentCost > 0 && (
                    <ReferenceLine 
                      y={currentCost} 
                      stroke="#ef4444" 
                      strokeWidth={2}
                      strokeDasharray="3 3"
                      label={{ 
                        value: 'Ton Cost', 
                        position: 'right',
                        fill: '#ef4444',
                        fontWeight: 'bold',
                        fontSize: 12
                      }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-5">
          <MetricCard 
            title="Prix Actuel" 
            value={`${marketPrice.toFixed(2)} €`}
            icon={DollarSign}
            color="blue"
          />
          <MetricCard 
            title="Plus Bas" 
            value={`${stats.min.toFixed(2)} €`}
            subValue={`${((marketPrice/stats.min - 1)*100).toFixed(1)}% vs min`}
            icon={TrendingDown}
            color="emerald"
          />
          <MetricCard 
            title="Plus Haut" 
            value={`${stats.max.toFixed(2)} €`}
            subValue={`${((marketPrice/stats.max - 1)*100).toFixed(1)}% vs max`}
            icon={TrendingUp}
            color="red"
          />
          <MetricCard 
            title="Tendance" 
            value={`${stats.priceChange > 0 ? "+" : ""}${stats.priceChange.toFixed(1)}%`}
            subValue={`sur ${timeRange}j`}
            icon={Activity}
            color={stats.priceChange > 0 ? "emerald" : "red"}
          />
        </div>

        {/* Conseil Trader */}
        <div className={cn(
          "p-6 rounded-2xl border-2 flex items-start gap-5",
          stats.priceChange > 5 ? "bg-amber-50 border-amber-300" : 
          stats.priceChange < -5 ? "bg-emerald-50 border-emerald-300" : 
          "bg-blue-50 border-blue-300"
        )}>
          <div className="text-4xl mt-1 bg-white p-4 rounded-xl shadow-sm">
            {stats.priceChange > 5 ? "📈" : stats.priceChange < -5 ? "📉" : "⚖️"}
          </div>
          <div>
            <h4 className="font-black text-xl mb-2 text-gray-900">Conseil Trader</h4>
            <p className="text-sm font-medium leading-relaxed text-gray-700">
              {stats.priceChange > 5 
                ? `Tendance Haussière (+${stats.priceChange.toFixed(1)}%) : Le marché s'apprécie. Si tu as du budget restant, achète maintenant avant que les prix montent encore. RSI à ${stats.rsi.toFixed(0)}.` 
                : stats.priceChange < -5 
                ? `Tendance Baissière (${stats.priceChange.toFixed(1)}%) : Le marché est en correction. C'est le bon moment pour augmenter ta marge ou attendre encore pour acheter moins cher. RSI à ${stats.rsi.toFixed(0)}.` 
                : `Marché Stable (${stats.priceChange > 0 ? '+' : ''}${stats.priceChange.toFixed(1)}%) : Prix dans la fourchette normale. Continue ton trading habituel. RSI équilibré à ${stats.rsi.toFixed(0)}.`}
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}

function MetricCard({ 
  title, 
  value, 
  subValue, 
  icon: Icon, 
  color 
}: { 
  title: string; 
  value: string; 
  subValue?: string; 
  icon: any; 
  color: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">{title}</div>
        <div className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center",
          color === "blue" && "bg-blue-50 text-blue-600",
          color === "emerald" && "bg-emerald-50 text-emerald-600",
          color === "red" && "bg-red-50 text-red-600"
        )}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="text-2xl font-black text-gray-900">{value}</div>
      {subValue && (
        <div className="text-xs font-medium text-gray-500 mt-2 bg-gray-50 px-2 py-1 rounded-md inline-block">
          {subValue}
        </div>
      )}
    </div>
  );
}
