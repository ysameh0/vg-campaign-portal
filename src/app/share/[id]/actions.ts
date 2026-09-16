"use server";

import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { signShareSession, shareCookieName } from "@/lib/share/session";

export async function verifySharePassword(shareId: string, password: string): Promise<{ ok: boolean }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("verify_campaign_share_password", {
    p_share_id: shareId,
    p_password: password,
  });

  if (error || !data) return { ok: false };

  const cookieStore = await cookies();
  cookieStore.set(shareCookieName(shareId), signShareSession(shareId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/share/${shareId}`,
    maxAge: 2 * 60 * 60,
  });

  return { ok: true };
}
