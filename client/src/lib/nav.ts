const NAV_ENTRY_KEY = "nav_entry_url";

function getUrlDepth(path: string): number {
  if (/^\/[^/]+\/(team|group)\/[^/]+\/?$/.test(path)) return 2;
  if (/^\/[^/]+\/teams\/?$/.test(path)) return 1;
  if (/^\/[^/]+\/?$/.test(path)) return 0;
  return -1;
}

function getCustomerId(path: string): string | null {
  const match = path.match(/^\/([^/]+)/);
  return match ? match[1] : null;
}

function getParentPath(path: string): string | null {
  const depth = getUrlDepth(path);
  const customerId = getCustomerId(path);
  if (!customerId) return null;
  if (depth === 2) return `/${customerId}/teams`;
  if (depth === 1) return `/${customerId}`;
  return null;
}

export function recordEntryPoint(): void {
  if (!sessionStorage.getItem(NAV_ENTRY_KEY)) {
    sessionStorage.setItem(NAV_ENTRY_KEY, window.location.pathname);
  }
}

export function useBackNav(currentPath: string): { parentPath: string | null; showBack: boolean } {
  const entryUrl = sessionStorage.getItem(NAV_ENTRY_KEY) ?? currentPath;
  const entryDepth = getUrlDepth(entryUrl);
  const parentPath = getParentPath(currentPath);

  if (parentPath === null) return { parentPath: null, showBack: false };

  const parentDepth = getUrlDepth(parentPath);

  const showBack = entryDepth < 0
    ? true
    : parentDepth >= entryDepth;

  return { parentPath, showBack };
}
