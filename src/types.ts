import { FeedOptions, Item } from "feed";

// Format types supported by the service
export type FeedFormat = "rss" | "atom" | "json" | "raw";
export type ApiFormat = "raw" | "html";

// Use the Item interface directly from the feed package
export type RssItem = Item;

// Extend FeedOptions from the feed package, adding our custom fields
export interface FeedConfig extends FeedOptions {
  siteUrl: string;
  maxItems: number;
}
