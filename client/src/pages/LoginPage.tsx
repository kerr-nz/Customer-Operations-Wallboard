import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SiGoogle } from "react-icons/si";
import { useCompanyName } from "@/hooks/useCompanyName";
import { CompanyLogo } from "@/components/CompanyLogo";

export default function LoginPage() {
  const { companyName, logoUrl } = useCompanyName();

  useEffect(() => {
    document.title = `${companyName} - Operations Wallboard`;
  }, [companyName]);

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
            Sign in with your corporate account to access the wallboard and admin tools.
          </p>
          <a href="/api/auth/login" className="w-full">
            <Button className="w-full gap-2" data-testid="button-login">
              <SiGoogle className="w-4 h-4" />
              Log in with Google
            </Button>
          </a>
        </div>
      </Card>
    </div>
  );
}
