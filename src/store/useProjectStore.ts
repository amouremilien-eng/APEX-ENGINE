import { useState, useEffect, useCallback } from "react";
import { ProjectData, DEFAULT_PROJECT } from "../types";
import { supabase, isSupabaseEnabled } from "../lib/supabase";

const STORAGE_KEY = "yield_projects";
const BACKUP_KEY = "yield_projects_backup";
const USER_ID_KEY = "yield_current_user_id";

// 🔥 V7.1 : Type pour les données cross-users (admin)
export interface AllProjectsData {
  projects: ProjectData[];
  byUser: Record<string, { userId: string; name: string; projects: ProjectData[] }>;
  lastFetched: number;
}

function getUserId(): string | null {
  try {
    return localStorage.getItem(USER_ID_KEY);
  } catch {
    return null;
  }
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
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "offline">("idle");

  // 🔥 V7.1 : État admin — toutes les campagnes cross-users
  const [allProjectsData, setAllProjectsData] = useState<AllProjectsData | null>(null);
  const [isLoadingAllProjects, setIsLoadingAllProjects] = useState(false);

  useEffect(() => {
    const loadProjects = async () => {
      const userId = getUserId();
      const localProjects = getLocalProjects();

      if (localProjects.length > 0) {
        backupLocalProjects();
      }

      if (isSupabaseEnabled() && supabase && userId) {
        try {
          setSyncStatus("syncing");
          const { data, error } = await supabase
            .from('projects')
            .select('id, name, data, last_modified')
            .eq('user_id', userId)
            .order('last_modified', { ascending: false });

          if (error) throw error;

          if (data && data.length > 0) {
            const loaded: ProjectData[] = data.map(row => ({
              ...(row.data as ProjectData),
              id: row.id,
              name: row.name,
              lastModified: row.last_modified
            }));

            // 🔐 V8.0 : On fait confiance à Supabase, pas de fusion avec localStorage
            // L'ancien code fusionnait les projets localStorage orphelins, ce qui causait
            // une fuite de campagnes entre utilisateurs sur le même navigateur

            setProjects(loaded);
            setLocalProjects(loaded);
            setSyncStatus("synced");
            setLastSyncError(null);
            console.log(`☁️ ${loaded.length} projet(s) chargé(s) depuis Supabase`);
            return;
          }

         if ((!data || data.length === 0) && localProjects.length > 0) {
            // 🔥 V11.5 FIX : Ne JAMAIS détruire les données localStorage !
            // Si Supabase est vide mais localStorage a des projets, c'est que les saves
            // précédents ont échoué. On GARDE les données locales et on tente de les re-uploader.
            const currentUsername = localStorage.getItem("yield_current_username") || "";
            console.log(`⚠️ Supabase vide pour ${currentUsername}, ${localProjects.length} projet(s) en localStorage — tentative de re-upload`);
            
            setProjects(localProjects);
            
            // Tenter de re-uploader chaque projet vers Supabase
            for (const p of localProjects) {
              if (!p.id) continue;
              try {
                await supabase!
                  .from('projects')
                  .upsert({
                    id: p.id,
                    user_id: userId,
                    name: p.name,
                    data: p,
                    last_modified: p.lastModified || Date.now(),
                    updated_at: new Date().toISOString()
                  }, { onConflict: 'id' });
              } catch (uploadErr: any) {
                console.warn(`⚠️ Re-upload échoué pour ${p.name}:`, uploadErr.message);
              }
            }
            
            setSyncStatus("synced");
            setLastSyncError(null);
            console.log(`✅ ${localProjects.length} projet(s) préservé(s) et re-uploadé(s)`);
            return;
          }

          setProjects([]);
          setSyncStatus("synced");
          return;

        } catch (err: any) {
          console.warn("⚠️ Supabase indisponible, fallback localStorage:", err.message);
          setLastSyncError(err.message || "Connexion échouée");
          setSyncStatus("offline");
        }
      }

      if (localProjects.length > 0) {
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
    };

    loadProjects();
  }, []);

  // ============================================================
  // 🔥 V7.1 : CHARGER TOUTES LES CAMPAGNES (ADMIN CROSS-USERS)
  // ============================================================
  const loadAllProjects = useCallback(async () => {
    // Cache 5 min pour éviter les requêtes excessives
    if (allProjectsData && Date.now() - allProjectsData.lastFetched < 300000) {
      console.log("👑 Admin : cache valide, skip reload");
      return;
    }
    if (isLoadingAllProjects) return;
    if (!isSupabaseEnabled() || !supabase) {
      console.warn("👑 Admin : Supabase non disponible, impossible de charger tous les projets");
      return;
    }

    setIsLoadingAllProjects(true);
    console.log("👑 Admin : chargement de toutes les campagnes cross-users...");

    try {
      // Requête 1 : Tous les projets (sans filtre user_id)
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('id, name, data, user_id, last_modified, updated_at')
        .order('last_modified', { ascending: false });

      if (projectsError) {
        console.error("👑 Admin : erreur chargement projets", projectsError.message);
        setIsLoadingAllProjects(false);
        return;
      }

      if (!projectsData || projectsData.length === 0) {
        console.log("👑 Admin : aucun projet trouvé");
        setAllProjectsData({ projects: [], byUser: {}, lastFetched: Date.now() });
        setIsLoadingAllProjects(false);
        return;
      }

      // Requête 2 : Tous les utilisateurs (pour avoir les noms)
      let usersMap: Record<string, { name: string }> = {};
      try {
        const { data: usersData } = await supabase
          .from('users')
          .select('id, name, username');

        if (usersData) {
          usersData.forEach((u: any) => {
            usersMap[u.id] = { name: u.name || u.username || 'Inconnu' };
          });
        }
      } catch {
        console.warn("👑 Admin : impossible de charger la table users, on continue sans noms");
      }

      // Construire les données agrégées
      const allProjects: ProjectData[] = [];
      const byUser: Record<string, { userId: string; name: string; projects: ProjectData[] }> = {};

      projectsData.forEach((row: any) => {
        const projectData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
        if (!projectData) return;

        const project: ProjectData = {
          ...projectData,
          id: row.id,
          name: row.name || projectData.name,
          // 🔥 Champs admin pour identification du propriétaire
          _owner: row.user_id,
          _ownerName: usersMap[row.user_id]?.name || row.user_id?.substring(0, 8) || 'Inconnu',
        };
        
        allProjects.push(project);

        const uid = row.user_id || 'unknown';
        if (!byUser[uid]) {
          byUser[uid] = {
            userId: uid,
            name: usersMap[uid]?.name || uid.substring(0, 8) || 'Inconnu',
            projects: [],
          };
        }
        byUser[uid].projects.push(project);
      });

      setAllProjectsData({
        projects: allProjects,
        byUser,
        lastFetched: Date.now(),
      });

      const userCount = Object.keys(byUser).length;
      console.log(`👑 Admin : ${allProjects.length} projet(s) chargé(s) de ${userCount} utilisateur(s)`);

    } catch (err: any) {
      console.error("👑 Admin : erreur inattendue", err.message);
    } finally {
      setIsLoadingAllProjects(false);
    }
  }, [allProjectsData, isLoadingAllProjects]);

  // 🔥 V7.1 : Forcer le rechargement admin (ignorer le cache)
  const forceReloadAllProjects = useCallback(async () => {
    setAllProjectsData(null); // Vider le cache
    // Le prochain appel à loadAllProjects() rechargera
  }, []);

  const saveProject = useCallback(async (projectData: ProjectData) => {
    const userId = getUserId();
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

    if (isSupabaseEnabled() && supabase && userId) {
      try {
        setIsSyncing(true);
        setSyncStatus("syncing");

        const { error } = await supabase
          .from('projects')
          .upsert({
            id: projectData.id,
            user_id: userId,
            name: projectData.name,
            data: projectData,
            last_modified: Date.now(),
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });

        if (error) {
          console.error("❌ Sync Supabase échouée:", error.message, "— retry dans 3s...");
          // 🔥 V11.5 : Retry automatique après 3 secondes
          setTimeout(async () => {
            try {
              const { error: retryError } = await supabase!
                .from('projects')
                .upsert({
                  id: projectData.id,
                  user_id: userId,
                  name: projectData.name,
                  data: projectData,
                  last_modified: Date.now(),
                  updated_at: new Date().toISOString()
                }, { onConflict: 'id' });
              if (!retryError) {
                console.log("✅ Retry Supabase réussi !");
                setLastSyncError(null);
                setSyncStatus("synced");
              } else {
                console.error("❌ Retry Supabase échoué:", retryError.message);
                setLastSyncError(retryError.message);
                setSyncStatus("offline");
              }
            } catch {
              setSyncStatus("offline");
            }
          }, 3000);
          setLastSyncError(error.message);
          setSyncStatus("offline");
        } else {
          setLastSyncError(null);
          setSyncStatus("synced");
          // 🔥 V7.1 : Invalider le cache admin après sauvegarde
          if (allProjectsData) {
            setAllProjectsData(null);
          }
        }
      } catch (err: any) {
        console.warn("⚠️ Sync Supabase impossible:", err.message);
        setLastSyncError("Connexion perdue");
        setSyncStatus("offline");
      } finally {
        setIsSyncing(false);
      }
    }
  }, [allProjectsData]);

  const deleteProject = useCallback(async (id: string) => {
    const userId = getUserId();

    backupLocalProjects();

    setProjects(prev => {
      const updated = prev.filter((p) => p.id !== id);
      setLocalProjects(updated);
      return updated;
    });

    setCurrentProject(prev => prev?.id === id ? null : prev);

    if (isSupabaseEnabled() && supabase && userId) {
      try {
        const { error } = await supabase
          .from('projects')
          .delete()
          .eq('id', id)
          .eq('user_id', userId);

        if (error) console.error("❌ Suppression Supabase échouée:", error.message);
        else if (allProjectsData) setAllProjectsData(null); // Invalider cache admin
      } catch (err) {
        console.warn("⚠️ Suppression Supabase impossible");
      }
    }
  }, [allProjectsData]);

  const loadProject = useCallback((id: string) => {
    // Chercher d'abord dans les projets du user
    const project = projects.find((p) => p.id === id);
    if (project) {
      setCurrentProject(project);
      return;
    }
    // 🔐 V8.0 : Si admin, chercher aussi dans allProjectsData
    if (allProjectsData) {
      const adminProject = allProjectsData.projects.find((p) => p.id === id);
      if (adminProject) setCurrentProject(adminProject);
    }
  }, [projects, allProjectsData]);

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
      // 🔥 V7.0 : Reset du statut pour la copie
      status: "active" as const,
      completedAt: undefined,
      finalBalance: undefined,
    };
    setCurrentProject(duplicate);
  }, [projects]);

  const forceSync = useCallback(async () => {
    const userId = getUserId();
    if (!isSupabaseEnabled() || !supabase || !userId) {
      setLastSyncError("Supabase non configuré");
      return;
    }

    backupLocalProjects();

    setIsSyncing(true);
    setSyncStatus("syncing");

    try {
      for (const p of projects) {
        if (!p.id) continue;
        await supabase
          .from('projects')
          .upsert({
            id: p.id,
            user_id: userId,
            name: p.name,
            data: p,
            last_modified: p.lastModified || Date.now(),
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
      }
      setSyncStatus("synced");
      setLastSyncError(null);
      if (allProjectsData) setAllProjectsData(null); // Invalider cache admin
      console.log(`☁️ Force sync : ${projects.length} projet(s) synchronisé(s)`);
    } catch (err: any) {
      setSyncStatus("offline");
      setLastSyncError(err.message);
    } finally {
      setIsSyncing(false);
    }
  }, [projects, allProjectsData]);

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
    // 🔥 V7.1 : Exports admin
    allProjectsData,
    isLoadingAllProjects,
    loadAllProjects,
    forceReloadAllProjects,
  };
}
