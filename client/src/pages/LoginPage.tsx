import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useCompanyName } from "@/hooks/useCompanyName";
import { CompanyLogo } from "@/components/CompanyLogo";

export default function LoginPage() {
  const { companyName, logoUrl } = useCompanyName();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    document.title = `${companyName} - Operations Wallboard`;
  }, [companyName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.message || "Unable to sign in. Please try again.");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      // The login page renders in place of the originally requested route, so
      // the current path is the page the user wanted. Reload it; the route
      // guards then route by role (e.g. a viewer landing on /admin → /spoke).
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = returnTo || "/";
    } catch {
      setError("Unable to sign in. Please try again.");
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
            <h1 className="text-lg font-semibold" data-testid="text-login-title">{companyName}</h1>
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-login-subtitle">
              Operations Wallboard
            </p>
          </div>
          <p className="text-sm text-muted-foreground text-center">
            Sign in with your email and password to access the wallboard and admin tools.
          </p>
          <form className="w-full flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="input-email"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="input-password"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" data-testid="text-login-error">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full gap-2"
              disabled={isSubmitting}
              data-testid="button-login"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Sign in
            </Button>
          </form>
          <p className="text-xs text-muted-foreground text-center">
            First time signing in? Enter your email and choose a password to set it.
          </p>
        </div>
      </Card>
    </div>
  );
}
