"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { syncCampaignEvents } from "../actions";

export function SyncButton() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    startTransition(async () => {
      const res = await syncCampaignEvents();
      setMessage(res.ok ? "Synced." : `Sync failed: ${res.error}`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
      <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
}
