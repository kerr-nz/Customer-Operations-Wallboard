const NAV_STACK_KEY = "nav_stack";

const NON_WALLBOARD_PATHS = new Set(["/admin", "/reset-password", "/login"]);

export function getUrlDepth(path: string): number {
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (normalized === "/" || normalized === "/spoke") return 0;
  if (NON_WALLBOARD_PATHS.has(normalized)) return -1;
  if (/^\/[^/]+\/(team|group)\/[^/]+\/?$/.test(path)) return 2;
  if (/^\/[^/]+\/teams\/?$/.test(path)) return 1;
  if (/^\/[^/]+\/?$/.test(path)) return 0;
  return -1;
}

function isCustomerPath(path: string): boolean {
  return getUrlDepth(path) >= 0;
}

function getStack(): string[] {
  try {
    const raw = sessionStorage.getItem(NAV_STACK_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function setStack(stack: string[]): void {
  sessionStorage.setItem(NAV_STACK_KEY, JSON.stringify(stack));
}

export function recordEntryPoint(): void {
  const stack = getStack();
  if (stack.length === 0 && isCustomerPath(window.location.pathname)) {
    setStack([window.location.pathname]);
  }
}

export function pushNavPath(path: string): void {
  if (!isCustomerPath(path)) return;
  const stack = getStack();
  if (stack.length > 0 && stack[stack.length - 1] === path) return;
  setStack([...stack, path]);
}

export function popNavPath(): string | null {
  const stack = getStack();
  if (stack.length <= 1) return null;
  const newStack = stack.slice(0, -1);
  setStack(newStack);
  return newStack[newStack.length - 1];
}

export function getLastNavPath(): string {
  const stack = getStack();
  return stack.length > 0 ? stack[stack.length - 1] : "/";
}

export function getEntryDepth(): number {
  const stack = getStack();
  if (stack.length === 0) return -1;
  return getUrlDepth(stack[0]);
}

export function useBackNav(): {
  backPath: string | null;
  showBack: boolean;
  goBack: (navigate: (path: string) => void) => void;
} {
  const stack = getStack();
  const showBack = stack.length > 1;
  const backPath = showBack ? stack[stack.length - 2] : null;

  const goBack = (navigate: (path: string) => void) => {
    const dest = popNavPath();
    if (dest) navigate(dest);
  };

  return { backPath, showBack, goBack };
}
