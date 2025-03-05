import sanitizeHtml from "sanitize-html";
import { parse } from "node-html-parser";

/**
 * Strip HTML tags from a string using node-html-parser for robust HTML parsing
 */
export function stripHtml(html: string): string {
  if (!html) return "";
  const root = parse(html);
  return root.textContent || "";
}

/**
 * Sanitize HTML content to prevent XSS attacks
 */
export function sanitize(content: string): string {
  return sanitizeHtml(content, {
    allowedTags: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "p",
      "a",
      "ul",
      "ol",
      "nl",
      "li",
      "b",
      "i",
      "strong",
      "em",
      "strike",
      "code",
      "hr",
      "br",
      "div",
      "table",
      "thead",
      "caption",
      "tbody",
      "tr",
      "th",
      "td",
      "pre",
      "img",
    ],
    allowedAttributes: {
      a: ["href", "name", "target"],
      img: ["src", "alt", "title", "width", "height"],
      "*": ["class", "id"],
    },
    selfClosing: ["img", "br", "hr"],
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {},
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: true,
  });
}
