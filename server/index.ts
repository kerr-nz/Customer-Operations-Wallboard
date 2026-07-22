import express, { type Request, Response, NextFunction } from "express";
import { serveStatic } from "./static";
import { createServer } from "http";

// ---------------------------------------------------------------------------
// Fail fast on missing required configuration — BEFORE importing any module
// that reads these at load time. A clear message beats a stack trace, and it
// tells a self-hosting customer exactly how to fix their copy.
// ---------------------------------------------------------------------------
const REQUIRED_ENV: Array<{ name: string; hint: string }> = [
  {
    name: "DATABASE_URL",
    hint: "PostgreSQL connection string. On Replit, create a PostgreSQL database (Tools → Database) and this is set automatically.",
  },
  {
    name: "SESSION_SECRET",
    hint: "Random string used to sign login session cookies. Add it in Secrets (Tools → Secrets). Any long random value works, e.g. run: openssl rand -hex 32",
  },
];

const missingEnv = REQUIRED_ENV.filter((v) => !process.env[v.name]?.trim());
if (missingEnv.length > 0) {
  console.error("\n========================================================");
  console.error("  STARTUP FAILED: missing required environment variables");
  console.error("========================================================");
  for (const v of missingEnv) {
    console.error(`\n  ${v.name} is not set.`);
    console.error(`    → ${v.hint}`);
  }
  console.error("\n  See SETUP.md for full setup instructions.\n");
  process.exit(1);
}

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Create all database tables on a fresh install BEFORE anything (session
  // store, startup migrations) touches the database. Idempotent on existing DBs.
  const { ensureSchema } = await import("./bootstrapSchema");
  await ensureSchema();

  const { setupAuth, registerAuthRoutes } = await import("./auth");
  await setupAuth(app);
  registerAuthRoutes(app);

  const { registerRoutes } = await import("./routes");
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
