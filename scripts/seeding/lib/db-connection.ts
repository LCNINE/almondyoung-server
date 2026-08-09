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

/**
 * **drizzle-kit 전용 URL 이다.** `uselibpqcompat` 은 libpq 쪽 파라미터라 `postgres.js` 에
 * 그대로 물리면 서버가 startup 파라미터로 받아 `unrecognized configuration parameter
 * "uselibpqcompat"` 으로 거부한다. postgres.js 로 붙을 거면 `createServiceConnection()` 을
 * 써라 — 같은 자격증명에서 클라이언트에 맞는 모양으로 만든다.
 */
export function buildDatabaseUrl(dbName: string): string {
  const { username, password, host, port } = getDbCredentials();
  return `postgresql://${username}:${password}@${host}:${port}/${dbName}?sslmode=require&uselibpqcompat=true`;
}

/**
 * 특정 논리 DB 에 `postgres.js` 로 붙는다.
 *
 * `buildDatabaseUrl` 의 postgres.js 짝. URL 을 문자열로 만들어 파라미터를 도로 떼어내는
 * 대신(그 우회가 이미 두 곳에 생길 뻔했다) 자격증명에서 바로 옵션 객체를 만든다 —
 * `createAdminConnection` 과 같은 모양이고 DB 이름만 다르다.
 */
export function createServiceConnection(dbName: string, options: Record<string, unknown> = {}): Sql {
  const { host, port, username, password } = getDbCredentials();
  return postgres({ host, port, user: username, password, database: dbName, ssl: 'require', ...options });
}

/** Connect to the default `postgres` database for admin operations (CREATE DATABASE, etc.) */
export function createAdminConnection(): Sql {
  const { host, port, username, password } = getDbCredentials();
  return postgres({ host, port, user: username, password, database: 'postgres' });
}
