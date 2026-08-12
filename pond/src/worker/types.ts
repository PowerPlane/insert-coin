export interface Env {
  DB: D1Database;
  /** HMAC key for session cookies and visitor hashes. `wrangler secret put`. */
  SESSION_SECRET: string;
  /** Admin password. The secret path is obscurity; this is the actual auth. */
  ADMIN_PASSWORD: string;
  /** Static client assets. */
  ASSETS: Fetcher;
}

/** What the public pond endpoint returns. Note what is NOT here. */
export interface PublicDuck {
  id: string;
  fortune: number;
  tint: number;
  stickers: { id: string; x: number; y: number }[];
  paint: string;
  name: string;
  message: string;
  created: number;
  waves: number;
  rescues: number;
  burning: boolean;
  say: { text: string; at: number } | null;
}
