import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import Admin from "@/pages/Admin";
import SpokeWallboard from "@/pages/SpokeWallboard";
import TeamWallboard from "@/pages/TeamWallboard";
import GroupWallboard from "@/pages/GroupWallboard";
import TeamBoard from "@/pages/TeamBoard";
import LoginPage from "@/pages/LoginPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import { useAuth } from "@/hooks/use-auth";
import { useWallboardAccess } from "@/hooks/use-wallboard-access";
import { recordEntryPoint, pushNavPath } from "@/lib/nav";
import { ShieldAlert } from "lucide-react";

function CustomerDashboard({ params }: { params: { customerId: string } }) {
  return <Dashboard customerId={params.customerId} />;
}

function CustomerTeamWallboard({ params }: { params: { customerId: string; teamId: string } }) {
  return <TeamWallboard customerId={params.customerId} teamId={params.teamId} />;
}

function CustomerGroupWallboard({ params }: { params: { customerId: string; groupSlug: string } }) {
  return <GroupWallboard customerId={params.customerId} groupSlug={params.groupSlug} />;
}

function CustomerTeamBoard({ params }: { params: { customerId: string } }) {
  return <TeamBoard customerId={params.customerId} />;
}

function AuthLoading() {
  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="text-muted-foreground">Loading...</div>
    </div>
  );
}

// Admin-only. Unauthenticated users see the login page; logged-in non-admins
// get an explicit "Administrators only" message rather than a silent redirect.
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, isAdmin } = useAuth();

  if (isLoading) return <AuthLoading />;
  if (!isAuthenticated) return <LoginPage />;
  if (!isAdmin) return <AdminOnlyMessage />;
  return <>{children}</>;
}

// Renders the wallboard when the visitor may view it (authenticated OR their IP
// is allowlisted), otherwise shows the login page. `probePath` points at the
// backend access probe for the specific wallboard being viewed.
function RequireWallboardView({
  probePath,
  children,
}: {
  probePath: string;
  children: React.ReactNode;
}) {
  const { canView, isLoading } = useWallboardAccess(probePath);

  if (isLoading) return <AuthLoading />;
  if (!canView) return <LoginPage />;
  return <>{children}</>;
}

function AdminOnlyMessage() {
  return (
    <div className="flex items-center justify-center h-screen bg-background p-6">
      <div
        className="flex flex-col items-center gap-3 text-center max-w-md"
        data-testid="message-admin-only"
      >
        <ShieldAlert className="w-10 h-10 text-destructive" />
        <h1 className="text-lg font-semibold">Administrators only</h1>
        <p className="text-sm text-muted-foreground">
          This page is restricted to administrators. Your account does not have
          admin access. Please contact an administrator if you need access.
        </p>
      </div>
    </div>
  );
}

function ProtectedAdmin() {
  return (
    <RequireAdmin>
      <Admin />
    </RequireAdmin>
  );
}

function ProtectedSpoke() {
  return (
    <RequireWallboardView probePath="/api/access/global">
      <SpokeWallboard />
    </RequireWallboardView>
  );
}

function NavStackWatcher() {
  const [location] = useLocation();

  useEffect(() => {
    pushNavPath(location);
  }, [location]);

  return null;
}

function Router() {
  useEffect(() => { recordEntryPoint(); }, []);
  return (
    <>
      <NavStackWatcher />
      <Switch>
        <Route path="/admin" component={ProtectedAdmin} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route path="/spoke" component={ProtectedSpoke} />
        <Route path="/:customerId/teams">
          {(params) => (
            <RequireWallboardView probePath={`/api/access/customer/${(params as { customerId: string }).customerId}`}>
              <CustomerTeamBoard params={params as { customerId: string }} />
            </RequireWallboardView>
          )}
        </Route>
        <Route path="/:customerId/team/:teamId">
          {(params) => (
            <RequireWallboardView probePath={`/api/access/customer/${(params as { customerId: string; teamId: string }).customerId}`}>
              <CustomerTeamWallboard params={params as { customerId: string; teamId: string }} />
            </RequireWallboardView>
          )}
        </Route>
        <Route path="/:customerId/group/:groupSlug">
          {(params) => (
            <RequireWallboardView probePath={`/api/access/customer/${(params as { customerId: string; groupSlug: string }).customerId}`}>
              <CustomerGroupWallboard params={params as { customerId: string; groupSlug: string }} />
            </RequireWallboardView>
          )}
        </Route>
        <Route path="/:customerId">
          {(params) => (
            <RequireWallboardView probePath={`/api/access/customer/${(params as { customerId: string }).customerId}`}>
              <CustomerDashboard params={params as { customerId: string }} />
            </RequireWallboardView>
          )}
        </Route>
        <Route path="/" component={ProtectedSpoke} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
