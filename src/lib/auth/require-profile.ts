import "server-only";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";

export interface CurrentProfile {
  id: string;
  brandId: string;
  brandCode: string;
  brandName: string;
  role: UserRole;
  email: string;
  fullName: string | null;
}

// Authenticating with Supabase (password or Google) only proves who you are.
// It does not by itself grant access to a brand: only the six pre-seeded
// emails have a row in brand_members, and only that row gets a profiles row
// created (see handle_new_auth_user() in supabase/migrations/0001_init.sql).
// Anyone else reaches this function authenticated but with no profile, and
// is signed back out here rather than shown an empty portal shell.
export async function requireProfile(): Promise<CurrentProfile> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, brand_id, role, email, full_name, brands(code, name)")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    await supabase.auth.signOut();
    redirect("/login?error=not_authorized");
  }

  const brand = profile.brands as unknown as { code: string; name: string } | null;

  return {
    id: profile.id,
    brandId: profile.brand_id,
    brandCode: brand?.code ?? "",
    brandName: brand?.name ?? "",
    role: profile.role as UserRole,
    email: profile.email,
    fullName: profile.full_name,
  };
}

export async function requireOwner(): Promise<CurrentProfile> {
  const profile = await requireProfile();
  if (profile.role !== "owner") {
    redirect("/dashboard?error=owner_only");
  }
  return profile;
}
