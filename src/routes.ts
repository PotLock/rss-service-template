import { Context } from "hono";
import { v4 as uuidv4 } from "uuid";
import { formatItems, generateFeed } from "./formatters.js";
import { addItem, getItems } from "./storage.js";
import { ApiFormat, RssItem } from "./types.js";
import { sanitize } from "./utils.js";

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
  let item: RssItem;
  try {
    item = await c.req.json<RssItem>();
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
  if (!item.content) {
    return c.json(
      {
        error: "Missing required field: content",
        message: "The content field is required for RSS items",
      },
      400,
    );
  }

  if (!item.link) {
    return c.json(
      {
        error: "Missing required field: link",
        message: "The link field is required for RSS items",
      },
      400,
    );
  }

  // Ensure required fields have values
  const completeItem: RssItem = {
    ...item,
    id: item.id || uuidv4(),
    guid: item.guid || uuidv4(),

    title: sanitize(item.title),
    description: sanitize(item.description || ""),
    content: sanitize(item.content),

    published: item.published ? new Date(item.published) : new Date(),
    date: item.date ? new Date(item.date) : new Date(),
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
