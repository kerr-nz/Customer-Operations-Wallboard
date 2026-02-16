import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import Admin from "@/pages/Admin";
import SpokeWallboard from "@/pages/SpokeWallboard";

function CustomerDashboard({ params }: { params: { customerId: string } }) {
  return <Dashboard customerId={params.customerId} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/admin" component={Admin} />
      <Route path="/spoke" component={SpokeWallboard} />
      <Route path="/:customerId" component={CustomerDashboard} />
      <Route path="/" component={Admin} />
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
