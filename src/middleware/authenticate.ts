import { Context, Next } from "hono";
import { API_SECRET } from "../config.js";

/**
 * Authentication middleware
 * Checks if the request has a valid API secret in the Authorization header
 */
export async function authenticate(
  c: Context,
  next: Next,
): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.json(
      {
        error: "Unauthorized: Missing Authorization header",
        message:
          "Please provide an API secret in the Authorization header using the format: Bearer <secret>",
      },
      401,
    );
  }

  if (!authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        error: "Unauthorized: Invalid Authorization format",
        message: "Authorization header must use the format: Bearer <secret>",
      },
      401,
    );
  }

  const secret = authHeader.substring(7);
  if (secret !== API_SECRET) {
    console.error("Authentication error: Invalid API secret");
    return c.json(
      {
        error: "Unauthorized: Invalid API secret",
        message: "The provided API secret is invalid",
      },
      401,
    );
  }

  return await next();
}
