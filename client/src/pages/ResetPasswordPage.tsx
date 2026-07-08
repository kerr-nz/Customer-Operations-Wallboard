import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2 } from "lucide-react";
import { useCompanyName } from "@/hooks/useCompanyName";
import { CompanyLogo } from "@/components/CompanyLogo";

export default function ResetPasswordPage() {
  const { companyName, logoUrl } = useCompanyName();

  const token = new URLSearchParams(window.location.search).get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invalidToken, setInvalidToken] = useState(!/^[a-f0-9]{64}$/.test(token));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    document.title = `${companyName} - Reset Password`;
  }, [companyName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.code === "invalid_token") {
          setInvalidToken(true);
        } else {
          setError(data?.message || "Something went wrong. Please try again.");
        }
        return;
      }
      setSuccess(true);
      setTimeout(() => {
        window.location.href = "/spoke";
      }, 2500);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="p-8 max-w-sm w-full mx-4">
        <div className="flex flex-col items-center gap-6">
          <CompanyLogo logoUrl={logoUrl} size={48} />
          <div className="text-center">
            <h1 className="text-lg font-semibold" data-testid="text-reset-title">{companyName}</h1>
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-reset-subtitle">
              Reset your password
            </p>
          </div>

          {invalidToken ? (
            <div className="flex flex-col items-center gap-4 w-full">
              <p className="text-sm text-destructive text-center" data-testid="text-token-invalid">
                This reset link is invalid or has expired.
              </p>
              <Link href="/spoke">
                <Button variant="outline" className="w-full" data-testid="button-request-new-link">
                  Request a new link
                </Button>
              </Link>
            </div>
          ) : success ? (
            <div className="flex flex-col items-center gap-3 w-full" data-testid="text-reset-success">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
              <p className="text-sm text-center text-muted-foreground">
                Your password has been reset. Redirecting you to sign in…
              </p>
            </div>
          ) : (
            <form className="w-full flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  data-testid="input-new-password"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  data-testid="input-confirm-password"
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" data-testid="text-reset-error">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="w-full gap-2"
                disabled={isSubmitting}
                data-testid="button-reset-password"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Set new password
              </Button>
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}
