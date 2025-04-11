import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { validateEnv, ALLOWED_ORIGINS } from "./config.js";
import {
  handleRoot,
  handleRss,
  handleAtom,
  handleJsonFeed,
  handleRawJson,
  handleGetItems,
  handleAddItem,
  handleHealth,
  handleUpdateConfig,
  handleGetConfig,
} from "./routes.js";
import { authenticate } from "./middleware.js";
import {
  rateLimiter,
  securityHeaders,
  requestTimeout,
} from "./middleware/protection.js";
import { initializeFeed } from "./storage.js";

// Validate environment variables
try {
  validateEnv();
} catch (error) {
  console.error("Environment validation failed:", error);
  process.exit(1);
}

// Create Hono app
const app = new Hono();

// Add security headers to all responses
app.use("*", securityHeaders);

// Add request timeout protection
app.use("*", requestTimeout);

// Add rate limiting for public endpoints
app.use("*", rateLimiter);

// Global error handler
app.onError((err, c) => {
  console.error(`Error: ${err}`);
  return c.json({ error: err.message }, 500);
});

// Configure CORS with specific origins if provided
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

// Apply authentication middleware
app.use("/api/*", authenticate);

// Register routes
app.get("/", handleRoot);
app.get("/health", handleHealth);
app.get("/rss.xml", handleRss);
app.get("/atom.xml", handleAtom);
app.get("/feed.json", handleJsonFeed);
app.get("/raw.json", handleRawJson);
app.get("/api/items", handleGetItems);
app.post("/api/items", handleAddItem);
app.get("/api/config", handleGetConfig);
app.put("/api/config", handleUpdateConfig);

// Initialize feed
await initializeFeed();

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
  console.log(`Available formats:`);
  console.log(`- RSS 2.0: http://localhost:${port}/rss.xml`);
  console.log(`- Atom: http://localhost:${port}/atom.xml`);
  console.log(`- JSON Feed: http://localhost:${port}/feed.json`);
  console.log(`- Raw JSON: http://localhost:${port}/raw.json`);
  console.log(`- API: http://localhost:${port}/api/items`);
}

// Export for serverless platforms (Netlify, etc)
export default app;
