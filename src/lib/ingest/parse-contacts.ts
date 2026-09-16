import { parseCsv, pick } from "./csv";
import { normalizeBoolean, normalizeDate, normalizeEmail, normalizeStatus, contentHash } from "./normalize";
import type { ContactStatus } from "@/lib/supabase/types";

export interface NormalizedContactRow {
  external_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  status: ContactStatus;
  consent_marketing: boolean;
  signup_at: string | null;
  deleted_at: string | null;
  suppressed_until: string | null;
  notes: string | null;
  raw: Record<string, string>;
  content_hash: string;
}

export interface RowIssue {
  rowNumber: number;
  severity: "error" | "warning";
  reason: string;
  rawRow: Record<string, string>;
}

const ALIASES = {
  external_id: ["external_id", "externalid"],
  full_name: ["full_name", "fullname"],
  email: ["email", "e_mail"],
  phone: ["phone", "mobile"],
  country: ["country", "pays"],
  city: ["city"],
  status: ["status"],
  consent_marketing: ["consent_marketing"],
  signup_at: ["signup_at", "signupat"],
  deleted_at: ["deleted_at", "deletedat"],
  suppressed_until: ["suppressed_until", "suppresseduntil"],
  notes: ["notes"],
};

export function parseContactsCsv(text: string): { rows: NormalizedContactRow[]; issues: RowIssue[] } {
  const { rows: rawRows, headerMap } = parseCsv(text);
  const rows: NormalizedContactRow[] = [];
  const issues: RowIssue[] = [];

  rawRows.forEach((rawRow, index) => {
    const rowNumber = index + 2; // +1 for 0-index, +1 for header line
    const externalId = pick(rawRow, headerMap, ALIASES.external_id)?.trim();

    if (!externalId) {
      issues.push({ rowNumber, severity: "error", reason: "missing external_id — row skipped", rawRow });
      return;
    }

    const statusResult = normalizeStatus(pick(rawRow, headerMap, ALIASES.status));
    const consentResult = normalizeBoolean(pick(rawRow, headerMap, ALIASES.consent_marketing));
    const emailResult = normalizeEmail(pick(rawRow, headerMap, ALIASES.email));
    const signupResult = normalizeDate(pick(rawRow, headerMap, ALIASES.signup_at));
    const deletedResult = normalizeDate(pick(rawRow, headerMap, ALIASES.deleted_at));
    const suppressedResult = normalizeDate(pick(rawRow, headerMap, ALIASES.suppressed_until));

    for (const result of [statusResult, consentResult, emailResult, signupResult, deletedResult, suppressedResult]) {
      if (result.warning) {
        issues.push({ rowNumber, severity: "warning", reason: result.warning, rawRow });
      }
    }

    const normalized = {
      external_id: externalId,
      full_name: pick(rawRow, headerMap, ALIASES.full_name)?.trim() ?? null,
      email: emailResult.value,
      phone: pick(rawRow, headerMap, ALIASES.phone)?.trim() ?? null,
      country: pick(rawRow, headerMap, ALIASES.country)?.trim().toUpperCase() ?? null,
      city: pick(rawRow, headerMap, ALIASES.city)?.trim() ?? null,
      status: statusResult.status,
      consent_marketing: consentResult.value,
      signup_at: signupResult.value,
      deleted_at: deletedResult.value,
      suppressed_until: suppressedResult.value,
      notes: pick(rawRow, headerMap, ALIASES.notes)?.trim() ?? null,
    };

    rows.push({
      ...normalized,
      raw: rawRow,
      content_hash: contentHash(normalized),
    });
  });

  return { rows, issues };
}
