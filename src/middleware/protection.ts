import { Redis } from "@upstash/redis";
import { Context, Next } from "hono";

// Initialize Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Rate limit configuration
const RATE_LIMIT = {
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // limit each IP to 100 requests per windowMs
};

/**
 * Rate limiting middleware for public endpoints
 * Uses Redis to track request counts across multiple instances
 */
export async function rateLimiter(
  c: Context,
  next: Next,
): Promise<Response | undefined> {
  // Skip rate limiting for non-GET requests (they're protected by API key)
  if (c.req.method !== "GET") {
    await next();
    return undefined;
  }

  // Note: Verify x-forwarded-for header handling matches your deployment environment
  // Different proxy setups may require adjusting how this header is processed
  const ip = c.req.header("x-forwarded-for") || "unknown";
  const key = `ratelimit:${ip}`;

  try {
    // Get current request count
    const requests = await redis.incr(key);

    // Set expiry on first request
    if (requests === 1) {
      await redis.expire(key, RATE_LIMIT.windowMs / 1000);
    }

    // Get TTL for headers
    const ttl = await redis.ttl(key);

    // Set rate limit headers
    c.header("X-RateLimit-Limit", RATE_LIMIT.max.toString());
    c.header(
      "X-RateLimit-Remaining",
      Math.max(0, RATE_LIMIT.max - requests).toString(),
    );
    c.header("X-RateLimit-Reset", (Date.now() + ttl * 1000).toString());

    // Check if rate limit exceeded
    if (requests > RATE_LIMIT.max) {
      return c.json(
        {
          error: "Too Many Requests",
          message: "Rate limit exceeded. Please try again later.",
        },
        429,
      );
    }

    await next();
    return undefined;
  } catch (error) {
    console.error("Rate limiting error:", error);
    // Continue on error to avoid blocking requests
    await next();
    return undefined;
  }
}

/**
 * Security headers middleware
 * Adds essential security headers to responses
 */
export async function securityHeaders(
  c: Context,
  next: Next,
): Promise<Response | undefined> {
  // Wait for response to be generated
  await next();

  // Add security headers
  // Ensure browsers respect our content types (important for XML/JSON feeds)
  c.header("X-Content-Type-Options", "nosniff");
  // Enforce HTTPS for secure feed access
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  return c.res;
}

/**
 * Request timeout middleware
 * Adds timeout protection for long-running requests
 */
export async function requestTimeout(
  c: Context,
  next: Next,
): Promise<Response | undefined> {
  const TIMEOUT = 30000; // 30 seconds

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error("Request timeout"));
    }, TIMEOUT);
  });

  try {
    await Promise.race([next(), timeoutPromise]);
    return c.res;
  } catch (error) {
    if (error instanceof Error && error.message === "Request timeout") {
      return c.json(
        {
          error: "Request Timeout",
          message: "The request took too long to process.",
        },
        408,
      );
    }
    throw error;
  }
}
