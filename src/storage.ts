import {
  DuplicateItemError,
  FeedNotFoundError,
  StorageError,
} from "./errors.js";
import { FeedConfig, RssItem } from "./types.js";

let redis: any;

const importRedisMock = async () => {
  const { RedisMock } = await import("./mock/redis.js");
  return new RedisMock();
};

const initializeRedis = async () => {
  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    // Option to use Upstash Redis
    try {
      const { Redis } = await import("@upstash/redis");
      return new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    } catch (error) {
      console.error("Failed to import @upstash/redis:", error);
      console.log("Falling back to Redis mock");
      return await importRedisMock();
    }
  } else if (process.env.USE_REDIS_MOCK === "true") {
    // Option to use Redis mock for local
    console.log("Using in-memory Redis mock");

    return await importRedisMock();
  } else {
    // Use IoRedis for Docker/Railway environment
    console.log("Using IoRedis for Docker/Railway environment");
    try {
      const { default: Redis } = await import("ioredis");

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

      // Last resort fallback...
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
      console.error("Failed to import ioredis:", error);
      console.log("Falling back to Redis mock");
      return await importRedisMock();
    }
  }
};

// Initialize Redis client
redis = await initializeRedis();

// Export the redis client for use in other modules
export { redis };

/**
 * Check if a feed exists
 */
export async function feedExists(feedId: string): Promise<boolean> {
  try {
    const exists = await redis.exists(`feed:${feedId}`);
    return exists === 1;
  } catch (error) {
    throw new StorageError(`Failed to check if feed exists: ${error}`);
  }
}

/**
 * Create a new feed with the given configuration
 * The feedId must be provided in config.id
 */
export async function createFeed(config: FeedConfig): Promise<string> {
  if (!config.id) {
    throw new StorageError("Feed ID is required when creating a feed");
  }

  const feedId = config.id;

  try {
    // Store the feed configuration
    await redis.set(
      `feed:${feedId}`,
      JSON.stringify({
        feedConfig: config,
        createdAt: new Date().toISOString(),
      }),
    );

    console.log(`Created new feed: ${feedId}`);
    return feedId;
  } catch (error) {
    throw new StorageError(`Failed to create feed: ${error}`);
  }
}

/**
 * Get feed configuration
 */
export async function getFeedConfig(feedId: string): Promise<FeedConfig> {
  try {
    const feedData = await redis.get(`feed:${feedId}`);

    if (!feedData) {
      throw new FeedNotFoundError(feedId);
    }

    const parsedData = JSON.parse(feedData);
    if (!parsedData?.feedConfig) {
      throw new StorageError(
        `Invalid feed configuration format for feed: ${feedId}`,
      );
    }

    return parsedData.feedConfig;
  } catch (error) {
    if (error instanceof FeedNotFoundError || error instanceof StorageError) {
      throw error;
    }
    throw new StorageError(`Failed to get feed configuration: ${error}`);
  }
}

/**
 * Update feed configuration
 */
export async function updateFeedConfig(
  feedId: string,
  config: FeedConfig,
): Promise<void> {
  try {
    if (!(await feedExists(feedId))) {
      throw new FeedNotFoundError(feedId);
    }

    // Get existing data to preserve metadata
    const existingData = await redis.get(`feed:${feedId}`);
    let parsedData = {};

    if (existingData) {
      try {
        parsedData = JSON.parse(existingData);
      } catch (parseError) {
        console.warn(
          `Error parsing existing feed data for ${feedId}, creating new structure`,
        );
      }
    }

    // Update the configuration while preserving other metadata
    const updatedData = {
      ...parsedData,
      feedConfig: { ...config, id: feedId },
      updatedAt: new Date().toISOString(),
    };

    await redis.set(`feed:${feedId}`, JSON.stringify(updatedData));
    console.log(`Updated feed configuration: ${feedId}`);
  } catch (error) {
    if (error instanceof FeedNotFoundError) {
      throw error;
    }
    throw new StorageError(`Failed to update feed configuration: ${error}`);
  }
}

/**
 * Get all items from a specific feed
 */
export async function getItems(feedId: string): Promise<string[]> {
  try {
    if (!(await feedExists(feedId))) {
      throw new FeedNotFoundError(feedId);
    }

    const config = await getFeedConfig(feedId);
    const itemsKey = `feed:${feedId}:items`;

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
  } catch (error) {
    if (error instanceof FeedNotFoundError) {
      throw error;
    }
    throw new StorageError(`Failed to get items: ${error}`);
  }
}

/**
 * Check if an item with the given GUID already exists in the feed
 */
export async function itemExists(
  feedId: string,
  guid: string,
): Promise<boolean> {
  try {
    if (!(await feedExists(feedId))) {
      throw new FeedNotFoundError(feedId);
    }

    const guidsKey = `feed:${feedId}:guids`;
    const exists = await redis.sismember(guidsKey, guid);
    return exists === 1;
  } catch (error) {
    if (error instanceof FeedNotFoundError) {
      throw error;
    }
    throw new StorageError(`Failed to check if item exists: ${error}`);
  }
}

/**
 * Add an item to a specific feed
 */
export async function addItem(feedId: string, item: RssItem): Promise<void> {
  try {
    if (!(await feedExists(feedId))) {
      throw new FeedNotFoundError(feedId);
    }

    // Check for duplicate GUID
    if (item.guid && (await itemExists(feedId, item.guid))) {
      throw new DuplicateItemError(item.guid);
    }

    const config = await getFeedConfig(feedId);
    const itemsKey = `feed:${feedId}:items`;
    const guidsKey = `feed:${feedId}:guids`;

    console.log(`Adding item to feed: ${feedId}`);

    // Add item to feed's items list
    await redis.lpush(itemsKey, JSON.stringify(item));

    // Add GUID to the set for duplicate checking
    if (item.guid) {
      await redis.sadd(guidsKey, item.guid);
    }

    // Trim to max items
    await redis.ltrim(itemsKey, 0, config.maxItems - 1);

    // Also trim the GUID set to match (this is approximate since we can't easily determine which GUIDs to remove)
    // For now, we'll let the GUID set grow and periodically clean it up
    const currentItemCount = await redis.llen(itemsKey);
    if (currentItemCount > config.maxItems) {
      // Get the items that will be removed
      const removedItems = await redis.lrange(itemsKey, config.maxItems, -1);
      for (const removedItemJson of removedItems) {
        try {
          const removedItem = JSON.parse(removedItemJson);
          if (removedItem.guid) {
            await redis.srem(guidsKey, removedItem.guid);
          }
        } catch (parseError) {
          console.warn(
            `Error parsing removed item for GUID cleanup: ${parseError}`,
          );
        }
      }
    }
  } catch (error) {
    if (
      error instanceof FeedNotFoundError ||
      error instanceof DuplicateItemError
    ) {
      throw error;
    }
    throw new StorageError(`Failed to add item: ${error}`);
  }
}

/**
 * Get a list of all feed IDs
 */
export async function getAllFeedIds(): Promise<string[]> {
  try {
    const pattern = "feed:*";
    const keys = await redis.keys(pattern);

    // Filter out keys that are not feed configurations (exclude :items and :guids keys)
    const feedIds = keys
      .filter(
        (key: string) => !key.includes(":items") && !key.includes(":guids"),
      )
      .map((key: string) => key.replace("feed:", ""));

    return feedIds;
  } catch (error) {
    throw new StorageError(`Failed to get feed IDs: ${error}`);
  }
}

/**
 * Delete a feed and all its items
 */
export async function deleteFeed(feedId: string): Promise<void> {
  try {
    if (!(await feedExists(feedId))) {
      throw new FeedNotFoundError(feedId);
    }

    // Delete all related keys
    await redis.del(`feed:${feedId}`);
    await redis.del(`feed:${feedId}:items`);
    await redis.del(`feed:${feedId}:guids`);

    console.log(`Deleted feed: ${feedId}`);
  } catch (error) {
    if (error instanceof FeedNotFoundError) {
      throw error;
    }
    throw new StorageError(`Failed to delete feed: ${error}`);
  }
}
