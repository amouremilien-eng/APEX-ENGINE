import { create } from "zustand";
import { persist } from "zustand/middleware";
import { supabase, isSupabaseEnabled } from "../lib/supabase";
import bcrypt from "bcryptjs"; // 🔐 V9.0 : Hashage des mots de passe


export type Theme = "salesin" | "biggie" | "gamned" | "light" | "dark";

export interface UserProfile {
  name: string;
  initials: string;
  theme: Theme;
  role?: "trader" | "admin";
}

interface UserStore {
  user: UserProfile | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  updateProfile: (updates: Partial<Omit<UserProfile, "theme">>) => void;
  updateTheme: (theme: Theme) => void;
}

const USERS_KEY = "yield_users_db";
const CURRENT_USER_KEY = "yield_current_user";
const USER_ID_KEY = "yield_current_user_id";
const USERNAME_KEY = "yield_current_username";

interface StoredUser {
  username: string;
  password: string; // 🔐 V9.0 : Ce champ contient maintenant un hash bcrypt
  profile: UserProfile;
}

function getLocalUsers(): StoredUser[] {
  try {
    const data = localStorage.getItem(USERS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveLocalUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function getCurrentUser(): UserProfile | null {
  try {
    const data = localStorage.getItem(CURRENT_USER_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function saveCurrentUser(profile: UserProfile | null) {
  if (profile) {
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(profile));
  } else {
    localStorage.removeItem(CURRENT_USER_KEY);
  }
}

// 🔐 V9.0 : Liste des 3 comptes admin
const ADMIN_USERNAMES = ["tfgmd", "aygmd", "eagmd"];

// 🔐 V9.0 : Hash bcrypt du mot de passe par défaut "gmd"
// Généré avec bcrypt.hashSync("gmd", 10)
const DEFAULT_PASSWORD_HASH = bcrypt.hashSync("gmd", 10);

const DEFAULT_ACCOUNTS: StoredUser[] = [
  { username: "eagmd", password: DEFAULT_PASSWORD_HASH, profile: { name: "eaGMD", initials: "EA", theme: "salesin", role: "admin" } },
  { username: "tfgmd", password: DEFAULT_PASSWORD_HASH, profile: { name: "tfGMD", initials: "TF", theme: "salesin", role: "admin" } },
  { username: "aygmd", password: DEFAULT_PASSWORD_HASH, profile: { name: "ayGMD", initials: "AY", theme: "salesin", role: "admin" } },
  { username: "lcgmd", password: DEFAULT_PASSWORD_HASH, profile: { name: "lcGMD", initials: "LC", theme: "salesin", role: "trader" } },
  { username: "usgmd", password: DEFAULT_PASSWORD_HASH, profile: { name: "usGMD", initials: "US", theme: "salesin", role: "trader" } },
  { username: "jhgmd", password: DEFAULT_PASSWORD_HASH, profile: { name: "jhGMD", initials: "JH", theme: "salesin", role: "trader" } },
  { username: "jdgmd", password: DEFAULT_PASSWORD_HASH, profile: { name: "jdGMD", initials: "JD", theme: "salesin", role: "trader" } },
  { username: "argmd", password: DEFAULT_PASSWORD_HASH, profile: { name: "arGMD", initials: "AR", theme: "salesin", role: "trader" } },
  { username: "trgmd", password: DEFAULT_PASSWORD_HASH, profile: { name: "trGMD", initials: "TR", theme: "salesin", role: "trader" } },
  { username: "bpgmd", password: DEFAULT_PASSWORD_HASH, profile: { name: "bpGMD", initials: "BP", theme: "salesin", role: "trader" } },
  { username: "hrgmd", password: DEFAULT_PASSWORD_HASH, profile: { name: "hrGMD", initials: "HR", theme: "salesin", role: "trader" } },
  { username: "fjgmd", password: DEFAULT_PASSWORD_HASH, profile: { name: "fjGMD", initials: "FJ", theme: "salesin", role: "trader" } },
];

if (typeof window !== 'undefined') {
  const existingUsers = getLocalUsers();
  if (existingUsers.length === 0) {
    saveLocalUsers(DEFAULT_ACCOUNTS);
  } else {
    let updated = 0;
    DEFAULT_ACCOUNTS.forEach(def => {
      const existing = existingUsers.find(u => u.username === def.username);
      if (!existing) {
        existingUsers.push(def);
        updated++;
      } else {
        // 🔐 V9.0 : Migrer les anciens mots de passe en clair vers bcrypt
        if (existing.password === "gmd" || (!existing.password.startsWith("$2a$") && !existing.password.startsWith("$2b$"))) {
          existing.password = bcrypt.hashSync("gmd", 10);
          updated++;
        }
        if (!existing.profile.role || existing.profile.role !== def.profile.role) {
          existing.profile.role = ADMIN_USERNAMES.includes(def.username) ? "admin" : "trader";
          updated++;
        }
      }
    });
    if (updated > 0) saveLocalUsers(existingUsers);
  }
}

export const useUserStore = create<UserStore>()(
  persist(
    (set, get) => ({
      user: getCurrentUser(),
      isLoading: false,

      login: async (username: string, password: string) => {
        set({ isLoading: true });

        if (isSupabaseEnabled() && supabase) {
          try {
            // 🔐 V9.0 : On récupère le hash par USERNAME seulement
            // Puis on compare le password côté client avec bcrypt
            const { data, error } = await supabase
              .from('users')
              .select('id, username, name, initials, theme, password_hash')
              .eq('username', username)
              .single();

            if (!error && data) {
              // 🔐 V9.0 : Vérification du mot de passe
              const isValidPassword = 
                // Cas 1 : Le hash dans Supabase est un vrai bcrypt hash
                (data.password_hash.startsWith("$2a$") || data.password_hash.startsWith("$2b$"))
                  ? bcrypt.compareSync(password, data.password_hash)
                // Cas 2 : Le hash est encore en clair (migration pas encore faite)
                  : password === data.password_hash;

              if (!isValidPassword) {
                set({ isLoading: false });
                throw new Error("Nom d'utilisateur ou mot de passe incorrect");
              }

              // 🔐 V9.0 : Si le mdp Supabase est encore en clair, le migrer vers bcrypt
              if (!data.password_hash.startsWith("$2a$") && !data.password_hash.startsWith("$2b$")) {
                const newHash = bcrypt.hashSync(password, 10);
                await supabase
                  .from('users')
                  .update({ password_hash: newHash })
                  .eq('id', data.id);
                console.log(`🔐 Mot de passe migré vers bcrypt pour ${username}`);
              }

              const role: "trader" | "admin" = 
                ADMIN_USERNAMES.includes(data.username) ? "admin" : "trader";

              const profile: UserProfile = {
                name: data.name,
                initials: data.initials,
                theme: (data.theme as Theme) || "salesin",
                role,
              };

              localStorage.setItem(USER_ID_KEY, data.id);
              localStorage.setItem(USERNAME_KEY, data.username);
              saveCurrentUser(profile);

              set({ user: profile, isLoading: false });
              console.log(`☁️ Login Supabase OK : ${data.name} (${role})`);
              return;
            }

            if (error && error.code !== 'PGRST116') {
              console.warn("⚠️ Erreur Supabase:", error.message);
            }
          } catch (err: any) {
            if (err.message === "Nom d'utilisateur ou mot de passe incorrect") {
              set({ isLoading: false });
              throw err;
            }
            console.warn("⚠️ Supabase indisponible pour le login, fallback local");
          }
        }

        // Fallback localStorage
        await new Promise(resolve => setTimeout(resolve, 300));

        const users = getLocalUsers();
        const foundUser = users.find(u => {
          if (u.username !== username) return false;
          // 🔐 V9.0 : Comparer avec bcrypt si c'est un hash, sinon comparaison directe
          if (u.password.startsWith("$2a$") || u.password.startsWith("$2b$")) {
            return bcrypt.compareSync(password, u.password);
          }
          return u.password === password;
        });

        if (!foundUser) {
          set({ isLoading: false });
          throw new Error("Nom d'utilisateur ou mot de passe incorrect");
        }

        // 🔐 V9.0 : Migrer le password local en clair vers bcrypt si besoin
        if (!foundUser.password.startsWith("$2a$") && !foundUser.password.startsWith("$2b$")) {
          foundUser.password = bcrypt.hashSync(password, 10);
          saveLocalUsers(users);
        }

        if (!foundUser.profile.role) {
          foundUser.profile.role = ADMIN_USERNAMES.includes(username) ? "admin" : "trader";
        }

        const localUserId = `local_${username}_${Date.now()}`;
        localStorage.setItem(USER_ID_KEY, localUserId);
        localStorage.setItem(USERNAME_KEY, username);
        saveCurrentUser(foundUser.profile);

        set({ user: foundUser.profile, isLoading: false });
        console.log(`📦 Login localStorage OK : ${foundUser.profile.name} (${foundUser.profile.role})`);
      },

      register: async (username: string, password: string) => {
        set({ isLoading: true });

        const initials = username.substring(0, 2).toUpperCase();
        const newProfile: UserProfile = {
          name: username,
          initials,
          theme: "salesin",
          role: "trader",
        };

        // 🔐 V9.0 : Hasher le mot de passe AVANT de le stocker
        const hashedPassword = bcrypt.hashSync(password, 10);

        if (isSupabaseEnabled() && supabase) {
          try {
            const { data: existing } = await supabase
              .from('users')
              .select('id')
              .eq('username', username)
              .single();

            if (existing) {
              set({ isLoading: false });
              throw new Error("Ce nom d'utilisateur est déjà pris");
            }

            const { data, error } = await supabase
              .from('users')
              .insert({
                username,
                password_hash: hashedPassword, // 🔐 Hash bcrypt, plus en clair
                name: username,
                initials,
                theme: 'salesin',
              })
              .select('id')
              .single();

            if (!error && data) {
              localStorage.setItem(USER_ID_KEY, data.id);
              localStorage.setItem(USERNAME_KEY, username);
              saveCurrentUser(newProfile);

              set({ user: newProfile, isLoading: false });
              console.log(`☁️ Register Supabase OK : ${username}`);
              return;
            }
          } catch (err: any) {
            if (err.message === "Ce nom d'utilisateur est déjà pris") {
              set({ isLoading: false });
              throw err;
            }
            console.warn("⚠️ Register Supabase échoué, fallback local");
          }
        }

        await new Promise(resolve => setTimeout(resolve, 300));

        const users = getLocalUsers();
        if (users.some(u => u.username === username)) {
          set({ isLoading: false });
          throw new Error("Ce nom d'utilisateur est déjà pris");
        }

        users.push({ username, password: hashedPassword, profile: newProfile }); // 🔐 Hash
        saveLocalUsers(users);

        const localUserId = `local_${username}_${Date.now()}`;
        localStorage.setItem(USER_ID_KEY, localUserId);
        localStorage.setItem(USERNAME_KEY, username);
        saveCurrentUser(newProfile);

        set({ user: newProfile, isLoading: false });
      },

      logout: () => {
        saveCurrentUser(null);
        localStorage.removeItem(USER_ID_KEY);
        localStorage.removeItem(USERNAME_KEY);
        localStorage.removeItem("yield_projects");
        set({ user: null });
      },

      updateProfile: (updates) => {
        const currentUser = get().user;
        if (!currentUser) return;

        const updatedUser = { ...currentUser, ...updates };
        saveCurrentUser(updatedUser);
        set({ user: updatedUser });

        if (isSupabaseEnabled() && supabase) {
          const username = localStorage.getItem(USERNAME_KEY);
          if (username) {
            supabase
              .from('users')
              .update({ name: updatedUser.name, initials: updatedUser.initials })
              .eq('username', username)
              .then(({ error }) => {
                if (error) console.warn("⚠️ Sync profil Supabase échouée:", error.message);
              });
          }
        }
      },

      updateTheme: (theme) => {
        const currentUser = get().user;
        if (!currentUser) return;

        const updatedUser = { ...currentUser, theme };
        saveCurrentUser(updatedUser);
        set({ user: updatedUser });
        document.documentElement.setAttribute("data-theme", theme);

        if (isSupabaseEnabled() && supabase) {
          const username = localStorage.getItem(USERNAME_KEY);
          if (username) {
            supabase
              .from('users')
              .update({ theme })
              .eq('username', username)
              .then(({ error }) => {
                if (error) console.warn("⚠️ Sync thème Supabase échouée:", error.message);
              });
          }
        }
      },
    }),
    {
      name: "user-storage",
    }
  )
);
