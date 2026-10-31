import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailLookup } from '../services/notifications/runNotifier';

/** Looks up a ZeroOne user's email address for notifications. */
export function supabaseEmailLookup(db: SupabaseClient): EmailLookup {
  return async (userId) => {
    const { data, error } = await db.from('users').select('email').eq('id', userId).maybeSingle();
    if (error) throw new Error(`Could not look up the user's email: ${error.message}`);
    return (data?.email as string | undefined) ?? null;
  };
}
