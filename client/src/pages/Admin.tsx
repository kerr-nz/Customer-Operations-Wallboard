import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { Customer, AuthorizedUser } from "@shared/schema";
import { TIMEZONES, REGION_OPTIONS, REGION_LABELS } from "@shared/schema";
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
        window.location.href = "/api/login";
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
        window.location.href = "/api/login";
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
            Your account ({authMe.email}) is not authorized to access this portal. Contact an administrator to get access.
          </p>
          <a href="/api/logout">
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
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
            <Phone className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-none">Spoke Phone</h1>
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
          <a href="/api/logout">
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

              {showForm && (
                <Card className="p-4">
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <h3 className="font-semibold text-sm">{editingCustomer ? "Edit Customer" : "Add Customer"}</h3>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => { setShowForm(false); setEditingCustomer(null); }}
                      data-testid="button-close-form"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <CustomerForm
                    customer={editingCustomer}
                    onSave={() => {
                      setShowForm(false);
                      setEditingCustomer(null);
                      fetchCustomers();
                    }}
                  />
                </Card>
              )}
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
                </Card>
              ))}
            </div>
          )}

          {isAdmin && <SpokeSettings />}
          {isAdmin && <UserManagement />}
        </div>
      </main>
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

function SpokeSettings() {
  const [spokeTz, setSpokeTz] = useState("Australia/Sydney");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/admin/settings", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (data.spoke_timezone) setSpokeTz(data.spoke_timezone);
        }
      } catch {}
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ spoke_timezone: spokeTz }),
      });
      if (res.ok) {
        toast({ title: "Spoke timezone updated" });
      } else {
        toast({ title: "Failed to save", variant: "destructive" });
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
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spoke-timezone" className="text-sm">Spoke Timezone (Global Wallboard Reset)</Label>
            <p className="text-xs text-muted-foreground">
              All customer data on the global /spoke wallboard resets at midnight in this timezone.
              Individual customer dashboards still reset at their own configured timezone.
            </p>
          </div>
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
            <Button onClick={handleSave} disabled={saving} data-testid="button-save-spoke-settings">
              {saving ? "Saving..." : "Save"}
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
