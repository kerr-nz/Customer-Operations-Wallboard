import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Phone, LogIn } from "lucide-react";

export default function LoginPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="p-8 max-w-sm w-full mx-4">
        <div className="flex flex-col items-center gap-6">
          <div className="w-12 h-12 rounded-md bg-primary flex items-center justify-center">
            <Phone className="w-6 h-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-semibold" data-testid="text-login-title">Spoke Phone</h1>
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-login-subtitle">
              Operations Wallboard
            </p>
          </div>
          <p className="text-sm text-muted-foreground text-center">
            Sign in with your corporate account to access the wallboard and admin tools.
          </p>
          <a href="/api/login" className="w-full">
            <Button className="w-full gap-2" data-testid="button-login">
              <LogIn className="w-4 h-4" />
              Sign in
            </Button>
          </a>
        </div>
      </Card>
    </div>
  );
}
