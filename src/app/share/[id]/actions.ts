"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { signShareSession, shareCookieName } from "@/lib/share/session";

// Bound to shareId via .bind(null, shareId) where used, matching the same
// native <form action={...}> pattern as src/app/login/actions.ts — a
// client-side fetch + router.refresh() version of this intermittently hit a
// hydration error and left the password form on screen even though the
// cookie had already been set successfully server-side every time
// (confirmed via campaign_share_attempts rows). A real form submission with
// a server-side redirect() is the same mechanism login already relies on.
export async function verifySharePassword(shareId: string, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const supabase = await createServerSupabaseClient();

  const { data: hash, error: hashError } = await supabase.rpc("get_campaign_share_hash_for_verification", {
    p_share_id: shareId,
  });

  if (hashError || !hash) {
    redirect(`/share/${shareId}?error=1`);
  }

  const matches = await bcrypt.compare(password, hash);
  await supabase.rpc("record_campaign_share_attempt", { p_share_id: shareId, p_success: matches });

  if (!matches) {
    redirect(`/share/${shareId}?error=1`);
  }

  const cookieStore = await cookies();
  cookieStore.set(shareCookieName(shareId), signShareSession(shareId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 2 * 60 * 60,
  });

  redirect(`/share/${shareId}`);
}
