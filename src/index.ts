import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cache } from "hono/cache";
import { cors } from "hono/cors";
import { etag } from "hono/etag";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { ALLOWED_ORIGINS, validateEnv } from "./config.js";
import { authenticate } from "./middleware/authenticate.js";
import { rateLimiter } from "./middleware/rate-limit.js";
import {
  handleAddItem,
  handleAtom,
  handleCreateFeed,
  handleGetConfig,
  handleGetItems,
  handleHealth,
  handleJsonFeed,
  handleListFeeds,
  handleRawJson,
  handleRss,
  handleUpdateConfig,
} from "./routes.js";

try {
  validateEnv();
} catch (error) {
  console.error("Environment validation failed:", error);
  process.exit(1);
}

const app = new Hono();

// Global middleware
app.use("*", timeout(30000)); // 30 second timeout
app.use(
  "*",
  secureHeaders({
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
  }),
);

// Global error handler
app.onError((err, c) => {
  console.error(`Error: ${err}`);
  return c.json({ error: err.message }, 500);
});

app.use(
  "*",
  cors({
    origin: ALLOWED_ORIGINS.includes("*") ? "*" : ALLOWED_ORIGINS,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    exposeHeaders: ["Content-Length", "X-RSS-Service-Version"],
    maxAge: 86400,
  }),
);

// Public routes (no authentication required)
const publicRoutes = new Hono();
publicRoutes.use("*", rateLimiter);

publicRoutes.get("/", handleHealth);
publicRoutes.get("/health", handleHealth);
publicRoutes.get("/api/feeds", handleListFeeds);

// Feed format routes with caching and ETags
const feedRoutes = new Hono();
feedRoutes.use("*", etag());
feedRoutes.use(
  "*",
  cache({
    cacheName: "rss-feeds",
    cacheControl: "public, max-age=600", // 10 minutes
    vary: ["Accept", "Accept-Encoding"],
  }),
);
feedRoutes.get("/:feedId/rss.xml", handleRss);
feedRoutes.get("/:feedId/atom.xml", handleAtom);
feedRoutes.get("/:feedId/feed.json", handleJsonFeed);
feedRoutes.get("/:feedId/raw.json", handleRawJson);

// Protected API routes (authentication required)
const protectedRoutes = new Hono();
protectedRoutes.use("*", authenticate);
protectedRoutes.post("/api/feeds", handleCreateFeed);
protectedRoutes.get("/api/feeds/:feedId/config", handleGetConfig);
protectedRoutes.put("/api/feeds/:feedId/config", handleUpdateConfig);
protectedRoutes.get("/api/feeds/:feedId/items", handleGetItems);
protectedRoutes.post("/api/feeds/:feedId/items", handleAddItem);

app.route("/", publicRoutes);
app.route("/", feedRoutes);
app.route("/", protectedRoutes);

// For local development and container-based deployments (e.g. Railway via Docker)
if (
  process.env.NODE_ENV !== "production" ||
  process.env.CONTAINER_RUNTIME === "true"
) {
  const DEFAULT_PORT = 4001;
  const port = process.env.PORT ? parseInt(process.env.PORT) : DEFAULT_PORT;
  serve({
    fetch: app.fetch,
    port,
  });
  console.log(`RSS Service running at http://localhost:${port}`);
  console.log(`Multi-feed RSS service with the following endpoints:`);
  console.log(`- List feeds: http://localhost:${port}/api/feeds`);
  console.log(`- Create feed: POST http://localhost:${port}/api/feeds`);
  console.log(`- Feed formats: http://localhost:${port}/{feedId}/{format}`);
  console.log(`  - RSS 2.0: /{feedId}/rss.xml`);
  console.log(`  - Atom: /{feedId}/atom.xml`);
  console.log(`  - JSON Feed: /{feedId}/feed.json`);
  console.log(`  - Raw JSON: /{feedId}/raw.json`);
  console.log(`- Feed API: http://localhost:${port}/api/feeds/{feedId}/items`);
}

export default app;
