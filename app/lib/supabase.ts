import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zlnkzyvtxaksvilujdwu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsbmt6eXZ0eGFrc3ZpbHVqZHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTA3OTksImV4cCI6MjA5MTU2Njc5OX0.IQCEn-z7DS6REYCGghZPbJNXKtonInKAn78aBVQOqms';

// Storage adapter that works everywhere: native, web, and SSR (Node.js)
function createStorage() {
  // Check if we're in a browser/RN environment (has window or RN runtime)
  const isClient = typeof window !== 'undefined';

  if (!isClient) {
    // SSR / Node.js — use in-memory storage (no persistence needed during export)
    const mem = new Map<string, string>();
    return {
      getItem: async (key: string) => mem.get(key) ?? null,
      setItem: async (key: string, value: string) => { mem.set(key, value); },
      removeItem: async (key: string) => { mem.delete(key); },
    };
  }

  // Client (React Native / Web) — use AsyncStorage
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  return AsyncStorage;
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: createStorage(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** Check if Supabase is configured (not placeholder keys) */
export function isSupabaseConfigured(): boolean {
  return !SUPABASE_URL.includes('YOUR_PROJECT');
}
