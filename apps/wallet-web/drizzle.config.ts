import { defineConfig } from "drizzle-kit";

const connectionString =
  process.env.WALLET_WEB_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "WALLET_WEB_DATABASE_URL or DATABASE_URL must be set before running drizzle-kit commands."
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/drizzle",
  dbCredentials: {
    url: connectionString,
  },
  strict: true,
  verbose: true,
});
