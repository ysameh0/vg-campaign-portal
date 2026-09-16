import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runContactsImport, runCampaignsImport, runEventsImport } from "../src/lib/ingest/run-import";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.local)");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DATA_DIR = path.resolve(__dirname, "..", "data", "extracted");

const BRANDS = [
  { code: "KILELE", name: "Kilele Rides" },
  { code: "KAROO", name: "Karoo Coaches" },
  { code: "MARRAKECH", name: "Marrakech Express" },
] as const;

interface SeedUser {
  email: string;
  password: string;
  brandCode: (typeof BRANDS)[number]["code"];
  role: "owner" | "analyst";
  fullName: string;
}

// Generated once; printed at the end of the run for you to copy into the
// submission email. Re-running the script keeps these same credentials
// (updateUserById resets the password rather than minting a new one).
const USERS: SeedUser[] = [
  {
    email: "youssef.s.shokry@gmail.com",
    password: process.env.SEED_KILELE_OWNER_PASSWORD || "Kilele-Owner-2026!",
    brandCode: "KILELE",
    role: "owner",
    fullName: "Kilele Owner",
  },
  {
    email: "analyst@kilele.vg-portal.test",
    password: process.env.SEED_KILELE_ANALYST_PASSWORD || "Kilele-Analyst-2026!",
    brandCode: "KILELE",
    role: "analyst",
    fullName: "Kilele Analyst",
  },
  {
    email: "owner@karoo.vg-portal.test",
    password: process.env.SEED_KAROO_OWNER_PASSWORD || "Karoo-Owner-2026!",
    brandCode: "KAROO",
    role: "owner",
    fullName: "Karoo Owner",
  },
  {
    email: "analyst@karoo.vg-portal.test",
    password: process.env.SEED_KAROO_ANALYST_PASSWORD || "Karoo-Analyst-2026!",
    brandCode: "KAROO",
    role: "analyst",
    fullName: "Karoo Analyst",
  },
  {
    email: "owner@marrakech.vg-portal.test",
    password: process.env.SEED_MARRAKECH_OWNER_PASSWORD || "Marrakech-Owner-2026!",
    brandCode: "MARRAKECH",
    role: "owner",
    fullName: "Marrakech Owner",
  },
  {
    email: "analyst@marrakech.vg-portal.test",
    password: process.env.SEED_MARRAKECH_ANALYST_PASSWORD || "Marrakech-Analyst-2026!",
    brandCode: "MARRAKECH",
    role: "analyst",
    fullName: "Marrakech Analyst",
  },
];

async function upsertBrands(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const brand of BRANDS) {
    const { data, error } = await supabase
      .from("brands")
      .upsert({ code: brand.code, name: brand.name }, { onConflict: "code" })
      .select("id")
      .single();
    if (error) throw new Error(`brand upsert failed for ${brand.code}: ${error.message}`);
    ids[brand.code] = data.id as string;
    console.log(`brand ${brand.code} -> ${data.id}`);
  }
  return ids;
}

async function upsertBrandMembers(brandIds: Record<string, string>) {
  const rows = USERS.map((u) => ({ email: u.email.toLowerCase(), brand_id: brandIds[u.brandCode], role: u.role }));
  const { error } = await supabase.from("brand_members").upsert(rows, { onConflict: "email" });
  if (error) throw new Error(`brand_members upsert failed: ${error.message}`);
  console.log(`brand_members: ${rows.length} rows`);
}

async function upsertAuthUser(user: SeedUser): Promise<string> {
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listError) throw new Error(`listUsers failed: ${listError.message}`);
  const existing = list.users.find((u) => u.email?.toLowerCase() === user.email.toLowerCase());

  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: user.password,
      email_confirm: true,
      user_metadata: { full_name: user.fullName },
    });
    if (error) throw new Error(`updateUserById failed for ${user.email}: ${error.message}`);
    return existing.id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { full_name: user.fullName },
  });
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`);
  return data.user.id;
}

async function seedUsers(brandIds: Record<string, string>) {
  await upsertBrandMembers(brandIds);
  for (const user of USERS) {
    const id = await upsertAuthUser(user);
    console.log(`auth user ${user.email} -> ${id} (${user.brandCode} ${user.role})`);
  }
}

function readCsv(fileName: string): string {
  return readFileSync(path.join(DATA_DIR, fileName), "utf8");
}

async function seedBrandData(brandCode: string, brandId: string, files: { contacts: string[]; campaigns: string; events: string }) {
  for (const fileName of files.contacts) {
    const summary = await runContactsImport(supabase, brandId, fileName, readCsv(fileName), null);
    console.log(
      `[${brandCode}] contacts <- ${fileName}: ${summary.insertedCount} inserted, ${summary.updatedCount} updated, ${summary.unchangedCount} unchanged, ${summary.rejectedCount} rejected, ${summary.warningCount} warnings`,
    );
  }

  const campaignSummary = await runCampaignsImport(supabase, brandId, files.campaigns, readCsv(files.campaigns), null);
  console.log(
    `[${brandCode}] campaigns <- ${files.campaigns}: ${campaignSummary.insertedCount} inserted, ${campaignSummary.updatedCount} updated, ${campaignSummary.unchangedCount} unchanged, ${campaignSummary.rejectedCount} rejected`,
  );

  const eventsSummary = await runEventsImport(supabase, brandId, files.events, readCsv(files.events), null);
  console.log(
    `[${brandCode}] events <- ${files.events}: ${eventsSummary.insertedCount} inserted, ${eventsSummary.unchangedCount} unchanged (duplicate), ${eventsSummary.rejectedCount} rejected`,
  );
}

async function main() {
  console.log("== brands ==");
  const brandIds = await upsertBrands();

  console.log("== users ==");
  await seedUsers(brandIds);

  console.log("== data ==");
  await seedBrandData("KILELE", brandIds.KILELE, {
    contacts: ["kilele-contacts.csv", "kilele-contacts-delta-2026-09-01.csv"],
    campaigns: "kilele-campaigns.csv",
    events: "kilele-events.csv",
  });
  await seedBrandData("KAROO", brandIds.KAROO, {
    contacts: ["karoo-contacts.csv"],
    campaigns: "karoo-campaigns.csv",
    events: "karoo-events.csv",
  });
  await seedBrandData("MARRAKECH", brandIds.MARRAKECH, {
    contacts: ["marrakech-contacts.csv"],
    campaigns: "marrakech-campaigns.csv",
    events: "marrakech-events.csv",
  });

  console.log("\n== credentials (save these — this is the only time the script prints them) ==");
  for (const user of USERS) {
    console.log(`${user.brandCode.padEnd(10)} ${user.role.padEnd(8)} ${user.email.padEnd(32)} ${user.password}`);
  }
}

main()
  .then(() => {
    console.log("\nseed complete");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
