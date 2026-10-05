import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// ENV_FILE=.env.neon points drizzle-kit at production (Neon) instead of the local PGlite.
config({ path: process.env.ENV_FILE ?? ".env.local" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
