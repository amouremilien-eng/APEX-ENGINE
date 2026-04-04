import { useState, useMemo } from "react";
import { ProjectData, DailyEntry, ProjectSnapshot, FinalBalance } from "../types";
import { Calendar, TrendingUp, DollarSign, Percent, Target, Save, AlertCircle, Table, PenLine, AlertTriangle, Info, CheckCircle2, Trophy, Lock, Archive } from "lucide-react";
import { cn } from "../utils/cn";
import { exportSingleProject } from "../utils/exportHelper";
// 🔥 V8.0 : Learning Engine
import { detectFunnelTag } from "../LearningEngine";

interface CampaignTrackingProps {
  project: ProjectData;
  onChange: (project: ProjectData) => void;
}

interface BulkRow {
  date: string;
  budgetSpent: number;
  cpmRevenue: number;
  marginPct: number;
  kpiActual: number;
  isExisting: boolean;
  adGroup?: string;       // 🔥 V8.0
  subCampaign?: string;   // 🔥 V8.2
}

export function CampaignTracking({ project, onChange }: CampaignTrackingProps) {
  const currSym = project.currency.includes("EUR") ? "€" : "$";
  const isFin = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
  const isCompleted = project.status === "completed";
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  const [formData, setFormData] = useState<DailyEntry>({
    date: yesterdayStr,
    budgetSpent: 0,
    cpmRevenue: project.cpmRevenueActual,
    marginPct: project.margeInput,
    kpiActual: 0,
    adGroup: '',       // 🔥 V8.0
    subCampaign: '',   // 🔥 V8.2
  });

  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [entryMode, setEntryMode] = useState<"single" | "bulk">("single");
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);

  const existingEntries = project.dailyEntries || [];
  const cumulativeBudget = existingEntries.reduce((sum, entry) => sum + entry.budgetSpent, 0);
  const todayEntry = existingEntries.find(e => e.date === formData.date);
  const hasEntryForDate = !!todayEntry;

  const fmtKpi = (val: number) => {
    if (isFin) return `${val.toFixed(2)} ${currSym}`;
    return `${val.toFixed(2)} %`;
  };

  // ============================================================
  // 🔥 FEATURE 2 : AUTO-CALCUL KPI CUMULÉ EN TEMPS RÉEL
  // ============================================================
  const kpiPreview = useMemo(() => {
    if (formData.budgetSpent <= 0 || formData.kpiActual <= 0) return null;
    const otherEntries = existingEntries.filter(e => e.date !== formData.date);
    let currentCumulKpi = 0;
    const currentTotalSpent = otherEntries.reduce((s, e) => s + e.budgetSpent, 0);
    
    if (currentTotalSpent > 0) {
      if (isFin) {
        const totalActions = otherEntries.reduce((s, e) => e.kpiActual > 0 ? s + e.budgetSpent / e.kpiActual : s, 0);
        currentCumulKpi = totalActions > 0 ? currentTotalSpent / totalActions : 0;
      } else {
        currentCumulKpi = otherEntries.reduce((s, e) => s + e.budgetSpent * e.kpiActual, 0) / currentTotalSpent;
      }
    }

    const newTotalSpent = currentTotalSpent + formData.budgetSpent;
    let newCumulKpi = 0;
    if (newTotalSpent > 0) {
      if (isFin) {
        const existingActions = otherEntries.reduce((s, e) => e.kpiActual > 0 ? s + e.budgetSpent / e.kpiActual : s, 0);
        const newActions = formData.kpiActual > 0 ? formData.budgetSpent / formData.kpiActual : 0;
        const totalActions = existingActions + newActions;
        newCumulKpi = totalActions > 0 ? newTotalSpent / totalActions : 0;
      } else {
        const existingWeighted = otherEntries.reduce((s, e) => s + e.budgetSpent * e.kpiActual, 0);
        const newWeighted = formData.budgetSpent * formData.kpiActual;
        newCumulKpi = (existingWeighted + newWeighted) / newTotalSpent;
      }
    }

    const delta = otherEntries.length > 0 ? newCumulKpi - currentCumulKpi : 0;
    const deltaDirection = isFin ? (delta < 0 ? "good" : delta > 0 ? "bad" : "neutral") : (delta > 0 ? "good" : delta < 0 ? "bad" : "neutral");
    const meetsTarget = project.targetKpi > 0
      ? (isFin ? newCumulKpi <= project.targetKpi : newCumulKpi >= project.targetKpi)
      : null;

    return { currentCumulKpi, newCumulKpi, delta, deltaDirection, meetsTarget, hasHistory: otherEntries.length > 0, dayKpi: formData.kpiActual };
  }, [formData.budgetSpent, formData.kpiActual, formData.date, existingEntries, isFin, project.targetKpi]);

  // ============================================================
  // 🔥 FEATURE 3 : DÉTECTION JOURS MANQUANTS
  // ============================================================
  const missingDays = useMemo(() => {
    if (isCompleted) return [];
    const existingDates = new Set(existingEntries.map(e => e.date));
    const missing: string[] = [];
    let startFrom: Date;
    if (existingEntries.length > 0) {
      const sorted = [...existingEntries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      startFrom = new Date(sorted[sorted.length - 1].date);
      startFrom.setDate(startFrom.getDate() + 1);
    } else if (project.startDate) {
      startFrom = new Date(project.startDate);
    } else {
      return [];
    }
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const current = new Date(startFrom);
    while (current <= yesterdayDate) {
      const dateStr = current.toISOString().split('T')[0];
      if (!existingDates.has(dateStr)) missing.push(dateStr);
      current.setDate(current.getDate() + 1);
    }
    return missing;
  }, [existingEntries, project.startDate, isCompleted]);

  // 🔥 V8.2 : initBulkMode adapté aux 3 trackingModes
  const initBulkMode = () => {
    const lastEntry = existingEntries.length > 0
      ? [...existingEntries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
      : null;
    const defaultCpmRev = lastEntry?.cpmRevenue || project.cpmRevenueActual;
    const defaultMargin = lastEntry?.marginPct || project.margeInput;

    const rows: BulkRow[] = [];
    if (project.trackingMode === "adgroup" && (project.adGroupList || []).length > 0) {
      missingDays.slice(0, 5).forEach(date => {
        (project.adGroupList || []).forEach(ag => {
          rows.push({ date, budgetSpent: 0, cpmRevenue: defaultCpmRev, marginPct: defaultMargin, kpiActual: 0, isExisting: false, adGroup: ag });
        });
      });
    } else if (project.trackingMode === "campaign" && (project.subCampaignList || []).length > 0) {
      // 🔥 V8.2 : Mode Sous-Campagne
      missingDays.slice(0, 5).forEach(date => {
        (project.subCampaignList || []).forEach(sc => {
          rows.push({ date, budgetSpent: 0, cpmRevenue: defaultCpmRev, marginPct: defaultMargin, kpiActual: 0, isExisting: false, subCampaign: sc });
        });
      });
    } else {
      missingDays.slice(0, 10).forEach(date => {
        rows.push({ date, budgetSpent: 0, cpmRevenue: defaultCpmRev, marginPct: defaultMargin, kpiActual: 0, isExisting: false });
      });
    }
    setBulkRows(rows);
    setEntryMode("bulk");
  };

  const updateBulkRow = (index: number, field: keyof BulkRow, value: number) => {
    setBulkRows(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleBulkSubmit = () => {
    if (!project.id) { alert("⚠️ Sauvegardez d'abord votre campagne."); return; }
    const validRows = bulkRows.filter(r => r.budgetSpent > 0 && !r.isExisting);
    if (validRows.length === 0) { alert("⚠️ Aucune ligne valide (budget > 0) à enregistrer."); return; }
    let updatedEntries = [...existingEntries];
    const newSnapshots: ProjectSnapshot[] = [];
    validRows.forEach(row => {
      // 🔥 V8.2 : Inclure subCampaign
      const groupName = row.adGroup || row.subCampaign || undefined;
      const newEntry: DailyEntry = {
        date: row.date, budgetSpent: row.budgetSpent, cpmRevenue: row.cpmRevenue,
        marginPct: row.marginPct, kpiActual: row.kpiActual,
        adGroup: row.adGroup || undefined,
        subCampaign: row.subCampaign || undefined,
        funnelTag: groupName ? detectFunnelTag(groupName).tag : undefined,
      };
      const existingIndex = updatedEntries.findIndex(e =>
        e.date === row.date
        && (e.adGroup || '') === (row.adGroup || '')
        && (e.subCampaign || '') === (row.subCampaign || '')
      );
      if (existingIndex >= 0) updatedEntries[existingIndex] = newEntry;
      else updatedEntries.push(newEntry);
      const runningTotal = updatedEntries.reduce((s, e) => s + e.budgetSpent, 0);
      newSnapshots.push({
        timestamp: new Date(row.date + 'T12:00:00').toISOString(), budgetSpent: runningTotal, marginPct: row.marginPct,
        cpmCostActuel: row.cpmRevenue * (1 - row.marginPct / 100), cpmRevenueActual: row.cpmRevenue, actualKpi: row.kpiActual,
        gainRealized: runningTotal * (row.marginPct / 100), action: "DAILY_UPDATE",
        note: `Suivi quotidien : ${new Date(row.date).toLocaleDateString('fr-FR')}${groupName ? ` [${groupName}]` : ''}`
      });
    });
    updatedEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const newTotalBudgetSpent = updatedEntries.reduce((sum, e) => sum + e.budgetSpent, 0);
    const lastRow = validRows[validRows.length - 1];
    onChange({
      ...project, dailyEntries: updatedEntries, budgetSpent: newTotalBudgetSpent,
      cpmRevenueActual: lastRow.cpmRevenue, actualKpi: lastRow.kpiActual, margeInput: lastRow.marginPct,
      history: [...(project.history || []), ...newSnapshots], updatedAt: new Date().toISOString()
    });
    alert(`✅ ${validRows.length} entrée(s) enregistrée(s) en lot !`);
    setEntryMode("single");
    setBulkRows([]);
  };

  const handleInputChange = (field: keyof DailyEntry, value: number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleEdit = (entry: DailyEntry) => {
    setFormData({
      date: entry.date, budgetSpent: entry.budgetSpent, cpmRevenue: entry.cpmRevenue,
      marginPct: entry.marginPct, kpiActual: entry.kpiActual,
      adGroup: entry.adGroup || '',
      subCampaign: entry.subCampaign || '',
    });
    setEditingDate(entry.date);
    setEntryMode("single");
  };

  const handleDelete = (dateToDelete: string) => {
    if (!confirm(`Supprimer l'entrée du ${new Date(dateToDelete).toLocaleDateString('fr-FR')} ?`)) return;
    const updatedEntries = existingEntries.filter(e => e.date !== dateToDelete);
    const newTotalBudgetSpent = updatedEntries.reduce((sum, e) => sum + e.budgetSpent, 0);
    const newHistory = (project.history || []).filter(h => {
      if (h.action !== "DAILY_UPDATE") return true;
      const dateMatch = h.note?.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (!dateMatch) return true;
      const [day, month, year] = dateMatch[1].split('/');
      return `${year}-${month}-${day}` !== dateToDelete;
    });
    onChange({ ...project, dailyEntries: updatedEntries, budgetSpent: newTotalBudgetSpent, history: newHistory, updatedAt: new Date().toISOString() });
  };

  const handleSubmit = () => {
    if (!project.id) { alert("⚠️ Vous devez d'abord sauvegarder votre campagne."); return; }
    if (formData.budgetSpent <= 0) { alert("⚠️ Le budget dépensé doit être supérieur à 0."); return; }
    // 🔥 V8.2 : Inclure adGroup, subCampaign et funnelTag
    const groupName = project.trackingMode === "adgroup" ? formData.adGroup
                     : project.trackingMode === "campaign" ? formData.subCampaign
                     : undefined;
    const newEntry: DailyEntry = {
      ...formData,
      date: formData.date,
      adGroup: project.trackingMode === "adgroup" ? formData.adGroup : undefined,
      subCampaign: project.trackingMode === "campaign" ? formData.subCampaign : undefined,
      funnelTag: groupName ? detectFunnelTag(groupName).tag : undefined,
    };
    let updatedEntries = [...existingEntries];
    const existingIndex = updatedEntries.findIndex(e =>
      e.date === formData.date
      && (e.adGroup || '') === (newEntry.adGroup || '')
      && (e.subCampaign || '') === (newEntry.subCampaign || '')
    );
    if (existingIndex >= 0) updatedEntries[existingIndex] = newEntry;
    else updatedEntries.push(newEntry);
    updatedEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const newTotalBudgetSpent = updatedEntries.reduce((sum, e) => sum + e.budgetSpent, 0);
    const snapshot: ProjectSnapshot = {
      timestamp: new Date(formData.date + 'T12:00:00').toISOString(), budgetSpent: newTotalBudgetSpent, marginPct: formData.marginPct,
      cpmCostActuel: formData.cpmRevenue * (1 - formData.marginPct / 100), cpmRevenueActual: formData.cpmRevenue, actualKpi: formData.kpiActual,
      gainRealized: newTotalBudgetSpent * (formData.marginPct / 100), action: "DAILY_UPDATE",
      note: `Suivi quotidien : ${new Date(formData.date).toLocaleDateString('fr-FR')}${groupName ? ` [${groupName}]` : ''}`
    };
    onChange({
      ...project, dailyEntries: updatedEntries, budgetSpent: newTotalBudgetSpent,
      cpmRevenueActual: formData.cpmRevenue, actualKpi: formData.kpiActual, margeInput: formData.marginPct,
      history: [...(project.history || []), snapshot], updatedAt: new Date().toISOString()
    });
    alert(`✅ Données du ${new Date(formData.date).toLocaleDateString('fr-FR')} enregistrées !`);
    setEditingDate(null);
    const nextDay = new Date(formData.date);
    nextDay.setDate(nextDay.getDate() + 1);
    setFormData({ date: nextDay.toISOString().split('T')[0], budgetSpent: 0, cpmRevenue: formData.cpmRevenue, marginPct: formData.marginPct, kpiActual: 0, adGroup: formData.adGroup, subCampaign: formData.subCampaign });
  };

  // ============================================================
  // 🔥 V7.0 : TERMINER LA CAMPAGNE — Calcul du bilan final
  // ============================================================
  const handleCompleteCampaign = () => {
    if (!project.id) return;
    if (existingEntries.length === 0) {
      alert("⚠️ Impossible de terminer une campagne sans données quotidiennes.");
      return;
    }
    if (!confirm("⚠️ TERMINER LA CAMPAGNE ?\n\nCette action est irréversible :\n• La campagne sera archivée\n• Plus aucune saisie possible\n• Le bilan final sera calculé\n• La campagne servira de référence dans Benchmark Intelligence\n\nConfirmer ?")) return;

    const entries = [...existingEntries];
    const totalSpent = entries.reduce((s, e) => s + e.budgetSpent, 0);
    const totalGain = entries.reduce((s, e) => s + e.budgetSpent * (e.marginPct / 100), 0);
    const realMarginPct = totalSpent > 0 ? (totalGain / totalSpent) * 100 : 0;

    let finalKpi = 0;
    if (totalSpent > 0) {
      if (isFin) {
        const totalActions = entries.reduce((s, e) => e.kpiActual > 0 ? s + e.budgetSpent / e.kpiActual : s, 0);
        finalKpi = totalActions > 0 ? totalSpent / totalActions : 0;
      } else {
        finalKpi = entries.reduce((s, e) => s + e.budgetSpent * e.kpiActual, 0) / totalSpent;
      }
    }

    const kpiVsTarget = project.targetKpi > 0
      ? (isFin ? project.targetKpi / Math.max(finalKpi, 0.001) : finalKpi / project.targetKpi)
      : 0;
    const kpiAchieved = project.targetKpi > 0
      ? (isFin ? finalKpi <= project.targetKpi : finalKpi >= project.targetKpi)
      : false;

    const avgCpmRevenue = totalSpent > 0
      ? entries.reduce((s, e) => s + e.budgetSpent * e.cpmRevenue, 0) / totalSpent : 0;
    const avgCpmCost = totalSpent > 0
      ? entries.reduce((s, e) => s + e.budgetSpent * e.cpmRevenue * (1 - e.marginPct / 100), 0) / totalSpent : 0;

    const dayGains = entries.map(e => ({ date: e.date, gain: e.budgetSpent * (e.marginPct / 100) }));
    const bestDay = dayGains.length > 0 ? dayGains.reduce((a, b) => a.gain > b.gain ? a : b) : null;
    const worstDay = dayGains.length > 0 ? dayGains.reduce((a, b) => a.gain < b.gain ? a : b) : null;

    const finalBalance: FinalBalance = {
      realMarginPct, totalGain, totalBudgetSpent: totalSpent, totalBudgetTotal: project.budgetTotal,
      finalKpi, kpiTarget: project.targetKpi, kpiVsTarget, kpiAchieved,
      totalDays: entries.length, avgDailySpend: totalSpent / entries.length,
      avgCpmRevenue, avgCpmCost, bestDay, worstDay,
      completionPacingPct: project.budgetTotal > 0 ? (totalSpent / project.budgetTotal) * 100 : 0,
    };

    const snapshot: ProjectSnapshot = {
      timestamp: new Date().toISOString(), budgetSpent: totalSpent, marginPct: realMarginPct,
      cpmCostActuel: avgCpmCost, cpmRevenueActual: avgCpmRevenue, actualKpi: finalKpi,
      gainRealized: totalGain, action: "SNAPSHOT",
      note: `🏁 Campagne terminée — Bilan final : Marge ${realMarginPct.toFixed(1)}%, Gain ${totalGain.toFixed(0)} ${currSym}, ${project.kpiType} ${fmtKpi(finalKpi)} ${kpiAchieved ? "✅ Objectif atteint" : "❌ Objectif non atteint"}`
    };

    onChange({
      ...project, status: "completed", completedAt: new Date().toISOString(),
      finalBalance, history: [...(project.history || []), snapshot], updatedAt: new Date().toISOString(),
    });
    alert("✅ Campagne terminée et archivée !\n\nLe bilan final est maintenant affiché.\nCette campagne servira de référence dans Benchmark Intelligence.");
  };

  const handleReactivateCampaign = () => {
    if (!confirm("Réactiver cette campagne ?\n\nVous pourrez à nouveau saisir des données et la terminer plus tard.")) return;
    onChange({
      ...project, status: "active", completedAt: undefined, finalBalance: undefined, updatedAt: new Date().toISOString(),
    });
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="p-8 h-full overflow-y-auto bg-[#f8f9fa]">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              📊 Suivi Quotidien Campagne
              {isCompleted && (
                <span className="text-sm font-black bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full">
                  ✓ TERMINÉE
                </span>
              )}
            </h2>
            <p className="text-gray-500 mt-1">
              {isCompleted 
                ? `Campagne archivée le ${project.completedAt ? new Date(project.completedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}`
                : "Enregistrez vos performances jour après jour"
              }
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-6 py-3 shadow-sm">
              <Calendar className="w-5 h-5 text-blue-600" />
              <div>
                <div className="text-xs text-gray-500 font-medium">Entrées</div>
                <div className="text-2xl font-black text-gray-900">{existingEntries.length}</div>
              </div>
            </div>

            <button onClick={() => exportSingleProject(project)} disabled={!project.id || existingEntries.length === 0} className={cn("flex items-center gap-3 px-6 py-3 rounded-xl text-sm font-bold transition-all shadow-md", (!project.id || existingEntries.length === 0) ? "bg-gray-300 text-gray-500 cursor-not-allowed" : "bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 transform hover:scale-105")}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" /></svg>
              Export
            </button>
            
            {!isCompleted && project.id && existingEntries.length > 0 && (
              <button onClick={handleCompleteCampaign} className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700 transition-all shadow-md transform hover:scale-105">
                <Archive className="w-4 h-4" />
                Terminer la Campagne
              </button>
            )}
          </div>
        </div>

        {/* 🔥 V7.0 : BILAN FINAL */}
        {isCompleted && project.finalBalance && (
          <div className="space-y-6">
            <div className={cn("rounded-2xl p-8 border-2 shadow-lg", project.finalBalance.kpiAchieved ? "bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-300" : "bg-gradient-to-br from-amber-50 to-orange-50 border-amber-300")}>
              <div className="flex items-center gap-5 mb-6">
                <div className={cn("w-16 h-16 rounded-2xl flex items-center justify-center shadow-md", project.finalBalance.kpiAchieved ? "bg-emerald-500" : "bg-amber-500")}>
                  <Trophy className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-gray-900">Bilan Final — {project.name}</h3>
                  <p className="text-gray-600 mt-1">{project.finalBalance.totalDays} jours de campagne • {project.finalBalance.completionPacingPct.toFixed(0)}% du budget consommé</p>
                </div>
                <div className="ml-auto">
                  <button onClick={handleReactivateCampaign} className="flex items-center gap-2 px-4 py-2 bg-white/80 border border-gray-200 rounded-lg text-xs font-bold text-gray-600 hover:bg-white hover:text-gray-900 transition-all">
                    <Lock className="w-3.5 h-3.5" /> Réactiver
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm text-center">
                  <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Gain Total</div>
                  <div className="text-3xl font-black text-emerald-600">{project.finalBalance.totalGain.toFixed(0)} {currSym}</div>
                </div>
                <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm text-center">
                  <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Marge Réelle</div>
                  <div className="text-3xl font-black text-indigo-600">{project.finalBalance.realMarginPct.toFixed(1)}%</div>
                </div>
                <div className={cn("rounded-xl p-5 border shadow-sm text-center", project.finalBalance.kpiAchieved ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200")}>
                  <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{project.kpiType} Final</div>
                  <div className={cn("text-3xl font-black", project.finalBalance.kpiAchieved ? "text-emerald-600" : "text-red-600")}>{fmtKpi(project.finalBalance.finalKpi)}</div>
                  <div className={cn("text-xs font-bold mt-1", project.finalBalance.kpiAchieved ? "text-emerald-600" : "text-red-600")}>{project.finalBalance.kpiAchieved ? "✅ Objectif atteint" : "❌ Objectif non atteint"}</div>
                </div>
                <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm text-center">
                  <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Budget Dépensé</div>
                  <div className="text-3xl font-black text-gray-900">{project.finalBalance.totalBudgetSpent.toFixed(0)} {currSym}</div>
                  <div className="text-xs text-gray-500 mt-1">/ {project.finalBalance.totalBudgetTotal.toFixed(0)} {currSym}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white/80 rounded-lg p-4 border border-gray-100">
                  <div className="text-xs text-gray-500 font-bold mb-2">Objectif {project.kpiType}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-gray-700">{fmtKpi(project.finalBalance.kpiTarget)}</span>
                    <span className={cn("text-xs font-black px-2 py-0.5 rounded-full", project.finalBalance.kpiVsTarget >= 1 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>{(project.finalBalance.kpiVsTarget * 100).toFixed(0)}% du target</span>
                  </div>
                </div>
                <div className="bg-white/80 rounded-lg p-4 border border-gray-100">
                  <div className="text-xs text-gray-500 font-bold mb-2">CPM Moyens</div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Rev: <strong>{project.finalBalance.avgCpmRevenue.toFixed(2)} {currSym}</strong></span>
                    <span className="text-gray-600">Cost: <strong>{project.finalBalance.avgCpmCost.toFixed(2)} {currSym}</strong></span>
                  </div>
                </div>
                <div className="bg-white/80 rounded-lg p-4 border border-gray-100">
                  <div className="text-xs text-gray-500 font-bold mb-2">Spend Moyen / Jour</div>
                  <div className="text-lg font-black text-gray-900">{project.finalBalance.avgDailySpend.toFixed(0)} {currSym}/j</div>
                </div>
              </div>
              {(project.finalBalance.bestDay || project.finalBalance.worstDay) && (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  {project.finalBalance.bestDay && (
                    <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-200">
                      <div className="text-xs font-bold text-emerald-700 mb-1">🥇 Meilleur Jour</div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-emerald-800">{new Date(project.finalBalance.bestDay.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                        <span className="text-lg font-black text-emerald-700">+{project.finalBalance.bestDay.gain.toFixed(2)} {currSym}</span>
                      </div>
                    </div>
                  )}
                  {project.finalBalance.worstDay && (
                    <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                      <div className="text-xs font-bold text-red-700 mb-1">📉 Pire Jour</div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-red-800">{new Date(project.finalBalance.worstDay.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                        <span className="text-lg font-black text-red-700">+{project.finalBalance.worstDay.gain.toFixed(2)} {currSym}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============================================================
            🔥 V8.2 : SÉLECTEUR DE MODE DE SUIVI — Learning actif sur les 3
            ============================================================ */}
        {!isCompleted && project.id && (
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-indigo-900 flex items-center gap-2">🧠 Mode de Suivi</h3>
                <p className="text-sm text-indigo-700 mt-1">Choisissez le niveau de granularité de vos données quotidiennes</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => onChange({ ...project, trackingMode: "global" })} className={cn("p-4 rounded-xl border-2 transition-all text-left", (project.trackingMode || "global") === "global" ? "border-indigo-600 bg-indigo-100 shadow-md" : "border-indigo-200 bg-white hover:border-indigo-400")}>
                <div className="text-lg mb-1">🌐</div>
                <div className="font-black text-sm text-gray-900">Global</div>
                <div className="text-[10px] text-gray-500 mt-1">1 ligne/jour pour toute la campagne. Simple et rapide.</div>
                <div className="text-[9px] font-bold text-indigo-600 mt-2 bg-indigo-50 px-2 py-0.5 rounded inline-block">🧠 Learning actif</div>
              </button>
              <button onClick={() => onChange({ ...project, trackingMode: "adgroup" })} className={cn("p-4 rounded-xl border-2 transition-all text-left", project.trackingMode === "adgroup" ? "border-purple-600 bg-purple-100 shadow-md" : "border-purple-200 bg-white hover:border-purple-400")}>
                <div className="text-lg mb-1">📊</div>
                <div className="font-black text-sm text-gray-900">Par Ad Group</div>
                <div className="text-[10px] text-gray-500 mt-1">1 ligne/jour/adgroup. L'algo apprend les TG vs RT, stars vs dead. <strong>Recommandé.</strong></div>
                <div className="text-[9px] font-bold text-purple-600 mt-2 bg-purple-50 px-2 py-0.5 rounded inline-block">🧠 Learning actif</div>
              </button>
              <button onClick={() => onChange({ ...project, trackingMode: "campaign" })} className={cn("p-4 rounded-xl border-2 transition-all text-left", project.trackingMode === "campaign" ? "border-emerald-600 bg-emerald-100 shadow-md" : "border-emerald-200 bg-white hover:border-emerald-400")}>
                <div className="text-lg mb-1">📈</div>
                <div className="font-black text-sm text-gray-900">Par Sous-Campagne</div>
                <div className="text-[10px] text-gray-500 mt-1">1 ligne/jour/sous-campagne. Intermédiaire.</div>
                <div className="text-[9px] font-bold text-emerald-600 mt-2 bg-emerald-50 px-2 py-0.5 rounded inline-block">🧠 Learning actif</div>
              </button>
            </div>

            {/* 🔥 V8.0 : Gestion liste ad groups */}
            {project.trackingMode === "adgroup" && (
              <div className="mt-4 pt-4 border-t border-indigo-200">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-indigo-800 uppercase">Ad Groups ({(project.adGroupList || []).length})</label>
                  <button onClick={() => { const name = prompt("Nom du nouvel Ad Group :"); if (name && name.trim()) { onChange({ ...project, adGroupList: [...(project.adGroupList || []), name.trim()] }); } }} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-100 px-3 py-1 rounded-lg">+ Ajouter</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(project.adGroupList || []).map((ag, idx) => {
                    const { tag, confidence } = detectFunnelTag(ag);
                    return (
                      <div key={idx} className="flex items-center gap-1.5 bg-white border border-indigo-200 rounded-lg px-3 py-1.5">
                        <span className="text-xs font-bold text-gray-800">{ag}</span>
                        {tag !== "unknown" && (<span className={cn("text-[9px] font-black px-1.5 py-0.5 rounded-full", tag === "retargeting" ? "bg-orange-100 text-orange-700" : tag === "prospecting" ? "bg-blue-100 text-blue-700" : tag === "awareness" ? "bg-purple-100 text-purple-700" : tag === "conversion" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600")}>{tag.slice(0, 2).toUpperCase()}</span>)}
                        <button onClick={() => { onChange({ ...project, adGroupList: (project.adGroupList || []).filter((_, i) => i !== idx) }); }} className="text-gray-400 hover:text-red-500 text-xs ml-1">×</button>
                      </div>
                    );
                  })}
                  {(project.adGroupList || []).length === 0 && (<div className="text-xs text-indigo-400 italic">Aucun ad group. Ajoutez-en ou importez un Excel.</div>)}
                </div>
              </div>
            )}

            {/* 🔥 V8.2 : Gestion liste sous-campagnes */}
            {project.trackingMode === "campaign" && (
              <div className="mt-4 pt-4 border-t border-emerald-200">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-emerald-800 uppercase">Sous-Campagnes ({(project.subCampaignList || []).length})</label>
                  <button onClick={() => { const name = prompt("Nom de la nouvelle sous-campagne :"); if (name && name.trim()) { onChange({ ...project, subCampaignList: [...(project.subCampaignList || []), name.trim()] }); } }} className="text-xs font-bold text-emerald-600 hover:text-emerald-800 bg-emerald-100 px-3 py-1 rounded-lg">+ Ajouter</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(project.subCampaignList || []).map((sc, idx) => {
                    const { tag } = detectFunnelTag(sc);
                    return (
                      <div key={idx} className="flex items-center gap-1.5 bg-white border border-emerald-200 rounded-lg px-3 py-1.5">
                        <span className="text-xs font-bold text-gray-800">{sc}</span>
                        {tag !== "unknown" && (<span className={cn("text-[9px] font-black px-1.5 py-0.5 rounded-full", tag === "retargeting" ? "bg-orange-100 text-orange-700" : tag === "prospecting" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600")}>{tag.slice(0, 2).toUpperCase()}</span>)}
                        <button onClick={() => { onChange({ ...project, subCampaignList: (project.subCampaignList || []).filter((_, i) => i !== idx) }); }} className="text-gray-400 hover:text-red-500 text-xs ml-1">×</button>
                      </div>
                    );
                  })}
                  {(project.subCampaignList || []).length === 0 && (<div className="text-xs text-emerald-400 italic">Aucune sous-campagne. Ajoutez-en pour activer le suivi granulaire.</div>)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Alert si pas sauvegardé */}
        {!project.id && !isCompleted && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-5 flex items-start gap-4">
            <AlertCircle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-amber-900 mb-1">Campagne non sauvegardée</h4>
              <p className="text-sm text-amber-700">Vous devez d'abord sauvegarder votre campagne avant de pouvoir enregistrer des données quotidiennes.</p>
            </div>
          </div>
        )}

        {/* Alerte jours manquants */}
        {missingDays.length > 0 && project.id && !isCompleted && (
          <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-5 flex items-start gap-4">
            <AlertTriangle className="w-6 h-6 text-orange-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-bold text-orange-900 mb-1">{missingDays.length} jour{missingDays.length > 1 ? "s" : ""} non saisi{missingDays.length > 1 ? "s" : ""}</h4>
              <p className="text-sm text-orange-700 mb-3">
                Données manquantes du {new Date(missingDays[0]).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                {missingDays.length > 1 && ` au ${new Date(missingDays[missingDays.length - 1]).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`}. Les projections et le pacing sont dégradés.
              </p>
              <button onClick={initBulkMode} className="flex items-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-orange-700 transition-colors">
                <Table className="w-4 h-4" /> Saisir en lot ({missingDays.length} jour{missingDays.length > 1 ? "s" : ""})
              </button>
            </div>
          </div>
        )}

        {/* Résumé Cumulé */}
        <div className="grid grid-cols-4 gap-6">
          <MetricCard title="Budget Cumulé" value={existingEntries.length ? `${cumulativeBudget.toFixed(0)} ${currSym}` : '—'} icon={DollarSign} color="blue" />
          <MetricCard title="Jours Trackés" value={existingEntries.length ? `${existingEntries.length}` : '—'} icon={Calendar} color="emerald" />
          <MetricCard title="Marge Cumulée (Jour)" value={existingEntries.length ? `${(existingEntries.reduce((sum, e) => sum + e.budgetSpent * e.marginPct, 0) / Math.max(1, cumulativeBudget)).toFixed(2)} %` : '—'} icon={Percent} color="purple" />
          <MetricCard title={`${project.kpiType} Cumulé`} value={existingEntries.length ? `${(() => {
            if (isFin) { const ts = existingEntries.reduce((s, e) => s + e.budgetSpent, 0); const ta = existingEntries.reduce((s, e) => e.kpiActual > 0 ? s + e.budgetSpent / e.kpiActual : s, 0); return ta > 0 ? (ts / ta).toFixed(2) : '0.00'; }
            else { const ts = existingEntries.reduce((s, e) => s + e.budgetSpent, 0); return ts > 0 ? (existingEntries.reduce((s, e) => s + e.budgetSpent * e.kpiActual, 0) / ts).toFixed(2) : '0.00'; }
          })()}` : '—'} icon={Target} color="amber" />
        </div>

        {/* FORMULAIRES (masqués si completed) */}
        {!isCompleted && (
          <>
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl p-1.5 shadow-sm w-fit">
              <button onClick={() => setEntryMode("single")} className={cn("flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all", entryMode === "single" ? "bg-blue-600 text-white shadow-md" : "text-gray-500 hover:bg-gray-50")}><PenLine className="w-4 h-4" /> Saisie Unitaire</button>
              <button onClick={initBulkMode} className={cn("flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all", entryMode === "bulk" ? "bg-blue-600 text-white shadow-md" : "text-gray-500 hover:bg-gray-50")}>
                <Table className="w-4 h-4" /> Saisie en Lot
                {missingDays.length > 0 && <span className="bg-orange-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full ml-1">{missingDays.length}</span>}
              </button>
            </div>

            {/* SAISIE UNITAIRE */}
            {entryMode === "single" && (
              <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
                {editingDate && (
                  <div className="bg-amber-50 border-2 border-amber-300 rounded-t-2xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">✏️</span>
                      <div>
                        <div className="font-bold text-amber-900">Mode Édition</div>
                        <div className="text-xs text-amber-700">Modification de l'entrée du {new Date(editingDate).toLocaleDateString('fr-FR')}</div>
                      </div>
                    </div>
                    <button onClick={() => { setEditingDate(null); setFormData({ date: yesterdayStr, budgetSpent: 0, cpmRevenue: project.cpmRevenueActual, marginPct: project.margeInput, kpiActual: 0, adGroup: '', subCampaign: '' }); }} className="px-4 py-2 bg-amber-200 text-amber-800 rounded-lg text-xs font-bold hover:bg-amber-300 transition-colors">✕ Annuler</button>
                  </div>
                )}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100 p-6">
                  <h3 className="text-lg font-bold text-blue-900 flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white"><Calendar className="w-6 h-6" /></div>
                    Saisir les Données du Jour
                  </h3>
                  <p className="text-sm text-blue-700 mt-2">Remplissez les performances <strong>d'un seul jour</strong></p>
                </div>
                <div className="p-8 space-y-6">
                  
                  {/* Sélecteur Ad Group */}
                  {project.trackingMode === "adgroup" && (project.adGroupList || []).length > 0 && (
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">📊 Ad Group</label>
                      <select className="w-full text-base border-gray-300 bg-gray-50 rounded-xl p-4 border focus:ring-2 focus:ring-blue-500 outline-none font-medium" value={formData.adGroup || ''} onChange={(e) => setFormData(prev => ({ ...prev, adGroup: e.target.value }))}>
                        <option value="">— Sélectionner un ad group —</option>
                        {(project.adGroupList || []).map(ag => (<option key={ag} value={ag}>{ag}</option>))}
                      </select>
                      {formData.adGroup && (() => { const { tag } = detectFunnelTag(formData.adGroup); return tag !== "unknown" ? (<div className={cn("text-xs font-bold mt-2 px-3 py-1 rounded-full inline-block", tag === "retargeting" ? "bg-orange-100 text-orange-700" : tag === "prospecting" ? "bg-blue-100 text-blue-700" : tag === "awareness" ? "bg-purple-100 text-purple-700" : tag === "conversion" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600")}>🏷️ Détecté : {tag.toUpperCase()}</div>) : null; })()}
                    </div>
                  )}

                  {/* 🔥 V8.2 : Sélecteur Sous-Campagne */}
                  {project.trackingMode === "campaign" && (project.subCampaignList || []).length > 0 && (
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">📈 Sous-Campagne</label>
                      <select className="w-full text-base border-gray-300 bg-gray-50 rounded-xl p-4 border focus:ring-2 focus:ring-emerald-500 outline-none font-medium" value={formData.subCampaign || ''} onChange={(e) => setFormData(prev => ({ ...prev, subCampaign: e.target.value }))}>
                        <option value="">— Sélectionner une sous-campagne —</option>
                        {(project.subCampaignList || []).map(sc => (<option key={sc} value={sc}>{sc}</option>))}
                      </select>
                      {formData.subCampaign && (() => { const { tag } = detectFunnelTag(formData.subCampaign); return tag !== "unknown" ? (<div className={cn("text-xs font-bold mt-2 px-3 py-1 rounded-full inline-block", tag === "retargeting" ? "bg-orange-100 text-orange-700" : tag === "prospecting" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600")}>🏷️ Détecté : {tag.toUpperCase()}</div>) : null; })()}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">📅 Date</label>
                    <input type="date" className="w-full text-base border-gray-300 bg-gray-50 rounded-xl p-4 border focus:ring-2 focus:ring-blue-500 outline-none font-medium" value={formData.date} onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))} max={today} />
                    {hasEntryForDate && <p className="text-xs text-amber-600 mt-2 font-medium">⚠️ Une entrée existe déjà pour cette date.</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">💰 Budget Dépensé du Jour ({currSym})</label>
                      <input type="number" step="0.01" className="w-full text-base border-gray-300 bg-gray-50 rounded-xl p-4 border focus:ring-2 focus:ring-blue-500 outline-none font-medium" value={formData.budgetSpent || ''} onChange={(e) => handleInputChange("budgetSpent", Number(e.target.value))} />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">📈 CPM Revenue ({currSym})</label>
                      <input type="number" step="0.01" className="w-full text-base border-gray-300 bg-gray-50 rounded-xl p-4 border focus:ring-2 focus:ring-blue-500 outline-none font-medium" value={formData.cpmRevenue ?? ''} onChange={(e) => handleInputChange("cpmRevenue", Number(e.target.value))} />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">📊 Marge du Jour (%)</label>
                      <input type="number" step="0.01" className="w-full text-base border-gray-300 bg-gray-50 rounded-xl p-4 border focus:ring-2 focus:ring-blue-500 outline-none font-medium" value={formData.marginPct || ''} onChange={(e) => handleInputChange("marginPct", Number(e.target.value))} />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1 uppercase tracking-wider">🎯 {project.kpiType} du Jour</label>
                      <div className="flex items-center gap-1.5 mb-2"><Info className="w-3.5 h-3.5 text-blue-500" /><span className="text-xs text-blue-600 font-medium">Valeur de CE JOUR uniquement — pas le cumulé global</span></div>
                      <input type="number" step="0.01" className="w-full text-base border-gray-300 bg-gray-50 rounded-xl p-4 border focus:ring-2 focus:ring-blue-500 outline-none font-medium" value={formData.kpiActual || ''} onChange={(e) => handleInputChange("kpiActual", Number(e.target.value))} placeholder={isFin ? `Ex: 5.20 ${currSym}` : "Ex: 68.5 %"} />
                    </div>
                  </div>

                  {/* Calculs Auto */}
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
                    <h4 className="text-sm font-bold text-blue-900 mb-4 uppercase tracking-wider">📐 Calculs Automatiques</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-white rounded-lg p-4"><div className="text-xs text-gray-500 mb-1 font-medium">CPM Cost</div><div className="text-xl font-black text-gray-900">{(formData.cpmRevenue * (1 - formData.marginPct / 100)).toFixed(2)} {currSym}</div></div>
                      <div className="bg-white rounded-lg p-4"><div className="text-xs text-gray-500 mb-1 font-medium">Gain du Jour</div><div className="text-xl font-black text-emerald-600">{(formData.budgetSpent * (formData.marginPct / 100)).toFixed(2)} {currSym}</div></div>
                      <div className="bg-white rounded-lg p-4"><div className="text-xs text-gray-500 mb-1 font-medium">Nouveau Cumulé Budget</div><div className="text-xl font-black text-blue-600">{(cumulativeBudget + formData.budgetSpent).toFixed(0)} {currSym}</div></div>
                    </div>
                  </div>

                  {/* KPI Preview */}
                  {kpiPreview && (
                    <div className={cn("rounded-xl p-5 border-2", kpiPreview.meetsTarget === true ? "bg-emerald-50 border-emerald-200" : kpiPreview.meetsTarget === false ? "bg-red-50 border-red-200" : "bg-indigo-50 border-indigo-200")}>
                      <h4 className="text-sm font-bold text-gray-900 mb-4 uppercase tracking-wider flex items-center gap-2">🎯 Impact sur le {project.kpiType} Cumulé <span className="text-[10px] font-bold bg-indigo-200 text-indigo-800 px-2 py-0.5 rounded-full normal-case">Temps réel</span></h4>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-white rounded-lg p-4 border border-gray-100"><div className="text-xs text-gray-500 mb-1 font-medium">{project.kpiType} du Jour</div><div className="text-xl font-black text-gray-900">{fmtKpi(kpiPreview.dayKpi)}</div></div>
                        {kpiPreview.hasHistory && (<div className="bg-white rounded-lg p-4 border border-gray-100"><div className="text-xs text-gray-500 mb-1 font-medium">{project.kpiType} Cumulé Actuel</div><div className="text-xl font-black text-gray-600">{fmtKpi(kpiPreview.currentCumulKpi)}</div></div>)}
                        <div className={cn("rounded-lg p-4 border-2", kpiPreview.meetsTarget === true ? "bg-emerald-50 border-emerald-300" : kpiPreview.meetsTarget === false ? "bg-red-50 border-red-300" : "bg-blue-50 border-blue-200")}>
                          <div className="text-xs text-gray-500 mb-1 font-medium flex items-center justify-between"><span>{project.kpiType} Cumulé Après</span>{kpiPreview.meetsTarget === true && <span className="text-emerald-600 text-[10px] font-black">✓ OBJECTIF</span>}{kpiPreview.meetsTarget === false && <span className="text-red-600 text-[10px] font-black">✗ OBJECTIF</span>}</div>
                          <div className={cn("text-xl font-black", kpiPreview.meetsTarget === true ? "text-emerald-600" : kpiPreview.meetsTarget === false ? "text-red-600" : "text-blue-700")}>{fmtKpi(kpiPreview.newCumulKpi)}</div>
                          {kpiPreview.hasHistory && kpiPreview.delta !== 0 && (<div className={cn("text-xs font-bold mt-1", kpiPreview.deltaDirection === "good" ? "text-emerald-600" : kpiPreview.deltaDirection === "bad" ? "text-red-600" : "text-gray-500")}>{kpiPreview.delta > 0 ? "+" : ""}{fmtKpi(kpiPreview.delta)} vs avant</div>)}
                        </div>
                      </div>
                      {project.targetKpi > 0 && (<div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">Objectif {project.kpiType} : <strong className="text-gray-900">{fmtKpi(project.targetKpi)}</strong>{isFin ? " (plus bas = mieux)" : " (plus haut = mieux)"}</div>)}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button onClick={handleSubmit} disabled={!project.id || formData.budgetSpent <= 0} className={cn("flex items-center gap-3 px-8 py-4 rounded-xl text-base font-bold transition-all shadow-lg", (!project.id || formData.budgetSpent <= 0) ? "bg-gray-300 text-gray-500 cursor-not-allowed" : "bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 transform hover:scale-105")}><Save className="w-5 h-5" /> Enregistrer les Données</button>
                  </div>
                </div>
              </div>
            )}

            {/* MODE BULK */}
            {entryMode === "bulk" && (
              <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
                <div className="bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-100 p-6">
                  <h3 className="text-lg font-bold text-orange-900 flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center text-white"><Table className="w-6 h-6" /></div>
                    Saisie en Lot — {bulkRows.length} ligne{bulkRows.length > 1 ? "s" : ""}
                    {project.trackingMode === "adgroup" && (<span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full ml-2">Mode Ad Group</span>)}
                    {project.trackingMode === "campaign" && (<span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full ml-2">Mode Sous-Campagne</span>)}
                  </h3>
                  <p className="text-sm text-orange-700 mt-2">Remplissez toutes les lignes d'un coup. CPM Revenue et Marge pré-remplis.</p>
                </div>
                <div className="p-6">
                  {bulkRows.length === 0 ? (
                    <div className="text-center py-12 text-gray-500"><div className="text-4xl mb-3">✅</div><h4 className="font-bold text-gray-700 mb-1">Aucun jour manquant</h4></div>
                  ) : (
                    <>
                      <div className="overflow-x-auto rounded-xl border border-gray-200">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase w-40">Date</th>
                              {project.trackingMode === "adgroup" && (<th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Ad Group</th>)}
                              {project.trackingMode === "campaign" && (<th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Sous-Camp.</th>)}
                              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Budget ({currSym})</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">CPM Rev ({currSym})</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Marge %</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">{project.kpiType} du Jour</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Gain</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {bulkRows.map((row, idx) => (
                              <tr key={`${row.date}-${row.adGroup || row.subCampaign || idx}`} className={cn("transition-colors", row.isExisting ? "bg-gray-50 opacity-50" : "bg-white hover:bg-blue-50/30")}>
                                <td className="px-4 py-3"><div className="font-bold text-gray-900">{new Date(row.date).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })}</div></td>
                                {project.trackingMode === "adgroup" && (
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-bold text-gray-700">{row.adGroup || '—'}</span>
                                      {row.adGroup && (() => { const { tag } = detectFunnelTag(row.adGroup); return tag !== "unknown" ? (<span className={cn("text-[9px] font-black px-1 py-0.5 rounded-full", tag === "retargeting" ? "bg-orange-100 text-orange-700" : tag === "prospecting" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600")}>{tag.slice(0, 2).toUpperCase()}</span>) : null; })()}
                                    </div>
                                  </td>
                                )}
                                {project.trackingMode === "campaign" && (<td className="px-4 py-3"><span className="text-xs font-bold text-gray-700">{row.subCampaign || '—'}</span></td>)}
                                <td className="px-4 py-3"><input type="number" step="0.01" disabled={row.isExisting} className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 outline-none font-medium" value={row.budgetSpent || ''} onChange={(e) => updateBulkRow(idx, "budgetSpent", Number(e.target.value))} placeholder="0.00" /></td>
                                <td className="px-4 py-3"><input type="number" step="0.01" disabled={row.isExisting} className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 outline-none font-medium" value={row.cpmRevenue || ''} onChange={(e) => updateBulkRow(idx, "cpmRevenue", Number(e.target.value))} /></td>
                                <td className="px-4 py-3"><input type="number" step="0.01" disabled={row.isExisting} className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 outline-none font-medium" value={row.marginPct || ''} onChange={(e) => updateBulkRow(idx, "marginPct", Number(e.target.value))} /></td>
                                <td className="px-4 py-3"><input type="number" step="0.01" disabled={row.isExisting} className="w-full text-sm border-gray-200 bg-gray-50 rounded-lg p-2.5 border focus:ring-2 focus:ring-blue-500 outline-none font-medium" value={row.kpiActual || ''} onChange={(e) => updateBulkRow(idx, "kpiActual", Number(e.target.value))} placeholder={isFin ? `${project.kpiType} du jour` : "%"} /></td>
                                <td className="px-4 py-3"><span className={cn("font-bold text-sm", row.budgetSpent > 0 ? "text-emerald-600" : "text-gray-300")}>{row.budgetSpent > 0 ? `+${(row.budgetSpent * (row.marginPct / 100)).toFixed(2)} ${currSym}` : "—"}</span></td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-blue-50 border-t-2 border-blue-200">
                            <tr>
                              <td className="px-4 py-3 font-black text-blue-900 text-xs uppercase" colSpan={(project.trackingMode === "adgroup" || project.trackingMode === "campaign") ? 2 : 1}>Total</td>
                              <td className="px-4 py-3 font-black text-blue-900">{bulkRows.reduce((s, r) => s + r.budgetSpent, 0).toFixed(2)} {currSym}</td>
                              <td className="px-4 py-3"></td>
                              <td className="px-4 py-3 font-bold text-blue-700">{(() => { const t = bulkRows.reduce((s, r) => s + r.budgetSpent, 0); return t === 0 ? "—" : `${(bulkRows.reduce((s, r) => s + r.budgetSpent * r.marginPct, 0) / t).toFixed(1)}%`; })()}</td>
                              <td className="px-4 py-3"></td>
                              <td className="px-4 py-3 font-black text-emerald-700">+{bulkRows.reduce((s, r) => s + r.budgetSpent * (r.marginPct / 100), 0).toFixed(2)} {currSym}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      <div className="flex items-center justify-between mt-6">
                        <button onClick={() => { setEntryMode("single"); setBulkRows([]); }} className="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl text-sm font-bold hover:bg-gray-200 transition-colors">Annuler</button>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-gray-500">{bulkRows.filter(r => r.budgetSpent > 0).length} ligne(s) valide(s)</span>
                          <button onClick={handleBulkSubmit} disabled={!project.id || bulkRows.filter(r => r.budgetSpent > 0).length === 0} className={cn("flex items-center gap-3 px-8 py-4 rounded-xl text-base font-bold transition-all shadow-lg", (!project.id || bulkRows.filter(r => r.budgetSpent > 0).length === 0) ? "bg-gray-300 text-gray-500 cursor-not-allowed" : "bg-gradient-to-r from-orange-600 to-amber-600 text-white hover:from-orange-700 hover:to-amber-700 transform hover:scale-105")}><Save className="w-5 h-5" /> Enregistrer {bulkRows.filter(r => r.budgetSpent > 0).length} Entrée(s)</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* HISTORIQUE */}
        {existingEntries.length > 0 && (
          <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 p-6 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">📋 Historique des Saisies</h3>
              <div className="flex items-center gap-2">
                {project.trackingMode === "adgroup" && (<span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Mode Ad Group</span>)}
                {project.trackingMode === "campaign" && (<span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Mode Sous-Campagne</span>)}
                {isCompleted && <span className="text-xs font-bold bg-gray-200 text-gray-600 px-3 py-1 rounded-full">Lecture seule</span>}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Date</th>
                    {project.trackingMode === "adgroup" && (<th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Ad Group</th>)}
                    {project.trackingMode === "campaign" && (<th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Sous-Campagne</th>)}
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Budget</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">CPM Rev</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Marge %</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">{project.kpiType} Jour</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Gain</th>
                    {!isCompleted && <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {existingEntries.map((entry, idx) => (
                    <tr key={idx} className={cn("hover:bg-blue-50 transition-colors", editingDate === entry.date && "bg-amber-50 ring-2 ring-amber-300")}>
                      <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{new Date(entry.date).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      {project.trackingMode === "adgroup" && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-gray-700">{entry.adGroup || "—"}</span>
                            {entry.funnelTag && entry.funnelTag !== "unknown" && (<span className={cn("text-[9px] font-black px-1.5 py-0.5 rounded-full", entry.funnelTag === "retargeting" ? "bg-orange-100 text-orange-700" : entry.funnelTag === "prospecting" ? "bg-blue-100 text-blue-700" : entry.funnelTag === "awareness" ? "bg-purple-100 text-purple-700" : entry.funnelTag === "conversion" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600")}>{entry.funnelTag.slice(0, 2).toUpperCase()}</span>)}
                          </div>
                        </td>
                      )}
                      {project.trackingMode === "campaign" && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-gray-700">{entry.subCampaign || "—"}</span>
                            {entry.funnelTag && entry.funnelTag !== "unknown" && (<span className={cn("text-[9px] font-black px-1.5 py-0.5 rounded-full", entry.funnelTag === "retargeting" ? "bg-orange-100 text-orange-700" : entry.funnelTag === "prospecting" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600")}>{entry.funnelTag.slice(0, 2).toUpperCase()}</span>)}
                          </div>
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap text-gray-600">{entry.budgetSpent.toFixed(2)} {currSym}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-600">{entry.cpmRevenue.toFixed(2)} {currSym}</td>
                      <td className="px-6 py-4 whitespace-nowrap"><span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">{entry.marginPct.toFixed(2)} %</span></td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-600 font-medium">{entry.kpiActual.toFixed(2)}</td>
                      <td className="px-6 py-4 whitespace-nowrap"><span className="text-emerald-600 font-bold">+{(entry.budgetSpent * (entry.marginPct / 100)).toFixed(2)} {currSym}</span></td>
                      {!isCompleted && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleEdit(entry)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Modifier"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></button>
                            <button onClick={() => handleDelete(entry.date)} className="p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors" title="Supprimer"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, color }: { title: string; value: string; icon: any; color: "blue" | "emerald" | "purple" | "amber" }) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">{title}</div>
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", color === "blue" && "bg-blue-100 text-blue-600", color === "emerald" && "bg-emerald-100 text-emerald-600", color === "purple" && "bg-purple-100 text-purple-600", color === "amber" && "bg-amber-100 text-amber-600")}><Icon className="w-5 h-5" /></div>
      </div>
      <div className="text-3xl font-black text-gray-900">{value}</div>
    </div>
  );
}
