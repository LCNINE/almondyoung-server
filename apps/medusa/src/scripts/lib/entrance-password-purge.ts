/**
 * 공동현관 출입 비밀번호(`order.metadata.entrance_password`) 파기 판정.
 *
 * Medusa 는 이 값의 **통과점**일 뿐이다 — 체크아웃에서 받아 주문 metadata 에 실어두면
 * channel-adapter 가 그걸 읽어 core 로 넘기고, 그 뒤로는 core 가 SoT 다(송장 조립·배송 완료
 * 파기·보관 상한 배치 전부 core 쪽에 있다). 그러니 Medusa 에 남은 사본은 보관할 이유가 없다.
 *
 * 판정을 여기 순수 함수로 모아둔 이유는 스케줄 잡과 일회성 스크립트가 **같은 규칙**을 쓰게
 * 하려는 것이고, 컨테이너 없이 테스트할 수 있게 하려는 것이다.
 */

/**
 * 보관 상한(일).
 *
 * core 의 `ENTRANCE_PASSWORD_TTL_DAYS`(apps/core/src/modules/sales-order/services/
 * entrance-password-expiry.ts)와 **같은 값이어야 한다**. Medusa 는 별도 앱/별도 tsconfig 라
 * 앱 경계를 넘어 import 하지 않으므로 숫자가 두 곳에 적힌다 — 드리프트는 유닛 테스트가 잡는다.
 */
export const ENTRANCE_PASSWORD_TTL_DAYS = 14;

const TTL_MS = ENTRANCE_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000;

/** 주문 metadata 안의 키 이름. */
export const ENTRANCE_PASSWORD_METADATA_KEY = 'entrance_password';

/**
 * Medusa 의 metadata 삭제 신호.
 *
 * 모듈 서비스는 update 마다 `mergeMetadata(기존, 입력)` 를 부르고
 * (`@medusajs/utils/dist/modules-sdk/medusa-internal-service.js:241`), `mergeMetadata` 는
 * **값이 빈 문자열이면 키를 지운다**(`.../common/merge-metadata.js:18`). 그래서 `''` 를 쓰면
 * 마이그레이션도 raw SQL 도 없이 키 자체가 사라진다.
 *
 * `null` 을 쓰면 안 된다 — 그건 삭제가 아니라 "값을 null 로 저장"이라 비번 자리가 그대로 남는다.
 */
export const METADATA_DELETE_SENTINEL = '';

/** 일회성 전량 파기 스크립트의 확인 토큰. 되돌릴 수 없으므로 정확히 이 문자열을 요구한다. */
export const PURGE_ALL_CONFIRM_TOKEN = 'purge-all-entrance-passwords';

/**
 * 후보 조회.
 *
 * **프로젝션이 `id, created_at` 뿐인 것이 값 유출 방어선이다** — 비번 값은 술어(where)에서만
 * 쓰이고 프로세스 메모리로 올라오지 않으므로, 로그·에러 메시지·스택에 실릴 경로가 아예 없다.
 * 여기에 `metadata` 를 추가하지 말 것(유닛 테스트가 막는다).
 *
 * `nullif(...) is not null` 술어는 두 번째 방어선이자 **멱등성의 근거**다. 이미 비워진 주문은
 * 후보가 아니므로 같은 스크립트를 몇 번 돌려도 두 번째부터는 0건이다.
 *
 * `order by created_at asc` — 오래된 것부터. 배치 상한이 걸려도 만료된 주문이 굶지 않는다.
 */
export const ENTRANCE_PASSWORD_CANDIDATE_SQL = `
  select id, created_at
  from "order"
  where deleted_at is null
    and nullif(metadata->>'${ENTRANCE_PASSWORD_METADATA_KEY}', '') is not null
  order by created_at asc
  limit ?
`;

/**
 * 건수 조회 — 전체와 "보관 상한 초과분"을 한 번에 센다.
 *
 * 일회성 스크립트의 dry run 이 파괴 범위를 정확히 보여주기 위한 것이다. 건수만 나오고
 * 값은 나오지 않는다.
 */
export const ENTRANCE_PASSWORD_COUNT_SQL = `
  select
    count(*)::int as total,
    count(*) filter (where created_at <= ?)::int as expired
  from "order"
  where deleted_at is null
    and nullif(metadata->>'${ENTRANCE_PASSWORD_METADATA_KEY}', '') is not null
`;

/** 후보 행. **비번 값을 담는 필드가 없다** — 타입 수준에서도 값을 들고 다니지 않는다. */
export type EntrancePasswordCandidate = {
  id: string;
  created_at: Date | string;
};

/** `updateOrders` 에 그대로 넘기는 파기 페이로드. */
export type EntrancePasswordPurgeUpdate = {
  id: string;
  metadata: Record<string, string>;
};

/** 이 시각 이전(포함)에 만들어진 주문은 보관 상한을 넘겼다. */
export function entrancePasswordCutoff(now: Date): Date {
  return new Date(now.getTime() - TTL_MS);
}

/**
 * 보관 상한을 넘겼는가.
 *
 * `created_at` 이 문자열로 와도 같은 답을 낸다 — pg 드라이버 설정에 따라 timestamptz 가
 * `Date` 가 아니라 문자열로 올 수 있고, 그때 조용히 오판하면 파기가 통째로 멈춘다.
 */
export function isEntrancePasswordExpired(createdAt: Date | string, now: Date): boolean {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  return created.getTime() <= entrancePasswordCutoff(now).getTime();
}

/** 후보 중 보관 상한을 넘긴 것들의 id. 입력 순서를 유지한다(오래된 것부터). */
export function expiredEntrancePasswordOrderIds(rows: EntrancePasswordCandidate[], now: Date): string[] {
  return rows.filter((row) => isEntrancePasswordExpired(row.created_at, now)).map((row) => row.id);
}

/**
 * 파기 페이로드를 만든다.
 *
 * 기존 metadata 를 spread 하지 **않는다**. 모듈 서비스가 알아서 머지하므로 다른 키는 보존되고,
 * spread 하면 읽어온 비번 값을 되쓰게 되어 유출 표면만 늘어난다.
 */
export function buildEntrancePasswordPurgeUpdates(ids: string[]): EntrancePasswordPurgeUpdate[] {
  return ids.map((id) => ({
    id,
    metadata: { [ENTRANCE_PASSWORD_METADATA_KEY]: METADATA_DELETE_SENTINEL },
  }));
}

/** 일회성 스크립트 인자 파싱. 기본은 dry run 이고, 파괴는 정확한 토큰을 요구한다. */
export function parseEntrancePasswordPurgeArgs(args: string[]): { dryRun: boolean } {
  let dryRun = true;

  for (const arg of args) {
    if (arg === '--dry-run') {
      continue;
    }
    if (arg === `--confirm=${PURGE_ALL_CONFIRM_TOKEN}`) {
      dryRun = false;
      continue;
    }
    if (arg.startsWith('--confirm')) {
      throw new Error(
        `공동현관 비번 전량 파기는 되돌릴 수 없다. 정확히 --confirm=${PURGE_ALL_CONFIRM_TOKEN} 를 넘길 것.`,
      );
    }
    throw new Error(
      `알 수 없는 인자: ${arg} (사용법: [--dry-run] | --confirm=${PURGE_ALL_CONFIRM_TOKEN})`,
    );
  }

  return { dryRun };
}

/** 배열을 size 씩 자른다. `updateOrders` 한 번에 넘기는 행 수를 제한하는 데 쓴다. */
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
