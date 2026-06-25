import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { Customer, AuthorizedUser, CustomerTeam, TeamGroup } from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";
import { TIMEZONES, REGION_OPTIONS, REGION_LABELS } from "@shared/schema";
import { CompanyLogo } from "@/components/CompanyLogo";
import {
  Plus,
  Pencil,
  Trash2,
  Copy,
  ExternalLink,
  Phone,
  Shield,
  Users,
  RefreshCw,
  X,
  LayoutDashboard,
  Clock,
  LogOut,
  UserPlus,
  Crown,
  Eye,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  ToggleLeft,
  ToggleRight,
  FolderOpen,
  Link2,
  Check,
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";

interface AuthMe {
  email: string;
  role: "admin" | "viewer" | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  authorized?: boolean;
  isBootstrap?: boolean;
}

export default function Admin() {
  const { user, isLoading: authLoading } = useAuth();
  const [companyName, setCompanyName] = useState("Your Company Name");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${companyName} - Customer Management`;
  }, [companyName]);

  useEffect(() => {
    fetch("/api/admin/settings", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.app_company_name) setCompanyName(data.app_company_name);
        setLogoUrl(data?.app_company_logo || null);
      })
      .catch(() => {});
  }, []);

  const [authMe, setAuthMe] = useState<AuthMe | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const { toast } = useToast();

  const fetchAuthMe = async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.status === 401) {
        window.location.href = "/api/auth/login";
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setAuthMe(data);
      }
    } catch {
      // ignore
    } finally {
      setAuthLoaded(true);
    }
  };

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/customers", { credentials: "include" });
      if (res.status === 401) {
        window.location.href = "/api/auth/login";
        return;
      }
      if (res.status === 403) {
        setCustomers([]);
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (Array.isArray(data)) {
        setCustomers(data);
      }
    } catch {
      toast({ title: "Failed to load customers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuthMe();
  }, []);

  const isAdmin = authMe?.role === "admin";

  useEffect(() => {
    if (authLoaded && authMe && (authMe.authorized !== false)) {
      fetchCustomers();
    } else if (authLoaded && (!authMe || authMe.authorized === false)) {
      setLoading(false);
    }
  }, [authLoaded, authMe]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete customer "${name}"? This will remove all their data.`)) return;
    try {
      await fetch(`/api/admin/customers/${id}`, { method: "DELETE", credentials: "include" });
      toast({ title: `Deleted ${name}` });
      fetchCustomers();
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const handleToggleActive = async (customer: Customer) => {
    try {
      await fetch(`/api/admin/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !customer.active }),
        credentials: "include",
      });
      fetchCustomers();
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied` });
  };

  const baseUrl = window.location.origin;

  if (!authLoaded || loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground" data-testid="text-loading">Loading...</div>
      </div>
    );
  }

  if (authMe && authMe.authorized === false) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background gap-4">
        <Card className="p-8 max-w-sm w-full mx-4 text-center">
          <ShieldAlert className="w-12 h-12 mx-auto text-muted-foreground opacity-40 mb-3" />
          <h2 className="text-lg font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
          <p className="text-sm text-muted-foreground mb-4">
            You have not been approved or added as a user to this app. Please contact your administrator.
          </p>
          <a href="/api/auth/logout">
            <Button variant="outline" className="gap-2" data-testid="button-logout-denied">
              <LogOut className="w-4 h-4" />
              Sign out
            </Button>
          </a>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-4 py-3 border-b flex-wrap">
        <div className="flex items-center gap-2">
          <CompanyLogo logoUrl={logoUrl} size={32} />
          <div>
            <h1 className="text-sm font-semibold leading-none">{companyName}</h1>
            <p className="text-xs text-muted-foreground leading-none mt-0.5">Customer Management</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {authMe && (
            <Badge variant="outline" className="gap-1.5" data-testid="badge-current-user">
              {authMe.role === "admin" ? <Crown className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {authMe.email}
            </Badge>
          )}
          <Badge variant="secondary" className="gap-1.5">
            <Users className="w-3 h-3" />
            {customers.length} customers
          </Badge>
          <Link href="/spoke">
            <Button variant="outline" className="gap-1.5" data-testid="button-global-wallboard">
              <LayoutDashboard className="w-4 h-4" />
              Global Wallboard
            </Button>
          </Link>
          <Button size="icon" variant="ghost" onClick={fetchCustomers} data-testid="button-refresh">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <a href="/api/auth/logout">
            <Button size="icon" variant="ghost" data-testid="button-logout">
              <LogOut className="w-4 h-4" />
            </Button>
          </a>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">
          {isAdmin && (
            <>
              <Card className="p-3 border-l-[3px] border-l-sky-500 bg-sky-500/5" data-testid="info-live-only-identity">
                <div className="flex items-start gap-2">
                  <Eye className="w-4 h-4 mt-0.5 text-sky-500 shrink-0" />
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Live-only caller identity:</span> Caller names, phone numbers, and agent names are shown on live dashboards only. None of this information is persisted to the database — only aggregated daily stats and city/country labels are stored.
                  </div>
                </div>
              </Card>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-lg font-semibold">Customers</h2>
                {!showForm && (
                  <Button
                    onClick={() => { setShowForm(true); setEditingCustomer(null); }}
                    data-testid="button-add-customer"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add Customer
                  </Button>
                )}
              </div>

              <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); setEditingCustomer(null); } }}>
                <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{editingCustomer ? "Edit Customer" : "Add Customer"}</DialogTitle>
                    <DialogDescription>
                      {editingCustomer ? `Editing ${editingCustomer.name}` : "Create a new customer with a unique ID and webhook endpoint."}
                    </DialogDescription>
                  </DialogHeader>
                  <CustomerForm
                    key={editingCustomer?.id || "_new"}
                    customer={editingCustomer}
                    onSave={() => {
                      setShowForm(false);
                      setEditingCustomer(null);
                      fetchCustomers();
                    }}
                  />
                </DialogContent>
              </Dialog>
            </>
          )}

          {customers.length === 0 && !showForm ? (
            <Card className="p-8 text-center">
              <Users className="w-12 h-12 mx-auto text-muted-foreground opacity-40 mb-3" />
              <p className="text-muted-foreground">
                {isAdmin ? "No customers yet. Add your first customer to get started." : "No customers to display."}
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {customers.map((customer) => (
                <Card key={customer.id} className="p-4" data-testid={`card-customer-${customer.id}`}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm" data-testid={`text-customer-name-${customer.id}`}>{customer.name}</span>
                        <Badge variant={customer.active ? "secondary" : "outline"} data-testid={`badge-status-${customer.id}`}>
                          {customer.active ? "Active" : "Inactive"}
                        </Badge>
                        <Badge variant="outline" className="gap-1">
                          <Clock className="w-3 h-3" />
                          {customer.timezone || "UTC"}
                        </Badge>
                        {customer.ipAllowlist.length > 0 && (
                          <Badge variant="outline" className="gap-1">
                            <Shield className="w-3 h-3" />
                            IP Restricted
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 font-mono" data-testid={`text-customer-id-${customer.id}`}>{customer.id}</p>

                      <div className="flex flex-col gap-1 mt-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground w-20 shrink-0">Dashboard:</span>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{baseUrl}/{customer.id}</code>
                          <Button size="icon" variant="ghost" onClick={() => copyToClipboard(`${baseUrl}/${customer.id}`, "Dashboard URL")} data-testid={`button-copy-dashboard-${customer.id}`}>
                            <Copy className="w-3 h-3" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => window.open(`/${customer.id}`, "_blank")} data-testid={`button-open-dashboard-${customer.id}`}>
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground w-20 shrink-0">Webhook:</span>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{baseUrl}/webhook/{customer.id}</code>
                          <Button size="icon" variant="ghost" onClick={() => copyToClipboard(`${baseUrl}/webhook/${customer.id}`, "Webhook URL")} data-testid={`button-copy-webhook-${customer.id}`}>
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => { setEditingCustomer(customer); setShowForm(true); }}
                          data-testid={`button-edit-${customer.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => handleToggleActive(customer)}
                          data-testid={`button-toggle-${customer.id}`}
                        >
                          {customer.active ? "Pause" : "Activate"}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDelete(customer.id, customer.name)}
                          data-testid={`button-delete-${customer.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  {isAdmin && <CustomerTeamManagement customerId={customer.id} />}
                  {isAdmin && <CustomerGroupManagement customerId={customer.id} customerName={customer.name} />}
                </Card>
              ))}
            </div>
          )}

          {isAdmin && <SpokeSettings companyName={companyName} onCompanyNameChange={setCompanyName} onLogoChange={setLogoUrl} />}
          {isAdmin && <UserManagement />}
        </div>
      </main>
    </div>
  );
}

function CustomerTeamManagement({ customerId }: { customerId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [teams, setTeams] = useState<CustomerTeam[]>([]);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchTeams = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/teams`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setTeams(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (expanded) fetchTeams();
  }, [expanded]);

  const handleToggle = async (teamId: string, enabled: boolean) => {
    setToggling(teamId);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
        credentials: "include",
      });
      if (res.ok) {
        setTeams((prev) => prev.map((t) => t.teamId === teamId ? { ...t, enabled } : t));
        toast({ title: `Team ${enabled ? "enabled" : "disabled"}` });
      } else {
        toast({ title: "Failed to update team", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to update team", variant: "destructive" });
    } finally {
      setToggling(null);
    }
  };

  const handleSlaChange = async (teamId: string, value: string) => {
    const slaAnswerSeconds = value === "" ? null : value;
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slaAnswerSeconds }),
        credentials: "include",
      });
      if (res.ok) {
        const updated = await res.json();
        setTeams((prev) => prev.map((t) => t.teamId === teamId ? { ...t, slaAnswerSeconds: updated.slaAnswerSeconds } : t));
        toast({ title: "SLA updated" });
      }
    } catch {
      toast({ title: "Failed to update SLA", variant: "destructive" });
    }
  };

  const enabledCount = teams.filter((t) => t.enabled).length;

  return (
    <div className="mt-3 border-t pt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover-elevate rounded-md px-2 py-1 w-full text-left"
        data-testid={`button-teams-toggle-${customerId}`}
      >
        <Users className="w-3.5 h-3.5" />
        <span className="font-medium">Team Wallboards</span>
        {!expanded && teams.length > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {enabledCount}/{teams.length}
          </Badge>
        )}
        {expanded ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-1.5">
          {loading ? (
            <p className="text-xs text-muted-foreground px-2 py-1">Loading teams...</p>
          ) : teams.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-1">
              No teams discovered yet. Teams appear automatically when webhook events are received.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground px-2 mb-1">
                {enabledCount} of {teams.length} teams enabled. Enabled teams appear on the customer dashboard.
              </p>
              {teams.map((team) => (
                <div
                  key={team.teamId}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-muted/40"
                  data-testid={`team-row-${team.teamId}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {team.enabled ? (
                      <ToggleRight className="w-4 h-4 text-green-500 shrink-0" />
                    ) : (
                      <ToggleLeft className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-sm truncate">{team.teamName}</span>
                    <span className="text-[10px] text-muted-foreground font-mono truncate">{team.teamId}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="flex items-center gap-1">
                      <Label className="text-[10px] text-muted-foreground whitespace-nowrap">SLA</Label>
                      <Input
                        type="number"
                        min={0}
                        placeholder="sec"
                        className="w-16 h-7 text-xs"
                        value={team.slaAnswerSeconds ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setTeams((prev) => prev.map((t) => t.teamId === team.teamId ? { ...t, slaAnswerSeconds: val === "" ? null : parseInt(val, 10) } : t));
                        }}
                        onBlur={(e) => handleSlaChange(team.teamId, e.target.value)}
                        data-testid={`input-sla-${team.teamId}`}
                      />
                    </div>
                    <Button
                      variant={team.enabled ? "secondary" : "default"}
                      size="sm"
                      disabled={toggling === team.teamId}
                      onClick={() => handleToggle(team.teamId, !team.enabled)}
                      data-testid={`button-toggle-team-${team.teamId}`}
                    >
                      {toggling === team.teamId ? "..." : team.enabled ? "Disable" : "Enable"}
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CustomerGroupManagement({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [expanded, setExpanded] = useState(false);
  const [groups, setGroups] = useState<TeamGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TeamGroup | null>(null);
  const [editName, setEditName] = useState("");
  const [teamDialogGroup, setTeamDialogGroup] = useState<TeamGroup | null>(null);
  const [groupTeams, setGroupTeams] = useState<{ teamId: string; teamName: string; inGroup: boolean }[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [savingTeams, setSavingTeams] = useState(false);
  const { toast } = useToast();

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/groups`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setGroups(data);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (expanded) fetchGroups();
  }, [expanded]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newGroupName.trim() }),
        credentials: "include",
      });
      if (res.ok) {
        const group = await res.json();
        setGroups((prev) => [...prev, group].sort((a, b) => a.name.localeCompare(b.name)));
        setNewGroupName("");
        toast({ title: `Group "${group.name}" created` });
      } else {
        toast({ title: "Failed to create group", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to create group", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleRenameGroup = async () => {
    if (!editingGroup || !editName.trim()) return;
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/groups/${editingGroup.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
        credentials: "include",
      });
      if (res.ok) {
        const updated = await res.json();
        setGroups((prev) => prev.map((g) => g.id === updated.id ? { ...g, name: updated.name } : g));
        setEditingGroup(null);
        toast({ title: "Group renamed" });
      }
    } catch {
      toast({ title: "Failed to rename group", variant: "destructive" });
    }
  };

  const handleDeleteGroup = async (groupId: number, groupName: string) => {
    if (!confirm(`Delete group "${groupName}"? This won't affect the teams themselves.`)) return;
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/groups/${groupId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setGroups((prev) => prev.filter((g) => g.id !== groupId));
        toast({ title: `Group "${groupName}" deleted` });
      }
    } catch {
      toast({ title: "Failed to delete group", variant: "destructive" });
    }
  };

  const openTeamDialog = async (group: TeamGroup) => {
    setTeamDialogGroup(group);
    setTeamsLoading(true);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/groups/${group.id}/teams`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setGroupTeams(data);
      }
    } catch {
    } finally {
      setTeamsLoading(false);
    }
  };

  const toggleTeamInGroup = (teamId: string) => {
    setGroupTeams((prev) =>
      prev.map((t) => t.teamId === teamId ? { ...t, inGroup: !t.inGroup } : t)
    );
  };

  const saveTeamAssignment = async () => {
    if (!teamDialogGroup) return;
    setSavingTeams(true);
    try {
      const selectedIds = groupTeams.filter((t) => t.inGroup).map((t) => t.teamId);
      const res = await fetch(`/api/admin/customers/${customerId}/groups/${teamDialogGroup.id}/teams`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamIds: selectedIds }),
        credentials: "include",
      });
      if (res.ok) {
        setGroups((prev) =>
          prev.map((g) => g.id === teamDialogGroup.id ? { ...g, teamCount: selectedIds.length } : g)
        );
        setTeamDialogGroup(null);
        toast({ title: "Teams updated" });
      }
    } catch {
      toast({ title: "Failed to save teams", variant: "destructive" });
    } finally {
      setSavingTeams(false);
    }
  };

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="mt-3 border-t pt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover-elevate rounded-md px-2 py-1 w-full text-left"
        data-testid={`button-groups-toggle-${customerId}`}
      >
        <FolderOpen className="w-3.5 h-3.5" />
        <span className="font-medium">Team Groups (Sub-Wallboards)</span>
        {!expanded && groups.length > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {groups.length}
          </Badge>
        )}
        {expanded ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          {loading ? (
            <p className="text-xs text-muted-foreground px-2 py-1">Loading groups...</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground px-2">
                Create groups to organize teams into sub-wallboards. Each group gets its own URL that shows only the selected teams.
              </p>

              <div className="flex items-center gap-2 px-2">
                <Input
                  placeholder="New group name (e.g. BMW Exeter)"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
                  className="text-sm"
                  data-testid="input-new-group-name"
                />
                <Button
                  size="sm"
                  onClick={handleCreateGroup}
                  disabled={creating || !newGroupName.trim()}
                  data-testid="button-create-group"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add
                </Button>
              </div>

              {groups.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2 py-1">
                  No groups yet. Create one above to organize teams into sub-wallboards.
                </p>
              ) : (
                groups.map((group) => (
                  <div
                    key={group.id}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-muted/40"
                    data-testid={`group-row-${group.id}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                      {editingGroup?.id === group.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleRenameGroup()}
                            className="h-7 text-sm w-40"
                            autoFocus
                            data-testid="input-rename-group"
                          />
                          <Button size="icon" variant="ghost" onClick={handleRenameGroup} data-testid="button-save-rename">
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setEditingGroup(null)} data-testid="button-cancel-rename">
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm font-medium truncate">{group.name}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {group.teamCount || 0} teams
                          </Badge>
                        </>
                      )}
                    </div>
                    {editingGroup?.id !== group.id && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openTeamDialog(group)}
                          data-testid={`button-manage-teams-${group.id}`}
                          title="Manage teams in this group"
                        >
                          <Users className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            navigator.clipboard.writeText(`${baseUrl}/${customerId}/group/${group.slug}`);
                            toast({ title: "Group URL copied" });
                          }}
                          data-testid={`button-copy-group-url-${group.id}`}
                          title="Copy group wallboard URL"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => { setEditingGroup(group); setEditName(group.name); }}
                          data-testid={`button-rename-group-${group.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDeleteGroup(group.id, group.name)}
                          data-testid={`button-delete-group-${group.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </>
          )}
        </div>
      )}

      <Dialog open={!!teamDialogGroup} onOpenChange={(open) => !open && setTeamDialogGroup(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Manage Teams — {teamDialogGroup?.name}</DialogTitle>
            <DialogDescription>
              Select which enabled teams should appear in this group's wallboard.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto flex flex-col gap-1.5 py-2">
            {teamsLoading ? (
              <p className="text-sm text-muted-foreground">Loading teams...</p>
            ) : groupTeams.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No enabled teams found. Enable teams in the "Team Wallboards" section first.
              </p>
            ) : (
              groupTeams.map((team) => (
                <label
                  key={team.teamId}
                  className="flex items-center gap-3 px-3 py-2 rounded-md hover-elevate cursor-pointer"
                  data-testid={`checkbox-team-${team.teamId}`}
                >
                  <Checkbox
                    checked={team.inGroup}
                    onCheckedChange={() => toggleTeamInGroup(team.teamId)}
                  />
                  <span className="text-sm">{team.teamName}</span>
                </label>
              ))
            )}
          </div>
          <div className="flex items-center justify-between gap-2 pt-2 border-t">
            <span className="text-xs text-muted-foreground">
              {groupTeams.filter((t) => t.inGroup).length} of {groupTeams.length} teams selected
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setTeamDialogGroup(null)} data-testid="button-cancel-teams">
                Cancel
              </Button>
              <Button onClick={saveTeamAssignment} disabled={savingTeams} data-testid="button-save-teams">
                {savingTeams ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CustomerForm({ customer, onSave }: { customer: Customer | null; onSave: () => void }) {
  const [id, setId] = useState(customer?.id || "");
  const [name, setName] = useState(customer?.name || "");
  const [ipAllowlist, setIpAllowlist] = useState(customer?.ipAllowlist.join(", ") || "");
  const [timezone, setTimezone] = useState(customer?.timezone || "UTC");
  const [defaultRegion, setDefaultRegion] = useState(customer?.defaultRegion || "world");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const isEditing = !!customer;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const ipList = ipAllowlist
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const url = isEditing ? `/api/admin/customers/${customer.id}` : "/api/admin/customers";
      const method = isEditing ? "PATCH" : "POST";
      const body = isEditing
        ? { name, ipAllowlist: ipList, timezone, defaultRegion }
        : { id, name, active: true, ipAllowlist: ipList, timezone, defaultRegion };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error?.formErrors?.[0] || data.error?.fieldErrors?.id?.[0] || data.error || "Failed to save");
        return;
      }

      toast({ title: isEditing ? "Customer updated" : "Customer created" });
      onSave();
    } catch {
      setError("Request failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {!isEditing && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customer-id">Customer ID</Label>
          <Input
            id="customer-id"
            value={id}
            onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="acme-rockets"
            required
            data-testid="input-customer-id"
          />
          <p className="text-xs text-muted-foreground">Lowercase, hyphens only. Used in URLs.</p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customer-name">Company Name</Label>
        <Input
          id="customer-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ACME Rockets"
          required
          data-testid="input-customer-name"
        />
        <p className="text-xs text-muted-foreground">Displayed as "Spoke - ACME Rockets" on the dashboard.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customer-timezone">Timezone</Label>
        <select
          id="customer-timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid="select-customer-timezone"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Daily stats reset at midnight in this timezone.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customer-region">Default Map Region</Label>
        <select
          id="customer-region"
          value={defaultRegion}
          onChange={(e) => setDefaultRegion(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid="select-customer-region"
        >
          {REGION_OPTIONS.map((r) => (
            <option key={r} value={r}>{REGION_LABELS[r]}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">The map will focus on this region by default for this customer.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ip-allowlist">IP Allowlist (optional)</Label>
        <Input
          id="ip-allowlist"
          value={ipAllowlist}
          onChange={(e) => setIpAllowlist(e.target.value)}
          placeholder="203.0.113.0/24, 198.51.100.5"
          data-testid="input-ip-allowlist"
        />
        <p className="text-xs text-muted-foreground">Comma-separated IPs or CIDR ranges. Leave empty to allow all.</p>
      </div>

      {error && (
        <p className="text-sm text-destructive" data-testid="text-form-error">{typeof error === "string" ? error : JSON.stringify(error)}</p>
      )}

      <Button type="submit" disabled={saving} data-testid="button-save-customer">
        {saving ? "Saving..." : isEditing ? "Update Customer" : "Create Customer"}
      </Button>
    </form>
  );
}

function SpokeSettings({
  companyName,
  onCompanyNameChange,
  onLogoChange,
}: {
  companyName: string;
  onCompanyNameChange: (name: string) => void;
  onLogoChange: (url: string | null) => void;
}) {
  const [spokeTz, setSpokeTz] = useState("Australia/Sydney");
  const [localCompanyName, setLocalCompanyName] = useState(companyName);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoChanged, setLogoChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/admin/settings", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (data.spoke_timezone) setSpokeTz(data.spoke_timezone);
          if (data.app_company_name) {
            setLocalCompanyName(data.app_company_name);
            onCompanyNameChange(data.app_company_name);
          }
          const existingLogo = data.app_company_logo || null;
          setLogoPreview(existingLogo);
          onLogoChange(existingLogo);
        }
      } catch {}
    };
    load();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Logo must be under 1.5 MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setLogoPreview(dataUrl);
      setLogoChanged(true);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogoPreview(null);
    setLogoChanged(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Always send the company name as a trimmed string so a name-only save
      // reliably reaches the server (empty/whitespace falls back to the default).
      const nameToSave = localCompanyName.trim() || "Your Company Name";
      const body: Record<string, unknown> = {
        spoke_timezone: spokeTz,
        app_company_name: nameToSave,
      };
      if (logoChanged) {
        body.app_company_logo = logoPreview ?? "";
      }
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setLocalCompanyName(nameToSave);
        onCompanyNameChange(nameToSave);
        onLogoChange(logoPreview);
        setLogoChanged(false);
        toast({ title: "Settings saved" });
      } else {
        let description: string | undefined;
        try {
          const data = await res.json();
          if (data?.error) description = data.error;
        } catch {}
        toast({ title: "Failed to save", description, variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="section-spoke-settings">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Global Wallboard Settings</h2>
        </div>
      </div>
      <Card className="p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="company-name" className="text-sm">Company Name</Label>
            <p className="text-xs text-muted-foreground">
              Shown in the top-left title bar across all pages and as the prefix on customer dashboard headers (e.g. "Acme Corp - Customer Name").
            </p>
            <Input
              id="company-name"
              value={localCompanyName}
              onChange={(e) => setLocalCompanyName(e.target.value)}
              placeholder="Your Company Name"
              data-testid="input-company-name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Company Logo</Label>
            <p className="text-xs text-muted-foreground">
              Displayed in the top-left corner of all wallboard pages. Accepts PNG, SVG, or JPG. Max 1.5 MB.
              Falls back to a phone icon when no logo is set.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              {logoPreview ? (
                <div className="relative flex items-center gap-2">
                  <img
                    src={logoPreview}
                    alt="Logo preview"
                    className="w-12 h-12 rounded-md object-contain border border-border bg-white"
                    data-testid="img-logo-preview"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveLogo}
                    data-testid="button-remove-logo"
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border">
                  None
                </div>
              )}
              <div>
                <input
                  ref={fileInputRef}
                  id="logo-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/svg+xml"
                  className="hidden"
                  onChange={handleFileChange}
                  data-testid="input-logo-upload"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-choose-logo"
                >
                  {logoPreview ? "Change Logo" : "Upload Logo"}
                </Button>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spoke-timezone" className="text-sm">Global Reset Timezone</Label>
            <p className="text-xs text-muted-foreground">
              All customer data on the global /spoke wallboard resets at midnight in this timezone.
              Individual customer dashboards still reset at their own configured timezone.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                id="spoke-timezone"
                value={spokeTz}
                onChange={(e) => setSpokeTz(e.target.value)}
                className="flex-1 min-w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                data-testid="select-spoke-timezone"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Button onClick={handleSave} disabled={saving} data-testid="button-save-spoke-settings">
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function UserManagement() {
  const [users, setUsers] = useState<AuthorizedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "viewer">("viewer");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setUsers(data);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail, role: newRole }),
        credentials: "include",
      });
      if (res.status === 409) {
        toast({ title: "This email is already added", variant: "destructive" });
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        toast({ title: data.error || "Failed to add user", variant: "destructive" });
        return;
      }
      toast({ title: "User added" });
      setNewEmail("");
      setNewRole("viewer");
      setShowAddForm(false);
      fetchUsers();
    } catch {
      toast({ title: "Failed to add user", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (userId: number, email: string) => {
    if (!confirm(`Remove access for ${email}?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        toast({ title: data.error || "Failed to remove user", variant: "destructive" });
        return;
      }
      toast({ title: `Removed ${email}` });
      fetchUsers();
    } catch {
      toast({ title: "Failed to remove user", variant: "destructive" });
    }
  };

  const handleRoleChange = async (userId: number, role: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
        credentials: "include",
      });
      if (res.ok) {
        fetchUsers();
        toast({ title: "Role updated" });
      }
    } catch {
      toast({ title: "Failed to update role", variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="section-user-management">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Authorized Users</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage who can access the admin portal and global wallboard
          </p>
        </div>
        {!showAddForm && (
          <Button onClick={() => setShowAddForm(true)} data-testid="button-add-user">
            <UserPlus className="w-4 h-4 mr-1" />
            Add User
          </Button>
        )}
      </div>

      {showAddForm && (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h3 className="font-semibold text-sm">Add Authorized User</h3>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setShowAddForm(false)}
              data-testid="button-close-user-form"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <form onSubmit={handleAdd} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="user-email">Email Address</Label>
              <Input
                id="user-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="colleague@spoke.com"
                required
                data-testid="input-user-email"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="user-role">Role</Label>
              <select
                id="user-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "admin" | "viewer")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="select-user-role"
              >
                <option value="admin">Admin - Can manage customers and users</option>
                <option value="viewer">Viewer - Can view the global wallboard</option>
              </select>
              <p className="text-xs text-muted-foreground">Admins can add customers and manage users. Viewers can only see the global wallboard.</p>
            </div>
            <Button type="submit" disabled={saving} data-testid="button-save-user">
              {saving ? "Adding..." : "Add User"}
            </Button>
          </form>
        </Card>
      )}

      {loading ? (
        <div className="text-center text-muted-foreground py-6">Loading...</div>
      ) : users.length === 0 ? (
        <Card className="p-6 text-center">
          <Shield className="w-10 h-10 mx-auto text-muted-foreground opacity-40 mb-3" />
          <p className="text-sm text-muted-foreground">
            No authorized users yet. Anyone who signs in will have admin access until you add the first user.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {users.map((u) => (
            <Card key={u.id} className="p-3" data-testid={`card-user-${u.id}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  {u.role === "admin" ? (
                    <Crown className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
                  ) : (
                    <Eye className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-sm font-medium truncate" data-testid={`text-user-email-${u.id}`}>{u.email}</span>
                  <Badge variant={u.role === "admin" ? "secondary" : "outline"} data-testid={`badge-user-role-${u.id}`}>
                    {u.role === "admin" ? "Admin" : "Viewer"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    className="h-8 text-xs rounded-md border border-input bg-transparent px-2"
                    data-testid={`select-change-role-${u.id}`}
                  >
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDelete(u.id, u.email)}
                    data-testid={`button-delete-user-${u.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
