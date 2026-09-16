"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { sendCampaignAction } from "../actions";

export function SendPanel({
  campaignId,
  audienceCount,
  campaignName,
}: {
  campaignId: string;
  audienceCount: number;
  campaignName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();

  function handleConfirm() {
    startTransition(async () => {
      const res = await sendCampaignAction(campaignId);
      if (res.outcome === "dispatched") {
        setResult(`Sent to ${res.recipientCount} recipients — provider batch ${res.providerBatchId}.`);
      } else if (res.outcome === "already_sent") {
        setResult(`Already ${res.status} — this campaign can only be sent once.`);
      } else if (res.outcome === "empty_audience") {
        setResult("No contactable recipients matched — nothing was sent.");
      } else {
        setResult(`Send failed: ${res.error}`);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-2xl font-semibold tabular-nums">{audienceCount.toLocaleString()} recipients</p>

      {result && (
        <Alert>
          <AlertDescription>{result}</AlertDescription>
        </Alert>
      )}

      <AlertDialog>
        <AlertDialogTrigger render={<Button disabled={audienceCount === 0 || isPending} />}>
          Send campaign
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send &ldquo;{campaignName}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will dispatch to exactly <strong>{audienceCount.toLocaleString()}</strong> contactable
              recipients through the messaging provider, right now. This cannot be undone and a campaign can only
              be sent once.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
              {isPending ? "Sending…" : "Confirm send"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
