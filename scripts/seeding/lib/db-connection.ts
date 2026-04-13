/**
 * SST Resource.Db connection factory.
 *
 * Must be run inside `sst shell` to have Resource available.
 */
import postgres, { Sql } from 'postgres';
import { Resource } from 'sst';

function getDbCredentials() {
  const db = (Resource as any).Db;
  return {
    host: db.host as string,
    port: db.port as number,
    username: db.username as string,
    password: db.password as string,
  };
}

export function buildDatabaseUrl(dbName: string): string {
  const { username, password, host, port } = getDbCredentials();
  return `postgresql://${username}:${password}@${host}:${port}/${dbName}`;
}

/** Connect to the default `postgres` database for admin operations (CREATE DATABASE, etc.) */
export function createAdminConnection(): Sql {
  const { host, port, username, password } = getDbCredentials();
  return postgres({ host, port, user: username, password, database: 'postgres' });
}
