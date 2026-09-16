import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 50;

// PostgREST's `.or()` filter string uses `,` and `()` as syntax — strip them
// from free-text search input so a stray character can't produce a broken
// filter expression (the value itself is still parameterized by
// supabase-js, this is only about not confusing the operator grammar).
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%]/g, "").trim();
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "bounced" || status === "unsubscribed") return "destructive";
  return "secondary";
}

type Props = {
  searchParams: Promise<{ page?: string; q?: string }>;
};

export default async function ContactsPage({ searchParams }: Props) {
  const { page: pageParam, q: qParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const q = sanitizeSearch(qParam ?? "");
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("contacts")
    .select("id, full_name, email, phone, country, status, consent_marketing, signup_at", { count: "exact" })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (q) {
    query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data: contacts, count } = await query;
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Contacts</h1>
        <span className="text-sm text-muted-foreground">{total.toLocaleString()} total</span>
      </div>

      <form className="flex gap-2" action="/contacts">
        <Input name="q" defaultValue={qParam ?? ""} placeholder="Search name or email…" className="max-w-sm" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Page {page} of {totalPages}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Consent</TableHead>
                <TableHead>Signed up</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(contacts ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                    No contacts match.
                  </TableCell>
                </TableRow>
              )}
              {(contacts ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.full_name ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.email ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.phone ?? "—"}</TableCell>
                  <TableCell>{c.country ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                  </TableCell>
                  <TableCell>{c.consent_marketing ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.signup_at ? new Date(c.signup_at).toLocaleDateString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <Link
          href={`/contacts?page=${Math.max(1, page - 1)}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
          aria-disabled={page <= 1}
          className={page <= 1 ? "pointer-events-none text-muted-foreground/40" : "text-foreground"}
        >
          ← Previous
        </Link>
        <Link
          href={`/contacts?page=${Math.min(totalPages, page + 1)}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
          aria-disabled={page >= totalPages}
          className={page >= totalPages ? "pointer-events-none text-muted-foreground/40" : "text-foreground"}
        >
          Next →
        </Link>
      </div>
    </div>
  );
}
