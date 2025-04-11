import { Context } from "hono";
import { v4 as uuidv4 } from "uuid";
import { formatItems, generateFeed } from "./formatters.js";
import { getFeedConfig, setFeedConfig } from "./config.js";
import { addItem, getItems, saveFeedConfig } from "./storage.js";
import { ApiFormat, FeedConfig, RssItem } from "./types.js";
import { sanitize } from "./utils.js";
import {
  cacheFeed,
  getCachedFeed,
  invalidateCache,
  isCacheValid,
} from "./cache.js";

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
 * Health check and redirect to preferred format
 */
export async function handleRoot(c: Context): Promise<Response> {
  return c.redirect(`/rss.xml`);
}

/**
 * Handle RSS format request
 */
export async function handleRss(c: Context): Promise<Response> {
  return await handleFeedRequest(c, "rss");
}

/**
 * Handle Atom format request
 */
export async function handleAtom(c: Context): Promise<Response> {
  return await handleFeedRequest(c, "atom");
}

/**
 * Handle JSON Feed format request (includes HTML)
 */
export async function handleJsonFeed(c: Context): Promise<Response> {
  return await handleFeedRequest(c, "json");
}

/**
 * Handle Raw JSON format request
 */
export async function handleRawJson(c: Context): Promise<Response> {
  return await handleFeedRequest(c, "raw");
}

/**
 * Common handler for all feed format requests with caching
 */
async function handleFeedRequest(
  c: Context,
  format: "rss" | "atom" | "json" | "raw",
): Promise<Response> {
  try {
    // Check if we have a cached version
    const cached = await getCachedFeed(format);

    if (cached) {
      // Check if client cache is still valid
      if (isCacheValid(c.req.raw.headers, cached.metadata)) {
        return new Response(null, {
          status: 304,
          headers: {
            ETag: cached.metadata.etag,
            "Last-Modified": cached.metadata.lastModified,
            "Cache-Control": "public, max-age=600", // 10 minutes
          },
        });
      }

      // Return cached content with cache headers
      return new Response(cached.content, {
        headers: {
          "Content-Type": getContentType(format),
          ETag: cached.metadata.etag,
          "Last-Modified": cached.metadata.lastModified,
          "Cache-Control": "public, max-age=600", // 10 minutes
        },
      });
    }

    // Generate fresh content
    const { content, contentType } = generateFeed(await getItems(), format);

    // Cache the generated content
    const metadata = await cacheFeed(format, content);

    // Return fresh content with cache headers
    return new Response(content, {
      headers: {
        "Content-Type": contentType,
        ETag: metadata.etag,
        "Last-Modified": metadata.lastModified,
        "Cache-Control": "public, max-age=600", // 10 minutes
      },
    });
  } catch (error) {
    console.error(`Error generating ${format} feed:`, error);
    return new Response(
      JSON.stringify({
        error: "Feed Generation Error",
        message: `Failed to generate ${format} feed: ${error}`,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

/**
 * Get content type for a feed format
 */
function getContentType(format: "rss" | "atom" | "json" | "raw"): string {
  switch (format) {
    case "atom":
      return "application/atom+xml; charset=utf-8";
    case "json":
    case "raw":
      return "application/json; charset=utf-8";
    default:
      return "application/rss+xml; charset=utf-8";
  }
}

/**
 * Update feed configuration
 */
export async function handleUpdateConfig(c: Context): Promise<Response> {
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
    // Update the configuration
    setFeedConfig(inputConfig as FeedConfig);

    // Save to Redis
    await saveFeedConfig(getFeedConfig());

    // Invalidate all feed caches when configuration changes
    await invalidateCache();

    return c.json({
      message: "Feed configuration updated successfully",
      config: getFeedConfig(),
    });
  } catch (error) {
    console.error("Failed to update feed configuration:", error);
    return c.json(
      {
        error: "Configuration Error",
        message: `Failed to update feed configuration: ${error}`,
      },
      500,
    );
  }
}

/**
 * Get current feed configuration
 */
export async function handleGetConfig(c: Context): Promise<Response> {
  return c.json(getFeedConfig());
}

/**
 * Get all items with format options
 */
export async function handleGetItems(c: Context): Promise<Response> {
  const format = c.req.query("format") || "raw";
  const items = await getItems();

  // Validate format is a valid ApiFormat
  if (format === "raw" || format === "html") {
    const formattedItems = formatItems(items, format as ApiFormat);
    return c.json(formattedItems);
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
}

/**
 * Add item to feed
 */
export async function handleAddItem(c: Context): Promise<Response> {
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
    published: inputItem.published ? new Date(inputItem.published) : new Date(),
    date: inputItem.date ? new Date(inputItem.date) : new Date(),

    // Optional fields
    ...(author && { author }),
    ...(category && { category }),

    // Media fields
    ...(inputItem.image && {
      image:
        typeof inputItem.image === "string" ? inputItem.image : inputItem.image,
    }),
    ...(inputItem.audio && {
      audio:
        typeof inputItem.audio === "string" ? inputItem.audio : inputItem.audio,
    }),
    ...(inputItem.video && {
      video:
        typeof inputItem.video === "string" ? inputItem.video : inputItem.video,
    }),
    ...(inputItem.enclosure && { enclosure: inputItem.enclosure }),

    // Additional metadata
    ...(inputItem.source && { source: inputItem.source }),
    ...(inputItem.isPermaLink !== undefined && {
      isPermaLink: inputItem.isPermaLink,
    }),
    ...(inputItem.copyright && { copyright: inputItem.copyright }),
  };

  // Add item to feed's items list
  try {
    await addItem(completeItem);

    // Invalidate all feed caches when a new item is added
    await invalidateCache();

    return c.json({
      message: "Item added successfully",
      item: completeItem,
    });
  } catch (error) {
    console.error("Failed to add item:", error);
    return c.json(
      {
        error: "Storage Error",
        message: "Failed to store the item. Please try again later.",
      },
      500,
    );
  }
}
