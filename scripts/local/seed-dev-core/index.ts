import { recreateDatabase, resolveSeedUrl, runCoreMigrations } from './database';

async function main(): Promise<void> {
  const bulk = process.argv.includes('--bulk');
  const url = resolveSeedUrl();

  console.log(`── 1/3 dev_core 재생성 (${url})`);
  await recreateDatabase(url);

  console.log('── 2/3 drizzle 마이그레이션');
  runCoreMigrations(url);

  console.log(`── 3/3 시드${bulk ? ' (--bulk)' : ''}`);
  // 시드 단계는 Task 4 이후에 채운다.

  console.log('✅ dev_core 리셋 완료');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
