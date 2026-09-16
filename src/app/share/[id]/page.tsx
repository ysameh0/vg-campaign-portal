import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { verifyShareSession, shareCookieName } from "@/lib/share/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordForm } from "./password-form";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function SharePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error: errorParam } = await searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get(shareCookieName(id))?.value;

  if (!verifyShareSession(id, token)) {
    return <PasswordForm shareId={id} error={Boolean(errorParam)} />;
  }

  const supabase = await createServerSupabaseClient();
  const { data: rows, error } = await supabase.rpc("get_campaign_share_summary", { p_share_id: id });
  const summary = Array.isArray(rows) ? rows[0] : rows;

  if (error || !summary) {
    return <PasswordForm shareId={id} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{summary.campaign_name}</CardTitle>
          <CardDescription>
            {summary.brand_name} · {summary.channel.toUpperCase()}
            {summary.sent_at ? ` · sent ${new Date(summary.sent_at).toLocaleDateString()}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">As reported</p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              <Stat label="Sent" value={summary.reported_sent} />
              <Stat label="Delivered" value={summary.reported_delivered} />
              <Stat label="Bounced" value={summary.reported_bounced} />
              <Stat label="Opens" value={summary.reported_opens} />
              <Stat label="Clicks" value={summary.reported_clicks} />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Counted from the event log</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Delivered" value={summary.counted_delivered} />
              <Stat label="Bounced" value={summary.counted_bounced} />
              <Stat label="Opened" value={summary.counted_opened} />
              <Stat label="Clicked" value={summary.counted_clicked} />
            </div>
          </div>
        </CardContent>
      </Card>
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
