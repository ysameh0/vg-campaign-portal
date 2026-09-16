"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { requireOwner } from "@/lib/auth/require-profile";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { sendCampaign } from "@/lib/campaigns/send";

export async function createCampaign(formData: FormData) {
  const profile = await requireOwner();
  const name = String(formData.get("name") ?? "").trim();
  const channel = String(formData.get("channel") ?? "");
  const targetCountry = String(formData.get("target_country") ?? "").trim().toUpperCase();

  if (!name || (channel !== "email" && channel !== "sms")) {
    redirect("/campaigns/new?error=invalid_fields");
  }

  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      brand_id: profile.brandId,
      name,
      channel,
      target_country: targetCountry || null,
      status: "draft",
      source: "app",
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) {
    redirect(`/campaigns/new?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/campaigns");
  redirect(`/campaigns/${data.id}`);
}

export async function sendCampaignAction(campaignId: string) {
  const profile = await requireOwner();
  const result = await sendCampaign(profile.brandId, campaignId, profile.id);
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
  return result;
}

export async function syncCampaignEvents() {
  await requireOwner();
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.functions.invoke("poll-events", { method: "POST" });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, data };
}

export async function createShareAction(campaignId: string, password: string) {
  const profile = await requireOwner();
  if (password.length < 8) {
    return { ok: false as const, error: "Password must be at least 8 characters." };
  }

  const supabase = createServiceRoleSupabaseClient();
  const passwordHash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from("campaign_shares")
    .insert({
      campaign_id: campaignId,
      brand_id: profile.brandId,
      password_hash: passwordHash,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) return { ok: false as const, error: error.message };

  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true as const, shareId: data.id as string };
}

export async function revokeShareAction(shareId: string, campaignId: string) {
  await requireOwner();
  const supabase = createServiceRoleSupabaseClient();
  await supabase.from("campaign_shares").update({ revoked_at: new Date().toISOString() }).eq("id", shareId);
  revalidatePath(`/campaigns/${campaignId}`);
}
