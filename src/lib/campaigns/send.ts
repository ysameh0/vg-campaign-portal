import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { computeAudience } from "./audience";
import { dispatchMessages } from "@/lib/dispatcher/client";

export type SendCampaignResult =
  | { outcome: "dispatched"; recipientCount: number; providerBatchId: string }
  | { outcome: "already_sent"; status: string }
  | { outcome: "empty_audience" }
  | { outcome: "failed"; error: string };

// The idempotency key is deterministic from campaign_id, not random per
// click — so a retried request (same campaign, same key) collapses at the
// provider too, per the dispatcher's own "same key twice -> delivered once"
// contract. See supabase/migrations/0001_init.sql's comment on
// campaign_sends for the DB-side half of this guarantee.
function idempotencyKeyFor(campaignId: string): string {
  return `send:${campaignId}`;
}

export async function sendCampaign(
  brandId: string,
  campaignId: string,
  requestedBy: string,
): Promise<SendCampaignResult> {
  const supabase = createServiceRoleSupabaseClient();

  // Atomic claim: only one concurrent request can flip draft/failed ->
  // queued. A second click, a second tab, or a second session all lose this
  // race and fall through to the already_sent / re-check branch below —
  // never a second dispatch.
  const { data: claimed, error: claimError } = await supabase
    .from("campaigns")
    .update({ status: "queued" })
    .eq("id", campaignId)
    .eq("brand_id", brandId)
    .in("status", ["draft", "failed"])
    .select("id, channel, target_country, name")
    .maybeSingle();

  if (claimError) return { outcome: "failed", error: claimError.message };

  if (!claimed) {
    const { data: current } = await supabase
      .from("campaigns")
      .select("status")
      .eq("id", campaignId)
      .eq("brand_id", brandId)
      .maybeSingle();
    return { outcome: "already_sent", status: current?.status ?? "unknown" };
  }

  const audience = await computeAudience(supabase, {
    brandId,
    channel: claimed.channel,
    targetCountry: claimed.target_country,
  });

  if (audience.length === 0) {
    await supabase.from("campaigns").update({ status: "failed" }).eq("id", campaignId);
    return { outcome: "empty_audience" };
  }

  const idempotencyKey = idempotencyKeyFor(campaignId);

  await supabase.from("campaign_sends").upsert(
    {
      campaign_id: campaignId,
      brand_id: brandId,
      requested_by: requestedBy,
      idempotency_key: idempotencyKey,
      recipient_count: audience.length,
      status: "queued",
    },
    { onConflict: "campaign_id" },
  );

  try {
    const result = await dispatchMessages(
      claimed.name,
      brandId,
      audience.map((c) => ({ id: c.id })),
      idempotencyKey,
    );

    await supabase
      .from("campaign_sends")
      .update({
        provider_batch_id: result.batch_id,
        status: "dispatched",
        provider_response: result,
        dispatched_at: new Date().toISOString(),
      })
      .eq("campaign_id", campaignId);

    const { data: send } = await supabase
      .from("campaign_sends")
      .select("id")
      .eq("campaign_id", campaignId)
      .single();

    if (send) {
      const recipientRows = audience.map((c) => ({
        campaign_send_id: send.id,
        contact_id: c.id,
        brand_id: brandId,
        provider_recipient_key: c.id,
        status: "sent" as const,
      }));
      for (let i = 0; i < recipientRows.length; i += 500) {
        await supabase.from("campaign_send_recipients").upsert(recipientRows.slice(i, i + 500), {
          onConflict: "campaign_send_id,contact_id",
        });
      }
    }

    await supabase.from("campaigns").update({ status: "sent" }).eq("id", campaignId);

    return { outcome: "dispatched", recipientCount: audience.length, providerBatchId: result.batch_id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("campaign_sends").update({ status: "failed", error: message }).eq("campaign_id", campaignId);
    await supabase.from("campaigns").update({ status: "failed" }).eq("id", campaignId);
    return { outcome: "failed", error: message };
  }
}
