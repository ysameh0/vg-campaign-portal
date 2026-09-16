"use server";

import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { signShareSession, shareCookieName } from "@/lib/share/session";

export async function verifySharePassword(shareId: string, password: string): Promise<{ ok: boolean }> {
  const supabase = await createServerSupabaseClient();

  const { data: hash, error: hashError } = await supabase.rpc("get_campaign_share_hash_for_verification", {
    p_share_id: shareId,
  });

  if (hashError || !hash) return { ok: false };

  const matches = await bcrypt.compare(password, hash);
  await supabase.rpc("record_campaign_share_attempt", { p_share_id: shareId, p_success: matches });

  if (!matches) return { ok: false };

  const cookieStore = await cookies();
  cookieStore.set(shareCookieName(shareId), signShareSession(shareId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 2 * 60 * 60,
  });

  return { ok: true };
}
