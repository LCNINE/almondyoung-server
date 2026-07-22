/**
 * 시드 리셋은 DROP DATABASE 를 수행한다. 실수로 라이브·공용 DB 를 날리지 않도록
 * 대상 URL 을 두 조건으로 잠근다.
 *
 * 호스트 조건이 라이브 RDS 를 막고, DB 이름 조건이 공용 로컬 `core` 를 막는다.
 * `sst tunnel` 이 떠 있으면 localhost:5432 가 원격을 가리킬 수 있으므로
 * **DB 이름 조건이 실질적 방어선**이다.
 */
const ALLOWED_HOSTS = ['localhost', '127.0.0.1'];
const REQUIRED_DB_NAME = 'dev_core';

export function assertLocalDevCoreUrl(rawUrl: string): { url: URL; dbName: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`[seed-dev-core] DATABASE_URL 을 파싱할 수 없습니다: ${rawUrl}`);
  }

  if (!ALLOWED_HOSTS.includes(url.hostname)) {
    throw new Error(
      `[seed-dev-core] 로컬 전용 스크립트입니다. 호스트는 ${ALLOWED_HOSTS.join(' 또는 ')} 여야 하는데 '${url.hostname}' 입니다.`,
    );
  }

  const dbName = url.pathname.replace(/^\//, '');
  if (dbName !== REQUIRED_DB_NAME) {
    throw new Error(
      `[seed-dev-core] 대상 DB 는 '${REQUIRED_DB_NAME}' 여야 합니다. '${dbName}' 은 거부합니다 (통합테스트·라이브 복제본 보호).`,
    );
  }

  return { url, dbName };
}
