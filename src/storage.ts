import { DEFAULT_FEED_ID, getFeedConfig, setFeedConfig } from "./config.js";
import { FeedConfig, RssItem } from "./types.js";

// Initialize Redis client based on environment
let redis: any;

// Determine which Redis client to use
const initializeRedis = async () => {
  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    // Use Upstash Redis in production
    const { Redis } = await import("@upstash/redis");
    return new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } else if (process.env.USE_REDIS_MOCK === "true") {
    console.log("Using in-memory Redis mock");

    // In-memory storage for mock Redis
    const inMemoryStorage: Record<string, any> = {};

    // Enhanced mock implementation with debugging
    const mockRedis = {
      async lrange(key: string, start: number, end: number) {
        console.log(`[MOCK REDIS] lrange: ${key}, ${start}, ${end}`);
        if (!inMemoryStorage[key]) {
          console.log(
            `[MOCK REDIS] Key not found: ${key}, returning empty array`,
          );
          return [];
        }
        const result = inMemoryStorage[key].slice(
          start,
          end === -1 ? undefined : end + 1,
        );
        console.log(`[MOCK REDIS] lrange result: ${result.length} items`);
        return result;
      },

      async lpush(key: string, value: string) {
        console.log(`[MOCK REDIS] lpush: ${key}, ${value.substring(0, 50)}...`);
        if (!inMemoryStorage[key]) {
          inMemoryStorage[key] = [];
        }
        inMemoryStorage[key].unshift(value);
        console.log(
          `[MOCK REDIS] New length after lpush: ${inMemoryStorage[key].length}`,
        );
        return inMemoryStorage[key].length;
      },

      async ltrim(key: string, start: number, end: number) {
        console.log(`[MOCK REDIS] ltrim: ${key}, ${start}, ${end}`);
        if (!inMemoryStorage[key]) {
          return "OK";
        }

        // Handle NaN or invalid end values
        let endIndex = end;
        if (isNaN(endIndex) || endIndex < 0) {
          console.log(
            `[MOCK REDIS] Invalid end index: ${end}, using -1 (keep all items)`,
          );
          endIndex = -1;
        }

        inMemoryStorage[key] = inMemoryStorage[key].slice(
          start,
          endIndex === -1 ? undefined : endIndex + 1,
        );

        console.log(
          `[MOCK REDIS] New length after ltrim: ${inMemoryStorage[key].length}`,
        );
        return "OK";
      },

      async exists(key: string) {
        console.log(`[MOCK REDIS] exists: ${key}`);
        const exists = !!inMemoryStorage[key];
        console.log(`[MOCK REDIS] Key ${key} exists: ${exists}`);
        return exists ? 1 : 0;
      },

      async set(key: string, value: string) {
        console.log(`[MOCK REDIS] set: ${key}, ${value.substring(0, 50)}...`);
        inMemoryStorage[key] = value;
        return "OK";
      },

      // Helper method to inspect the current state (not part of Redis API)
      getStorageState() {
        return Object.keys(inMemoryStorage).reduce(
          (acc, key) => {
            if (Array.isArray(inMemoryStorage[key])) {
              // For arrays, return the actual array contents
              acc[key] = inMemoryStorage[key];
            } else {
              acc[key] =
                typeof inMemoryStorage[key] === "string"
                  ? inMemoryStorage[key]
                  : inMemoryStorage[key];
            }
            return acc;
          },
          {} as Record<string, any>,
        );
      },
    };

    return mockRedis;
  } else {
    // Use IoRedis for Docker/Railway environment
    console.log("Using IoRedis for Docker/Railway environment");
    const { default: Redis } = await import("ioredis");

    try {
      // Railway provides REDIS_URL when services are linked
      if (process.env.REDIS_URL) {
        console.log("Connecting to Redis using REDIS_URL");
        // @ts-ignore
        return new Redis(process.env.REDIS_URL, {
          family: 0, // Enable dual stack lookup (IPv4 and IPv6)
          maxRetriesPerRequest: 5,
          retryStrategy(times) {
            const delay = Math.min(times * 100, 3000);
            return delay;
          },
        });
      }

      // For Docker Compose environments
      if (process.env.REDIS_HOST) {
        const host = process.env.REDIS_HOST;
        const port = parseInt(process.env.REDIS_PORT || "6379");
        console.log(`Connecting to Redis at ${host}:${port}`);

        // @ts-ignore
        return new Redis({
          host,
          port,
          family: 0, // Enable dual stack lookup (IPv4 and IPv6)
          maxRetriesPerRequest: 5,
          retryStrategy(times) {
            const delay = Math.min(times * 100, 3000);
            return delay;
          },
        });
      }

      // Last resort fallback - not recommended for production
      console.warn(
        "No Redis configuration found, falling back to localhost (not recommended for production)",
      );
      // @ts-ignore
      return new Redis({
        host: "localhost",
        port: 6379,
        family: 0, // Enable dual stack lookup (IPv4 and IPv6)
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });
    } catch (error) {
      console.error("Failed to connect to Redis:", error);
      throw error;
    }
  }
};

// Initialize Redis client
redis = await initializeRedis();

// Export the redis client for use in other modules
export { redis };

/**
 * Get all items from the feed
 */
export async function getItems(): Promise<string[]> {
  const itemsKey = `feed:${DEFAULT_FEED_ID}:items`;
  const config = getFeedConfig();

  // Log the current storage state when in development mode
  if (process.env.USE_REDIS_MOCK === "true" && redis.getStorageState) {
    console.log("[MOCK REDIS] Current storage state:");
    const storageState = redis.getStorageState();
    console.log(JSON.stringify(storageState, null, 2));

    // If we have items in the storage, return them directly
    if (storageState[itemsKey] && Array.isArray(storageState[itemsKey])) {
      console.log(
        `[MOCK REDIS] Returning ${storageState[itemsKey].length} items directly from storage`,
      );
      return storageState[itemsKey];
    }
  }

  // If not using mock or no items in storage, use standard Redis API
  return await redis.lrange(itemsKey, 0, config.maxItems - 1);
}

/**
 * Add an item to the feed
 */
export async function addItem(item: RssItem): Promise<void> {
  console.log("pushing item");
  const config = getFeedConfig();

  // Add item to feed's items list
  await redis.lpush(`feed:${DEFAULT_FEED_ID}:items`, JSON.stringify(item));

  // Trim to max items
  await redis.ltrim(`feed:${DEFAULT_FEED_ID}:items`, 0, config.maxItems - 1);
}

/**
 * Initialize feed in Redis if it doesn't exist
 */
export async function initializeFeed(): Promise<void> {
  const exists = await redis.exists(`feed:${DEFAULT_FEED_ID}`);
  if (!exists) {
    console.log(`Initializing feed: ${DEFAULT_FEED_ID}`);
    await redis.set(
      `feed:${DEFAULT_FEED_ID}`,
      JSON.stringify({
        feedConfig: getFeedConfig(),
      }),
    );
  } else {
    // Load existing configuration from Redis
    try {
      const feedData = await redis.get(`feed:${DEFAULT_FEED_ID}`);
      if (feedData) {
        try {
          const parsedData = JSON.parse(feedData);
          if (parsedData?.feedConfig) {
            setFeedConfig(parsedData.feedConfig);
            console.log("Loaded feed configuration from Redis");
          } else {
            console.warn(
              "Invalid feed configuration format in Redis, using default",
            );
          }
        } catch (parseError) {
          console.warn(
            "Error parsing feed configuration from Redis:",
            parseError,
          );
          console.warn("Using default configuration instead");
        }
      }
    } catch (error) {
      console.warn("Error loading feed configuration from Redis:", error);
    }
  }
}

/**
 * Save feed configuration to Redis
 */
export async function saveFeedConfig(config: FeedConfig): Promise<void> {
  try {
    // Update the feed configuration in Redis
    const exists = await redis.exists(`feed:${DEFAULT_FEED_ID}`);
    if (exists) {
      try {
        // Get existing data
        const feedData = await redis.get(`feed:${DEFAULT_FEED_ID}`);
        let parsedData;

        try {
          parsedData = JSON.parse(feedData);
        } catch (parseError) {
          console.warn(
            "Error parsing existing feed data, creating new data structure",
          );
          parsedData = {};
        }

        // Update the configuration
        parsedData.feedConfig = config;

        // Save back to Redis
        await redis.set(`feed:${DEFAULT_FEED_ID}`, JSON.stringify(parsedData));
      } catch (redisError) {
        // If there's an error with the existing data, create a new entry
        console.warn(
          "Error with existing Redis data, creating new entry:",
          redisError,
        );
        await redis.set(
          `feed:${DEFAULT_FEED_ID}`,
          JSON.stringify({
            feedConfig: config,
          }),
        );
      }
    } else {
      // Create new feed entry
      await redis.set(
        `feed:${DEFAULT_FEED_ID}`,
        JSON.stringify({
          feedConfig: config,
        }),
      );
    }

    console.log("Saved feed configuration to Redis");
  } catch (error) {
    console.error("Error saving feed configuration to Redis:", error);
    throw new Error(`Failed to save feed configuration: ${error}`);
  }
}
