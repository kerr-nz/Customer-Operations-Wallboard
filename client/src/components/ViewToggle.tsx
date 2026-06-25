import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, Users } from "lucide-react";
import { getEntryDepth } from "@/lib/nav";
import type { TeamGroup } from "@shared/schema";

interface ViewToggleProps {
  customerId: string;
  activeView: "company" | "team";
  activeSlug?: string | null;
}

export function ViewToggle({ customerId, activeView, activeSlug = null }: ViewToggleProps) {
  const [groups, setGroups] = useState<TeamGroup[]>([]);
  const [, setLocation] = useLocation();
  const entryDepth = getEntryDepth();
  const showCompany = entryDepth <= 0 || entryDepth === -1;
  const showAllTeams = entryDepth <= 1 || entryDepth === -1;
  const showAllGroups = entryDepth < 2 || entryDepth === -1;

  useEffect(() => {
    fetch(`/api/customers/${customerId}/groups`)
      .then((res) => res.json())
      .then((data: TeamGroup[]) => {
        if (Array.isArray(data)) setGroups(data.filter((g) => (g.teamCount || 0) > 0));
      })
      .catch(() => {});
  }, [customerId]);

  const hasGroups = groups.length > 0;
  const visibleGroups = showAllGroups ? groups : groups.filter((g) => g.slug === activeSlug);

  const goToTeam = () => {
    if (showAllTeams) {
      setLocation(`/${customerId}/teams`);
    } else if (visibleGroups.length > 0) {
      setLocation(`/${customerId}/group/${visibleGroups[0].slug}`);
    }
  };

  const dropdownValue = activeSlug ?? "all";

  return (
    <div className="flex items-center gap-2">
      {showCompany && (
        <Button
          size="sm"
          variant={activeView === "company" ? "default" : "outline"}
          onClick={() => setLocation(`/${customerId}`)}
          className="gap-1.5"
          data-testid="button-view-company"
        >
          <Globe className="w-4 h-4" />
          Company
        </Button>
      )}
      <Button
        size="sm"
        variant={activeView === "team" ? "default" : "outline"}
        onClick={goToTeam}
        className="gap-1.5"
        data-testid="button-view-team"
      >
        <Users className="w-4 h-4" />
        Team
      </Button>
      {activeView === "team" && hasGroups && (
        <Select
          value={dropdownValue}
          onValueChange={(val) => {
            if (val === "all") {
              setLocation(`/${customerId}/teams`);
            } else if (val !== activeSlug) {
              setLocation(`/${customerId}/group/${val}`);
            }
          }}
        >
          <SelectTrigger className="w-[160px]" data-testid="select-sub-board">
            <SelectValue placeholder="Select board" />
          </SelectTrigger>
          <SelectContent>
            {showAllTeams && (
              <SelectItem value="all" data-testid="select-sub-board-all-teams">
                All
              </SelectItem>
            )}
            {visibleGroups.map((group) => (
              <SelectItem key={group.id} value={group.slug} data-testid={`select-sub-board-${group.slug}`}>
                {group.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
