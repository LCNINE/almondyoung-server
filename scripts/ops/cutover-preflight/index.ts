/**
 * 셀메이트 컷오버(#1233) 사전 «판정». 읽기 전용이다 — 아무것도 고치지 않는다.
 *
 * 지도 #1233 의 축마다 라이브 데이터·설정·코드가 «셀메이트 없이 운영»의 선행조건을 만족하는지 본다.
 * 지도와 sub-issue 본문에는 도출 수치를 적지 않는다 — 이 스크립트의 출력이 «지금 어디인가»다.
 * 판정 조건은 코드에서 옮겼다(각 검사 옆 주석의 파일이 정본 — 코드가 바뀌면 여기도 바꾼다).
 *
 * 판정자가 고치지 않는 이유는 `scripts/local/preflight-e2e.sh` 와 같다: 스스로 고치면 초록불이
 * 「원래 옳았다」의 증거가 아니게 된다. 그래서 모든 ✗ 는 무엇이 그걸 고치는지(이슈·명령) 함께 적는다.
 *
 * 사용 (터널: `npx sst tunnel --stage live` 가 떠 있어야 한다. AWS_PROFILE 은 export 하지 말 것):
 *   cd deployments/lcnine/services && npx sst shell --stage live -- npx tsx ../../../scripts/ops/cutover-preflight/index.ts
 *   cd deployments/lcnine/auth     && npx sst shell --stage live -- npx tsx ../../../scripts/ops/cutover-preflight/index.ts
 * services 에선 core·channel_adapter·medusa 를, auth 에선 user_service 를 본다. 배선(코드·IaC)은 어디서나 본다.
 *
 * core 는 테넌트마다 논리 DB 가 따로다. 기본은 `core`(테넌트 1)이고 CORE_DB_NAME 으로 바꾼다.
 * 로컬 검증: CORE_DATABASE_URL / CHANNEL_ADAPTER_DATABASE_URL / MEDUSA_DATABASE_URL / USER_SERVICE_DATABASE_URL.
 *
 * 종료 코드: ✗ 가 하나라도 있으면 1, DB 에 못 닿으면 2.
 */
import { connect, linkedResource, readOnly, type Sql } from './db';
import { checkInbound } from './checks/inbound';
import { checkLocation } from './checks/location';
import { checkMarketAdapter, checkMarketCore } from './checks/market';
import { checkMatching } from './checks/matching';
import { checkMedusaReservations } from './checks/medusa';
import { checkOutbound, checkOutboundAdapter } from './checks/outbound';
import { checkPeople } from './checks/people';
import { checkWiring } from './checks/wiring';
import { Report } from './report';

async function main(): Promise<void> {
  const r = new Report();
  checkWiring(r);

  const db = await linkedResource('Db');
  const core = connect(process.env.CORE_DATABASE_URL, db, process.env.CORE_DB_NAME ?? 'core');
  const adapter = connect(process.env.CHANNEL_ADAPTER_DATABASE_URL, db, 'channel_adapter');
  const medusa = connect(process.env.MEDUSA_DATABASE_URL, db, 'medusa');
  const users = connect(process.env.USER_SERVICE_DATABASE_URL, await linkedResource('IdpDb'), 'user_service');
  if (!core && !users) {
    console.error('\nDB 에 닿을 수 없다 — sst shell 안에서 돌리거나 *_DATABASE_URL 을 준다 (파일 머리 주석)');
    process.exit(2);
  }
  const all: (Sql | null)[] = [core, adapter, medusa, users];
  try {
    if (core) {
      await readOnly(core, async (tx) => {
        await checkLocation(tx, r);
        await checkInbound(tx, r);
        await checkMatching(tx, r);
        await checkOutbound(tx, r);
        await checkMarketCore(tx, r);
      });
    } else r.info('\ncore 건너뜀 — deployments/lcnine/services 에서 sst shell 로 돌린다');
    if (adapter)
      await readOnly(adapter, async (tx) => {
        await checkOutboundAdapter(tx, r);
        await checkMarketAdapter(tx, r);
      });
    if (medusa && core) await readOnly(medusa, (med) => readOnly(core, (tx) => checkMedusaReservations(med, tx, r)));
    if (users) await readOnly(users, (tx) => checkPeople(tx, r));
    else r.info('\nuser_service 건너뜀 — deployments/lcnine/auth 에서 sst shell 로 한 번 더 돌린다');
  } finally {
    await Promise.all(all.flatMap((s) => (s ? [s.end()] : [])));
  }

  console.log(r.failures ? `\n\x1b[31m✗ ${r.failures}건\x1b[0m` : '\n\x1b[32m✓ 전부 통과\x1b[0m');
  process.exit(r.failures ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(2);
});
