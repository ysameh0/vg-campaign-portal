import { requireOwner } from "@/lib/auth/require-profile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createCampaign } from "../actions";

type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function NewCampaignPage({ searchParams }: Props) {
  await requireOwner();
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">New campaign</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
          <CardDescription>
            The audience is computed at send time from contactable contacts, optionally narrowed by country.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form action={createCampaign} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Campaign name</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="channel">Channel</Label>
              <select
                id="channel"
                name="channel"
                required
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="target_country">Target country (optional, ISO code)</Label>
              <Input id="target_country" name="target_country" placeholder="e.g. KE" maxLength={2} />
            </div>
            <Button type="submit" className="w-full">
              Create draft
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
