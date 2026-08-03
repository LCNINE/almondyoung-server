/**
 * 시드 리셋은 DROP DATABASE 를 수행한다. 실수로 라이브·공용 DB 를 날리지 않도록
 * 대상 URL 을 세 조건으로 잠근다.
 *
 * 호스트 조건이 라이브 RDS 를 막고, DB 이름 조건이 공용 로컬 `core` 를 막는다.
 * `sst tunnel` 이 떠 있으면 localhost:5432 가 원격을 가리킬 수 있으므로
 * **DB 이름 조건이 실질적 방어선**이다.
 *
 * 쿼리 문자열은 통째로 거부한다. `pg-connection-string` 은 쿼리 키(`?host=...`)를
 * config 에 먼저 채우고 authority 의 host 는 `if (!config.host)` 일 때만 적용하므로,
 * `?host=` 하나로 hostname/pathname 검사를 모두 통과하면서 실제 접속지는 임의의
 * 원격 서버로 바뀔 수 있다 (drizzle-kit 은 `pg` 를 우선 선택). 이 스크립트가 허용하는
 * 대상은 `localhost`/`127.0.0.1` 의 `dev_core` 단 하나뿐이라 보존할 만한 합법적
 * 쿼리 파라미터가 없고, "안전한 키" allowlist 는 드라이버가 키를 추가할 때마다
 * 썩는다 — 그래서 쿼리 문자열 존재 자체를 거부한다.
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

  if (url.search !== '') {
    throw new Error(
      `[seed-dev-core] 쿼리 문자열이 있는 URL 은 거부합니다 (예: '?host=' 로 실제 접속 호스트를 덮어쓸 수 있음 — pg-connection-string 이 쿼리 키를 host/authority 보다 우선 적용합니다). DATABASE_URL 에서 '?' 이후를 제거하세요: ${rawUrl}`,
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.includes(hostname)) {
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
