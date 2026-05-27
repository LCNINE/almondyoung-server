/**
 * SST Resource.Db connection factory.
 *
 * Must be run inside `sst shell` to have Resource available.
 */
import postgres, { Sql } from 'postgres';
import { Resource } from 'sst';

/**
 * SST 리소스 이름은 배포마다 다름:
 *  - root / df → `Db`
 *  - lcnine-auth → `IdpDb` (deployments/lcnine/auth/infra/shared.ts)
 * `sst shell`이 주입하는 SST_RESOURCE_<name> env var로 자동 선택.
 */
const DB_RESOURCE_CANDIDATES = ['Db', 'IdpDb'] as const;

function getDbCredentials() {
  const r = Resource as any;
  const resourceName = DB_RESOURCE_CANDIDATES.find(
    (name) => process.env[`SST_RESOURCE_${name}`],
  );
  if (!resourceName) {
    throw new Error(
      `No DB resource found. Tried: ${DB_RESOURCE_CANDIDATES.join(', ')}. ` +
        `Ensure this is running inside 'sst shell' with a Postgres resource linked.`,
    );
  }
  const db = r[resourceName];
  return {
    host: db.host as string,
    port: db.port as number,
    username: db.username as string,
    password: db.password as string,
  };
}

export function buildDatabaseUrl(dbName: string): string {
  const { username, password, host, port } = getDbCredentials();
  return `postgresql://${username}:${password}@${host}:${port}/${dbName}?sslmode=require&uselibpqcompat=true`;
}

/** Connect to the default `postgres` database for admin operations (CREATE DATABASE, etc.) */
export function createAdminConnection(): Sql {
  const { host, port, username, password } = getDbCredentials();
  return postgres({ host, port, user: username, password, database: 'postgres' });
}
