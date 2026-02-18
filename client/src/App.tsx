import { Switch, Route } from "wouter";
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

function ProtectedAdmin() {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <Admin />;
}

function ProtectedSpoke() {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <SpokeWallboard />;
}

function Router() {
  return (
    <Switch>
      <Route path="/admin" component={ProtectedAdmin} />
      <Route path="/spoke" component={ProtectedSpoke} />
      <Route path="/:customerId/teams" component={CustomerTeamBoard} />
      <Route path="/:customerId/team/:teamId" component={CustomerTeamWallboard} />
      <Route path="/:customerId/group/:groupSlug" component={CustomerGroupWallboard} />
      <Route path="/:customerId" component={CustomerDashboard} />
      <Route path="/" component={ProtectedAdmin} />
      <Route component={NotFound} />
    </Switch>
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
