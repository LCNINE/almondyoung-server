import { execFileSync } from 'child_process';
import * as postgres from 'postgres';
import { assertLocalDevCoreUrl } from './guard';

export const DEFAULT_SEED_URL = 'postgresql://postgres:postgres@localhost:5432/dev_core';

// 가드가 dbName 을 'dev_core' 리터럴 하나로 고정하는 한, DROP/CREATE 식별자
// 보간은 안전하다. 그러나 이 검사는 그 가드 조건에 의존하지 않는 별도의
// 방어선이다 — 가드가 나중에 prefix/pattern 매칭(예: 병렬 dev DB 지원)으로
// 느슨해지면 여기 보간이 그대로 identifier-injection 지점이 된다. 가드가
// 이미 검증한다고 해서 이 줄을 지우지 말 것.
const SAFE_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

const DROP_CREATE_MAX_ATTEMPTS = 5;
const DROP_CREATE_RETRY_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertSafeIdentifier(dbName: string): void {
  if (!SAFE_IDENTIFIER_PATTERN.test(dbName)) {
    throw new Error(
      `[seed-dev-core] DB 이름이 안전한 식별자 형태(${SAFE_IDENTIFIER_PATTERN}) 가 아니라 거부합니다: ${dbName}`,
    );
  }
}

export function resolveSeedUrl(): string {
  return process.env.SEED_DEV_CORE_URL ?? DEFAULT_SEED_URL;
}

/**
 * pg_terminate_backend 후 즉시 DROP DATABASE 를 한 번 시도한다. core 를 watch
 * 로 띄워둔 채라면 postgres.js 풀이 그 사이에 재연결해 DROP 이
 * "database is being accessed by other users" 로 실패할 수 있다 — 그 실패를
 * 그대로 던져 호출부가 재시도 여부를 결정하게 한다.
 */
async function terminateAndDropOnce(admin: ReturnType<typeof postgres>, dbName: string): Promise<void> {
  await admin`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = ${dbName} AND pid <> pg_backend_pid()
  `;
  // dbName 은 위 assertSafeIdentifier 로 안전한 식별자임이 보장된 뒤에만 여기 도달한다.
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
}

/**
 * 대상 DB 의 다른 세션을 끊고 drop/create 한다. core 를 watch 로 띄워둔 채여도
 * postgres.js 풀이 재연결하므로 core 를 내릴 필요가 없다. 다만 terminate 와
 * DROP 사이에 재연결이 끼어들 수 있어(레이스) 짧은 지연을 두고 몇 차례
 * 재시도한다.
 */
export async function recreateDatabase(rawUrl: string): Promise<void> {
  const { url, dbName } = assertLocalDevCoreUrl(rawUrl);
  assertSafeIdentifier(dbName);

  const admin = postgres({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: 'postgres',
    max: 1,
  });

  try {
    let lastError: unknown;
    let dropped = false;
    for (let attempt = 1; attempt <= DROP_CREATE_MAX_ATTEMPTS; attempt += 1) {
      try {
        await terminateAndDropOnce(admin, dbName);
        dropped = true;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < DROP_CREATE_MAX_ATTEMPTS) {
          await sleep(DROP_CREATE_RETRY_DELAY_MS);
        }
      }
    }
    if (!dropped) {
      throw new Error(
        `[seed-dev-core] ${DROP_CREATE_MAX_ATTEMPTS}회 재시도했지만 '${dbName}' DROP 에 실패했습니다 ` +
          `(다른 세션이 재연결하며 계속 점유했을 수 있습니다): ${String(lastError)}`,
      );
    }
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }
}

/**
 * drizzle-kit 은 별도 프로세스로 돌린다. apps/core/drizzle.config.ts 의
 * dotenv config() 는 **이미 설정된 env 를 덮어쓰지 않으므로** 여기서 주입한
 * DATABASE_URL 이 이긴다 (migrate-all.sh 와 동일한 성질).
 *
 * 자식 프로세스에는 rawUrl 문자열을 그대로 넘기지 않는다. drizzle-kit 이
 * 쓰는 pg-connection-string 은 파싱 전에 `encodeURI(str)` 를 거치는데, 이
 * 과정이 WHATWG `new URL()` 이 하는 앞뒤 공백 트리밍을 억제한다. 그 결과
 * 가드(assertLocalDevCoreUrl)가 검증한 DB 이름과 자식 프로세스가 실제로
 * 접속하는 DB 이름이 어긋날 수 있다 (예: 끝에 공백이 붙은 URL 은 가드에는
 * 'dev_core' 로, drizzle-kit 에는 'dev_core ' 로 보인다). 대신 가드가 이미
 * 파싱해 돌려준 URL 객체를 canonical 하게 재직렬화한 문자열을 넘겨,
 * "검증한 문자열"과 "실행에 쓰이는 문자열"을 일치시킨다.
 */
export function runCoreMigrations(rawUrl: string): void {
  const { url } = assertLocalDevCoreUrl(rawUrl);
  execFileSync('npx', ['drizzle-kit', 'migrate', '--config', 'apps/core/drizzle.config.ts'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url.toString() },
  });
}
