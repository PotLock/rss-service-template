/**
 * Redis Mock Implementation
 *
 * This file provides a mock implementation of Redis for development and testing.
 * It implements the core Redis methods needed by the RSS service.
 */

// In-memory storage for mock Redis
const inMemoryStorage: Record<string, any> = {};

/**
 * Redis Mock Client
 * Implements the Redis methods used by the RSS service
 */
export class RedisMock {
  /**
   * Get a value from the mock Redis store
   */
  async get(key: string): Promise<string | null> {
    console.log(`[MOCK REDIS] get: ${key}`);
    const value = inMemoryStorage[key];

    if (value === undefined) {
      console.log(`[MOCK REDIS] Key not found: ${key}, returning null`);
      return null;
    }

    console.log(`[MOCK REDIS] Retrieved value for key: ${key}`);
    return value;
  }

  /**
   * Set a value in the mock Redis store
   */
  async set(key: string, value: string): Promise<string> {
    console.log(
      `[MOCK REDIS] set: ${key}, ${value.substring(0, 50)}${value.length > 50 ? "..." : ""}`,
    );
    inMemoryStorage[key] = value;
    return "OK";
  }

  /**
   * Check if a key exists in the mock Redis store
   */
  async exists(key: string): Promise<number> {
    console.log(`[MOCK REDIS] exists: ${key}`);
    const exists = inMemoryStorage[key] !== undefined;
    console.log(`[MOCK REDIS] Key ${key} exists: ${exists}`);
    return exists ? 1 : 0;
  }

  /**
   * Delete a key from the mock Redis store
   */
  async del(key: string): Promise<number> {
    console.log(`[MOCK REDIS] del: ${key}`);

    if (inMemoryStorage[key] === undefined) {
      return 0;
    }

    delete inMemoryStorage[key];
    return 1;
  }

  /**
   * Get a range of values from a list
   */
  async lrange(key: string, start: number, end: number): Promise<string[]> {
    console.log(`[MOCK REDIS] lrange: ${key}, ${start}, ${end}`);

    if (!inMemoryStorage[key] || !Array.isArray(inMemoryStorage[key])) {
      console.log(
        `[MOCK REDIS] Key not found or not an array: ${key}, returning empty array`,
      );
      return [];
    }

    const result = inMemoryStorage[key].slice(
      start,
      end === -1 ? undefined : end + 1,
    );

    console.log(`[MOCK REDIS] lrange result: ${result.length} items`);
    return result;
  }

  /**
   * Push a value to the beginning of a list
   */
  async lpush(key: string, value: string): Promise<number> {
    console.log(
      `[MOCK REDIS] lpush: ${key}, ${value.substring(0, 50)}${value.length > 50 ? "..." : ""}`,
    );

    if (!inMemoryStorage[key]) {
      inMemoryStorage[key] = [];
    } else if (!Array.isArray(inMemoryStorage[key])) {
      // Convert to array if it's not already
      inMemoryStorage[key] = [inMemoryStorage[key]];
    }

    inMemoryStorage[key].unshift(value);
    console.log(
      `[MOCK REDIS] New length after lpush: ${inMemoryStorage[key].length}`,
    );
    return inMemoryStorage[key].length;
  }

  /**
   * Trim a list to a specified range
   */
  async ltrim(key: string, start: number, end: number): Promise<string> {
    console.log(`[MOCK REDIS] ltrim: ${key}, ${start}, ${end}`);

    if (!inMemoryStorage[key] || !Array.isArray(inMemoryStorage[key])) {
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
  }

  /**
   * Increment a value
   * For rate limiting
   */
  async incr(key: string): Promise<number> {
    console.log(`[MOCK REDIS] incr: ${key}`);

    let value = inMemoryStorage[key];

    if (value === undefined) {
      // Key doesn't exist, initialize to 1
      inMemoryStorage[key] = "1";
      return 1;
    }

    if (typeof value === "string") {
      // Try to parse as number
      const num = parseInt(value, 10);
      if (!isNaN(num)) {
        inMemoryStorage[key] = (num + 1).toString();
        return num + 1;
      }
    }

    // If we can't parse as number, start from 1
    inMemoryStorage[key] = "1";
    return 1;
  }

  /**
   * Set an expiry time on a key
   * For rate limiting
   */
  async expire(key: string, seconds: number): Promise<number> {
    console.log(`[MOCK REDIS] expire: ${key}, ${seconds} seconds`);

    if (inMemoryStorage[key] === undefined) {
      return 0;
    }

    // Store expiry time in a separate key
    const expiryKey = `${key}:expiry`;
    const expiryTime = Date.now() + seconds * 1000;
    inMemoryStorage[expiryKey] = expiryTime.toString();

    // Set up automatic cleanup (this is a simplification)
    setTimeout(() => {
      if (inMemoryStorage[key] !== undefined) {
        console.log(`[MOCK REDIS] Auto-expiring key: ${key}`);
        delete inMemoryStorage[key];
        delete inMemoryStorage[expiryKey];
      }
    }, seconds * 1000);

    return 1;
  }

  /**
   * Get the time-to-live for a key
   * For rate limiting
   */
  async ttl(key: string): Promise<number> {
    console.log(`[MOCK REDIS] ttl: ${key}`);

    const expiryKey = `${key}:expiry`;
    const expiryTime = inMemoryStorage[expiryKey];

    if (expiryTime === undefined) {
      return -2; // Key does not exist or has no expiry
    }

    const ttl = Math.ceil((parseInt(expiryTime, 10) - Date.now()) / 1000);
    return ttl > 0 ? ttl : -1; // -1 means the key exists but has no expiry
  }

  /**
   * Ping the Redis server
   * For health checks
   */
  async ping(): Promise<string> {
    console.log(`[MOCK REDIS] ping`);
    return "PONG";
  }

  /**
   * Create a pipeline for batched operations
   * For rate limiting optimization
   */
  pipeline(): RedisMockPipeline {
    console.log(`[MOCK REDIS] Creating pipeline`);
    return new RedisMockPipeline(this);
  }

  /**
   * Helper method to inspect the current state (not part of Redis API)
   */
  getStorageState(): Record<string, any> {
    return Object.keys(inMemoryStorage).reduce(
      (acc, key) => {
        acc[key] = inMemoryStorage[key];
        return acc;
      },
      {} as Record<string, any>,
    );
  }
}

/**
 * Redis Mock Pipeline
 * Implements the Redis pipeline interface for batched operations
 */
class RedisMockPipeline {
  private commands: { method: string; args: any[] }[] = [];
  private redis: RedisMock;

  constructor(redis: RedisMock) {
    this.redis = redis;
  }

  /**
   * Add an incr command to the pipeline
   */
  incr(key: string): this {
    this.commands.push({ method: "incr", args: [key] });
    return this;
  }

  /**
   * Add a ttl command to the pipeline
   */
  ttl(key: string): this {
    this.commands.push({ method: "ttl", args: [key] });
    return this;
  }

  /**
   * Add an expire command to the pipeline
   */
  expire(key: string, seconds: number): this {
    this.commands.push({ method: "expire", args: [key, seconds] });
    return this;
  }

  /**
   * Execute all commands in the pipeline
   */
  async exec(): Promise<any[]> {
    console.log(
      `[MOCK REDIS] Executing pipeline with ${this.commands.length} commands`,
    );

    const results: any[] = [];

    for (const command of this.commands) {
      try {
        // @ts-ignore - We know these methods exist on the redis mock
        const result = await this.redis[command.method](...command.args);
        results.push(result);
      } catch (error) {
        console.error(`[MOCK REDIS] Pipeline command error:`, error);
        results.push(null);
      }
    }

    return results;
  }
}
