import { useQuery } from "@tanstack/react-query";

export interface WallboardAccess {
  canView: boolean;
  authenticated: boolean;
}

// Probes whether the current visitor may VIEW a specific wallboard, either via
// a logged-in session or an allowlisted IP. `authenticated` distinguishes true
// login from anonymous IP-based access (the auth hook alone can't express this).
export function useWallboardAccess(probePath: string) {
  const { data, isLoading } = useQuery<WallboardAccess>({
    queryKey: [probePath],
    queryFn: async () => {
      const res = await fetch(probePath, { credentials: "include" });
      if (!res.ok) return { canView: false, authenticated: false };
      return res.json();
    },
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  return {
    canView: data?.canView ?? false,
    authenticated: data?.authenticated ?? false,
    isLoading,
  };
}
