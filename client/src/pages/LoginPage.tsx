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

  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);

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

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || "Something went wrong. Please try again.");
        return;
      }
      setForgotMessage(
        data?.message ||
          "If your email address is found in our database, a password reset link will be sent to your email."
      );
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = (next: "login" | "forgot") => {
    setMode(next);
    setError(null);
    setForgotMessage(null);
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

          {mode === "login" ? (
            <>
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
              <button
                type="button"
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                onClick={() => switchMode("forgot")}
                data-testid="link-forgot-password"
              >
                Forgot password?
              </button>
              <p className="text-xs text-muted-foreground text-center">
                First time signing in? Enter your email and choose a password to set it.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground text-center">
                Enter your email address and we'll send you a link to reset your password.
              </p>
              {forgotMessage ? (
                <p className="text-sm text-center" data-testid="text-forgot-confirmation">
                  {forgotMessage}
                </p>
              ) : (
                <form className="w-full flex flex-col gap-4" onSubmit={handleForgotSubmit}>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="forgot-email">Email</Label>
                    <Input
                      id="forgot-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      data-testid="input-forgot-email"
                    />
                  </div>
                  {error && (
                    <p className="text-sm text-destructive" data-testid="text-forgot-error">
                      {error}
                    </p>
                  )}
                  <Button
                    type="submit"
                    className="w-full gap-2"
                    disabled={isSubmitting}
                    data-testid="button-send-reset-link"
                  >
                    {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    Send reset link
                  </Button>
                </form>
              )}
              <button
                type="button"
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                onClick={() => switchMode("login")}
                data-testid="link-back-to-login"
              >
                Back to sign in
              </button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
