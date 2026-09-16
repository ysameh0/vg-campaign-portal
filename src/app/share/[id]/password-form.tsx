import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { verifySharePassword } from "./actions";

export function PasswordForm({ shareId, error }: { shareId: string; error?: boolean }) {
  const action = verifySharePassword.bind(null, shareId);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Campaign results</CardTitle>
          <CardDescription>This link is password-protected.</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>Incorrect password.</AlertDescription>
            </Alert>
          )}
          <form action={action} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required autoFocus />
            </div>
            <Button type="submit" className="w-full">
              View results
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
