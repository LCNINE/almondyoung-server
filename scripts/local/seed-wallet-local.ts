/**
 * 로컬 wallet DB 에 reference 시드(결제수단 카탈로그·지역·지역별 매핑)를 적용한다.
 *
 * `npm run db:seed:ref` 는 SST/AWS 에서 배포 설정을 읽어 DB URL 을 해석하므로 로컬에서는 못 쓴다.
 * `seed-user-service-local.ts` 와 같은 방식으로, 같은 `WalletSeedStep` 을 로컬 DATABASE_URL 로 직접 돌린다.
 *
 * 🔴 이게 없으면 결제 화면(wallet-web :3200)이 «대한민국(KR) 지역에서 사용 가능한 결제수단이 없습니다»
 * 로 막혀 주문을 완결할 수 없다. 리허설 3차에서 실제로 여기서 막혔다.
 *
 * 사용: npx tsx scripts/local/seed-wallet-local.ts
 */
import { WalletSeedStep } from '../seeding/steps/wallet.seed-step';

const LOCAL_PG = process.env.LOCAL_PG ?? 'postgresql://postgres:postgres@localhost:5432';
const DATABASE_URL = process.env.WALLET_DATABASE_URL ?? `${LOCAL_PG}/wallet`;

if (!/localhost|127\.0\.0\.1/.test(DATABASE_URL)) {
  throw new Error(`로컬 전용 스크립트다. DATABASE_URL 이 localhost 가 아니다: ${DATABASE_URL}`);
}

async function main(): Promise<void> {
  const step = new WalletSeedStep(DATABASE_URL);
  console.log('[check-before]', JSON.stringify(await step.check(), null, 2));
  const result = await step.apply();
  console.log('[apply]', JSON.stringify(result, null, 2));
  console.log('[check-after]', JSON.stringify(await step.check(), null, 2));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
