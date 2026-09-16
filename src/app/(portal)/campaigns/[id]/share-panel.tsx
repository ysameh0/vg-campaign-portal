"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createShareAction, revokeShareAction } from "../actions";

interface Share {
  id: string;
  created_at: string;
  revoked_at: string | null;
  view_count: number;
}

export function SharePanel({ campaignId, shares }: { campaignId: string; shares: Share[] }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleCreate() {
    startTransition(async () => {
      const res = await createShareAction(campaignId, password);
      if (res.ok) {
        setNewLink(`${window.location.origin}/share/${res.shareId}`);
        setMessage(null);
        setPassword("");
        router.refresh();
      } else {
        setMessage(res.error);
      }
    });
  }

  function handleRevoke(shareId: string) {
    startTransition(async () => {
      await revokeShareAction(shareId, campaignId);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="share-password">Password</Label>
          <Input
            id="share-password"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </div>
        <Button onClick={handleCreate} disabled={isPending || password.length < 8}>
          Create link
        </Button>
      </div>

      {message && (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {newLink && (
        <Alert>
          <AlertDescription>
            Share this link and password with your client: <br />
            <code className="text-xs">{newLink}</code>
          </AlertDescription>
        </Alert>
      )}

      {shares.length > 0 && (
        <div className="space-y-2">
          {shares.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <div>
                <p className="font-mono text-xs">{s.id}</p>
                <p className="text-xs text-muted-foreground">
                  {s.view_count} view{s.view_count === 1 ? "" : "s"} · created{" "}
                  {new Date(s.created_at).toLocaleDateString()}
                  {s.revoked_at ? " · revoked" : ""}
                </p>
              </div>
              {!s.revoked_at && (
                <Button variant="ghost" size="sm" onClick={() => handleRevoke(s.id)} disabled={isPending}>
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
