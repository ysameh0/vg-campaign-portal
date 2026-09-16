"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ImportSummary } from "@/lib/ingest/run-import";
import { uploadImport } from "./actions";

export function UploadForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await uploadImport(formData);
      if (res.ok) {
        setResult(res.summary);
        setError(null);
        formRef.current?.reset();
        router.refresh();
      } else {
        setError(res.error);
        setResult(null);
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="kind">File contains</Label>
          <select
            id="kind"
            name="kind"
            required
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
          >
            <option value="contacts">Contacts</option>
            <option value="campaigns">Campaigns</option>
            <option value="events">Events</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="file">CSV file</Label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
          />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Importing…" : "Import"}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {result && (
        <Alert>
          <AlertDescription>
            {result.rowCount} rows read — {result.insertedCount} inserted, {result.updatedCount} updated,{" "}
            {result.unchangedCount} unchanged, {result.rejectedCount} rejected
            {result.warningCount > 0 ? `, ${result.warningCount} warnings` : ""}.
          </AlertDescription>
        </Alert>
      )}
    </form>
  );
}
