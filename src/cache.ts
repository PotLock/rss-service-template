import { redis } from "./storage.js";
import { FeedFormat } from "./types.js";

// Cache keys
const CACHE_PREFIX = "feed:cache:";
const CACHE_METADATA_PREFIX = "feed:cache:metadata:";

// Cache TTL in seconds (10 minutes by default)
const DEFAULT_CACHE_TTL = 10 * 60;

// Cache metadata interface
interface CacheMetadata {
  lastModified: string; // ISO date string
  etag: string;
}

/**
 * Get cached feed content
 */
export async function getCachedFeed(
  format: FeedFormat,
): Promise<{ content: string; metadata: CacheMetadata } | null> {
  try {
    // Get cached content
    const cacheKey = `${CACHE_PREFIX}${format}`;
    const content = await redis.get(cacheKey);

    if (!content) {
      return null;
    }

    // Get metadata
    const metadataKey = `${CACHE_METADATA_PREFIX}${format}`;
    const metadataStr = await redis.get(metadataKey);

    if (!metadataStr) {
      // If we have content but no metadata, return with default metadata
      return {
        content,
        metadata: {
          lastModified: new Date().toISOString(),
          etag: `"${Date.now().toString(36)}"`,
        },
      };
    }

    return {
      content,
      metadata: JSON.parse(metadataStr),
    };
  } catch (error) {
    console.error("Cache retrieval error:", error);
    return null;
  }
}

/**
 * Cache feed content with metadata
 */
export async function cacheFeed(
  format: FeedFormat,
  content: string,
  ttl: number = DEFAULT_CACHE_TTL,
): Promise<CacheMetadata> {
  try {
    const timestamp = Date.now();
    const etag = `"${timestamp.toString(36)}"`;
    const lastModified = new Date().toISOString();

    const metadata: CacheMetadata = {
      lastModified,
      etag,
    };

    // Cache the content
    const cacheKey = `${CACHE_PREFIX}${format}`;
    await redis.set(cacheKey, content);
    await redis.expire(cacheKey, ttl);

    // Cache the metadata
    const metadataKey = `${CACHE_METADATA_PREFIX}${format}`;
    await redis.set(metadataKey, JSON.stringify(metadata));
    await redis.expire(metadataKey, ttl);

    return metadata;
  } catch (error) {
    console.error("Cache storage error:", error);
    throw error;
  }
}

/**
 * Invalidate all feed caches
 */
export async function invalidateCache(): Promise<void> {
  try {
    const formats: FeedFormat[] = ["rss", "atom", "json", "raw"];

    for (const format of formats) {
      const cacheKey = `${CACHE_PREFIX}${format}`;
      const metadataKey = `${CACHE_METADATA_PREFIX}${format}`;

      await redis.del(cacheKey);
      await redis.del(metadataKey);
    }

    console.log("All feed caches invalidated");
  } catch (error) {
    console.error("Cache invalidation error:", error);
    throw error;
  }
}

/**
 * Check if a request can use a cached response based on conditional headers
 */
export function isCacheValid(
  requestHeaders: Headers,
  metadata: CacheMetadata,
): boolean {
  // Check If-None-Match header (ETag)
  const ifNoneMatch = requestHeaders.get("If-None-Match");
  if (ifNoneMatch && ifNoneMatch === metadata.etag) {
    return true;
  }

  // Check If-Modified-Since header
  const ifModifiedSince = requestHeaders.get("If-Modified-Since");
  if (ifModifiedSince) {
    const modifiedSinceDate = new Date(ifModifiedSince);
    const lastModifiedDate = new Date(metadata.lastModified);

    if (
      !isNaN(modifiedSinceDate.getTime()) &&
      !isNaN(lastModifiedDate.getTime()) &&
      lastModifiedDate <= modifiedSinceDate
    ) {
      return true;
    }
  }

  return false;
}
