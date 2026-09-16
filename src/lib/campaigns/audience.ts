import type { SupabaseClient } from "@supabase/supabase-js";

export interface AudienceContact {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
}

export interface CampaignAudienceInput {
  brandId: string;
  channel: "email" | "sms";
  targetCountry: string | null;
}

// The single definition of "who a campaign goes to" — used identically by
// the confirmation screen (so the count shown is the count sent) and by the
// actual dispatch in send.ts. Contactable = active status, marketing
// consent given, not suppressed, not deleted (is_contactable() in the
// schema); this additionally requires the contact method the channel
// actually needs, and narrows by target_country when the campaign sets one.
// That full rule — not just a number — is what the confirm dialog shows.
export async function computeAudience(
  supabase: SupabaseClient,
  input: CampaignAudienceInput,
): Promise<AudienceContact[]> {
  const PAGE_SIZE = 1000;
  const contacts: AudienceContact[] = [];
  let from = 0;

  for (;;) {
    let query = supabase
      .from("contacts")
      .select("id, full_name, email, phone, country")
      .eq("brand_id", input.brandId)
      .is("deleted_at", null)
      .eq("status", "active")
      .eq("consent_marketing", true)
      .or("suppressed_until.is.null,suppressed_until.lte.now()")
      .range(from, from + PAGE_SIZE - 1);

    if (input.channel === "email") {
      query = query.not("email", "is", null);
    } else {
      query = query.not("phone", "is", null);
    }

    if (input.targetCountry) {
      query = query.eq("country", input.targetCountry);
    }

    const { data, error } = await query;
    if (error) throw new Error(`audience query failed: ${error.message}`);

    const page = (data ?? []) as AudienceContact[];
    contacts.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return contacts;
}

export const AUDIENCE_RULE_DESCRIPTION =
  "Contactable: active status, marketing consent given, not suppressed, not deleted, and has the contact method this channel needs — narrowed to the campaign's target country when one is set.";
