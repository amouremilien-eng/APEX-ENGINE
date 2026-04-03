import { useState, useMemo, useCallback } from "react";
import { cn } from "../utils/cn";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, BarChart3, ChevronUp, ChevronDown, RefreshCw, Zap, Info } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

// ============================================================
// TYPES
// ============================================================
interface TTDRow {
  date: string;
  advertiser: string;
  currency: string;
  campaign: string;
  adGroup: string;
  mediaType: string;
  adFormat: string;
  creative: string;
  advertiserCost: number;
  partnerCost: number;
  mediaCost: number;
  dataCost: number;
  impressions: number;
  clicks: number;
  viewedImpressions: number;
  trackedImpressions: number;
  q25: number;
  q50: number;
  q75: number;
  completedViews: number;
  // Conversions (aggregated)
  totalClickConversions: number;
  totalViewConversions: number;
  totalConversions: number;
}

interface AggregatedLine {
  adGroup: string;
  adGroupShort: string;
  mediaType: string;
  device: string;
  // Metrics
  advertiserCost: number;
  partnerCost: number;
  mediaCost: number;
  dataCost: number;
  impressions: number;
  clicks: number;
  viewedImpressions: number;
  trackedImpressions: number;
  completedViews: number;
  totalConversions: number;
  daysActive: number;
  creativesCount: number;
  // Calculated KPIs
  cpm: number;
  cpmCost: number;
  cpc: number;
  cpcv: number;
  cpa: number;
  vtr: number;
  viewability: number;
  ctr: number;
  margin: number;
  dailySpend: number;
  // Optimization
  score: number;
  recommendation: "scale_up" | "maintain" | "reduce" | "pause";
  recommendationLabel: string;
  recommendationDetail: string;
  budgetAdjustPct: number;
  isEdited: boolean;
}

interface TTDImporterProps {
  onImportLines?: (lines: AggregatedLine[]) => void;
  initialFile?: File | null;
  kpiType?: string;
  targetKpi?: number;
  onBack?: () => void;
  onApplyToLineItems?: (lineItems: any[]) => void;
}


// ============================================================
// HELPERS
// ============================================================
function parseAdGroupName(fullName: string): { short: string; device: string } {
  const parts = fullName.split(" [");
  const short = parts[0] || fullName;
  let device = "All";
  if (fullName.includes("[dv:D]")) device = "Desktop";
  else if (fullName.includes("[dv:M]")) device = "Mobile";
  else if (fullName.includes("[dv:T]")) device = "Tablet";
  else if (fullName.toLowerCase().includes("_desk")) device = "Desktop";
  else if (fullName.toLowerCase().includes("_mob")) device = "Mobile";
  else if (fullName.toLowerCase().includes("_inter")) device = "Tablet";
  return { short, device };
}

function detectKpiType(lines: AggregatedLine[]): string {
  const hasVideo = lines.some(l => l.mediaType === "Video" && l.completedViews > 0);
  const hasClicks = lines.some(l => l.clicks > 0);
  const hasConversions = lines.some(l => l.totalConversions > 0);
  if (hasConversions) return "CPA";
  if (hasVideo) return "CPCV";
  if (hasClicks) return "CPC";
  return "CPM";
}

const COLORS = {
  scale_up: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", badge: "bg-emerald-100 text-emerald-800" },
  maintain: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", badge: "bg-blue-100 text-blue-800" },
  reduce: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", badge: "bg-amber-100 text-amber-800" },
  pause: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", badge: "bg-red-100 text-red-800" },
};

// ============================================================
// COMPONENT
// ============================================================
export function TTDImporter({ onImportLines, initialFile, kpiType: parentKpiType, targetKpi: parentTargetKpi, onBack, onApplyToLineItems }: TTDImporterProps) {
  const [rawData, setRawData] = useState<TTDRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [selectedCampaign, setSelectedCampaign] = useState<string>("all");
  const [kpiType, setKpiType] = useState<string>(parentKpiType || "auto");
  const [targetKpi, setTargetKpi] = useState<number>(parentTargetKpi || 0);
  const [sortBy, setSortBy] = useState<string>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [lines, setLines] = useState<AggregatedLine[]>([]);
  const [showChart, setShowChart] = useState(true);
  const [step, setStep] = useState<"upload" | "config" | "results">("upload");

  // ============================================================
  // PARSE XLSX
  // ============================================================
  const handleFileUpload = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: 0 });

      if (json.length === 0) throw new Error("Fichier vide");

      // Map TTD columns
      const rows: TTDRow[] = json.map((r: any) => {
        // Sum all conversion columns (Click + View + Total)
        let totalClick = 0, totalView = 0, totalAll = 0;
        Object.keys(r).forEach(k => {
          if (k.includes("Click Conversion") && !k.includes("Total")) totalClick += Number(r[k]) || 0;
          if (k.includes("View Through Conversion") && !k.includes("Total")) totalView += Number(r[k]) || 0;
          if (k.includes("Total Click + View")) totalAll += Number(r[k]) || 0;
        });

        const dateVal = r["Date"];
        let dateStr = "";
        if (dateVal instanceof Date) dateStr = dateVal.toISOString().split("T")[0];
        else if (typeof dateVal === "string") dateStr = dateVal.split(" ")[0].split("T")[0];
        else dateStr = String(dateVal);

        return {
          date: dateStr,
          advertiser: r["Advertiser"] || "",
          currency: r["Advertiser Currency Code"] || "EUR",
          campaign: r["Campaign"] || "",
          adGroup: r["Ad Group"] || "",
          mediaType: r["Media Type"] || "",
          adFormat: r["Ad Format"] || "",
          creative: r["Creative"] || "",
          advertiserCost: Number(r["Advertiser Cost (Adv Currency)"]) || 0,
          partnerCost: Number(r["Partner Cost (Adv Currency)"]) || 0,
          mediaCost: Number(r["Media Cost (Adv Currency)"]) || 0,
          dataCost: Number(r["Data Cost (Adv Currency)"]) || 0,
          impressions: Number(r["Impressions"]) || 0,
          clicks: Number(r["Clicks"]) || 0,
          viewedImpressions: Number(r["Sampled Viewed Impressions"]) || 0,
          trackedImpressions: Number(r["Sampled Tracked Impressions"]) || 0,
          q25: Number(r["Player 25% Complete"]) || 0,
          q50: Number(r["Player 50% Complete"]) || 0,
          q75: Number(r["Player 75% Complete"]) || 0,
          completedViews: Number(r["Player Completed Views"]) || 0,
          totalClickConversions: totalClick,
          totalViewConversions: totalView,
          totalConversions: totalAll > 0 ? totalAll : totalClick + totalView,
        };
      });

      setRawData(rows);
      setStep("config");
      console.log(`✅ TTD Import: ${rows.length} lignes parsées, ${new Set(rows.map(r => r.campaign)).size} campagnes`);
    } catch (err: any) {
      setError(err.message || "Erreur de lecture du fichier");
      console.error("❌ TTD Import error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".xlsx") || file.name.endsWith(".xls") || file.name.endsWith(".csv"))) {
      handleFileUpload(file);
    } else {
      setError("Format non supporté. Utilisez un fichier .xlsx ou .xls");
    }
  }, [handleFileUpload]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  // ============================================================
  // CAMPAIGNS LIST
  // ============================================================
  const campaigns = useMemo(() => {
    const set = new Set(rawData.map(r => r.campaign));
    return Array.from(set).sort();
  }, [rawData]);

  // ============================================================
  // AGGREGATE BY AD GROUP + CALCULATE KPIs
  // ============================================================
  const processData = useCallback(() => {
    const filtered = selectedCampaign === "all" ? rawData : rawData.filter(r => r.campaign === selectedCampaign);
    const groups = new Map<string, TTDRow[]>();
    filtered.forEach(r => {
      const key = r.adGroup;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    });

    const effectiveKpi = kpiType === "auto" ? detectKpiType(Array.from(groups.entries()).map(([ag, rows]) => {
      const imp = rows.reduce((s, r) => s + r.impressions, 0);
      return { mediaType: rows[0].mediaType, completedViews: rows.reduce((s, r) => s + r.completedViews, 0), clicks: rows.reduce((s, r) => s + r.clicks, 0), totalConversions: rows.reduce((s, r) => s + r.totalConversions, 0) } as any;
    })) : kpiType;

    const aggregated: AggregatedLine[] = Array.from(groups.entries()).map(([adGroup, rows]) => {
      const { short, device } = parseAdGroupName(adGroup);
      const adCost = rows.reduce((s, r) => s + r.advertiserCost, 0);
      const partCost = rows.reduce((s, r) => s + r.partnerCost, 0);
      const medCost = rows.reduce((s, r) => s + r.mediaCost, 0);
      const datCost = rows.reduce((s, r) => s + r.dataCost, 0);
      const imp = rows.reduce((s, r) => s + r.impressions, 0);
      const clk = rows.reduce((s, r) => s + r.clicks, 0);
      const viewed = rows.reduce((s, r) => s + r.viewedImpressions, 0);
      const tracked = rows.reduce((s, r) => s + r.trackedImpressions, 0);
      const completed = rows.reduce((s, r) => s + r.completedViews, 0);
      const conv = rows.reduce((s, r) => s + r.totalConversions, 0);
      const dates = new Set(rows.map(r => r.date));
      const creatives = new Set(rows.map(r => r.creative));

      const cpm = imp > 0 ? (adCost / imp) * 1000 : 0;
      const cpmCost = imp > 0 ? (partCost / imp) * 1000 : 0;
      const cpc = clk > 0 ? adCost / clk : 0;
      const cpcv = completed > 0 ? adCost / completed : 0;
      const cpa = conv > 0 ? adCost / conv : 0;
      const vtr = imp > 0 ? (completed / imp) * 100 : 0;
      const viewability = tracked > 0 ? (viewed / tracked) * 100 : 0;
      const ctr = imp > 0 ? (clk / imp) * 100 : 0;
      const margin = adCost > 0 ? ((adCost - partCost) / adCost) * 100 : 0;

      return {
        adGroup, adGroupShort: short, mediaType: rows[0].mediaType, device,
        advertiserCost: adCost, partnerCost: partCost, mediaCost: medCost, dataCost: datCost,
        impressions: imp, clicks: clk, viewedImpressions: viewed, trackedImpressions: tracked,
        completedViews: completed, totalConversions: conv,
        daysActive: dates.size, creativesCount: creatives.size,
        cpm, cpmCost, cpc, cpcv, cpa, vtr, viewability, ctr, margin,
        dailySpend: dates.size > 0 ? adCost / dates.size : 0,
        score: 0, recommendation: "maintain" as const, recommendationLabel: "", recommendationDetail: "", budgetAdjustPct: 0, isEdited: false,
      };
    });

    // ============================================================
    // OPTIMIZATION ENGINE
    // ============================================================
    if (aggregated.length > 0) {
      const totalSpend = aggregated.reduce((s, l) => s + l.advertiserCost, 0);

      // Get primary KPI value for each line
      const getKpiValue = (l: AggregatedLine): number => {
        switch (effectiveKpi) {
          case "CPA": return l.cpa;
          case "CPCV": return l.cpcv;
          case "CPC": return l.cpc;
          case "CPM": return l.cpm;
          case "VTR": return l.vtr;
          case "Viewability": return l.viewability;
          case "CTR": return l.ctr;
          default: return l.cpm;
        }
      };

      const isLowerBetter = ["CPA", "CPCV", "CPC", "CPM"].includes(effectiveKpi);
      const kpiValues = aggregated.filter(l => getKpiValue(l) > 0).map(l => getKpiValue(l));
      const avgKpi = kpiValues.length > 0 ? kpiValues.reduce((a, b) => a + b, 0) / kpiValues.length : 0;
      const target = targetKpi > 0 ? targetKpi : avgKpi;

      aggregated.forEach(line => {
        const kpiVal = getKpiValue(line);
        if (kpiVal === 0 || line.impressions === 0) {
          line.score = 0;
          line.recommendation = "pause";
          line.recommendationLabel = "⏸️ Pause";
          line.recommendationDetail = "Pas de données suffisantes";
          line.budgetAdjustPct = -100;
          return;
        }

        // Score: ratio vs target (normalized so >1 = good)
        let ratio: number;
        if (isLowerBetter) {
          ratio = target > 0 ? target / kpiVal : 1;
        } else {
          ratio = target > 0 ? kpiVal / target : 1;
        }

        // Bonus for high margin
        const marginBonus = line.margin > 0 ? 1 + (line.margin / 200) : 1;
        // Bonus for volume (lines with more spend are more reliable)
        const volumeBonus = totalSpend > 0 ? 1 + (line.advertiserCost / totalSpend) * 0.5 : 1;

        line.score = Math.round(ratio * marginBonus * volumeBonus * 100) / 100;

        // Thresholds
        if (line.score >= 1.3) {
          line.recommendation = "scale_up";
          const pct = Math.min(50, Math.round((line.score - 1) * 40));
          line.budgetAdjustPct = pct;
          line.recommendationLabel = `🚀 Scale Up +${pct}%`;
          line.recommendationDetail = `${effectiveKpi} ${isLowerBetter ? "inférieur" : "supérieur"} de ${Math.round((line.score - 1) * 100)}% vs target. Marge ${line.margin.toFixed(1)}%.`;
        } else if (line.score >= 0.85) {
          line.recommendation = "maintain";
          line.budgetAdjustPct = 0;
          line.recommendationLabel = "✅ Maintenir";
          line.recommendationDetail = `Performance alignée avec l'objectif. ${effectiveKpi}: ${kpiVal.toFixed(2)}`;
        } else if (line.score >= 0.5) {
          line.recommendation = "reduce";
          const pct = Math.min(50, Math.round((1 - line.score) * 50));
          line.budgetAdjustPct = -pct;
          line.recommendationLabel = `⚠️ Réduire -${pct}%`;
          line.recommendationDetail = `${effectiveKpi} sous-performe de ${Math.round((1 - line.score) * 100)}% vs target.`;
        } else {
          line.recommendation = "pause";
          line.budgetAdjustPct = -100;
          line.recommendationLabel = "⏸️ Pause";
          line.recommendationDetail = `${effectiveKpi} très dégradé (score ${line.score.toFixed(2)}). Recommandation : pause et analyse.`;
        }
      });
    }

    // Sort
    aggregated.sort((a, b) => b.score - a.score);
    setLines(aggregated);
    if (kpiType === "auto") setKpiType(detectKpiType(aggregated));
    setStep("results");
  }, [rawData, selectedCampaign, kpiType, targetKpi]);

  // ============================================================
  // SORT
  // ============================================================
  const sortedLines = useMemo(() => {
    const sorted = [...lines];
    sorted.sort((a, b) => {
      let va: number, vb: number;
      switch (sortBy) {
        case "score": va = a.score; vb = b.score; break;
        case "spend": va = a.advertiserCost; vb = b.advertiserCost; break;
        case "impressions": va = a.impressions; vb = b.impressions; break;
        case "margin": va = a.margin; vb = b.margin; break;
        case "cpm": va = a.cpm; vb = b.cpm; break;
        case "vtr": va = a.vtr; vb = b.vtr; break;
        case "ctr": va = a.ctr; vb = b.ctr; break;
        case "cpcv": va = a.cpcv; vb = b.cpcv; break;
        case "cpa": va = a.cpa; vb = b.cpa; break;
        case "viewability": va = a.viewability; vb = b.viewability; break;
        default: va = a.score; vb = b.score;
      }
      return sortDir === "desc" ? vb - va : va - vb;
    });
    return sorted;
  }, [lines, sortBy, sortDir]);

  // ============================================================
  // STATS SUMMARY
  // ============================================================
  const summary = useMemo(() => {
    if (lines.length === 0) return null;
    const scaleUp = lines.filter(l => l.recommendation === "scale_up");
    const maintain = lines.filter(l => l.recommendation === "maintain");
    const reduce = lines.filter(l => l.recommendation === "reduce");
    const pause = lines.filter(l => l.recommendation === "pause");
    const totalSpend = lines.reduce((s, l) => s + l.advertiserCost, 0);
    const totalImp = lines.reduce((s, l) => s + l.impressions, 0);
    const avgMargin = totalSpend > 0 ? lines.reduce((s, l) => s + l.advertiserCost * l.margin, 0) / totalSpend : 0;
    const budgetRealloc = lines.reduce((s, l) => s + l.advertiserCost * (l.budgetAdjustPct / 100), 0);
    return { scaleUp: scaleUp.length, maintain: maintain.length, reduce: reduce.length, pause: pause.length, totalSpend, totalImp, avgMargin, budgetRealloc, total: lines.length };
  }, [lines]);

  // Chart data
  const chartData = useMemo(() => {
    return sortedLines.slice(0, 15).map(l => ({
      name: l.adGroupShort.length > 20 ? l.adGroupShort.substring(0, 20) + "…" : l.adGroupShort,
      Score: l.score,
      fill: l.recommendation === "scale_up" ? "#10b981" : l.recommendation === "maintain" ? "#3b82f6" : l.recommendation === "reduce" ? "#f59e0b" : "#ef4444",
    }));
  }, [sortedLines]);

  // Edit handler
  const updateLineBudget = (idx: number, pct: number) => {
    setLines(prev => {
      const updated = [...prev];
      const line = { ...updated[idx] };
      line.budgetAdjustPct = pct;
      line.isEdited = true;
      if (pct >= 20) { line.recommendation = "scale_up"; line.recommendationLabel = `🚀 Scale Up +${pct}%`; }
      else if (pct > -10) { line.recommendation = "maintain"; line.recommendationLabel = "✅ Maintenir"; }
      else if (pct > -100) { line.recommendation = "reduce"; line.recommendationLabel = `⚠️ Réduire ${pct}%`; }
      else { line.recommendation = "pause"; line.recommendationLabel = "⏸️ Pause"; }
      updated[idx] = line;
      return updated;
    });
  };

  const handleSort = (col: string) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  const SortIcon = ({ col }: { col: string }) => sortBy === col ? (sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />) : null;

  // ============================================================
  // RENDER: UPLOAD STEP
  // ============================================================
  if (step === "upload") {
    return (
      <div className="p-8 h-full overflow-y-auto bg-[#f8f9fa]">
        <div className="max-w-3xl mx-auto space-y-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
              <FileSpreadsheet className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-black text-gray-900">Import Report TTD</h2>
            <p className="text-gray-500 mt-2">Importez un export TTD (.xlsx) pour analyser vos Ad Groups et obtenir des recommandations d'optimisation</p>
          </div>

          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className={cn(
              "border-3 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer",
              "hover:border-indigo-400 hover:bg-indigo-50/50",
              isLoading ? "border-indigo-400 bg-indigo-50" : "border-gray-300 bg-white"
            )}
            onClick={() => document.getElementById("ttd-file-input")?.click()}
          >
            <input id="ttd-file-input" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleInputChange} />
            
            {isLoading ? (
              <div className="space-y-4">
                <RefreshCw className="w-12 h-12 text-indigo-500 mx-auto animate-spin" />
                <div className="text-lg font-bold text-indigo-700">Analyse en cours...</div>
                <div className="text-sm text-indigo-500">{fileName}</div>
              </div>
            ) : (
              <div className="space-y-4">
                <Upload className="w-12 h-12 text-gray-400 mx-auto" />
                <div>
                  <div className="text-lg font-bold text-gray-700">Glissez votre export TTD ici</div>
                  <div className="text-sm text-gray-500 mt-1">ou cliquez pour parcourir • .xlsx uniquement</div>
                </div>
                <div className="flex items-center justify-center gap-4 text-xs text-gray-400 mt-4">
                  <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Ad Groups</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Impressions & Coûts</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> KPI & Conversions</span>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
              <div>
                <div className="font-bold text-red-800 text-sm">Erreur d'import</div>
                <div className="text-xs text-red-600">{error}</div>
              </div>
            </div>
          )}

          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5">
            <h4 className="font-bold text-indigo-900 text-sm mb-3 flex items-center gap-2"><Info className="w-4 h-4" /> Format attendu</h4>
            <div className="text-xs text-indigo-700 space-y-1">
              <p>Export TTD standard avec les colonnes : Date, Campaign, Ad Group, Media Type, Advertiser Cost, Partner Cost, Media Cost, Impressions, Clicks, Sampled Viewed/Tracked Impressions, Player Completed Views, Conversions.</p>
              <p className="font-bold mt-2">L'app agrège automatiquement par Ad Group sur toute la période.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // RENDER: CONFIG STEP
  // ============================================================
  if (step === "config") {
    return (
      <div className="p-8 h-full overflow-y-auto bg-[#f8f9fa]">
        <div className="max-w-3xl mx-auto space-y-8">
          <div>
            <h2 className="text-2xl font-black text-gray-900 flex items-center gap-3">
              <FileSpreadsheet className="w-7 h-7 text-indigo-600" />
              Configuration Import
            </h2>
            <p className="text-gray-500 mt-1">{rawData.length} lignes importées depuis {fileName}</p>
          </div>

          {/* Stats rapides */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
              <div className="text-2xl font-black text-gray-900">{rawData.length}</div>
              <div className="text-[10px] font-bold text-gray-500 uppercase">Lignes</div>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
              <div className="text-2xl font-black text-indigo-600">{campaigns.length}</div>
              <div className="text-[10px] font-bold text-gray-500 uppercase">Campagnes</div>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
              <div className="text-2xl font-black text-purple-600">{new Set(rawData.map(r => r.adGroup)).size}</div>
              <div className="text-[10px] font-bold text-gray-500 uppercase">Ad Groups</div>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
              <div className="text-2xl font-black text-emerald-600">{new Set(rawData.map(r => r.date)).size}</div>
              <div className="text-[10px] font-bold text-gray-500 uppercase">Jours</div>
            </div>
          </div>

          {/* Config */}
          <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 space-y-6">
            <h3 className="font-bold text-gray-900">Paramètres d'analyse</h3>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Campagne</label>
              <select value={selectedCampaign} onChange={(e) => setSelectedCampaign(e.target.value)} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium bg-gray-50 focus:ring-2 focus:ring-indigo-500 outline-none">
                <option value="all">Toutes les campagnes ({campaigns.length})</option>
                {campaigns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">KPI Principal</label>
                <select value={kpiType} onChange={(e) => setKpiType(e.target.value)} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium bg-gray-50 focus:ring-2 focus:ring-indigo-500 outline-none">
                  <option value="auto">Auto-détection</option>
                  <option value="CPM">CPM</option>
                  <option value="CPC">CPC</option>
                  <option value="CPCV">CPCV</option>
                  <option value="CPA">CPA</option>
                  <option value="VTR">VTR (%)</option>
                  <option value="Viewability">Viewability (%)</option>
                  <option value="CTR">CTR (%)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Objectif KPI (optionnel)</label>
                <input type="number" step="0.01" value={targetKpi || ""} onChange={(e) => setTargetKpi(Number(e.target.value))} placeholder="Auto (moyenne)" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium bg-gray-50 focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => { setStep("upload"); setRawData([]); }} className="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl text-sm font-bold hover:bg-gray-200 transition-colors">
              ← Retour
            </button>
            <button onClick={processData} className="flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl text-base font-bold hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg transform hover:scale-105">
              <Zap className="w-5 h-5" />
              Analyser & Optimiser
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // RENDER: RESULTS
  // ============================================================
  return (
    <div className="p-8 h-full overflow-y-auto bg-[#f8f9fa]">
      <div className="max-w-full mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black text-gray-900 flex items-center gap-3">
              <Zap className="w-7 h-7 text-indigo-600" />
              Optimisations Multi-Lines
              <span className="text-xs font-black bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full">{kpiType}</span>
            </h2>
            <p className="text-gray-500 mt-1">
              {summary?.total} ad groups • {selectedCampaign === "all" ? "Toutes campagnes" : selectedCampaign} • {fileName}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setStep("config")} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-200 transition-colors">
              ← Config
            </button>
            <button onClick={() => { setStep("upload"); setRawData([]); setLines([]); }} className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-50 transition-colors flex items-center gap-2">
              <Upload className="w-4 h-4" /> Nouvel import
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-6 gap-3">
            <div className={cn("rounded-xl p-4 border-2 text-center", COLORS.scale_up.bg, COLORS.scale_up.border)}>
              <div className="text-2xl font-black text-emerald-700">{summary.scaleUp}</div>
              <div className="text-[10px] font-bold text-emerald-600 uppercase">Scale Up</div>
            </div>
            <div className={cn("rounded-xl p-4 border-2 text-center", COLORS.maintain.bg, COLORS.maintain.border)}>
              <div className="text-2xl font-black text-blue-700">{summary.maintain}</div>
              <div className="text-[10px] font-bold text-blue-600 uppercase">Maintenir</div>
            </div>
            <div className={cn("rounded-xl p-4 border-2 text-center", COLORS.reduce.bg, COLORS.reduce.border)}>
              <div className="text-2xl font-black text-amber-700">{summary.reduce}</div>
              <div className="text-[10px] font-bold text-amber-600 uppercase">Réduire</div>
            </div>
            <div className={cn("rounded-xl p-4 border-2 text-center", COLORS.pause.bg, COLORS.pause.border)}>
              <div className="text-2xl font-black text-red-700">{summary.pause}</div>
              <div className="text-[10px] font-bold text-red-600 uppercase">Pause</div>
            </div>
            <div className="rounded-xl p-4 border border-gray-200 bg-white text-center">
              <div className="text-2xl font-black text-gray-900">{summary.avgMargin.toFixed(1)}%</div>
              <div className="text-[10px] font-bold text-gray-500 uppercase">Marge Moy.</div>
            </div>
            <div className={cn("rounded-xl p-4 border-2 text-center", summary.budgetRealloc >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200")}>
              <div className={cn("text-2xl font-black", summary.budgetRealloc >= 0 ? "text-emerald-700" : "text-red-700")}>
                {summary.budgetRealloc >= 0 ? "+" : ""}{summary.budgetRealloc.toFixed(0)}€
              </div>
              <div className="text-[10px] font-bold text-gray-500 uppercase">Réalloc Budget</div>
            </div>
          </div>
        )}

        {/* Chart */}
        {showChart && chartData.length > 0 && (
          <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-indigo-100 p-4 flex items-center justify-between">
              <h3 className="text-sm font-bold text-indigo-900 flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Score par Ad Group</h3>
              <button onClick={() => setShowChart(false)} className="text-xs text-gray-400 hover:text-gray-600">Masquer</button>
            </div>
            <div className="p-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} width={160} />
                  <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '11px' }} formatter={(v: number) => [v.toFixed(2), "Score"]} />
                  <Bar dataKey="Score" radius={[0, 4, 4, 0]} barSize={14}>
                    {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* MAIN TABLE */}
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-3 text-left font-bold text-gray-500 uppercase tracking-wider w-56">Ad Group</th>
                  <th className="px-2 py-3 text-center font-bold text-gray-500 uppercase cursor-pointer hover:text-indigo-600" onClick={() => handleSort("spend")}>Spend €<SortIcon col="spend" /></th>
                  <th className="px-2 py-3 text-center font-bold text-gray-500 uppercase cursor-pointer hover:text-indigo-600" onClick={() => handleSort("impressions")}>Impr.<SortIcon col="impressions" /></th>
                  <th className="px-2 py-3 text-center font-bold text-gray-500 uppercase cursor-pointer hover:text-indigo-600" onClick={() => handleSort("margin")}>Marge<SortIcon col="margin" /></th>
                  <th className="px-2 py-3 text-center font-bold text-gray-500 uppercase cursor-pointer hover:text-indigo-600" onClick={() => handleSort("cpm")}>CPM<SortIcon col="cpm" /></th>
                  <th className="px-2 py-3 text-center font-bold text-gray-500 uppercase cursor-pointer hover:text-indigo-600" onClick={() => handleSort("ctr")}>CTR<SortIcon col="ctr" /></th>
                  <th className="px-2 py-3 text-center font-bold text-gray-500 uppercase cursor-pointer hover:text-indigo-600" onClick={() => handleSort("vtr")}>VTR<SortIcon col="vtr" /></th>
                  <th className="px-2 py-3 text-center font-bold text-gray-500 uppercase cursor-pointer hover:text-indigo-600" onClick={() => handleSort("viewability")}>View.<SortIcon col="viewability" /></th>
                  <th className="px-2 py-3 text-center font-bold text-gray-500 uppercase cursor-pointer hover:text-indigo-600" onClick={() => handleSort("cpcv")}>CPCV<SortIcon col="cpcv" /></th>
                  <th className="px-2 py-3 text-center font-bold text-gray-500 uppercase cursor-pointer hover:text-indigo-600" onClick={() => handleSort("score")}>Score<SortIcon col="score" /></th>
                  <th className="px-3 py-3 text-center font-bold text-gray-500 uppercase w-40">Recommandation</th>
                  <th className="px-2 py-3 text-center font-bold text-gray-500 uppercase w-24">Budget %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sortedLines.map((line, idx) => {
                  const c = COLORS[line.recommendation];
                  const originalIdx = lines.findIndex(l => l.adGroup === line.adGroup);
                  return (
                    <tr key={line.adGroup} className={cn("transition-colors hover:bg-gray-50/50", c.bg)}>
                      <td className="px-3 py-2.5">
                        <div className="font-bold text-gray-900 truncate max-w-[220px]" title={line.adGroup}>{line.adGroupShort}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[9px] font-bold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">{line.mediaType}</span>
                          <span className="text-[9px] text-gray-400">{line.device}</span>
                          <span className="text-[9px] text-gray-400">{line.daysActive}j • {line.creativesCount} crea</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-center font-bold text-gray-900">{line.advertiserCost.toFixed(1)}</td>
                      <td className="px-2 py-2.5 text-center text-gray-600">{line.impressions > 1000 ? `${(line.impressions / 1000).toFixed(1)}k` : line.impressions}</td>
                      <td className="px-2 py-2.5 text-center">
                        <span className={cn("font-bold px-1.5 py-0.5 rounded text-[10px]", line.margin >= 30 ? "bg-emerald-100 text-emerald-700" : line.margin >= 15 ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-700")}>
                          {line.margin.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-center font-medium text-gray-700">{line.cpm.toFixed(2)}</td>
                      <td className="px-2 py-2.5 text-center text-gray-600">{line.ctr > 0 ? `${line.ctr.toFixed(2)}%` : "—"}</td>
                      <td className="px-2 py-2.5 text-center text-gray-600">{line.vtr > 0 ? `${line.vtr.toFixed(1)}%` : "—"}</td>
                      <td className="px-2 py-2.5 text-center text-gray-600">{line.viewability > 0 ? `${line.viewability.toFixed(1)}%` : "—"}</td>
                      <td className="px-2 py-2.5 text-center font-medium text-gray-700">{line.cpcv > 0 ? line.cpcv.toFixed(3) : "—"}</td>
                      <td className="px-2 py-2.5 text-center">
                        <span className={cn("font-black text-sm", line.score >= 1.3 ? "text-emerald-600" : line.score >= 0.85 ? "text-blue-600" : line.score >= 0.5 ? "text-amber-600" : "text-red-600")}>
                          {line.score.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={cn("text-[10px] font-black px-2 py-1 rounded-full whitespace-nowrap", c.badge)}>
                          {line.recommendationLabel}
                        </span>
                        {line.isEdited && <span className="text-[8px] text-gray-400 block mt-0.5">modifié</span>}
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <input
                          type="number"
                          value={line.budgetAdjustPct}
                          onChange={(e) => updateLineBudget(originalIdx, Number(e.target.value))}
                          className={cn("w-16 text-center text-xs font-bold border rounded-lg px-1 py-1 outline-none focus:ring-2 focus:ring-indigo-500",
                            line.budgetAdjustPct > 0 ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
                            line.budgetAdjustPct < 0 ? "text-red-700 bg-red-50 border-red-200" :
                            "text-gray-600 bg-gray-50 border-gray-200"
                          )}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Legend */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <h4 className="text-xs font-bold text-indigo-900 mb-2">💡 Comment lire les recommandations</h4>
          <div className="grid grid-cols-2 gap-2 text-[10px] text-indigo-700">
            <div><strong>Score &gt; 1.3</strong> → Scale Up : KPI significativement meilleur que la cible, augmenter le budget</div>
            <div><strong>Score 0.85-1.3</strong> → Maintenir : performance alignée avec l'objectif</div>
            <div><strong>Score 0.5-0.85</strong> → Réduire : sous-performance, réduire le budget progressivement</div>
            <div><strong>Score &lt; 0.5</strong> → Pause : performance très dégradée, mettre en pause pour analyse</div>
          </div>
          <div className="text-[10px] text-indigo-600 mt-2">
            Le score intègre le KPI ({kpiType}) vs objectif, la marge, et le poids budgétaire. Vous pouvez ajuster manuellement le % budget de chaque ligne.
          </div>
        </div>
      </div>
    </div>
  );
}

