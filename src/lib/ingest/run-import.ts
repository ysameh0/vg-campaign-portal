import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseContactsCsv } from "./parse-contacts";
import { parseCampaignsCsv } from "./parse-campaigns";
import { parseEventsCsv } from "./parse-events";
import type { RowIssue } from "./parse-contacts";

const CHUNK_SIZE = 500;
const PAGE_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// PostgREST caps a single response at 1000 rows by default — this paginates
// through every row of a (brand-scoped) select rather than silently getting
// only the first page.
async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  brandId: string,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("brand_id", brandId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export interface ImportSummary {
  importId: string;
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  rejectedCount: number;
  warningCount: number;
}

async function startImport(
  supabase: SupabaseClient,
  brandId: string,
  kind: "contacts" | "campaigns" | "events",
  fileName: string,
  initiatedBy: string | null,
): Promise<string> {
  const { data, error } = await supabase
    .from("imports")
    .insert({ brand_id: brandId, kind, file_name: fileName, initiated_by: initiatedBy })
    .select("id")
    .single();
  if (error) throw new Error(`could not start import: ${error.message}`);
  return data.id as string;
}

async function recordIssues(supabase: SupabaseClient, importId: string, issues: RowIssue[]): Promise<void> {
  if (issues.length === 0) return;
  const payload = issues.map((issue) => ({
    import_id: importId,
    row_number: issue.rowNumber,
    severity: issue.severity,
    reason: issue.reason,
    raw_row: issue.rawRow,
  }));
  for (const batch of chunk(payload, CHUNK_SIZE)) {
    const { error } = await supabase.from("import_row_errors").insert(batch);
    if (error) throw new Error(`could not record import issues: ${error.message}`);
  }
}

async function finishImport(
  supabase: SupabaseClient,
  importId: string,
  counts: {
    row_count: number;
    inserted_count: number;
    updated_count: number;
    unchanged_count: number;
    rejected_count: number;
  },
  status: "completed" | "failed",
  error?: string,
): Promise<void> {
  await supabase
    .from("imports")
    .update({ ...counts, status, finished_at: new Date().toISOString(), error: error ?? null })
    .eq("id", importId);
}

export async function runContactsImport(
  supabase: SupabaseClient,
  brandId: string,
  fileName: string,
  text: string,
  initiatedBy: string | null,
): Promise<ImportSummary> {
  const importId = await startImport(supabase, brandId, "contacts", fileName, initiatedBy);

  try {
    const { rows, issues } = parseContactsCsv(text);
    const existing = await fetchAll<{ external_id: string; content_hash: string | null }>(
      supabase,
      "contacts",
      "external_id, content_hash",
      brandId,
    );
    const existingMap = new Map(existing.map((row) => [row.external_id, row.content_hash]));

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const toUpsert = [];

    for (const row of rows) {
      const priorHash = existingMap.get(row.external_id);
      if (priorHash === undefined) {
        inserted += 1;
        toUpsert.push(row);
      } else if (priorHash !== row.content_hash) {
        updated += 1;
        toUpsert.push(row);
      } else {
        unchanged += 1;
      }
    }

    for (const batch of chunk(toUpsert, CHUNK_SIZE)) {
      const { error } = await supabase
        .from("contacts")
        .upsert(
          batch.map((row) => ({ ...row, brand_id: brandId, source_import_id: importId })),
          { onConflict: "brand_id,external_id" },
        );
      if (error) throw new Error(`contacts upsert failed: ${error.message}`);
    }

    await recordIssues(supabase, importId, issues);

    const rejected = issues.filter((i) => i.severity === "error").length;
    await finishImport(supabase, importId, {
      row_count: rows.length + rejected,
      inserted_count: inserted,
      updated_count: updated,
      unchanged_count: unchanged,
      rejected_count: rejected,
    }, "completed");

    return {
      importId,
      rowCount: rows.length + rejected,
      insertedCount: inserted,
      updatedCount: updated,
      unchangedCount: unchanged,
      rejectedCount: rejected,
      warningCount: issues.filter((i) => i.severity === "warning").length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishImport(
      supabase,
      importId,
      { row_count: 0, inserted_count: 0, updated_count: 0, unchanged_count: 0, rejected_count: 0 },
      "failed",
      message,
    );
    throw err;
  }
}

export async function runCampaignsImport(
  supabase: SupabaseClient,
  brandId: string,
  fileName: string,
  text: string,
  initiatedBy: string | null,
): Promise<ImportSummary> {
  const importId = await startImport(supabase, brandId, "campaigns", fileName, initiatedBy);

  try {
    const { rows, issues } = parseCampaignsCsv(text);
    const existing = await fetchAll<{ external_id: string; content_hash: string | null }>(
      supabase,
      "campaigns",
      "external_id, content_hash",
      brandId,
    );
    const existingMap = new Map(existing.map((row) => [row.external_id, row.content_hash]));

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const toUpsert: (typeof rows[number] & { source: string })[] = [];

    for (const row of rows) {
      const priorHash = existingMap.get(row.external_id);
      if (priorHash === undefined) {
        inserted += 1;
        toUpsert.push({ ...row, source: "seed_historical" });
      } else if (priorHash !== row.content_hash) {
        updated += 1;
        toUpsert.push({ ...row, source: "seed_historical" });
      } else {
        unchanged += 1;
      }
    }

    for (const batch of chunk(toUpsert, CHUNK_SIZE)) {
      const { error } = await supabase.from("campaigns").upsert(
        batch.map(({ parent_external_id: _parent_external_id, ...row }) => ({
          ...row,
          brand_id: brandId,
        })),
        { onConflict: "brand_id,external_id" },
      );
      if (error) throw new Error(`campaigns upsert failed: ${error.message}`);
    }

    // Second pass: resolve parent_campaign_id now that every campaign in
    // this file has a row (a child can reference a parent later in the same
    // file, or one imported in a previous run).
    const withParents = rows.filter((row) => row.parent_external_id);
    if (withParents.length > 0) {
      const { data: campaignIds, error: lookupError } = await supabase
        .from("campaigns")
        .select("id, external_id")
        .eq("brand_id", brandId);
      if (lookupError) throw new Error(`campaign id lookup failed: ${lookupError.message}`);
      const idByExternalId = new Map((campaignIds ?? []).map((c) => [c.external_id, c.id]));

      for (const row of withParents) {
        const childId = idByExternalId.get(row.external_id);
        const parentId = row.parent_external_id ? idByExternalId.get(row.parent_external_id) : null;
        if (childId && parentId) {
          await supabase.from("campaigns").update({ parent_campaign_id: parentId }).eq("id", childId);
        }
      }
    }

    await recordIssues(supabase, importId, issues);

    const rejected = issues.filter((i) => i.severity === "error").length;
    await finishImport(supabase, importId, {
      row_count: rows.length + rejected,
      inserted_count: inserted,
      updated_count: updated,
      unchanged_count: unchanged,
      rejected_count: rejected,
    }, "completed");

    return {
      importId,
      rowCount: rows.length + rejected,
      insertedCount: inserted,
      updatedCount: updated,
      unchangedCount: unchanged,
      rejectedCount: rejected,
      warningCount: issues.filter((i) => i.severity === "warning").length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishImport(
      supabase,
      importId,
      { row_count: 0, inserted_count: 0, updated_count: 0, unchanged_count: 0, rejected_count: 0 },
      "failed",
      message,
    );
    throw err;
  }
}

export async function runEventsImport(
  supabase: SupabaseClient,
  brandId: string,
  fileName: string,
  text: string,
  initiatedBy: string | null,
): Promise<ImportSummary> {
  const importId = await startImport(supabase, brandId, "events", fileName, initiatedBy);

  try {
    const { rows, issues } = parseEventsCsv(text);

    const [contacts, campaigns, existingEvents] = await Promise.all([
      fetchAll<{ id: string; external_id: string }>(supabase, "contacts", "id, external_id", brandId),
      fetchAll<{ id: string; external_id: string }>(supabase, "campaigns", "id, external_id", brandId),
      fetchAll<{ event_id: string }>(supabase, "seed_events", "event_id", brandId),
    ]);
    const contactIdByExternal = new Map(contacts.map((c) => [c.external_id, c.id]));
    const campaignIdByExternal = new Map(campaigns.map((c) => [c.external_id, c.id]));
    const existingEventIds = new Set(existingEvents.map((e) => e.event_id));

    let inserted = 0;
    let unchanged = 0;
    const toInsert = [];

    for (const row of rows) {
      if (existingEventIds.has(row.event_id)) {
        unchanged += 1;
        continue;
      }
      inserted += 1;
      toInsert.push({
        brand_id: brandId,
        event_id: row.event_id,
        contact_id: row.external_contact_id ? (contactIdByExternal.get(row.external_contact_id) ?? null) : null,
        campaign_id: row.campaign_external_id ? (campaignIdByExternal.get(row.campaign_external_id) ?? null) : null,
        event_type: row.event_type,
        channel: row.channel,
        occurred_at: row.occurred_at,
      });
    }

    for (const batch of chunk(toInsert, CHUNK_SIZE)) {
      // Duplicate event_id rows within the same file (seen in the seed data)
      // collapse here too — ignoreDuplicates makes a second occurrence a
      // no-op instead of an error or a second row.
      const { error } = await supabase
        .from("seed_events")
        .upsert(batch, { onConflict: "brand_id,event_id", ignoreDuplicates: true });
      if (error) throw new Error(`seed_events insert failed: ${error.message}`);
    }

    await recordIssues(supabase, importId, issues);

    const rejected = issues.filter((i) => i.severity === "error").length;
    await finishImport(supabase, importId, {
      row_count: rows.length + rejected,
      inserted_count: inserted,
      updated_count: 0,
      unchanged_count: unchanged,
      rejected_count: rejected,
    }, "completed");

    return {
      importId,
      rowCount: rows.length + rejected,
      insertedCount: inserted,
      updatedCount: 0,
      unchangedCount: unchanged,
      rejectedCount: rejected,
      warningCount: issues.filter((i) => i.severity === "warning").length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishImport(
      supabase,
      importId,
      { row_count: 0, inserted_count: 0, updated_count: 0, unchanged_count: 0, rejected_count: 0 },
      "failed",
      message,
    );
    throw err;
  }
}
