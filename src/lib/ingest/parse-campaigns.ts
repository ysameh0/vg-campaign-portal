import { parseCsv, pick } from "./csv";
import { normalizeDate, normalizeDecimal, contentHash } from "./normalize";
import type { RowIssue } from "./parse-contacts";
import type { CampaignChannel } from "@/lib/supabase/types";

export interface NormalizedCampaignRow {
  external_id: string;
  name: string;
  channel: CampaignChannel;
  target_country: string | null;
  reported_sent: number | null;
  reported_delivered: number | null;
  reported_bounced: number | null;
  reported_opens: number | null;
  reported_clicks: number | null;
  spend: number | null;
  sent_at: string | null;
  send_local_time: string | null;
  parent_external_id: string | null;
  content_hash: string;
}

const ALIASES = {
  external_id: ["external_id", "externalid"],
  campaign_name: ["campaign_name", "campaignname"],
  channel: ["channel"],
  target_country: ["target_country", "targetcountry"],
  reported_sent: ["reported_sent", "reportedsent"],
  reported_delivered: ["reported_delivered", "reporteddelivered"],
  reported_bounced: ["reported_bounced", "reportedbounced"],
  reported_opens: ["reported_opens", "reportedopens"],
  reported_clicks: ["reported_clicks", "reportedclicks"],
  spend: ["spend"],
  sent_at_utc: ["sent_at_utc", "sentatutc"],
  send_local_time: ["send_local_time", "sendlocaltime"],
  parent_campaign_id: ["parent_campaign_id", "parentcampaignid"],
};

function toInt(raw: string | undefined): number | null {
  const { value } = normalizeDecimal(raw);
  return value === null ? null : Math.round(value);
}

export function parseCampaignsCsv(text: string): { rows: NormalizedCampaignRow[]; issues: RowIssue[] } {
  const { rows: rawRows, headerMap } = parseCsv(text);
  const rows: NormalizedCampaignRow[] = [];
  const issues: RowIssue[] = [];

  rawRows.forEach((rawRow, index) => {
    const rowNumber = index + 2;
    const externalId = pick(rawRow, headerMap, ALIASES.external_id)?.trim();
    const name = pick(rawRow, headerMap, ALIASES.campaign_name)?.trim();
    const rawChannel = pick(rawRow, headerMap, ALIASES.channel)?.trim().toLowerCase();

    if (!externalId) {
      issues.push({ rowNumber, severity: "error", reason: "missing external_id — row skipped", rawRow });
      return;
    }
    if (rawChannel !== "email" && rawChannel !== "sms") {
      issues.push({
        rowNumber,
        severity: "error",
        reason: `unrecognized channel "${rawChannel ?? ""}" — row skipped`,
        rawRow,
      });
      return;
    }

    const sentAtResult = normalizeDate(pick(rawRow, headerMap, ALIASES.sent_at_utc));
    const spendResult = normalizeDecimal(pick(rawRow, headerMap, ALIASES.spend));
    if (sentAtResult.warning) issues.push({ rowNumber, severity: "warning", reason: sentAtResult.warning, rawRow });
    if (spendResult.warning) issues.push({ rowNumber, severity: "warning", reason: spendResult.warning, rawRow });

    const normalized = {
      external_id: externalId,
      name: name || externalId,
      channel: rawChannel as CampaignChannel,
      target_country: pick(rawRow, headerMap, ALIASES.target_country)?.trim().toUpperCase() || null,
      reported_sent: toInt(pick(rawRow, headerMap, ALIASES.reported_sent)),
      reported_delivered: toInt(pick(rawRow, headerMap, ALIASES.reported_delivered)),
      reported_bounced: toInt(pick(rawRow, headerMap, ALIASES.reported_bounced)),
      reported_opens: toInt(pick(rawRow, headerMap, ALIASES.reported_opens)),
      reported_clicks: toInt(pick(rawRow, headerMap, ALIASES.reported_clicks)),
      spend: spendResult.value,
      sent_at: sentAtResult.value,
      send_local_time: pick(rawRow, headerMap, ALIASES.send_local_time)?.trim() || null,
      parent_external_id: pick(rawRow, headerMap, ALIASES.parent_campaign_id)?.trim() || null,
    };

    rows.push({ ...normalized, content_hash: contentHash(normalized) });
  });

  return { rows, issues };
}
