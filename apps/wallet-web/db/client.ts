import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./drizzle/schema";

const connectionString =
  process.env.WALLET_WEB_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "WALLET_WEB_DATABASE_URL or DATABASE_URL must be set for wallet-web DB access."
  );
}

const globalForDb = globalThis as unknown as {
  walletWebSqlClient?: ReturnType<typeof postgres>;
};

const sqlClient =
  globalForDb.walletWebSqlClient ??
  postgres(connectionString, {
    max: 5,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.walletWebSqlClient = sqlClient;
}

export const db = drizzle(sqlClient, { schema });
