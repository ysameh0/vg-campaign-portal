import { notFound } from "next/navigation";

// A send's recipient-bookkeeping insert is O(audience size) — Kilele-scale
// campaigns (tens of thousands of contactable recipients) need more than
// the platform's default function timeout to write every
// campaign_send_recipients row in the same request as the dispatch call.
export const maxDuration = 60;
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/require-profile";
import { computeAudience, AUDIENCE_RULE_DESCRIPTION } from "@/lib/campaigns/audience";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SendPanel } from "./send-panel";
import { SyncButton } from "./sync-button";
import { SharePanel } from "./share-panel";

type Props = { params: Promise<{ id: string }> };

export default async function CampaignDetailPage({ params }: Props) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createServerSupabaseClient();

  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (!campaign) notFound();

  const isDraftOrFailed = campaign.status === "draft" || campaign.status === "failed";

  const [{ data: performanceRows }, { data: send }, { data: shares }] = await Promise.all([
    supabase.rpc("rpc_campaign_performance"),
    supabase.from("campaign_sends").select("*").eq("campaign_id", id).maybeSingle(),
    supabase.from("campaign_shares").select("*").eq("campaign_id", id).order("created_at", { ascending: false }),
  ]);
  const performance = (performanceRows ?? []).find((r: { campaign_id: string }) => r.campaign_id === id);

  const audience = isDraftOrFailed
    ? await computeAudience(supabase, {
        brandId: profile.brandId,
        channel: campaign.channel,
        targetCountry: campaign.target_country,
      })
    : [];

  let recipientStats: { status: string; count: number }[] = [];
  if (send) {
    const { data } = await supabase
      .from("campaign_send_recipients")
      .select("status")
      .eq("campaign_send_id", send.id);
    const counts = new Map<string, number>();
    for (const row of data ?? []) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    recipientStats = Array.from(counts.entries()).map(([status, count]) => ({ status, count }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{campaign.name}</h1>
          <p className="text-sm text-muted-foreground">
            {campaign.channel.toUpperCase()} · {campaign.source === "seed_historical" ? "Historical" : "App-created"}
          </p>
        </div>
        <Badge>{campaign.status}</Badge>
      </div>

      {campaign.source === "seed_historical" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">As reported (seed export)</CardTitle>
            <CardDescription>Verbatim from the historical CSV — never recomputed.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Sent" value={campaign.reported_sent} />
            <Stat label="Delivered" value={campaign.reported_delivered} />
            <Stat label="Bounced" value={campaign.reported_bounced} />
            <Stat label="Opens" value={campaign.reported_opens} />
            <Stat label="Clicks" value={campaign.reported_clicks} />
          </CardContent>
        </Card>
      )}

      {performance && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Counted (from the event log)</CardTitle>
            <CardDescription>Recomputed from individual events rather than taken as given.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Delivered" value={performance.counted_delivered} />
            <Stat label="Bounced" value={performance.counted_bounced} />
            <Stat label="Opened" value={performance.counted_opened} />
            <Stat label="Clicked" value={performance.counted_clicked} />
            <Stat label="Unsubscribed" value={performance.counted_unsubscribed} />
          </CardContent>
        </Card>
      )}

      {isDraftOrFailed && profile.role === "owner" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Send</CardTitle>
            <CardDescription>{AUDIENCE_RULE_DESCRIPTION}</CardDescription>
          </CardHeader>
          <CardContent>
            <SendPanel campaignId={id} audienceCount={audience.length} campaignName={campaign.name} />
          </CardContent>
        </Card>
      )}

      {send && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Live delivery</CardTitle>
              <CardDescription>
                {send.recipient_count} recipients · batch {send.provider_batch_id ?? "—"} · last synced{" "}
                {send.last_polled_at ? new Date(send.last_polled_at).toLocaleString() : "never"}
              </CardDescription>
            </div>
            {profile.role === "owner" && <SyncButton />}
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {recipientStats.length === 0 && <p className="text-sm text-muted-foreground">No events synced yet.</p>}
            {recipientStats.map((s) => (
              <Badge key={s.status} variant="outline" className="text-sm">
                {s.status}: {s.count}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {campaign.status === "sent" && profile.role === "owner" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Publish results</CardTitle>
            <CardDescription>
              Create a password-protected link showing only this campaign&apos;s results, safe to send to someone
              without a login.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SharePanel campaignId={id} shares={shares ?? []} />
          </CardContent>
        </Card>
      )}

      <Separator />
      <p className="text-xs text-muted-foreground">Created {new Date(campaign.created_at).toLocaleString()}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value ?? "—"}</p>
    </div>
  );
}
