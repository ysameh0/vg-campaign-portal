// Scheduled via pg_cron (see supabase/post-deploy.sql) so delivery reports
// keep flowing in even while nobody has the app open — the brief is
// explicit this has to work "while your app isn't looking". Also callable
// on demand (the portal's "Sync now" button hits this same function) so the
// pipeline is demonstrable live without waiting on the schedule.
//
// The provider's own docs claim its event stream is "clean and complete...
// exactly once and in order" — the brief overrides that and says reports
// will be messy, duplicated, and out of order in testing. Every write below
// assumes the docs are wrong: events dedupe on (campaign_send_id,
// provider_event_id), and a recipient's derived status is only advanced
// when the new event's occurred_at is strictly after the last one applied,
// never by arrival order.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISPATCHER_BASE_URL = Deno.env.get("DISPATCHER_BASE_URL")!;
const DISPATCHER_API_KEY = Deno.env.get("DISPATCHER_API_KEY")!;

const MAX_SENDS_PER_RUN = 25;
const MAX_PAGES_PER_SEND = 25;

const STATUS_BY_EVENT_TYPE: Record<string, string> = {
  delivered: "delivered",
  bounced: "bounced",
  opened: "opened",
  unsubscribed: "unsubscribed",
};

interface ProviderEvent {
  event_id: string;
  event_type: string;
  occurred_at?: string;
  timestamp?: string;
  contact_id?: string;
  recipient_id?: string;
  id?: string;
  external_id?: string;
  recipient_key?: string;
  [key: string]: unknown;
}

function recipientKeyOf(event: ProviderEvent): string | null {
  return event.contact_id ?? event.recipient_id ?? event.id ?? event.external_id ?? event.recipient_key ?? null;
}

function occurredAtOf(event: ProviderEvent): string | null {
  const raw = event.occurred_at ?? event.timestamp;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchEventsPage(batchId: string, since: string | null) {
  const url = new URL(`${DISPATCHER_BASE_URL}/v1/messages/${batchId}/events`);
  if (since) url.searchParams.set("since", since);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${DISPATCHER_API_KEY}` } });
  if (!res.ok) throw new Error(`events fetch failed for ${batchId}: ${res.status} ${await res.text()}`);
  return (await res.json()) as { events: ProviderEvent[]; next_cursor: string | null; has_more: boolean };
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: sends, error: sendsError } = await supabase
    .from("campaign_sends")
    .select("id, brand_id, provider_batch_id, last_event_cursor")
    .eq("status", "dispatched")
    .not("provider_batch_id", "is", null)
    .order("last_polled_at", { ascending: true, nullsFirst: true })
    .limit(MAX_SENDS_PER_RUN);

  if (sendsError) {
    return new Response(JSON.stringify({ error: sendsError.message }), { status: 500 });
  }

  const summary: Record<string, number> = {};

  for (const send of sends ?? []) {
    let cursor = send.last_event_cursor as string | null;
    let lastEventId = cursor;
    let processed = 0;

    for (let page = 0; page < MAX_PAGES_PER_SEND; page++) {
      const result = await fetchEventsPage(send.provider_batch_id, cursor);

      for (const event of result.events) {
        if (!event.event_id) continue;
        const occurredAt = occurredAtOf(event);
        const recipientKey = recipientKeyOf(event);

        const { error: insertError, data: inserted } = await supabase
          .from("provider_events")
          .upsert(
            {
              campaign_send_id: send.id,
              brand_id: send.brand_id,
              provider_event_id: event.event_id,
              event_type: event.event_type,
              occurred_at: occurredAt,
              recipient_key: recipientKey,
              raw: event,
            },
            { onConflict: "campaign_send_id,provider_event_id", ignoreDuplicates: true },
          )
          .select("id");

        if (insertError) {
          console.error("provider_events upsert failed", insertError.message);
          continue;
        }
        // ignoreDuplicates means a redelivered/duplicated event returns no
        // row here — already processed, nothing further to do for it.
        if (!inserted || inserted.length === 0) continue;

        processed += 1;
        lastEventId = event.event_id;

        if (!recipientKey || !occurredAt) continue;

        const derivedStatus = STATUS_BY_EVENT_TYPE[event.event_type];
        if (!derivedStatus) continue;

        const { data: recipient } = await supabase
          .from("campaign_send_recipients")
          .select("id, contact_id, last_event_at")
          .eq("campaign_send_id", send.id)
          .eq("provider_recipient_key", recipientKey)
          .maybeSingle();

        if (!recipient) continue;

        if (!recipient.last_event_at || occurredAt > recipient.last_event_at) {
          await supabase
            .from("campaign_send_recipients")
            .update({ status: derivedStatus, last_event_at: occurredAt })
            .eq("id", recipient.id);

          if (event.event_type === "bounced") {
            await supabase
              .from("contacts")
              .update({ status: "bounced", provider_status_at: occurredAt })
              .eq("id", recipient.contact_id)
              .or(`provider_status_at.is.null,provider_status_at.lt.${occurredAt}`);
          } else if (event.event_type === "unsubscribed") {
            await supabase
              .from("contacts")
              .update({ status: "unsubscribed", consent_marketing: false, provider_status_at: occurredAt })
              .eq("id", recipient.contact_id)
              .or(`provider_status_at.is.null,provider_status_at.lt.${occurredAt}`);
          }
        }
      }

      cursor = result.next_cursor;
      if (!result.has_more || !cursor) break;
    }

    await supabase
      .from("campaign_sends")
      .update({ last_event_cursor: lastEventId, last_polled_at: new Date().toISOString() })
      .eq("id", send.id);

    summary[send.id] = processed;
  }

  return new Response(JSON.stringify({ polled: (sends ?? []).length, processed: summary }), {
    headers: { "Content-Type": "application/json" },
  });
});
