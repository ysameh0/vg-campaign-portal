"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/require-profile";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { runContactsImport, runCampaignsImport, runEventsImport, type ImportSummary } from "@/lib/ingest/run-import";

export async function uploadImport(
  formData: FormData,
): Promise<{ ok: true; summary: ImportSummary } | { ok: false; error: string }> {
  const profile = await requireOwner();
  const file = formData.get("file");
  const kind = String(formData.get("kind") ?? "");

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a CSV file." };
  }
  if (!["contacts", "campaigns", "events"].includes(kind)) {
    return { ok: false, error: "Choose what this file contains." };
  }

  const text = await file.text();
  const supabase = createServiceRoleSupabaseClient();

  try {
    let summary: ImportSummary;
    if (kind === "contacts") {
      summary = await runContactsImport(supabase, profile.brandId, file.name, text, profile.id);
    } else if (kind === "campaigns") {
      summary = await runCampaignsImport(supabase, profile.brandId, file.name, text, profile.id);
    } else {
      summary = await runEventsImport(supabase, profile.brandId, file.name, text, profile.id);
    }
    revalidatePath("/imports");
    return { ok: true, summary };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
