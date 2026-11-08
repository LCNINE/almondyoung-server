import postgres from 'postgres';

export type Sql = postgres.Sql;

interface DbResource {
  host: string;
  port: number;
  username: string;
  password: string;
}

// sst shell 밖(로컬 검증)에서도 돌도록 Resource 는 필요할 때만 읽는다.
// 링크되지 않은 리소스에 접근하면 sst 가 던지므로 null 로 바꾼다.
export async function linkedResource(name: 'Db' | 'IdpDb'): Promise<DbResource | null> {
  if (!process.env[`SST_RESOURCE_${name}`]) return null;
  const { Resource } = await import('sst');
  return (Resource as unknown as Record<string, DbResource>)[name];
}

export function connect(envUrl: string | undefined, resource: DbResource | null, database: string): Sql | null {
  if (envUrl) return postgres(envUrl, { max: 1, connect_timeout: 30, onnotice: () => undefined });
  if (!resource) return null;
  return postgres({
    host: process.env.DB_TUNNEL_HOST ?? resource.host,
    port: Number(process.env.DB_TUNNEL_PORT ?? resource.port),
    username: resource.username,
    password: resource.password,
    database,
    ssl: process.env.DB_TUNNEL_HOST ? false : 'require',
    max: 1,
    connect_timeout: 30,
    onnotice: () => undefined,
  });
}

// 모든 조회는 READ ONLY 트랜잭션 안에서만 돈다 — 실수로 쓰기 문이 섞여도 DB 가 거부한다.
export async function readOnly(sql: Sql, fn: (tx: Sql) => Promise<void>): Promise<void> {
  await sql.begin('read only', (tx) => fn(tx as unknown as Sql));
}
