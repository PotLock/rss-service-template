import { Context } from "hono";
import { v4 as uuidv4 } from "uuid";
import { formatItems, generateFeed } from "./formatters.js";
import { getFeedConfig, setFeedConfig } from "./config.js";
import { addItem, getItems, saveFeedConfig } from "./storage.js";
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
 * Health check and redirect to preferred format
 */
export async function handleRoot(c: Context): Promise<Response> {
  return c.redirect(`/rss.xml`);
}

/**
 * Handle RSS format request
 */
export async function handleRss(): Promise<Response> {
  const { content, contentType } = generateFeed(await getItems(), "rss");
  return new Response(content, {
    headers: { "Content-Type": contentType },
  });
}

/**
 * Handle Atom format request
 */
export async function handleAtom(): Promise<Response> {
  const { content, contentType } = generateFeed(await getItems(), "atom");
  return new Response(content, {
    headers: { "Content-Type": contentType },
  });
}

/**
 * Handle JSON Feed format request (includes HTML)
 */
export async function handleJsonFeed(): Promise<Response> {
  const { content, contentType } = generateFeed(await getItems(), "json");
  return new Response(content, {
    headers: { "Content-Type": contentType },
  });
}

/**
 * Handle Raw JSON format request
 */
export async function handleRawJson(): Promise<Response> {
  const { content, contentType } = generateFeed(await getItems(), "raw");
  return new Response(content, {
    headers: { "Content-Type": contentType },
  });
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
