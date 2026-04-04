import { useState, useEffect, useCallback } from "react";
import { ProjectData, DEFAULT_PROJECT } from "../types";

const STORAGE_KEY = "yield_projects";
const BACKUP_KEY = "yield_projects_backup";

// 🔥 V7.1 : Type pour les données cross-users (admin)
export interface AllProjectsData {
  projects: ProjectData[];
  byUser: Record<string, { userId: string; name: string; projects: ProjectData[] }>;
  lastFetched: number;
}

function getLocalProjects(): ProjectData[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function setLocalProjects(projects: ProjectData[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch (e) {
    console.error("❌ localStorage plein ou indisponible:", e);
  }
}

function backupLocalProjects() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current && current !== "[]") {
      localStorage.setItem(BACKUP_KEY, current);
      const projects = JSON.parse(current);
      console.log(`🔒 Backup créé : ${projects.length} projet(s) sauvegardés dans ${BACKUP_KEY}`);
    }
  } catch (e) {
    console.error("❌ Backup impossible:", e);
  }
}

function restoreFromBackup(): ProjectData[] {
  try {
    const backup = localStorage.getItem(BACKUP_KEY);
    if (backup) {
      const projects = JSON.parse(backup);
      console.log(`🔄 Restauration depuis backup : ${projects.length} projet(s)`);
      return projects;
    }
  } catch (e) {
    console.error("❌ Restauration impossible:", e);
  }
  return [];
}

export function useProjectStore() {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [currentProject, setCurrentProject] = useState<ProjectData | null>(null);
  const [isSyncing] = useState(false);
  const [lastSyncError] = useState<string | null>(null);
  const [syncStatus] = useState<"idle" | "syncing" | "synced" | "offline">("offline");

  // 🔥 V7.1 : État admin (désactivé en mode test — pas de Supabase)
  const [allProjectsData] = useState<AllProjectsData | null>(null);
  const [isLoadingAllProjects] = useState(false);

  useEffect(() => {
    const localProjects = getLocalProjects();

    if (localProjects.length > 0) {
      backupLocalProjects();
      setProjects(localProjects);
      console.log(`📦 ${localProjects.length} projet(s) chargé(s) depuis localStorage`);
    } else {
      const backupProjects = restoreFromBackup();
      if (backupProjects.length > 0) {
        setProjects(backupProjects);
        setLocalProjects(backupProjects);
        console.log(`🔄 ${backupProjects.length} projet(s) restauré(s) depuis le backup`);
      }
    }
  }, []);

  const loadAllProjects = useCallback(async () => {
    console.log("👑 Admin : mode test — Supabase désactivé, données locales uniquement");
  }, []);

  const forceReloadAllProjects = useCallback(async () => {
    // No-op en mode test
  }, []);

  const saveProject = useCallback(async (projectData: ProjectData) => {
    const projectToSave = { ...projectData, lastModified: Date.now() };

    setProjects(prev => {
      const existingIndex = prev.findIndex((p) => p.id === projectToSave.id);
      let updated: ProjectData[];

      if (existingIndex >= 0) {
        updated = [...prev];
        updated[existingIndex] = projectToSave;
      } else {
        updated = [...prev, projectToSave];
      }

      setLocalProjects(updated);
      return updated;
    });

    setCurrentProject(projectData);
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    backupLocalProjects();

    setProjects(prev => {
      const updated = prev.filter((p) => p.id !== id);
      setLocalProjects(updated);
      return updated;
    });

    setCurrentProject(prev => prev?.id === id ? null : prev);
  }, []);

  const loadProject = useCallback((id: string) => {
    const project = projects.find((p) => p.id === id);
    if (project) {
      setCurrentProject(project);
    }
  }, [projects]);

  const createNewProject = useCallback(() => {
    const newProject = {
      ...DEFAULT_PROJECT,
      id: Date.now().toString(),
      name: "Nouveau Projet",
      lastModified: Date.now()
    };
    setCurrentProject(newProject);
  }, []);

  const duplicateProject = useCallback((sourceId: string) => {
    const source = projects.find(p => p.id === sourceId);
    if (!source) return;
    const duplicate = {
      ...source,
      id: Date.now().toString(),
      name: `${source.name} (copie)`,
      dailyEntries: [],
      history: [],
      budgetSpent: 0,
      notes: [],
      anomalies: [],
      alertsTriggered: [],
      timingRecommendations: [],
      lastModified: Date.now(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "active" as const,
      completedAt: undefined,
      finalBalance: undefined,
    };
    setCurrentProject(duplicate);
  }, [projects]);

  const forceSync = useCallback(async () => {
    console.log("📦 Mode test — pas de sync Supabase, données en localStorage");
  }, []);

  return {
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
    forceSync,
    // 🔥 V7.1 : Exports admin (stub en mode test)
    allProjectsData,
    isLoadingAllProjects,
    loadAllProjects,
    forceReloadAllProjects,
  };
}
