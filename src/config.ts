import "dotenv/config";
import { FeedConfig } from "./types.js";

// Environment variables validation
const REQUIRED_ENV_VARS = ["API_SECRET"];

// Redis-specific environment variables
const UPSTASH_REDIS_ENV_VARS = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];

// Validate required environment variables
export function validateEnv(): void {
  // Always check for API_SECRET
  REQUIRED_ENV_VARS.forEach((varName) => {
    if (!process.env[varName]) {
      console.error(`Error: Environment variable ${varName} is required`);
      throw new Error(`Missing required environment variable: ${varName}`);
    }
  });

  // Check Redis configuration when not using mock or in Docker env
  if (
    process.env.CONTAINER_RUNTIME !== "true" &&
    process.env.USE_REDIS_MOCK !== "true"
  ) {
    // Check if we have either Upstash or local Redis configuration
    const hasUpstashConfig = UPSTASH_REDIS_ENV_VARS.every(
      (varName) => process.env[varName],
    );

    if (!hasUpstashConfig) {
      console.error(
        `Error: Upstash Redis (${UPSTASH_REDIS_ENV_VARS.join(", ")}) environment variables are required when not using Redis mock or in a Docker environment`,
      );
      throw new Error(`Missing required Redis configuration`);
    }
  }
}

// API Secret for authentication
export const API_SECRET = process.env.API_SECRET!;

// Optional allowed origins for CORS (comma-separated list)
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["*"];

// Default feed ID - since we're focusing on a single feed
export const DEFAULT_FEED_ID = "main";

// Default configuration
const DEFAULT_CONFIG: FeedConfig = {
  id: DEFAULT_FEED_ID,
  title: "Default RSS Feed",
  description: "A feed of curated content",
  siteUrl: "https://example.com",
  copyright: "test",
  language: "en",
  maxItems: 100,
  image: "https://example.com/logo.png",
  author: { name: "Feed Author", email: "author@example.com" },
};

let currentConfig: FeedConfig | null = null;

// Set feed configuration
export function setFeedConfig(config: FeedConfig): void {
  config.id = DEFAULT_FEED_ID;

  // Set default values for optional fields if not provided
  config.title = config.title || DEFAULT_CONFIG.title;
  config.description = config.description || DEFAULT_CONFIG.description;
  config.siteUrl = config.siteUrl || DEFAULT_CONFIG.siteUrl;

  // Ensure maxItems is always a positive number
  config.maxItems =
    typeof config.maxItems === "number" && config.maxItems > 0
      ? config.maxItems
      : DEFAULT_CONFIG.maxItems;

  config.language = config.language || DEFAULT_CONFIG.language;

  // Update the in-memory configuration
  currentConfig = config;
  console.log("Updated feed configuration");
}

// Get the current feed configuration
export const getFeedConfig = (): FeedConfig => {
  const config = currentConfig || DEFAULT_CONFIG;
  return JSON.parse(JSON.stringify(config)) as FeedConfig;
};
