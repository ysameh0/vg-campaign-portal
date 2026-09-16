import { createHash } from "node:crypto";
import type { ContactStatus } from "@/lib/supabase/types";

const STATUS_ALIASES: Record<string, ContactStatus> = {
  active: "active",
  bounced: "bounced",
  bounce: "bounced",
  unsubscribe: "unsubscribed",
  unsubscribed: "unsubscribed",
  pending: "pending",
};

export function normalizeStatus(raw: string | undefined): { status: ContactStatus; warning?: string } {
  if (!raw) return { status: "unknown", warning: "status missing" };
  const key = raw.trim().toLowerCase();
  const status = STATUS_ALIASES[key];
  if (!status) {
    return { status: "unknown", warning: `unrecognized status "${raw}"` };
  }
  return { status };
}

const TRUE_VALUES = new Set(["1", "yes", "true"]);
const FALSE_VALUES = new Set(["0", "no", "false"]);

export function normalizeBoolean(raw: string | undefined): { value: boolean; warning?: string } {
  if (raw === undefined) return { value: false };
  const key = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(key)) return { value: true };
  if (FALSE_VALUES.has(key)) return { value: false };
  return { value: false, warning: `unrecognized boolean "${raw}", treated as false` };
}

export function normalizeDate(raw: string | undefined): { value: string | null; warning?: string } {
  if (!raw) return { value: null };
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return { value: null, warning: `unparsable date "${raw}"` };
  }
  return { value: date.toISOString() };
}

// Marrakech's exports use a comma decimal separator ("221,09"). Only treat a
// comma as a decimal point when the string has no other plausible reading
// (no dot already present) — a stray thousands-separator comma elsewhere
// would be ambiguous, so those are left to fail numeric parsing explicitly
// rather than silently guessed at.
export function normalizeDecimal(raw: string | undefined): { value: number | null; warning?: string } {
  if (!raw) return { value: null };
  const trimmed = raw.trim();
  const candidate = trimmed.includes(".") ? trimmed : trimmed.replace(",", ".");
  const value = Number(candidate);
  if (Number.isNaN(value)) {
    return { value: null, warning: `unparsable number "${raw}"` };
  }
  return { value };
}

export function normalizeEmail(raw: string | undefined): { value: string | null; warning?: string } {
  if (!raw) return { value: null };
  const trimmed = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { value: trimmed, warning: `email "${raw}" doesn't look valid` };
  }
  return { value: trimmed };
}

export function contentHash(fields: Record<string, unknown>): string {
  const canonical = JSON.stringify(fields, Object.keys(fields).sort());
  return createHash("sha256").update(canonical).digest("hex");
}
