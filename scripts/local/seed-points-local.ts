/**
 * 로컬 테스트 계정에 적립금을 지급한다.
 *
 * 🔴 왜 필요한가: 로컬에는 `TOSS_*` 자격증명이 없어 「카드 간편결제」·「무통장입금」이 둘 다
 * 외부 PG 를 못 부른다. **로컬에서 실제로 통과하는 결제수단은 포인트 하나뿐이다.**
 * 그래서 결제~주문 구간을 볼 때마다 어드민 화면에서 손으로 적립금을 넣어야 했다.
 * (docs/local-e2e-environment.md §8)
 *
 * 🔴 `point_events` 만 넣으면 안 된다. 잔액은 `sum(point_events.amount)` 라 맞아 보이지만,
 * 사용(REDEEM)은 `point_event_details` 의 lot(`earned_event_detail_id`)에서 차감하므로
 * **잔액은 있는데 결제는 INSUFFICIENT_POINTS 로 실패하는** 상태가 된다.
 * 두 테이블을 같은 트랜잭션에서 함께 쓴다.
 *
 * 사용:
 *   npm run db:seed:points:local                       # 기본 계정들에 100,000P
 *   LOCAL_POINT_LOGIN_IDS=e2e01 npm run db:seed:points:local
 *   LOCAL_POINT_AMOUNT=50000 npm run db:seed:points:local
 *
 * 멱등하다 — 같은 `reason_code` 의 적립이 이미 있는 계정은 건너뛴다. 더 넣고 싶으면
 * `LOCAL_POINT_REASON` 을 다르게 줘서 한 번 더 돌린다.
 */
import postgres from 'postgres';

const LOCAL_PG = process.env.LOCAL_PG ?? 'postgresql://postgres:postgres@localhost:5432';
const USER_SERVICE_URL = process.env.USER_SERVICE_DATABASE_URL ?? `${LOCAL_PG}/user_service`;
const WALLET_URL = process.env.WALLET_DATABASE_URL ?? `${LOCAL_PG}/wallet`;

for (const url of [USER_SERVICE_URL, WALLET_URL]) {
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`로컬 전용 스크립트다. DATABASE_URL 이 localhost 가 아니다: ${url}`);
  }
}

/** docs/local-e2e-environment.md §5 의 로컬 구매자 계정들. 없는 계정은 조용히 건너뛴다. */
const DEFAULT_LOGIN_IDS = ['buyer01', 's2buyer01', 's2buyer02', 'test01'];

const LOGIN_IDS = (process.env.LOCAL_POINT_LOGIN_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const TARGET_LOGIN_IDS = LOGIN_IDS.length > 0 ? LOGIN_IDS : DEFAULT_LOGIN_IDS;

const AMOUNT = Number(process.env.LOCAL_POINT_AMOUNT ?? 100000);
const REASON = process.env.LOCAL_POINT_REASON ?? 'LOCAL_SEED';

if (!Number.isInteger(AMOUNT) || AMOUNT <= 0) {
  throw new Error(`LOCAL_POINT_AMOUNT 는 양의 정수여야 한다: ${process.env.LOCAL_POINT_AMOUNT}`);
}

async function main(): Promise<void> {
  const users = postgres(USER_SERVICE_URL, { max: 1 });
  const wallet = postgres(WALLET_URL, { max: 1 });

  try {
    const rows = await users<{ id: string; login_id: string }[]>`
      SELECT id, login_id FROM users WHERE login_id IN ${users(TARGET_LOGIN_IDS)}
    `;
    const found = new Map(rows.map((r) => [r.login_id, r.id]));

    for (const loginId of TARGET_LOGIN_IDS) {
      const userId = found.get(loginId);
      if (!userId) {
        console.log(`  – ${loginId}: user_service 에 없다 — 건너뛴다`);
        continue;
      }

      const [existing] = await wallet<{ count: number }[]>`
        SELECT count(*)::int AS count FROM point_events
        WHERE user_id = ${userId} AND event_type = 'EARN' AND reason_code = ${REASON}
      `;
      if ((existing?.count ?? 0) > 0) {
        console.log(`  = ${loginId}: 이미 '${REASON}' 적립이 있다 — 건너뛴다`);
        continue;
      }

      await wallet.begin(async (tx) => {
        // provider_idempotency_key 는 NOT NULL 이다. 계정+사유로 만들어 두 번 돌려도
        // 같은 키가 되게 한다 — 위 존재검사와 함께 이중 안전장치.
        const idempotencyKey = `local-seed:${REASON}:${userId}`;
        const [event] = await tx<{ id: string }[]>`
          INSERT INTO point_events (user_id, event_type, amount, reason_code, reason_message, provider_idempotency_key)
          VALUES (${userId}, 'EARN', ${AMOUNT}, ${REASON}, ${'로컬 E2E 검증용 시드 적립'}, ${idempotencyKey})
          RETURNING id
        `;
        // lot 을 만든다. earned_event_detail_id 는 «자기 자신» 이다 — EARN 이 lot 의 뿌리다.
        const [detail] = await tx<{ id: string }[]>`
          INSERT INTO point_event_details (point_event_id, user_id, event_type, amount)
          VALUES (${event.id}, ${userId}, 'EARN', ${AMOUNT})
          RETURNING id
        `;
        await tx`
          UPDATE point_event_details SET earned_event_detail_id = ${detail.id} WHERE id = ${detail.id}
        `;
      });

      console.log(`  + ${loginId}: ${AMOUNT.toLocaleString()}P 적립`);
    }

    console.log('\n=== 잔액 ===');
    for (const loginId of TARGET_LOGIN_IDS) {
      const userId = found.get(loginId);
      if (!userId) continue;
      const [bal] = await wallet<{ confirmed: number; reserved: number }[]>`
        SELECT
          (SELECT coalesce(sum(amount), 0)::int FROM point_events WHERE user_id = ${userId}) AS confirmed,
          (SELECT coalesce(sum(amount), 0)::int FROM point_holds
             WHERE user_id = ${userId} AND status = 'AUTHORIZED') AS reserved
      `;
      console.log(`  ${loginId}: 확정 ${bal.confirmed.toLocaleString()} / 예약 ${bal.reserved.toLocaleString()} / 사용가능 ${(bal.confirmed - bal.reserved).toLocaleString()}`);
    }
  } finally {
    await users.end();
    await wallet.end();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
