import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { Customer } from "@shared/schema";
import { TIMEZONES } from "@shared/schema";
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
} from "lucide-react";
import { Link } from "wouter";

export default function Admin() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const { toast } = useToast();

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/customers");
      const data = await res.json();
      setCustomers(data);
    } catch {
      toast({ title: "Failed to load customers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete customer "${name}"? This will remove all their data.`)) return;
    try {
      await fetch(`/api/admin/customers/${id}`, { method: "DELETE" });
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
        <div className="flex items-center gap-2">
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
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4">
        <div className="max-w-5xl mx-auto flex flex-col gap-4">
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

          {loading ? (
            <div className="text-center text-muted-foreground py-12">Loading...</div>
          ) : customers.length === 0 && !showForm ? (
            <Card className="p-8 text-center">
              <Users className="w-12 h-12 mx-auto text-muted-foreground opacity-40 mb-3" />
              <p className="text-muted-foreground">No customers yet. Add your first customer to get started.</p>
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
                  </div>
                </Card>
              ))}
            </div>
          )}
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
        ? { name, ipAllowlist: ipList, timezone }
        : { id, name, active: true, ipAllowlist: ipList, timezone };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
