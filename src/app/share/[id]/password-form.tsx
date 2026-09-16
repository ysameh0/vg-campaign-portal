"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { verifySharePassword } from "./actions";

export function PasswordForm({ shareId }: { shareId: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await verifySharePassword(shareId, password);
      if (res.ok) {
        // A plain hard reload rather than router.refresh(): the latter
        // re-renders the current route against an already-mounted
        // <PasswordForm>, which intermittently threw a hydration error and
        // left the form on screen even though the cookie had already been
        // set successfully server-side (confirmed via
        // campaign_share_attempts). A full navigation sidesteps RSC
        // reconciliation of the old form tree entirely.
        window.location.reload();
      } else {
        setError("Incorrect password.");
      }
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Campaign results</CardTitle>
          <CardDescription>This link is password-protected.</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "Checking…" : "View results"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
