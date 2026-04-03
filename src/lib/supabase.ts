import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabaseClient: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log("☁️ Supabase connecté");
} else {
  console.log("📦 Mode localStorage uniquement (Supabase non configuré)");
}

export const supabase = supabaseClient;

export function isSupabaseEnabled(): boolean {
  return supabaseClient !== null;
}
