import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/require-profile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UploadForm } from "./upload-form";

export default async function ImportsPage() {
  const profile = await requireProfile();
  const supabase = await createServerSupabaseClient();

  const { data: imports } = await supabase
    .from("imports")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(30);

  const importIds = (imports ?? []).map((i) => i.id);
  const { data: errors } = importIds.length
    ? await supabase
        .from("import_row_errors")
        .select("*")
        .in("import_id", importIds)
        .order("id", { ascending: true })
        .limit(500)
    : { data: [] };

  const errorsByImport = new Map<string, typeof errors>();
  for (const err of errors ?? []) {
    const list = errorsByImport.get(err.import_id) ?? [];
    list.push(err);
    errorsByImport.set(err.import_id, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Imports</h1>
        <p className="text-sm text-muted-foreground">
          Re-uploading the same export is safe — rows are matched by external ID and unchanged rows are skipped, so
          the same file twice leaves one set of records, not two.
        </p>
      </div>

      {profile.role === "owner" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Import a file</CardTitle>
            <CardDescription>Contacts, campaigns, and events each have their own column shape.</CardDescription>
          </CardHeader>
          <CardContent>
            <UploadForm />
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {(imports ?? []).length === 0 && <p className="text-sm text-muted-foreground">No imports yet.</p>}
        {(imports ?? []).map((imp) => {
          const rowErrors = errorsByImport.get(imp.id) ?? [];
          return (
            <Card key={imp.id}>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <div>
                  <CardTitle className="text-sm font-medium">
                    {imp.file_name}{" "}
                    <span className="font-normal text-muted-foreground">({imp.kind})</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {new Date(imp.started_at).toLocaleString()}
                  </CardDescription>
                </div>
                <Badge variant={imp.status === "completed" ? "default" : imp.status === "failed" ? "destructive" : "secondary"}>
                  {imp.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>{imp.row_count} rows read</span>
                  <span>{imp.inserted_count} inserted</span>
                  <span>{imp.updated_count} updated</span>
                  <span>{imp.unchanged_count} unchanged</span>
                  <span className={imp.rejected_count > 0 ? "font-medium text-destructive" : ""}>
                    {imp.rejected_count} rejected
                  </span>
                </div>
                {imp.error && <p className="text-xs text-destructive">{imp.error}</p>}
                {rowErrors.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      {rowErrors.length} row issue{rowErrors.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {rowErrors.slice(0, 50).map((e) => (
                        <li key={e.id} className={e.severity === "error" ? "text-destructive" : "text-muted-foreground"}>
                          Row {e.row_number}: {e.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
