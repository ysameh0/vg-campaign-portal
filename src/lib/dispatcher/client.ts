import "server-only";
import { env } from "@/lib/env";

export interface DispatchRecipient {
  id: string;
  email?: string | null;
}

export interface DispatchResult {
  batch_id: string;
  accepted: unknown[];
  rejected: unknown[];
}

export interface ProviderEvent {
  event_id: string;
  event_type: string;
  occurred_at?: string;
  timestamp?: string;
  recipient_id?: string;
  id?: string;
  external_id?: string;
  contact_id?: string;
  recipient_key?: string;
  [key: string]: unknown;
}

export interface EventsPage {
  events: ProviderEvent[];
  next_cursor: string | null;
  has_more: boolean;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${env.dispatcherApiKey()}` };
}

// The brief is explicit that this provider's reports arrive messy and out of
// order despite what its own docs claim — callers must never assume
// send() or fetchEvents() succeeded just because this function returned; a
// non-2xx or a network error throws, and the caller (send.ts,
// poll-events edge function) is responsible for making retries safe.
export async function dispatchMessages(
  campaign: string,
  brand: string,
  recipients: DispatchRecipient[],
  idempotencyKey: string,
): Promise<DispatchResult> {
  const response = await fetch(`${env.dispatcherBaseUrl()}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      ...authHeaders(),
    },
    body: JSON.stringify({ campaign, brand, recipients }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`dispatcher POST /v1/messages failed: ${response.status} ${body}`);
  }

  return response.json();
}

export async function fetchEventsPage(batchId: string, since: string | null): Promise<EventsPage> {
  const url = new URL(`${env.dispatcherBaseUrl()}/v1/messages/${batchId}/events`);
  if (since) url.searchParams.set("since", since);

  const response = await fetch(url, { headers: authHeaders() });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`dispatcher GET /v1/messages/${batchId}/events failed: ${response.status} ${body}`);
  }

  return response.json();
}
