import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, isSupabaseConfigured } from '@/lib/config';

/**
 * Service-role Supabase client, server-side only.
 *
 * Returns null when Supabase is not configured, which is a supported mode:
 * the store falls back to an in-process cache so the app remains usable
 * without credentials. Callers must handle null rather than assuming a client.
 */

let cached: SupabaseClient | null | undefined;

export function getServiceClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  if (!isSupabaseConfigured()) {
    cached = null;
    return cached;
  }

  cached = createClient(config.supabase.url!, config.supabase.serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'earnings-intelligence' } },
  });

  return cached;
}
