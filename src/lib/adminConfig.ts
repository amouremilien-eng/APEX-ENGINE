// src/lib/adminConfig.ts — Configuration des droits admin
// ========================================================
// Les 3 identifiants admin qui ont accès à :
//   - Toutes les campagnes de tous les traders
//   - Le ROI Tdesk
// ========================================================

export const ADMIN_USERNAMES = ["tfgmd", "aygmd", "eagmd"];

/**
 * Vérifie si un username est admin
 */
export function isAdminUsername(username: string | null): boolean {
  if (!username) return false;
  return ADMIN_USERNAMES.includes(username.toLowerCase());
}

/**
 * Récupère le username courant depuis localStorage
 */
export function getCurrentUsername(): string | null {
  try {
    return localStorage.getItem("yield_current_username");
  } catch {
    return null;
  }
}

/**
 * Vérifie si l'utilisateur actuellement connecté est admin
 */
export function isCurrentUserAdmin(): boolean {
  return isAdminUsername(getCurrentUsername());
}
