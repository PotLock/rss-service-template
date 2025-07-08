import { Context } from "hono";
import { v4 as uuidv4 } from "uuid";
import { DuplicateItemError, FeedNotFoundError } from "./errors.js";
import { formatItems, generateFeed } from "./formatters.js";
import {
  addItem,
  createFeed,
  feedExists,
  getAllFeedIds,
  getFeedConfig,
  getItems,
  updateFeedConfig,
} from "./storage.js";
import { ApiFormat, FeedConfig, RssItem } from "./types.js";
import { sanitize } from "./utils.js";

/**
 * Health check endpoint
 */
export async function handleHealth(c: Context): Promise<Response> {
  return c.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "rss-service",
    },
    200,
  );
}

/**
 * List all available feeds
 */
export async function handleListFeeds(c: Context): Promise<Response> {
  try {
    const feedIds = await getAllFeedIds();
    const feeds: Array<{
      id: string;
      title: string;
      description: string;
      siteUrl: string;
      formats: {
        rss: string;
        atom: string;
        json: string;
        raw: string;
      };
    }> = [];

    for (const feedId of feedIds) {
      try {
        const config = await getFeedConfig(feedId);
        feeds.push({
          id: feedId,
          title: config.title,
          description: config.description || "",
          siteUrl: config.siteUrl,
          formats: {
            rss: `/${feedId}/rss.xml`,
            atom: `/${feedId}/atom.xml`,
            json: `/${feedId}/feed.json`,
            raw: `/${feedId}/raw.json`,
          },
        });
      } catch (error) {
        console.warn(`Error getting config for feed ${feedId}:`, error);
      }
    }

    return c.json({
      feeds,
      total: feeds.length,
    });
  } catch (error) {
    console.error("Error listing feeds:", error);
    return c.json(
      {
        error: "Server Error",
        message: "Failed to list feeds",
      },
      500,
    );
  }
}

/**
 * Create a new feed
 */
export async function handleCreateFeed(c: Context): Promise<Response> {
  let inputConfig: any;
  try {
    inputConfig = await c.req.json();
  } catch (error) {
    return c.json(
      {
        error: "Invalid JSON",
        message: "The request body must be valid JSON",
      },
      400,
    );
  }

  // Validate required fields
  if (!inputConfig.title) {
    return c.json(
      {
        error: "Missing required field: title",
        message: "Feed title is required",
      },
      400,
    );
  }

  if (!inputConfig.description) {
    return c.json(
      {
        error: "Missing required field: description",
        message: "Feed description is required",
      },
      400,
    );
  }

  if (!inputConfig.siteUrl) {
    return c.json(
      {
        error: "Missing required field: siteUrl",
        message: "Feed site URL is required",
      },
      400,
    );
  }

  if (!inputConfig.id || typeof inputConfig.id !== "string") {
    return c.json(
      {
        error: "Missing or invalid required field: id",
        message: "Feed id is required and must be a string",
      },
      400,
    );
  }

  try {
    // Create the feed configuration with defaults
    const feedConfig: FeedConfig = {
      id: inputConfig.id,
      title: inputConfig.title,
      description: inputConfig.description,
      siteUrl: inputConfig.siteUrl,
      language: inputConfig.language || "en",
      copyright: inputConfig.copyright || `© ${new Date().getFullYear()}`,
      maxItems:
        typeof inputConfig.maxItems === "number" && inputConfig.maxItems > 0
          ? inputConfig.maxItems
          : 100,
      image: inputConfig.image,
      favicon: inputConfig.favicon,
      author: inputConfig.author,
    };

    const feedId = await createFeed(feedConfig);

    return c.json(
      {
        message: "Feed created successfully",
        feedId,
        config: { ...feedConfig, id: feedId },
        formats: {
          rss: `/${feedId}/rss.xml`,
          atom: `/${feedId}/atom.xml`,
          json: `/${feedId}/feed.json`,
          raw: `/${feedId}/raw.json`,
        },
      },
      201,
    );
  } catch (error) {
    console.error("Failed to create feed:", error);
    return c.json(
      {
        error: "Feed Creation Error",
        message: `Failed to create feed: ${error}`,
      },
      500,
    );
  }
}

/**
 * Handle RSS format request for a specific feed
 */
export async function handleRss(c: Context): Promise<Response> {
  const feedId = c.req.param("feedId");
  if (!feedId) {
    return c.json({ error: "Feed ID is required" }, 400);
  }
  return await handleFeedRequest(c, feedId, "rss");
}

/**
 * Handle Atom format request for a specific feed
 */
export async function handleAtom(c: Context): Promise<Response> {
  const feedId = c.req.param("feedId");
  if (!feedId) {
    return c.json({ error: "Feed ID is required" }, 400);
  }
  return await handleFeedRequest(c, feedId, "atom");
}

/**
 * Handle JSON Feed format request for a specific feed
 */
export async function handleJsonFeed(c: Context): Promise<Response> {
  const feedId = c.req.param("feedId");
  if (!feedId) {
    return c.json({ error: "Feed ID is required" }, 400);
  }
  return await handleFeedRequest(c, feedId, "json");
}

/**
 * Handle Raw JSON format request for a specific feed
 */
export async function handleRawJson(c: Context): Promise<Response> {
  const feedId = c.req.param("feedId");
  if (!feedId) {
    return c.json({ error: "Feed ID is required" }, 400);
  }
  return await handleFeedRequest(c, feedId, "raw");
}

/**
 * Common handler for all feed format requests
 */
async function handleFeedRequest(
  c: Context,
  feedId: string,
  format: "rss" | "atom" | "json" | "raw",
): Promise<Response> {
  try {
    // Check if feed exists
    if (!(await feedExists(feedId))) {
      return c.json(
        {
          error: "Feed Not Found",
          message: `Feed with ID '${feedId}' does not exist`,
        },
        404,
      );
    }

    const items = await getItems(feedId);
    const feedConfig = await getFeedConfig(feedId);
    const { content, contentType } = generateFeed(items, feedConfig, format);

    return new Response(content, {
      headers: {
        "Content-Type": contentType,
      },
    });
  } catch (error) {
    console.error(`Error generating ${format} feed for ${feedId}:`, error);

    if (error instanceof FeedNotFoundError) {
      return c.json(
        {
          error: "Feed Not Found",
          message: error.message,
        },
        404,
      );
    }

    return c.json(
      {
        error: "Feed Generation Error",
        message: `Failed to generate ${format} feed: ${error}`,
      },
      500,
    );
  }
}

/**
 * Update feed configuration for a specific feed (upsert operation)
 * Creates the feed if it doesn't exist, updates if it does
 */
export async function handleUpdateConfig(c: Context): Promise<Response> {
  const feedId = c.req.param("feedId");
  if (!feedId) {
    return c.json({ error: "Feed ID is required" }, 400);
  }

  let inputConfig: any;
  try {
    inputConfig = await c.req.json();
  } catch (error) {
    return c.json(
      {
        error: "Invalid JSON",
        message: "The request body must be valid JSON",
      },
      400,
    );
  }

  try {
    const feedAlreadyExists = await feedExists(feedId);
    let updatedConfig: FeedConfig;

    if (feedAlreadyExists) {
      // Get current config and merge with updates
      const currentConfig = await getFeedConfig(feedId);
      updatedConfig = {
        ...currentConfig,
        ...inputConfig,
        id: feedId, // Ensure ID doesn't change
      };
    } else {
      // Create new config with provided data
      updatedConfig = {
        id: feedId,
        title: inputConfig.title || "Untitled Feed",
        description: inputConfig.description || "RSS Feed",
        siteUrl: inputConfig.siteUrl || "",
        language: inputConfig.language || "en",
        copyright: inputConfig.copyright || `© ${new Date().getFullYear()}`,
        maxItems:
          typeof inputConfig.maxItems === "number" && inputConfig.maxItems > 0
            ? inputConfig.maxItems
            : 100,
        image: inputConfig.image,
        favicon: inputConfig.favicon,
        author: inputConfig.author,
      };
    }

    // Validate required fields
    if (
      !updatedConfig.title ||
      !updatedConfig.description ||
      !updatedConfig.siteUrl
    ) {
      return c.json(
        {
          error: "Invalid Configuration",
          message: "title, description, and siteUrl are required fields",
        },
        400,
      );
    }

    // Ensure maxItems is valid
    if (
      typeof updatedConfig.maxItems !== "number" ||
      updatedConfig.maxItems <= 0
    ) {
      updatedConfig.maxItems = 100;
    }

    if (feedAlreadyExists) {
      // Update existing feed configuration
      await updateFeedConfig(feedId, updatedConfig);
    } else {
      // Create new feed with the specified feedId
      await createFeed(updatedConfig);
    }

    return c.json({
      message: feedAlreadyExists
        ? "Feed configuration updated successfully"
        : "Feed created successfully",
      feedId,
      config: updatedConfig,
      created: !feedAlreadyExists,
    });
  } catch (error) {
    console.error("Failed to update/create feed configuration:", error);

    if (error instanceof FeedNotFoundError) {
      return c.json(
        {
          error: "Feed Not Found",
          message: error.message,
        },
        404,
      );
    }

    return c.json(
      {
        error: "Configuration Error",
        message: `Failed to update/create feed configuration: ${error}`,
      },
      500,
    );
  }
}

/**
 * Get current feed configuration for a specific feed
 */
export async function handleGetConfig(c: Context): Promise<Response> {
  const feedId = c.req.param("feedId");
  if (!feedId) {
    return c.json({ error: "Feed ID is required" }, 400);
  }

  try {
    if (!(await feedExists(feedId))) {
      return c.json(
        {
          error: "Feed Not Found",
          message: `Feed with ID '${feedId}' does not exist`,
        },
        404,
      );
    }

    const config = await getFeedConfig(feedId);
    return c.json(config);
  } catch (error) {
    console.error("Failed to get feed configuration:", error);

    if (error instanceof FeedNotFoundError) {
      return c.json(
        {
          error: "Feed Not Found",
          message: error.message,
        },
        404,
      );
    }

    return c.json(
      {
        error: "Configuration Error",
        message: `Failed to get feed configuration: ${error}`,
      },
      500,
    );
  }
}

/**
 * Get all items from a specific feed with format options
 */
export async function handleGetItems(c: Context): Promise<Response> {
  const feedId = c.req.param("feedId");
  if (!feedId) {
    return c.json({ error: "Feed ID is required" }, 400);
  }
  const format = c.req.query("format") || "raw";

  try {
    if (!(await feedExists(feedId))) {
      return c.json(
        {
          error: "Feed Not Found",
          message: `Feed with ID '${feedId}' does not exist`,
        },
        404,
      );
    }

    const items = await getItems(feedId);

    // Validate format is a valid ApiFormat
    if (format === "raw" || format === "html") {
      const formattedItems = formatItems(items, format as ApiFormat);
      return c.json({
        feedId,
        items: formattedItems,
        total: formattedItems.length,
      });
    } else {
      // Invalid format
      return c.json(
        {
          error: `Invalid format: ${format}. Valid formats are: raw, html`,
          message:
            "Format determines how item content is returned: raw (HTML stripped) or html (HTML preserved)",
        },
        400,
      );
    }
  } catch (error) {
    console.error("Failed to get feed items:", error);

    if (error instanceof FeedNotFoundError) {
      return c.json(
        {
          error: "Feed Not Found",
          message: error.message,
        },
        404,
      );
    }

    return c.json(
      {
        error: "Server Error",
        message: `Failed to get feed items: ${error}`,
      },
      500,
    );
  }
}

/**
 * Add item to a specific feed
 */
export async function handleAddItem(c: Context): Promise<Response> {
  const feedId = c.req.param("feedId");
  if (!feedId) {
    return c.json({ error: "Feed ID is required" }, 400);
  }

  let inputItem: any;
  try {
    inputItem = await c.req.json();
  } catch (error) {
    return c.json(
      {
        error: "Invalid JSON",
        message: "The request body must be valid JSON",
      },
      400,
    );
  }

  try {
    // Check if feed exists
    if (!(await feedExists(feedId))) {
      return c.json(
        {
          error: "Feed Not Found",
          message: `Feed with ID '${feedId}' does not exist`,
        },
        404,
      );
    }

    // Map publishedAt to published if it exists
    if (inputItem.publishedAt && !inputItem.published) {
      inputItem.published = inputItem.publishedAt;
    }

    // Validate and provide defaults for required fields
    if (!inputItem.content && !inputItem.description) {
      return c.json(
        {
          error: "Missing required field: content or description",
          message:
            "Either content or description field is required for RSS items",
        },
        400,
      );
    }

    if (!inputItem.link) {
      return c.json(
        {
          error: "Missing required field: link",
          message: "The link field is required for RSS items",
        },
        400,
      );
    }

    // Handle categories conversion if needed
    let category;
    if (inputItem.categories) {
      if (Array.isArray(inputItem.categories)) {
        if (typeof inputItem.categories[0] === "string") {
          category = inputItem.categories.map((cat: string) => ({
            name: cat,
          }));
        } else {
          category = inputItem.categories;
        }
      } else if (typeof inputItem.categories === "string") {
        category = [{ name: inputItem.categories }];
      }
    }

    // Handle author conversion if needed
    let author;
    if (inputItem.author) {
      author = Array.isArray(inputItem.author)
        ? inputItem.author
        : [inputItem.author];
    }

    // Create a complete RssItem with all required fields and sanitized content
    const completeItem: RssItem = {
      // Core fields with defaults
      id: inputItem.id || uuidv4(),
      guid: inputItem.guid || inputItem.link || uuidv4(),
      title: sanitize(inputItem.title || "Untitled"),
      description: sanitize(inputItem.description || ""),
      content: sanitize(inputItem.content || inputItem.description || ""),
      link: inputItem.link,

      // Dates
      published: inputItem.published
        ? new Date(inputItem.published)
        : new Date(),
      date: inputItem.date ? new Date(inputItem.date) : new Date(),

      // Optional fields
      ...(author && { author }),
      ...(category && { category }),

      // Media fields
      ...(inputItem.image && {
        image:
          typeof inputItem.image === "string"
            ? inputItem.image
            : inputItem.image,
      }),
      ...(inputItem.audio && {
        audio:
          typeof inputItem.audio === "string"
            ? inputItem.audio
            : inputItem.audio,
      }),
      ...(inputItem.video && {
        video:
          typeof inputItem.video === "string"
            ? inputItem.video
            : inputItem.video,
      }),
      ...(inputItem.enclosure && { enclosure: inputItem.enclosure }),

      // Additional metadata
      ...(inputItem.source && { source: inputItem.source }),
      ...(inputItem.isPermaLink !== undefined && {
        isPermaLink: inputItem.isPermaLink,
      }),
      ...(inputItem.copyright && { copyright: inputItem.copyright }),
    };

    // Add item to feed
    await addItem(feedId, completeItem);

    return c.json({
      message: "Item added successfully",
      feedId,
      item: completeItem,
    });
  } catch (error) {
    console.error("Failed to add item:", error);

    if (error instanceof FeedNotFoundError) {
      return c.json(
        {
          error: "Feed Not Found",
          message: error.message,
        },
        404,
      );
    }

    if (error instanceof DuplicateItemError) {
      return c.json(
        {
          error: "Duplicate Item",
          message: error.message,
        },
        409,
      );
    }

    return c.json(
      {
        error: "Storage Error",
        message: "Failed to store the item. Please try again later.",
      },
      500,
    );
  }
}
