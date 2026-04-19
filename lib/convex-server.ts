import { ConvexHttpClient } from "convex/browser";

/**
 * Server-side Convex client singleton.
 * Used by webhook handlers and server actions to call Convex mutations.
 */
let _client: ConvexHttpClient | null = null;

export function getConvexClient(): ConvexHttpClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }

  _client = new ConvexHttpClient(url);
  return _client;
}
