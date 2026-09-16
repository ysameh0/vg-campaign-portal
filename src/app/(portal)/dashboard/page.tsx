import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignupsChart, type SignupDay } from "@/components/signups-chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();

  const [{ data: totalsRows, error: totalsError }, { data: signups }, { data: campaigns }] = await Promise.all([
    supabase.rpc("rpc_dashboard_totals") as unknown as Promise<{
      data: { total_customers: number; contactable_customers: number }[] | null;
      error: { message: string } | null;
    }>,
    supabase.rpc("rpc_signups_per_day", { p_days: 30 }),
    supabase.rpc("rpc_campaign_performance"),
  ]);

  if (totalsError) {
    console.error("rpc_dashboard_totals failed:", totalsError.message);
  }
  const totals = totalsRows?.[0];
  const totalCustomers = totals?.total_customers ?? 0;
  const contactableCustomers = totals?.contactable_customers ?? 0;
  const contactablePct = totalCustomers > 0 ? Math.round((contactableCustomers / totalCustomers) * 100) : 0;
  const signupDays: SignupDay[] = (signups ?? []).map((row: { day: string; signups: number }) => ({
    day: row.day,
    signups: row.signups,
  }));
  const campaignRows = (campaigns ?? []).slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total customers</CardDescription>
            <CardTitle className="text-3xl font-semibold">{totalCustomers.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Non-deleted contacts on file.</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Contactable</CardDescription>
            <CardTitle className="text-3xl font-semibold">
              {contactableCustomers.toLocaleString()}{" "}
              <span className="text-base font-normal text-muted-foreground">({contactablePct}%)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Active status, marketing consent given, not suppressed, not deleted, and has a usable email or phone.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Signups per day — last 30 days</CardTitle>
          <CardDescription>
            Calendar days, calculated against today&apos;s date — not against this brand&apos;s most recent
            activity. A brand whose seed data predates this window will legitimately show as empty here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupsChart data={signupDays} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campaign performance</CardTitle>
          <CardDescription>
            &ldquo;Reported&rdquo; is the number the CSV export / provider claimed. &ldquo;Counted&rdquo; is
            recomputed from the underlying event log. They can legitimately differ — both are shown rather than
            picking one silently.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Reported sent</TableHead>
                <TableHead className="text-right">Reported delivered</TableHead>
                <TableHead className="text-right">Counted delivered</TableHead>
                <TableHead className="text-right">Counted bounced</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaignRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No campaigns yet.
                  </TableCell>
                </TableRow>
              )}
              {campaignRows.map(
                (c: {
                  campaign_id: string;
                  name: string;
                  status: string;
                  reported_sent: number | null;
                  reported_delivered: number | null;
                  counted_delivered: number;
                  counted_bounced: number;
                }) => (
                  <TableRow key={c.campaign_id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{c.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.reported_sent ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.reported_delivered ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.counted_delivered}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.counted_bounced}</TableCell>
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
