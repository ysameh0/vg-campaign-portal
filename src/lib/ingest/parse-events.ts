import { parseCsv, pick } from "./csv";
import { normalizeDate } from "./normalize";
import type { RowIssue } from "./parse-contacts";

export interface NormalizedEventRow {
  event_id: string;
  external_contact_id: string | null;
  campaign_external_id: string | null;
  event_type: string;
  channel: string | null;
  occurred_at: string;
}

const ALIASES = {
  event_id: ["event_id", "eventid"],
  external_contact_id: ["external_contact_id", "externalcontactid"],
  campaign_external_id: ["campaign_external_id", "campaignexternalid"],
  event_type: ["event_type", "eventtype"],
  channel: ["channel"],
  occurred_at_utc: ["occurred_at_utc", "occurredatutc"],
};

export function parseEventsCsv(text: string): { rows: NormalizedEventRow[]; issues: RowIssue[] } {
  const { rows: rawRows, headerMap } = parseCsv(text);
  const rows: NormalizedEventRow[] = [];
  const issues: RowIssue[] = [];

  rawRows.forEach((rawRow, index) => {
    const rowNumber = index + 2;
    const eventId = pick(rawRow, headerMap, ALIASES.event_id)?.trim();
    const eventType = pick(rawRow, headerMap, ALIASES.event_type)?.trim().toLowerCase();
    const occurredResult = normalizeDate(pick(rawRow, headerMap, ALIASES.occurred_at_utc));

    if (!eventId) {
      issues.push({ rowNumber, severity: "error", reason: "missing event_id — row skipped", rawRow });
      return;
    }
    if (!eventType) {
      issues.push({ rowNumber, severity: "error", reason: "missing event_type — row skipped", rawRow });
      return;
    }
    if (!occurredResult.value) {
      issues.push({ rowNumber, severity: "error", reason: "missing/unparsable occurred_at — row skipped", rawRow });
      return;
    }

    rows.push({
      event_id: eventId,
      external_contact_id: pick(rawRow, headerMap, ALIASES.external_contact_id)?.trim() || null,
      campaign_external_id: pick(rawRow, headerMap, ALIASES.campaign_external_id)?.trim() || null,
      event_type: eventType,
      channel: pick(rawRow, headerMap, ALIASES.channel)?.trim() || null,
      occurred_at: occurredResult.value,
    });
  });

  return { rows, issues };
}
