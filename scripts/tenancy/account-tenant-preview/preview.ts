/**
 * 계정 테넌트 채우기 마이그 «전에» 돌리는 읽기 전용 점검 (ADR-0056 expand).
 *
 *   npm run tenancy:account-tenant-preview -- --stage live   # lcnine-auth 의 user_service DB. 터널(npx sst tunnel --stage live)이 떠 있어야 한다
 *   npm run tenancy:account-tenant-preview -- --local        # apps/user-service/.env 의 DATABASE_URL
 *
 * 끝 코드 1 = 테넌트 1 에 남으며 다른 테넌트의 부여·소속을 잃는 계정이 있다 — 명단을 사용자에게 보이고 확인받은 뒤 마이그한다.
 * 규칙은 `preview-query.ts`.
 */
import { readFileSync } from 'fs';
import { parse as parseDotenv } from 'dotenv';
import postgres, { type Sql } from 'postgres';
import { ensureInsideSstShell } from '../../seeding/lib/sst-shell-relaunch';
import { sstShellStage } from '../../seeding/lib/tenant-registry';
import {
  ACCOUNT_TENANT_PREVIEW_SQL,
  renderPreview,
  splitPreview,
  type AccountTenantPreviewRow,
} from './preview-query';

function parseArgs(argv: string[]): { stage?: string; local: boolean } {
  const args: { stage?: string; local: boolean } = { local: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--local') args.local = true;
    else if (flag === '--stage') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--stage 에 값이 없다');
      args.stage = next;
      i += 1;
    } else throw new Error(`모르는 인자: ${flag}`);
  }
  if (args.local === (args.stage !== undefined)) throw new Error('--local 또는 --stage <stage> 중 하나');
  return args;
}

async function connect(args: { stage?: string; local: boolean }): Promise<Sql> {
  if (args.local) {
    const url = parseDotenv(readFileSync('apps/user-service/.env')).DATABASE_URL;
    if (!url) throw new Error('apps/user-service/.env 에 DATABASE_URL 이 없다');
    return postgres(url, { max: 1, onnotice: () => undefined });
  }
  const stage = args.stage ?? '';
  await ensureInsideSstShell({ stage, deployment: 'lcnine-auth' });
  const shellStage = sstShellStage(process.env);
  if (shellStage !== stage) throw new Error(`sst shell 의 stage(${shellStage}) 가 --stage ${stage} 와 다르다`);
  const { createServiceConnection } = await import('../../seeding/lib/db-connection');
  return createServiceConnection('user_service', { max: 1, prepare: false });
}

async function main(): Promise<void> {
  const sql = await connect(parseArgs(process.argv.slice(2)));
  try {
    // 읽기 전용 트랜잭션 — 이 점검이 무엇도 바꾸지 않는다는 것을 DB 가 보증한다.
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe('SET TRANSACTION READ ONLY');
      return tx.unsafe<AccountTenantPreviewRow[]>(ACCOUNT_TENANT_PREVIEW_SQL);
    });
    const { lines, exitCode } = renderPreview(splitPreview(rows));
    for (const line of lines) console.log(line);
    process.exitCode = exitCode;
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
