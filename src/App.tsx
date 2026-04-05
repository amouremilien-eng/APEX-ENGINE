import { useState, useEffect, useCallback, useRef } from "react";
import { BenchmarkIntelligence } from "./components/BenchmarkIntelligence";
import { AppROI } from "./components/AppROI";
import { Legal } from "./components/Legal";
import { Sidebar } from "./components/Sidebar";
import { CockpitYield } from "./components/CockpitYield";
import { LearningEngineDashboard } from "./components/LearningEngineDashboard";
import { OptimizationCycle } from "./components/OptimizationCycle";
import { Portfolio } from "./components/Portfolio";
import { MarketWatch } from "./components/MarketWatch";
import { CampaignTracking } from "./components/CampaignTracking";
// Insights supprimé — V11.0 Bloomberg Terminal Ads
import { Settings } from "./components/Settings";
import { Auth } from "./components/Auth";
import { IntroVideo } from "./components/IntroVideo";
import { useProjectStore } from "./store/useProjectStore";
import { useUserStore } from "./store/useUserStore";
import { DEFAULT_PROJECT, ProjectData } from "./types";
import { Bell, Layout, LogOut, ChevronDown, Plus, Percent, TrendingUp, DollarSign, Target, CheckCircle2, Activity, Lock, Shield } from "lucide-react";
import { GeoTraffic } from "./components/GeoTraffic";

// 🔐 ADMIN ACCESS CONTROL — Liste des 3 identifiants admin
const ADMIN_USERNAMES = ["tfgmd", "aygmd", "eagmd"];

function isAdminUsername(username: string | null | undefined): boolean {
  if (!username) return false;
  return ADMIN_USERNAMES.includes(username.toLowerCase());
}

function getCurrentUsername(): string | null {
  try {
    return localStorage.getItem("yield_current_username");
  } catch {
    return null;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState("cockpit");
  const [showIntro, setShowIntro] = useState(false);
  const [appReady, setAppReady] = useState(true);
  const [showCampaignDropdown, setShowCampaignDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [adminShowOnlyMine, setAdminShowOnlyMine] = useState(false); // 🔐 V11.1 : Filtre "Mes campagnes" pour admins
  const [animsDone, setAnimsDone] = useState(true);
  const [lastSaveTime, setLastSaveTime] = useState<number>(Date.now());
  const [saveIndicator, setSaveIndicator] = useState<string>("");

  const { user: storeUser, isLoading, logout } = useUserStore();
  const [localUser, setLocalUser] = useState(storeUser);

  // 🔥 V11.5 : Ref pour détecter la transition null → user (login frais)
  const prevUserRef = useRef<typeof storeUser>(storeUser);

  useEffect(() => {
    // Détecter la transition null → user = login frais → déclencher l'intro
    if (!prevUserRef.current && storeUser) {
      setShowIntro(true);
      setAppReady(false);
      setAnimsDone(false);
    }
    prevUserRef.current = storeUser;
    setLocalUser(storeUser);
  }, [storeUser]);

  useEffect(() => {
    if (!showIntro) return; // No intro → appReady already true via initial state

    const handleIntroDone = () => {
      setShowIntro(false);
      // 🔥 V11.5 : Nettoyer sessionStorage pour ne pas rejouer au refresh
      sessionStorage.removeItem("showIntroVideo");
      // Small beat before revealing the app (smoother transition)
      setTimeout(() => setAppReady(true), 80);
    };
    window.addEventListener("intro-animation-done", handleIntroDone);

    // Safety fallback
    const fallback = setTimeout(() => {
      setShowIntro(false);
      setAppReady(true);
    }, 5500);

    return () => {
      window.removeEventListener("intro-animation-done", handleIntroDone);
      clearTimeout(fallback);
    };
  }, [showIntro]);

  // 🎬 Clear animation properties after entrance animations complete
  // This removes stacking contexts that trap dropdown z-index
  useEffect(() => {
    if (!appReady || animsDone) return;
    const timer = setTimeout(() => setAnimsDone(true), 1100);
    return () => clearTimeout(timer);
  }, [appReady, animsDone]);

  useEffect(() => {
    const handleLoginSuccess = () => {
      const saved = localStorage.getItem("userProfile");
      if (saved) {
        setLocalUser(JSON.parse(saved));
      }
    };
    window.addEventListener("force-app-update", handleLoginSuccess);
    return () => window.removeEventListener("force-app-update", handleLoginSuccess);
  }, []);

  const {
    projects,
    currentProject,
    setCurrentProject,
    saveProject,
    deleteProject,
    loadProject,
    createNewProject,
    duplicateProject,
    isSyncing,
    lastSyncError,
    syncStatus,
    // 🔥 V7.1 : Fonctions admin cross-users
    allProjectsData,
    isLoadingAllProjects,
    loadAllProjects,
  } = useProjectStore();

  const activeProject = currentProject || DEFAULT_PROJECT;
  // 🔥 V12.3 FIX : Debounced save — sauvegarde 2s après le dernier changement
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const handleProjectChange = useCallback((updatedProject: ProjectData) => {
    setCurrentProject(updatedProject);
    
    // Debounce : sauvegarder 2s après le dernier changement (au lieu de 30s)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (updatedProject.id) {
        saveProject(updatedProject);
      }
    }, 2000);
  }, [saveProject, setCurrentProject]);

  // 🔥 V12.3 FIX : Sauvegarder le projet courant AVANT de changer de projet
  const handleLoadProject = useCallback((id: string) => {
    // Force save du projet en cours avant de switcher
    if (currentProject?.id) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveProject(currentProject);
    }
    loadProject(id);
  }, [currentProject, saveProject, loadProject]);

  // 🔐 V8.0 : Détection admin par USERNAME (tfgmd, aygmd, eagmd uniquement)
  const isAdmin = isAdminUsername(getCurrentUsername());

  // 🔥 V7.1 : Charger toutes les campagnes si admin
  useEffect(() => {
    if (isAdmin) {
      loadAllProjects();
    }
  }, [isAdmin, loadAllProjects]);

  // 🔐 V8.0 : Projets à afficher dans le dropdown
  // Admin = tous les projets de tous les traders
  // Trader normal = seulement ses propres projets
  const globalProjects = isAdmin && allProjectsData ? allProjectsData.projects : projects;

  // 🔐 V8.0 : Si un non-admin essaie d'accéder au ROI, le rediriger
  useEffect(() => {
    if (activeTab === "roi" && !isAdmin) {
      setActiveTab("cockpit");
    }
  }, [activeTab, isAdmin]);

  // 🔥 V6.0 : RACCOURCIS CLAVIER
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        switch (e.key) {
          case '1': e.preventDefault(); setActiveTab("cockpit"); break;
          case '2': e.preventDefault(); setActiveTab("tracking"); break;
          case '3': e.preventDefault(); setActiveTab("portfolio"); break;
          case '4': e.preventDefault(); setActiveTab("portfolio"); break;
          case 's':
            e.preventDefault();
            if (currentProject) {
              saveProject({ ...activeProject, id: currentProject.id, name: currentProject.name });
              setSaveIndicator("Sauvegardé !");
              setTimeout(() => setSaveIndicator(""), 2000);
            }
            break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentProject, activeProject]);

  // 🔥 V12.3 : AUTO-SAVE toutes les 30s + save avant fermeture page
  useEffect(() => {
    if (!currentProject?.id) return;
    const interval = setInterval(() => {
      saveProject({ ...activeProject, id: currentProject.id, name: currentProject.name });
      setLastSaveTime(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, [currentProject?.id, JSON.stringify(activeProject)]);

  // 🔥 V12.3 : Sauvegarder AVANT fermeture/refresh de la page
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentProject?.id) {
        // Flush le debounce en cours
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveProject(currentProject);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [currentProject, saveProject]);

  // 🔥 V6.0 : Compteur d'alertes pour la cloche
  const totalAlertCount = projects.reduce((count, p) => {
    if (!p.id || p.budgetTotal <= 0 || p.durationDays <= 0) return count;
    if (p.status === "completed") return count;
    let a = 0;
    const dayEl = p.startDate ? Math.max(0, Math.floor((Date.now() - new Date(p.startDate).getTime()) / 86400000)) : 0;
    const theo = p.budgetTotal * (dayEl / p.durationDays);
    if (theo > 0 && Math.abs((p.budgetSpent - theo) / theo) > 0.2) a++;
    const fin = !["Viewability", "VTR", "CTR"].includes(p.kpiType);
    if (p.actualKpi > 0 && p.targetKpi > 0) {
      if (fin && p.actualKpi > p.targetKpi * 1.3) a++;
      if (!fin && p.actualKpi < p.targetKpi * 0.7) a++;
    }
    return count + a;
  }, 0);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Chargement...</div>;

  if (!localUser) {
    return <Auth />;
  }

  const tabTitles: Record<string, string> = {
    cockpit: "Bloomberg Terminal Ads",
    learning: "Learning Engine",
    tracking: "Suivi Campagne",
    cycle: "Cycle des Optimisations",
    portfolio: "Portfolio & Performance",
    benchmark: "Benchmark Intelligence",
    roi: "ROI TDesk",
    market: "Market Watch",
    geotraffic: "Geo Traffic",
    settings: "Settings",
    help: "Help Center",
  };

  // 📊 Fonction pour calculer les KPIs moyens
  const calculateAverageKPIs = (project: any) => {
    const currSym = project.currency.includes("EUR") ? "€" : "$";
    
    if (project.status === "completed" && project.finalBalance) {
      return {
        avgCpmRevenue: project.finalBalance.avgCpmRevenue,
        avgMargin: project.finalBalance.realMarginPct,
        avgKpi: project.finalBalance.finalKpi,
        totalBudgetSpent: project.finalBalance.totalBudgetSpent,
        entriesCount: project.finalBalance.totalDays,
        currSym,
        kpiType: project.kpiType,
        targetKpi: project.targetKpi,
        isCompleted: true,
        kpiAchieved: project.finalBalance.kpiAchieved,
        totalGain: project.finalBalance.totalGain,
      };
    }

    if (!project.dailyEntries || project.dailyEntries.length === 0) {
      let margin = 0;
      if (project.inputMode === "CPM Cost") {
        if (project.cpmRevenueActual > 0) {
          margin = ((project.cpmRevenueActual - project.cpmCostActuel) / project.cpmRevenueActual) * 100;
        }
      } else {
        margin = project.margeInput;
      }

      return {
        avgCpmRevenue: project.cpmRevenueActual,
        avgMargin: margin,
        avgKpi: project.actualKpi,
        totalBudgetSpent: project.budgetSpent,
        entriesCount: 0,
        currSym,
        kpiType: project.kpiType,
        targetKpi: project.targetKpi,
        isCompleted: false,
        kpiAchieved: null,
        totalGain: 0,
      };
    }

    const totalBudgetSpent = project.dailyEntries.reduce((sum: number, e: any) => sum + e.budgetSpent, 0);
    
    let weightedCpmRevenue = 0;
    let weightedMargin = 0;
    let weightedKpi = 0;

    if (totalBudgetSpent > 0) {
      project.dailyEntries.forEach((entry: any) => {
        const weight = entry.budgetSpent / totalBudgetSpent;
        weightedCpmRevenue += entry.cpmRevenue * weight;
        weightedMargin += entry.marginPct * weight;
      });

      const isFin = !["Viewability", "VTR", "CTR"].includes(project.kpiType);
      if (isFin) {
        const totalActions = project.dailyEntries.reduce((sum: number, e: any) => {
          return e.kpiActual > 0 ? sum + e.budgetSpent / e.kpiActual : sum;
        }, 0);
        weightedKpi = totalActions > 0 ? totalBudgetSpent / totalActions : 0;
      } else {
        project.dailyEntries.forEach((entry: any) => {
          weightedKpi += entry.kpiActual * (entry.budgetSpent / totalBudgetSpent);
        });
      }
    }

    return {
      avgCpmRevenue: weightedCpmRevenue,
      avgMargin: weightedMargin,
      avgKpi: weightedKpi,
      totalBudgetSpent,
      entriesCount: project.dailyEntries.length,
      currSym,
      kpiType: project.kpiType,
      targetKpi: project.targetKpi,
      isCompleted: false,
      kpiAchieved: null,
      totalGain: totalBudgetSpent * (weightedMargin / 100),
    };
  };

  // 🔥 V7.0 : Tri des projets — actives en premier, terminées en bas
  // 🔐 V8.0 : Pour les admins, on utilise globalProjects (toutes les campagnes)
  // 🔐 V11.2 : Filtre "Mes campagnes" = utiliser allProjectsData.byUser[myUserId]
  const myUserId = (() => { try { return localStorage.getItem("yield_current_user_id"); } catch { return null; } })();
  const myOwnProjects = (isAdmin && allProjectsData && myUserId && allProjectsData.byUser?.[myUserId])
    ? allProjectsData.byUser[myUserId].projects
    : projects;
  const displayProjects = isAdmin 
    ? (adminShowOnlyMine ? myOwnProjects : globalProjects)
    : projects;
  const activeProjects = displayProjects.filter(p => p.status !== "completed");
  const completedProjects = displayProjects.filter(p => p.status === "completed");

  // 🔍 DEBUG V11.2 — À supprimer après validation
  if (isAdmin && adminShowOnlyMine) {
    console.log("🔍 DEBUG filtre Mes campagnes:", {
      myUserId,
      byUserKeys: allProjectsData ? Object.keys(allProjectsData.byUser) : "pas de allProjectsData",
      myOwnProjectsCount: myOwnProjects.length,
      myOwnProjectNames: myOwnProjects.map((p: any) => p.name),
      globalCount: globalProjects.length,
    });
  }

  // 🔐 V8.0 : Grouper les campagnes par propriétaire (pour vue admin)
  const groupProjectsByOwner = (projectsList: any[]) => {
    return projectsList.reduce((groups: Record<string, any[]>, p) => {
      const owner = p.ownerName || p.ownerUsername || "Mes campagnes";
      if (!groups[owner]) groups[owner] = [];
      groups[owner].push(p);
      return groups;
    }, {});
  };

  // 🔐 V8.0 : Wrapper setActiveTab pour bloquer ROI aux non-admins
  const handleSetActiveTab = (tab: string) => {
    if (tab === "roi" && !isAdmin) return; // 🔐 Bloquer ROI pour les non-admins
    setActiveTab(tab);
  };

  return (
    <div className={`flex h-screen w-full overflow-hidden font-sans text-gray-900 theme-${localUser.theme}`} style={{ background: "linear-gradient(160deg, #eef2f7 0%, #f5f0eb 30%, #f0f2f5 60%, #ebe8f0 100%)" }}>
      
      {/* 🎬 Entrance animation keyframes */}
      <style>{`
        @keyframes appSidebarIn {
          from { opacity: 0; transform: translateX(-40px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes appHeaderIn {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes appMainIn {
          from { opacity: 0; transform: translateY(24px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {showIntro && <IntroVideo />}

      <div style={animsDone ? {} : {
        opacity: appReady ? 1 : 0,
        animation: appReady ? "appSidebarIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) both" : "none",
        animationDelay: "0s",
      }}>
        <Sidebar
        activeTab={activeTab}
        setActiveTab={handleSetActiveTab}
        projects={projects}
        currentProject={currentProject}
        onLoadProject={handleLoadProject}
        onSaveProject={(name) => saveProject({ ...activeProject, id: currentProject?.id || Date.now().toString(), name })}
        onDeleteProject={deleteProject}
        onCreateNew={createNewProject}
        user={localUser}
        isAdmin={isAdmin}
      />
      </div>
      
      <div className="flex-1 flex flex-col h-full" style={animsDone ? {} : {
        opacity: appReady ? 1 : 0,
      }}>
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 shrink-0" style={animsDone ? {} : {
          animation: appReady ? "appHeaderIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both" : "none",
          animationDelay: "0.15s",
        }}>
          <div className="flex items-center gap-4">
            {/* Breadcrumb */}
            <div className="flex items-center text-sm text-gray-500">
              <span className="text-gray-400">Dashboard</span>
              <span className="mx-2">/</span>
              <span className="text-gray-900 font-medium">{tabTitles[activeTab]}</span>
            </div>

            {/* 🎯 SÉLECTEUR DE CAMPAGNE */}
            <div className="relative">
              <button
                onClick={() => setShowCampaignDropdown(!showCampaignDropdown)}
                className="flex items-center gap-3 px-4 py-2 bg-white border-2 border-gray-200 rounded-lg hover:border-blue-400 transition-colors min-w-[300px]"
              >
                <span className="flex-1 text-left text-sm font-medium text-gray-700 truncate flex items-center gap-2">
                  {currentProject?.status === "completed" && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  )}
                  {currentProject ? currentProject.name : "Sélectionner une campagne"}
                  {currentProject?.status === "completed" && (
                    <span className="text-[10px] font-black bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full shrink-0">
                      Terminée
                    </span>
                  )}
                  {/* 🔐 Badge propriétaire pour les admins */}
                  {isAdmin && currentProject && (currentProject as any).ownerName && (
                    <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full shrink-0">
                      {(currentProject as any).ownerName}
                    </span>
                  )}
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${showCampaignDropdown ? 'rotate-180' : ''}`} />
              </button>

              {/* Dropdown des campagnes */}
              {showCampaignDropdown && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowCampaignDropdown(false)}
                  />
                  
                  <div className="absolute top-full left-0 mt-2 w-96 bg-white border border-gray-200 rounded-xl shadow-2xl z-50 max-h-[480px] overflow-y-auto">
                    <button
                      onClick={() => {
                        createNewProject();
                        setShowCampaignDropdown(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-blue-600 hover:bg-blue-50 border-b border-gray-100 transition-colors"
                    >
                      <Plus className="w-5 h-5" />
                      <span>Nouvelle Campagne</span>
                    </button>

                    {currentProject && (
                      <button
                        onClick={() => {
                          duplicateProject(currentProject.id);
                          setShowCampaignDropdown(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-purple-600 hover:bg-purple-50 border-b border-gray-100 transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        <span>Dupliquer "{currentProject.name}"</span>
                      </button>
                    )}

                    {displayProjects.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-gray-500">
                        Aucune campagne sauvegardée
                      </div>
                    ) : isAdmin ? (
                      /* ============================================== */
                      /* 🔐 VUE ADMIN : Campagnes groupées par trader   */
                      /* ============================================== */
                      <>
                        {/* Header mode admin + filtre */}
                        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-[10px] font-black text-amber-700 uppercase tracking-wider">
                              <Shield className="w-3 h-3" />
                              Vue Admin
                              <span className="bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full">
                                {displayProjects.length}
                              </span>
                            </div>
                            {/* 🔐 V11.1 : Toggle Mes campagnes / Toutes */}
                            <div className="flex items-center gap-1 bg-amber-100 rounded-lg p-0.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); setAdminShowOnlyMine(false); }}
                                className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${
                                  !adminShowOnlyMine 
                                    ? "bg-white text-amber-900 shadow-sm" 
                                    : "text-amber-600 hover:text-amber-800"
                                }`}
                              >
                                Toutes
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setAdminShowOnlyMine(true); }}
                                className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${
                                  adminShowOnlyMine 
                                    ? "bg-white text-blue-700 shadow-sm" 
                                    : "text-amber-600 hover:text-amber-800"
                                }`}
                              >
                                Mes campagnes
                              </button>
                            </div>
                          </div>
                        </div>

                        {Object.entries(groupProjectsByOwner(displayProjects))
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([owner, ownerProjects]) => {
                            const ownerActive = (ownerProjects as any[]).filter((p: any) => p.status !== "completed");
                            const ownerCompleted = (ownerProjects as any[]).filter((p: any) => p.status === "completed");

                            return (
                              <div key={owner}>
                                {/* En-tête du trader */}
                                <div className="px-4 py-2 text-[10px] font-black text-gray-500 uppercase tracking-wider flex items-center gap-2 border-t border-gray-100 mt-1 pt-2 bg-gray-50/50">
                                  <span className="w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[9px] font-black">
                                    {owner.substring(0, 2).toUpperCase()}
                                  </span>
                                  <span>{owner}</span>
                                  <span className="text-[9px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
                                    {(ownerProjects as any[]).length}
                                  </span>
                                </div>

                                {/* Campagnes actives du trader */}
                                {ownerActive.map((project: any) => {
                                  const isActiveProject = currentProject?.id === project.id;
                                  const kpis = calculateAverageKPIs(project);

                                  return (
                                    <button
                                      key={project.id}
                                      onClick={() => {
                                        loadProject(project.id);
                                        setShowCampaignDropdown(false);
                                      }}
                                      className={`w-full px-4 py-3 text-sm hover:bg-gray-50 transition-colors ${
                                        isActiveProject ? 'bg-blue-50' : ''
                                      }`}
                                    >
                                      <div className="flex items-center justify-between mb-2">
                                        <div className={`font-bold text-left ${isActiveProject ? 'text-blue-600' : 'text-gray-900'}`}>
                                          {project.name}
                                        </div>
                                        {isActiveProject && (
                                          <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                                        )}
                                      </div>

                                      {kpis.entriesCount > 0 && (
                                        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                                          <div className="flex items-center gap-1.5">
                                            <Percent className="w-3.5 h-3.5 text-gray-400" />
                                            <span className="font-medium">{kpis.avgMargin.toFixed(1)}%</span>
                                            <span className="text-gray-400">marge</span>
                                          </div>
                                          <div className="flex items-center gap-1.5">
                                            <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
                                            <span className="font-medium">{kpis.avgCpmRevenue.toFixed(2)}</span>
                                            <span className="text-gray-400">CPM</span>
                                          </div>
                                          <div className="flex items-center gap-1.5">
                                            <DollarSign className="w-3.5 h-3.5 text-gray-400" />
                                            <span className="font-medium">{kpis.totalBudgetSpent.toFixed(0)} {kpis.currSym}</span>
                                          </div>
                                          <div className="flex items-center gap-1.5">
                                            <Target className="w-3.5 h-3.5 text-gray-400" />
                                            <span className="font-medium">{kpis.targetKpi.toFixed(2)}</span>
                                            <span className="text-gray-400">{kpis.kpiType}</span>
                                          </div>
                                        </div>
                                      )}

                                      {kpis.entriesCount === 0 && (
                                        <div className="text-xs text-gray-400 italic text-left">
                                          Aucune donnée quotidienne
                                        </div>
                                      )}
                                    </button>
                                  );
                                })}

                                {/* Campagnes terminées du trader */}
                                {ownerCompleted.map((project: any) => {
                                  const isActiveProject = currentProject?.id === project.id;
                                  const kpis = calculateAverageKPIs(project);

                                  return (
                                    <button
                                      key={project.id}
                                      onClick={() => {
                                        loadProject(project.id);
                                        setShowCampaignDropdown(false);
                                      }}
                                      className={`w-full px-4 py-3 text-sm hover:bg-emerald-50/50 transition-colors ${
                                        isActiveProject ? 'bg-emerald-50' : ''
                                      }`}
                                    >
                                      <div className="flex items-center justify-between mb-2">
                                        <div className={`font-bold text-left flex items-center gap-2 ${isActiveProject ? 'text-emerald-700' : 'text-gray-600'}`}>
                                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                          {project.name}
                                          <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 px-1 py-0.5 rounded-full">Terminée</span>
                                        </div>
                                        {isActiveProject && (
                                          <div className="w-2 h-2 bg-emerald-600 rounded-full"></div>
                                        )}
                                      </div>

                                      <div className="grid grid-cols-3 gap-2 text-xs">
                                        <div className="flex items-center gap-1.5 text-gray-600">
                                          <Percent className="w-3.5 h-3.5 text-gray-400" />
                                          <span className="font-medium">{kpis.avgMargin.toFixed(1)}%</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-emerald-600">
                                          <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                                          <span className="font-bold">+{kpis.totalGain?.toFixed(0) || '0'} {kpis.currSym}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-gray-500">
                                          <span className="font-medium">{kpis.entriesCount}j</span>
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          })
                        }
                      </>
                    ) : (
                      /* ============================================== */
                      /* 👤 VUE TRADER NORMAL : Ses campagnes seulement */
                      /* ============================================== */
                      <>
                        {activeProjects.length > 0 && (
                          <div className="py-1">
                            {completedProjects.length > 0 && (
                              <div className="px-4 py-2 text-[10px] font-black text-gray-400 uppercase tracking-wider flex items-center gap-2">
                                <Activity className="w-3 h-3" />
                                Campagnes actives ({activeProjects.length})
                              </div>
                            )}
                            {activeProjects.map((project) => {
                              const isActive = currentProject?.id === project.id;
                              const kpis = calculateAverageKPIs(project);

                              return (
                                <button
                                  key={project.id}
                                  onClick={() => {
                                    loadProject(project.id);
                                    setShowCampaignDropdown(false);
                                  }}
                                  className={`w-full px-4 py-3 text-sm hover:bg-gray-50 transition-colors ${
                                    isActive ? 'bg-blue-50' : ''
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <div className={`font-bold text-left ${isActive ? 'text-blue-600' : 'text-gray-900'}`}>
                                      {project.name}
                                    </div>
                                    {isActive && (
                                      <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                                    )}
                                  </div>

                                  {kpis.entriesCount > 0 && (
                                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                                      <div className="flex items-center gap-1.5">
                                        <Percent className="w-3.5 h-3.5 text-gray-400" />
                                        <span className="font-medium">{kpis.avgMargin.toFixed(1)}%</span>
                                        <span className="text-gray-400">marge</span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
                                        <span className="font-medium">{kpis.avgCpmRevenue.toFixed(2)}</span>
                                        <span className="text-gray-400">CPM</span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <DollarSign className="w-3.5 h-3.5 text-gray-400" />
                                        <span className="font-medium">{kpis.totalBudgetSpent.toFixed(0)} {kpis.currSym}</span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <Target className="w-3.5 h-3.5 text-gray-400" />
                                        <span className="font-medium">{kpis.targetKpi.toFixed(2)}</span>
                                        <span className="text-gray-400">{kpis.kpiType}</span>
                                      </div>
                                    </div>
                                  )}

                                  {kpis.entriesCount === 0 && (
                                    <div className="text-xs text-gray-400 italic text-left">
                                      Aucune donnée quotidienne
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {completedProjects.length > 0 && (
                          <div className="py-1 border-t border-gray-100">
                            <div className="px-4 py-2 text-[10px] font-black text-emerald-600 uppercase tracking-wider flex items-center gap-2">
                              <CheckCircle2 className="w-3 h-3" />
                              Campagnes terminées ({completedProjects.length})
                            </div>
                            {completedProjects.map((project) => {
                              const isActive = currentProject?.id === project.id;
                              const kpis = calculateAverageKPIs(project);

                              return (
                                <button
                                  key={project.id}
                                  onClick={() => {
                                    loadProject(project.id);
                                    setShowCampaignDropdown(false);
                                  }}
                                  className={`w-full px-4 py-3 text-sm hover:bg-emerald-50/50 transition-colors ${
                                    isActive ? 'bg-emerald-50' : ''
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <div className={`font-bold text-left flex items-center gap-2 ${isActive ? 'text-emerald-700' : 'text-gray-700'}`}>
                                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                      {project.name}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {kpis.kpiAchieved === true && (
                                        <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">KPI ✓</span>
                                      )}
                                      {kpis.kpiAchieved === false && (
                                        <span className="text-[9px] font-black bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">KPI ✗</span>
                                      )}
                                      {isActive && (
                                        <div className="w-2 h-2 bg-emerald-600 rounded-full"></div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-3 gap-2 text-xs">
                                    <div className="flex items-center gap-1.5 text-gray-600">
                                      <Percent className="w-3.5 h-3.5 text-gray-400" />
                                      <span className="font-medium">{kpis.avgMargin.toFixed(1)}%</span>
                                      <span className="text-gray-400">marge</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-emerald-600">
                                      <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                                      <span className="font-bold">+{kpis.totalGain?.toFixed(0) || '0'} {kpis.currSym}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-gray-500">
                                      <span className="font-medium">{kpis.entriesCount}j</span>
                                      <span className="text-gray-400">durée</span>
                                    </div>
                                  </div>

                                  {project.completedAt && (
                                    <div className="text-[10px] text-gray-400 mt-1.5 text-left">
                                      Terminée le {new Date(project.completedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* 🔐 V8.0 : Badge Admin dans le header */}
            {isAdmin && (
              <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                <span className="text-[10px] font-black text-amber-700">👑 ADMIN</span>
                {allProjectsData && (
                  <span className="text-[10px] text-amber-600">
                    {allProjectsData.projects.length} campagnes • {Object.keys(allProjectsData.byUser).length} traders
                  </span>
                )}
                {isLoadingAllProjects && (
                  <span className="text-[10px] text-amber-500 animate-pulse">chargement...</span>
                )}
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-6">
            <button className="text-gray-400 hover:text-gray-600">
              <Layout className="w-5 h-5" />
            </button>
            <div className="relative">
              <button onClick={() => setShowNotifications(!showNotifications)} className="text-gray-400 hover:text-gray-600 relative">
                <Bell className="w-5 h-5" />
                {totalAlertCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[9px] font-black flex items-center justify-center border-2 border-white">{Math.min(9, totalAlertCount)}</span>
                )}
              </button>
              {showNotifications && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
                  <div className="fixed top-16 right-8 mt-2 w-96 bg-white border border-gray-200 rounded-xl shadow-2xl z-50 max-h-96 overflow-y-auto">
                    <div className="p-4 border-b border-gray-100">
                      <h4 className="font-bold text-gray-900 text-sm flex items-center justify-between">
                        Alertes Actives
                        <span className={`text-xs px-2 py-0.5 rounded-full font-black ${totalAlertCount > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {totalAlertCount}
                        </span>
                      </h4>
                    </div>
                    <div className="p-3 space-y-2">
                      {totalAlertCount === 0 ? (
                        <div className="text-center py-6 text-sm text-gray-400">✅ Aucune alerte active</div>
                      ) : (
                        projects.filter(p => p.id && p.budgetTotal > 0 && p.status !== "completed").map(p => {
                          const alerts: string[] = [];
                          const dayEl = p.startDate ? Math.max(0, Math.floor((Date.now() - new Date(p.startDate).getTime()) / 86400000)) : 0;
                          const theo = p.budgetTotal * (dayEl / Math.max(1, p.durationDays));
                          const pacPct = theo > 0 ? ((p.budgetSpent - theo) / theo) * 100 : 0;
                          if (Math.abs(pacPct) > 20) alerts.push(`Pacing ${pacPct > 0 ? '+' : ''}${pacPct.toFixed(0)}%`);
                          const fin = !["Viewability", "VTR", "CTR"].includes(p.kpiType);
                          if (p.actualKpi > 0 && p.targetKpi > 0) {
                            if (fin && p.actualKpi > p.targetKpi * 1.3) alerts.push(`${p.kpiType} dégradé`);
                            if (!fin && p.actualKpi < p.targetKpi * 0.7) alerts.push(`${p.kpiType} faible`);
                          }
                          if (alerts.length === 0) return null;
                          return (
                            <div key={p.id} className="bg-red-50 border border-red-200 rounded-lg p-3">
                              <div className="text-xs font-black text-red-900 mb-1">{p.name}</div>
                              {alerts.map((a, i) => <div key={i} className="text-xs text-red-700">⚠️ {a}</div>)}
                              <button onClick={() => { loadProject(p.id); setShowNotifications(false); setActiveTab("cockpit"); }} className="text-[10px] text-blue-600 font-bold mt-2 hover:underline">Voir →</button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            {saveIndicator && <span className="text-xs text-emerald-600 font-bold animate-pulse">{saveIndicator}</span>}
            {!saveIndicator && syncStatus === "syncing" && (
              <span className="text-xs text-blue-500 font-bold animate-pulse">☁️ Sync...</span>
            )}
            {!saveIndicator && syncStatus === "synced" && (
              <span className="text-xs text-emerald-500 font-medium" title="Synchronisé avec le cloud">☁️</span>
            )}
            {!saveIndicator && syncStatus === "offline" && (
              <span className="text-xs text-amber-500 font-bold" title={lastSyncError || "Hors-ligne"}>⚠️ Hors-ligne</span>
            )}
            <button onClick={logout} className="text-gray-400 hover:text-red-600 transition-colors" title="Se déconnecter">
              <LogOut className="w-5 h-5" />
            </button>
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-sm">
              {localUser.initials}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-hidden" style={animsDone ? {} : {
          animation: appReady ? "appMainIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) both" : "none",
          animationDelay: "0.3s",
        }}>
          {activeTab === "cockpit" && <CockpitYield project={activeProject} onChange={handleProjectChange} allProjects={globalProjects} onSetActiveTab={setActiveTab} />}
          {activeTab === "tracking" && <CampaignTracking project={activeProject} onChange={handleProjectChange} />} 
          {activeTab === "cycle" && <OptimizationCycle project={activeProject} />}
          {/* 🔐 V8.0 : Portfolio et Benchmark reçoivent globalProjects (admin = tous les users) */}
          {activeTab === "portfolio" && <Portfolio projects={globalProjects} />}
          {activeTab === "benchmark" && <BenchmarkIntelligence projects={globalProjects} />}
          {/* 🔐 V8.0 : ROI TDesk — ADMIN ONLY */}
          {activeTab === "roi" && isAdmin && <AppROI projects={globalProjects} />}
          {activeTab === "roi" && !isAdmin && (
            <div className="flex items-center justify-center h-full bg-white">
              <div className="text-center">
                <Lock className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <h2 className="text-xl font-bold text-gray-900 mb-2">Accès restreint</h2>
                <p className="text-sm text-gray-500 max-w-md">
                  La section ROI TDesk est réservée aux administrateurs. 
                  Contactez votre responsable si vous avez besoin d'y accéder.
                </p>
              </div>
            </div>
          )}
          {activeTab === "market" && <MarketWatch currentCost={activeProject.cpmCostActuel} />}
          {activeTab === "learning" && <LearningEngineDashboard project={activeProject} allProjects={globalProjects} onNavigateToMarge={() => setActiveTab("cockpit")} />}
          {activeTab === "geotraffic" && <GeoTraffic />}
          {activeTab === "settings" && <Settings />}
          {activeTab === "legal" && <Legal />}
          
          {activeTab === "help" && (
            <div className="flex items-center justify-center h-full bg-white">
              <h1 className="text-3xl font-bold text-gray-900">
                Contactez l'équipe Bloomberg Terminal Ads
              </h1>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
