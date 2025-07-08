import "dotenv/config";

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
