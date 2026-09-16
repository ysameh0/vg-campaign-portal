import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// Bypasses RLS entirely. Every call site must re-check brand scoping and
// role explicitly — never pass a client-supplied brand_id straight through.
// Used only by: ingestion, the send pipeline, the delivery poller, and the
// public share RPCs' cookie-minting step. Never imported by client code.
export function createServiceRoleSupabaseClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
