import * as XLSX from "xlsx";
import type { ProjectData } from "../types";

/**
 * Exporte un seul projet en fichier Excel (.xlsx)
 */
export function exportSingleProject(project: ProjectData) {
  if (!project || !project.dailyEntries || project.dailyEntries.length === 0) return;

  const wb = XLSX.utils.book_new();

  // Feuille données journalières
  const dailyData = project.dailyEntries.map((e: any) => ({
    Date: e.date,
    Impressions: e.impressions ?? 0,
    Clics: e.clicks ?? 0,
    "Dépense (€)": e.spend ?? 0,
    Revenus: e.revenue ?? 0,
    CPM: e.cpm ?? 0,
    CPC: e.cpc ?? 0,
    CTR: e.ctr ?? 0,
    "Marge (%)": e.margin ?? 0,
  }));

  const ws = XLSX.utils.json_to_sheet(dailyData);
  XLSX.utils.book_append_sheet(wb, ws, "Données journalières");

  // Feuille résumé
  const summary = [
    {
      Projet: project.name || project.id,
      Statut: project.status,
      Devise: project.currency,
      KPI: project.kpiType,
      "Nb jours": project.dailyEntries.length,
      "Budget total": project.totalBudget ?? 0,
      "Objectif gain": project.gainObjective ?? 0,
    },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, wsSummary, "Résumé");

  const fileName = `${(project.name || project.id || "projet").replace(/[^a-zA-Z0-9]/g, "_")}_export.xlsx`;
  XLSX.writeFile(wb, fileName);
}

/**
 * Exporte tous les projets dans un seul fichier Excel (un onglet par projet)
 */
export function exportAllProjects(projects: ProjectData[]) {
  if (!projects || projects.length === 0) return;

  const wb = XLSX.utils.book_new();

  // Onglet récapitulatif
  const recapData = projects.map((p) => ({
    Projet: p.name || p.id,
    Statut: p.status,
    Devise: p.currency,
    KPI: p.kpiType,
    "Nb jours": p.dailyEntries?.length ?? 0,
    "Budget total": p.totalBudget ?? 0,
    "Objectif gain": p.gainObjective ?? 0,
    "Marge input": p.inputMode,
  }));
  const wsRecap = XLSX.utils.json_to_sheet(recapData);
  XLSX.utils.book_append_sheet(wb, wsRecap, "Récapitulatif");

  // Un onglet par projet
  projects.forEach((p, idx) => {
    if (!p.dailyEntries || p.dailyEntries.length === 0) return;

    const sheetName = (p.name || p.id || `Projet_${idx + 1}`)
      .replace(/[^a-zA-Z0-9 ]/g, "")
      .substring(0, 31); // Excel limite à 31 chars

    const data = p.dailyEntries.map((e: any) => ({
      Date: e.date,
      Impressions: e.impressions ?? 0,
      Clics: e.clicks ?? 0,
      "Dépense (€)": e.spend ?? 0,
      Revenus: e.revenue ?? 0,
      CPM: e.cpm ?? 0,
      CPC: e.cpc ?? 0,
      CTR: e.ctr ?? 0,
      "Marge (%)": e.margin ?? 0,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  XLSX.writeFile(wb, `bloomberg_terminal_ads_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
