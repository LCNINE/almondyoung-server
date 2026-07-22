import { execFileSync } from 'child_process';
import * as postgres from 'postgres';
import { assertLocalDevCoreUrl } from './guard';

export const DEFAULT_SEED_URL = 'postgresql://postgres:postgres@localhost:5432/dev_core';

export function resolveSeedUrl(): string {
  return process.env.SEED_DEV_CORE_URL ?? DEFAULT_SEED_URL;
}

/**
 * 대상 DB 의 다른 세션을 끊고 drop/create 한다. core 를 watch 로 띄워둔 채여도
 * postgres.js 풀이 재연결하므로 core 를 내릴 필요가 없다.
 */
export async function recreateDatabase(rawUrl: string): Promise<void> {
  const { url, dbName } = assertLocalDevCoreUrl(rawUrl);

  const admin = postgres({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: 'postgres',
    max: 1,
  });

  try {
    await admin`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${dbName} AND pid <> pg_backend_pid()
    `;
    // dbName 은 가드가 'dev_core' 리터럴로 고정했으므로 식별자 보간이 안전하다.
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }
}

/**
 * drizzle-kit 은 별도 프로세스로 돌린다. apps/core/drizzle.config.ts 의
 * dotenv config() 는 **이미 설정된 env 를 덮어쓰지 않으므로** 여기서 주입한
 * DATABASE_URL 이 이긴다 (migrate-all.sh 와 동일한 성질).
 */
export function runCoreMigrations(rawUrl: string): void {
  assertLocalDevCoreUrl(rawUrl);
  execFileSync('npx', ['drizzle-kit', 'migrate', '--config', 'apps/core/drizzle.config.ts'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: rawUrl },
  });
}
