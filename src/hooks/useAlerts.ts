import { useMemo } from "react";
import { ProjectData } from "../types";

export type AlertSeverity = "success" | "warning" | "danger" | "info";
export type AlertType = 
  | "budget_pace_early" 
  | "budget_pace_late" 
  | "kpi_drift_bad" 
  | "kpi_drift_good"
  | "kpi_achieved"
  | "margin_low"
  | "margin_opportunity"
  | "spend_stalled"
  | "high_performer"
  | "underperformer";

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  projectId: string;
  projectName: string;
  value?: number;
  threshold?: number;
  recommendation?: string;
}

export function useAlerts(projects: ProjectData[]): Alert[] {
  return useMemo(() => {
    const alerts: Alert[] = [];
    const now = new Date();

    projects.forEach((project) => {
      if (!project.id) return;

      const budgetProgress = project.budgetTotal > 0 ? project.budgetSpent / project.budgetTotal : 0;
      
      // Calculer les jours écoulés
      let daysElapsed = 0;
      let timeProgress = 0;
      
      if (project.createdAt && project.durationDays > 0) {
        const startDate = new Date(project.createdAt);
        const msElapsed = now.getTime() - startDate.getTime();
        daysElapsed = Math.max(0, Math.floor(msElapsed / (1000 * 60 * 60 * 24)));
        timeProgress = Math.min(1, daysElapsed / project.durationDays);
      }

      // Calculer la marge actuelle
      let currentMargin = 0;
      if (project.inputMode === "CPM Cost") {
        if (project.cpmRevenueActual > 0) {
          currentMargin = ((project.cpmRevenueActual - project.cpmCostActuel) / project.cpmRevenueActual) * 100;
        }
      } else {
        currentMargin = project.margeInput;
      }

      const isFin = !["Viewability", "VTR", "CTR"].includes(project.kpiType);

      // ========== ALERTE 1 : BUDGET PACE ==========
      if (timeProgress > 0.1 && budgetProgress > 0) {
        const paceDiff = budgetProgress - timeProgress;
        
        // Pace trop rapide (finit en avance)
        if (paceDiff > 0.15 && budgetProgress < 0.95) {
          const daysEarly = Math.round((paceDiff * project.durationDays));
          alerts.push({
            id: `${project.id}-pace-early`,
            type: "budget_pace_early",
            severity: "warning",
            title: "⚠️ Sur-pace budgétaire",
            message: `Le budget sera épuisé environ ${daysEarly} jour${daysEarly > 1 ? 's' : ''} avant la fin prévue`,
            projectId: project.id,
            projectName: project.name,
            value: budgetProgress * 100,
            threshold: timeProgress * 100,
            recommendation: "Réduisez les enchères ou pausez les lignes les moins performantes"
          });
        }
        
        // Pace trop lent (finit en retard)
        if (paceDiff < -0.15 && timeProgress > 0.2) {
          const daysLate = Math.round(Math.abs(paceDiff) * project.durationDays);
          alerts.push({
            id: `${project.id}-pace-late`,
            type: "budget_pace_late",
            severity: "danger",
            title: "🚨 Sous-pace budgétaire",
            message: `Risque de ne pas dépenser le budget à temps (retard estimé : ${daysLate} jour${daysLate > 1 ? 's' : ''})`,
            projectId: project.id,
            projectName: project.name,
            value: budgetProgress * 100,
            threshold: timeProgress * 100,
            recommendation: "Augmentez les enchères ou activez plus de lignes"
          });
        }
      }

      // ========== ALERTE 2 : KPI DRIFT ==========
      if (project.targetKpi > 0 && project.actualKpi > 0) {
        if (isFin) {
          // KPI financier (CPA, CPC, etc.) → plus bas = mieux
          const kpiDrift = ((project.actualKpi - project.targetKpi) / project.targetKpi) * 100;
          
          if (kpiDrift > 25) {
            alerts.push({
              id: `${project.id}-kpi-bad`,
              type: "kpi_drift_bad",
              severity: "danger",
              title: `🔻 ${project.kpiType} en dérive`,
              message: `${project.kpiType} actuel (${project.actualKpi.toFixed(2)}€) est ${kpiDrift.toFixed(0)}% au-dessus de l'objectif (${project.targetKpi.toFixed(2)}€)`,
              projectId: project.id,
              projectName: project.name,
              value: project.actualKpi,
              threshold: project.targetKpi,
              recommendation: "Optimisez le ciblage, testez de nouvelles créatives ou réduisez la marge"
            });
          } else if (kpiDrift < -20) {
            alerts.push({
              id: `${project.id}-kpi-good`,
              type: "kpi_drift_good",
              severity: "success",
              title: `✅ ${project.kpiType} excellent`,
              message: `${project.kpiType} actuel (${project.actualKpi.toFixed(2)}€) est ${Math.abs(kpiDrift).toFixed(0)}% en-dessous de l'objectif !`,
              projectId: project.id,
              projectName: project.name,
              value: project.actualKpi,
              threshold: project.targetKpi,
              recommendation: "Opportunité d'augmenter la marge ou de scaler le budget"
            });
          }
        } else {
          // KPI de qualité (CTR, VTR, etc.) → plus haut = mieux
          const kpiDrift = ((project.targetKpi - project.actualKpi) / project.targetKpi) * 100;
          
          if (kpiDrift > 25) {
            alerts.push({
              id: `${project.id}-kpi-bad`,
              type: "kpi_drift_bad",
              severity: "danger",
              title: `🔻 ${project.kpiType} faible`,
              message: `${project.kpiType} actuel (${(project.actualKpi * 100).toFixed(2)}%) est ${kpiDrift.toFixed(0)}% en-dessous de l'objectif`,
              projectId: project.id,
              projectName: project.name,
              value: project.actualKpi,
              threshold: project.targetKpi,
              recommendation: "Testez de nouvelles créatives ou optimisez le ciblage"
            });
          }
        }
      }

      // ========== ALERTE 3 : OBJECTIF KPI ATTEINT ==========
      if (project.targetKpi > 0 && project.actualKpi > 0 && budgetProgress > 0.3) {
        const isAchieved = isFin 
          ? project.actualKpi <= project.targetKpi 
          : project.actualKpi >= project.targetKpi;
          
        if (isAchieved) {
          alerts.push({
            id: `${project.id}-kpi-achieved`,
            type: "kpi_achieved",
            severity: "success",
            title: "🎯 Objectif KPI atteint !",
            message: `${project.kpiType} objectif atteint (${project.actualKpi.toFixed(2)} vs ${project.targetKpi.toFixed(2)})`,
            projectId: project.id,
            projectName: project.name,
            value: project.actualKpi,
            threshold: project.targetKpi,
            recommendation: "Vous pouvez optimiser la marge en toute sécurité"
          });
        }
      }

      // ========== ALERTE 4 : MARGE FAIBLE ==========
      if (currentMargin < 15 && budgetProgress > 0.2) {
        alerts.push({
          id: `${project.id}-margin-low`,
          type: "margin_low",
          severity: "warning",
          title: "⚠️ Marge faible",
          message: `Marge actuelle (${currentMargin.toFixed(1)}%) sous le seuil recommandé (15%)`,
          projectId: project.id,
          projectName: project.name,
          value: currentMargin,
          threshold: 15,
          recommendation: "Vérifiez la rentabilité ou envisagez de renégocier le CPM vendu"
        });
      }

      // ========== ALERTE 5 : OPPORTUNITÉ DE MARGE ==========
      if (currentMargin < 70 && isFin && project.actualKpi > 0 && project.targetKpi > 0) {
        const kpiMargin = isFin 
          ? ((project.targetKpi - project.actualKpi) / project.targetKpi) * 100
          : ((project.actualKpi - project.targetKpi) / project.targetKpi) * 100;
          
        if (kpiMargin > 20) {
          alerts.push({
            id: `${project.id}-margin-opportunity`,
            type: "margin_opportunity",
            severity: "info",
            title: "💰 Opportunité d'optimisation",
            message: `Marge de manœuvre sur le KPI : vous pouvez augmenter la marge`,
            projectId: project.id,
            projectName: project.name,
            value: currentMargin,
            recommendation: "Testez une augmentation de marge de +2 à +5 points"
          });
        }
      }

      // ========== ALERTE 6 : DÉPENSE STAGNANTE ==========
      if (budgetProgress < 0.05 && timeProgress > 0.3) {
        alerts.push({
          id: `${project.id}-spend-stalled`,
          type: "spend_stalled",
          severity: "danger",
          title: "🛑 Dépense stagnante",
          message: `Seulement ${(budgetProgress * 100).toFixed(1)}% du budget dépensé après ${Math.round(timeProgress * 100)}% du temps`,
          projectId: project.id,
          projectName: project.name,
          value: budgetProgress * 100,
          threshold: timeProgress * 100,
          recommendation: "Vérifiez que les lignes sont actives et les enchères compétitives"
        });
      }

      // ========== ALERTE 7 : HIGH PERFORMER ==========
      if (budgetProgress > 0.5 && currentMargin > 65) {
        const kpiGood = isFin 
          ? (project.actualKpi > 0 && project.targetKpi > 0 && project.actualKpi < project.targetKpi)
          : (project.actualKpi > 0 && project.targetKpi > 0 && project.actualKpi > project.targetKpi);
          
        if (kpiGood) {
          alerts.push({
            id: `${project.id}-high-performer`,
            type: "high_performer",
            severity: "success",
            title: "⭐ Campagne high-performer",
            message: `Excellente performance : marge ${currentMargin.toFixed(1)}% + objectif KPI atteint`,
            projectId: project.id,
            projectName: project.name,
            recommendation: "Considérez augmenter le budget ou dupliquer la stratégie"
          });
        }
      }

      // ========== ALERTE 8 : UNDERPERFORMER ==========
      if (budgetProgress > 0.3 && currentMargin < 30) {
        const kpiBad = isFin 
          ? (project.actualKpi > 0 && project.targetKpi > 0 && project.actualKpi > project.targetKpi * 1.3)
          : (project.actualKpi > 0 && project.targetKpi > 0 && project.actualKpi < project.targetKpi * 0.7);
          
        if (kpiBad) {
          alerts.push({
            id: `${project.id}-underperformer`,
            type: "underperformer",
            severity: "danger",
            title: "⚠️ Campagne sous-performante",
            message: `Marge faible (${currentMargin.toFixed(1)}%) ET objectif KPI non atteint`,
            projectId: project.id,
            projectName: project.name,
            recommendation: "Analyse urgente requise : optimisez ou considérez de mettre en pause"
          });
        }
      }
    });

    // Trier par sévérité (danger > warning > info > success)
    const severityOrder = { danger: 0, warning: 1, info: 2, success: 3 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return alerts;
  }, [projects]);
}
