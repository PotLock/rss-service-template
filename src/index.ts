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
} from "./routes.js";
import { authenticate } from "./middleware.js";
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
app.get("/rss.xml", handleRss);
app.get("/atom.xml", handleAtom);
app.get("/feed.json", handleJsonFeed);
app.get("/raw.json", handleRawJson);
app.get("/api/items", handleGetItems);
app.post("/api/items", handleAddItem);

// Start server
async function startServer() {
  // Initialize feed
  await initializeFeed();

  // Start server if not in production (Vercel will handle this in prod)
  if (process.env.NODE_ENV !== "production") {
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
}

startServer().catch(console.error);

// Export the Hono app for serverless environments
export default app;
