import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/require-profile";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "sent") return "default";
  if (status === "failed") return "destructive";
  if (status === "queued" || status === "sending") return "secondary";
  return "outline";
}

export default async function CampaignsPage() {
  const profile = await requireProfile();
  const supabase = await createServerSupabaseClient();
  const { data: campaigns } = await supabase.rpc("rpc_campaign_performance");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Campaigns</h1>
        {profile.role === "owner" && (
          <Button size="sm" render={<Link href="/campaigns/new" />}>
            New campaign
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(campaigns ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No campaigns yet.
                  </TableCell>
                </TableRow>
              )}
              {(campaigns ?? []).map(
                (c: {
                  campaign_id: string;
                  name: string;
                  channel: string;
                  source: string;
                  status: string;
                  sent_at: string | null;
                }) => (
                  <TableRow key={c.campaign_id} className="cursor-pointer">
                    <TableCell className="font-medium">
                      <Link href={`/campaigns/${c.campaign_id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{c.channel}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.source === "seed_historical" ? "Historical" : "App"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {c.sent_at ? new Date(c.sent_at).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
