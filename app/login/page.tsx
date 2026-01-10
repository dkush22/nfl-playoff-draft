"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const router = useRouter();

  const emailOk = useMemo(() => email.trim().length > 3 && email.includes("@"), [email]);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!emailOk) {
      setError("Enter a valid email address.");
      return;
    }

    setSending(true);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setSending(false);

    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="min-h-[calc(100vh-1px)] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-2xl">Sign in</CardTitle>
            <CardDescription>
              We’ll email you a magic link. No password needed.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {sent ? (
              <div className="grid gap-4">
                <div className="rounded-md border bg-muted/40 p-4">
                  <p className="font-medium">Check your inbox</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    If you don’t see it, check spam or try again.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button type="button" onClick={() => router.push("/")} className="flex-1">
                    Back to home
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSent(false);
                      setEmail("");
                      setError(null);
                    }}
                    className="flex-1"
                  >
                    Use a different email
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={sendLink} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>

                {error ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}

                <Button type="submit" disabled={!emailOk || sending}>
                  {sending ? "Sending..." : "Send magic link"}
                </Button>

                <Button type="button" variant="ghost" onClick={() => router.push("/")}>
                  Back
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing, you’re just signing in to your league. No marketing emails.
        </p>
      </div>
    </main>
  );
}
