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

// Memory cache for frequent requests to reduce Redis calls
// This cache is shared across all requests to the same server instance
const memCache = new Map<string, { count: number; expires: number }>();

/**
 * Rate limiting middleware for public endpoints
 * Uses Redis to track request counts across multiple instances
 * Optimized to use Redis pipeline for better performance
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
    let requests: number;
    let ttl: number;

    // Check memory cache first to avoid Redis calls for frequent requests
    const now = Date.now();
    const cached = memCache.get(key);

    if (cached && cached.expires > now) {
      // Use cached values if they haven't expired
      requests = cached.count + 1;
      ttl = Math.floor((cached.expires - now) / 1000);

      // Update the cache with incremented count
      memCache.set(key, {
        count: requests,
        expires: cached.expires,
      });
    } else {
      // Cache miss or expired, use Redis pipeline to batch commands for better performance
      // This reduces network roundtrips to Redis
      const pipeline = redis.pipeline();
      pipeline.incr(key);
      pipeline.ttl(key);

      const results = await pipeline.exec();

      if (!results || results.length < 2) {
        // If pipeline fails, allow the request to proceed
        console.error("Rate limiting pipeline error: Invalid results");
        await next();
        return undefined;
      }

      requests = results[0] as number;
      ttl = results[1] as number;

      // Set expiry on first request
      if (requests === 1 || ttl < 0) {
        await redis.expire(key, RATE_LIMIT.windowMs / 1000);
        ttl = RATE_LIMIT.windowMs / 1000;
      }

      // Update memory cache with values from Redis
      memCache.set(key, {
        count: requests,
        expires: now + ttl * 1000,
      });
    }

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
 * Security and caching headers middleware
 * Adds essential security and performance-related headers to responses
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

  // Add performance-related headers for GET requests to feed endpoints
  const path = c.req.path;
  if (
    c.req.method === "GET" &&
    (path.endsWith(".xml") || path.endsWith(".json") || path === "/")
  ) {
    // Only add Cache-Control if not already set by the route handler
    if (!c.res.headers.has("Cache-Control")) {
      // Public feeds can be cached by browsers and proxies
      c.header("Cache-Control", "public, max-age=600"); // 10 minutes
    }

    // Add Vary header to ensure proper caching based on these request headers
    c.header("Vary", "Accept, Accept-Encoding");

    // Add a default ETag if not already set
    if (!c.res.headers.has("ETag")) {
      // Generate a simple ETag based on the current time (not ideal but better than nothing)
      // In production, this should be based on content hash
      c.header("ETag", `"${Date.now().toString(36)}"`);
    }
  }

  return c.res;
}

/**
 * Request timeout middleware
 * Adds timeout protection for long-running requests
 * Optimized to avoid unnecessary Promise overhead
 */
export async function requestTimeout(
  c: Context,
  next: Next,
): Promise<Response | undefined> {
  const TIMEOUT = 30000; // 30 seconds

  // Use AbortController for more efficient timeout handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, TIMEOUT);

  try {
    // Store the signal in the context for downstream middleware
    c.set("abortSignal", controller.signal);

    // Execute the next middleware with timeout
    await next();

    // Clear the timeout if the request completes successfully
    clearTimeout(timeoutId);

    return c.res;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
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
