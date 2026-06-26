import { Switch, Route, Redirect, useLocation } from "wouter";
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
import { useAuth } from "@/hooks/use-auth";
import { recordEntryPoint, pushNavPath } from "@/lib/nav";

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

// Any authenticated user (admin or viewer) may see the wrapped page.
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) return <AuthLoading />;
  if (!isAuthenticated) return <LoginPage />;
  return <>{children}</>;
}

// Admin-only. Unauthenticated users see the login page; logged-in viewers are
// sent to the global wallboard rather than the admin UI.
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, isAdmin } = useAuth();

  if (isLoading) return <AuthLoading />;
  if (!isAuthenticated) return <LoginPage />;
  if (!isAdmin) return <Redirect to="/spoke" />;
  return <>{children}</>;
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
    <RequireAuth>
      <SpokeWallboard />
    </RequireAuth>
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
        <Route path="/spoke" component={ProtectedSpoke} />
        <Route path="/:customerId/teams">
          {(params) => (
            <RequireAuth>
              <CustomerTeamBoard params={params as { customerId: string }} />
            </RequireAuth>
          )}
        </Route>
        <Route path="/:customerId/team/:teamId">
          {(params) => (
            <RequireAuth>
              <CustomerTeamWallboard params={params as { customerId: string; teamId: string }} />
            </RequireAuth>
          )}
        </Route>
        <Route path="/:customerId/group/:groupSlug">
          {(params) => (
            <RequireAuth>
              <CustomerGroupWallboard params={params as { customerId: string; groupSlug: string }} />
            </RequireAuth>
          )}
        </Route>
        <Route path="/:customerId">
          {(params) => (
            <RequireAuth>
              <CustomerDashboard params={params as { customerId: string }} />
            </RequireAuth>
          )}
        </Route>
        <Route path="/" component={ProtectedAdmin} />
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
