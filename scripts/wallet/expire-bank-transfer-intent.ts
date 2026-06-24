/**
 * 무통장입금(AWAITING_DEPOSIT) intent 의 expires_at 을 과거로 당겨, wallet ExpirationJob 이
 * 다음 주기(@Cron WALLET_EXPIRATION_CRON, 기본 10분)에 만료 처리하도록 만드는 **테스트 전용** 스크립트.
 *
 * 목적(#439 시나리오 ③ staging 검증):
 *   expires_at 백데이트 → ExpirationJob 가 INTENT_EXPIRED 로 CANCELED 전이 + INTENT_CANCELED outbox 발행
 *   → channel-adapter → Medusa /hooks/payment-events handleCancelProjection
 *   → 선생성된 주문 cancelOrderWorkflow 취소 + 예약재고 해제.
 *
 * 실제 만료 경로(charge release + 상태 전이 + outbox)를 그대로 태운다(상태를 직접 손대지 않음).
 *
 * 사용법 (deployments/lcnine/services 에서, staging 스테이지로):
 *   # dry-run (대상만 확인) — 특정 intent
 *   npx sst shell --stage <staging-stage> -- npx tsx ../../../scripts/wallet/expire-bank-transfer-intent.ts <intentId>
 *   # 실제 적용
 *   npx sst shell --stage <staging-stage> -- npx tsx ../../../scripts/wallet/expire-bank-transfer-intent.ts <intentId> --apply
 *   # intent 전체 대상(주의) — 반드시 dry-run 으로 먼저 확인
 *   npx sst shell --stage <staging-stage> -- npx tsx ../../../scripts/wallet/expire-bank-transfer-intent.ts --all --apply
 *
 * 안전장치:
 *   - live 스테이지(SST_STAGE=live)에서는 거부한다(실 고객 주문 취소 위험).
 *   - intentId 또는 --all 중 하나는 필수.
 *   - 기본 dry-run. 쓰기는 --apply 필요.
 */
import postgres from 'postgres';
import { Resource } from 'sst';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALL = args.includes('--all');
const intentId = args.find((a) => !a.startsWith('--'));

const stage = process.env.SST_STAGE ?? '';
if (stage.toLowerCase() === 'live') {
  console.error('거부: live 스테이지에서는 실행할 수 없습니다(실 고객 주문 취소 위험). staging 에서만 사용하세요.');
  process.exit(1);
}
if (!intentId && !ALL) {
  console.error('intentId 를 인자로 주거나 --all 을 지정하세요. (기본 dry-run, 쓰기는 --apply)');
  process.exit(1);
}

function conn(database: string) {
  const db = (Resource as any).Db;
  return postgres({
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database,
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
  });
}

async function main() {
  const wallet = conn('wallet');
  try {
    await wallet`SELECT 1`;

    // 대상: AWAITING_DEPOSIT 상태. intentId 가 주어지면 그 한 건만.
    const targets = intentId
      ? await wallet`
          SELECT id, status, expires_at, payable_amount, currency, user_id
          FROM payment_intents
          WHERE id = ${intentId} AND status::text = 'AWAITING_DEPOSIT'`
      : await wallet`
          SELECT id, status, expires_at, payable_amount, currency, user_id
          FROM payment_intents
          WHERE status::text = 'AWAITING_DEPOSIT'
          ORDER BY created_at DESC
          LIMIT 50`;

    if ((targets as any[]).length === 0) {
      if (intentId) {
        console.log(`대상 없음: intent ${intentId} 가 AWAITING_DEPOSIT 상태가 아니거나 존재하지 않습니다.`);
      } else {
        console.log('대상 없음: AWAITING_DEPOSIT 상태의 intent 가 없습니다.');
      }
      return;
    }

    console.log(`=== 대상 AWAITING_DEPOSIT intent ${(targets as any[]).length}건 (stage=${stage || '(unknown)'}) ===`);
    console.table(
      (targets as any[]).map((t) => ({
        id: t.id,
        expires_at: t.expires_at,
        amount: `${t.payable_amount} ${t.currency}`,
        userId: t.user_id,
      })),
    );

    if (!APPLY) {
      console.log('\n[dry-run] 변경하지 않았습니다. 실제 적용하려면 --apply 를 붙이세요.');
      console.log('적용 시: 위 intent 들의 expires_at 을 (now - 1분) 으로 당깁니다.');
      console.log('이후 wallet ExpirationJob(@Cron, 기본 10분)이 만료 처리 → INTENT_CANCELED 발행 → 주문 취소/예약 해제.');
      return;
    }

    const ids = (targets as any[]).map((t) => t.id);
    const updated = await wallet`
      UPDATE payment_intents
      SET expires_at = now() - interval '1 minute', updated_at = now()
      WHERE id = ANY(${ids}) AND status::text = 'AWAITING_DEPOSIT'
      RETURNING id, expires_at`;

    console.log(`\n✅ expires_at 백데이트 완료: ${(updated as any[]).length}건`);
    console.table(updated);
    console.log('\n다음 단계: wallet ExpirationJob 주기(기본 10분, 또는 WALLET_EXPIRATION_CRON)를 기다리거나');
    console.log('wallet 인스턴스를 재기동하면 즉시 다음 주기에 만료됩니다.');
    console.log('검증: Medusa "order".status=\'canceled\', reservation_item 0건, channel-adapter wms_order_mappings 0건.');
  } finally {
    await wallet.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((err) => {
  console.error('실패:', err?.message ?? err);
  process.exit(1);
});
