import { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { redis } from "../storage.js";

// Rate limit configuration
const RATE_LIMIT = {
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // limit each IP to 100 requests per windowMs
};

// Memory cache for frequent requests to reduce Redis calls
const memCache = new Map<string, { count: number; expires: number }>();

const MAX_CACHE_SIZE = 10000; // Limit cache size

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memCache.entries()) {
    if (value.expires <= now) {
      memCache.delete(key);
    }
  }

  // If still too large, remove oldest entries
  if (memCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(memCache.entries()).sort(
      (a, b) => a[1].expires - b[1].expires,
    );
    const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
    toRemove.forEach(([key]) => memCache.delete(key));
  }
}, 60000); // Run every minute

/**
 * Rate limiting middleware for public endpoints
 */
export async function rateLimiter(c: Context, next: Next): Promise<void> {
  // Skip rate limiting for non-GET requests (they're protected by API key)
  if (c.req.method !== "GET") {
    await next();
    return;
  }

  // Get client IP - handle various proxy configurations
  const ip =
    c.req.header("cf-connecting-ip") || // Cloudflare
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || // Standard proxy
    c.req.header("x-real-ip") || // Nginx
    "unknown";

  const key = `ratelimit:${ip}`;

  try {
    let requests: number;
    let ttl: number;

    const now = Date.now();
    const cached = memCache.get(key);

    if (cached && cached.expires > now) {
      requests = cached.count + 1;
      ttl = Math.floor((cached.expires - now) / 1000);
      memCache.set(key, {
        count: requests,
        expires: cached.expires,
      });
    } else {
      const pipeline = redis.pipeline();
      pipeline.incr(key);
      pipeline.ttl(key);

      const results = await pipeline.exec();

      if (!results || results.length < 2) {
        console.error("Rate limiting pipeline error: Invalid results");
        await next();
        return;
      }

      requests = results[0] as number;
      ttl = results[1] as number;

      if (requests === 1 || ttl < 0) {
        await redis.expire(key, RATE_LIMIT.windowMs / 1000);
        ttl = RATE_LIMIT.windowMs / 1000;
      }

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

    if (requests > RATE_LIMIT.max) {
      throw new HTTPException(429, {
        message: "Rate limit exceeded. Please try again later.",
      });
    }

    await next();
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    console.error("Rate limiting error:", error);
    await next();
  }
}
