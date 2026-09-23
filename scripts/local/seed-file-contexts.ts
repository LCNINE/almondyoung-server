/**
 * 로컬 `file_service` DB 에 `file_contexts` 를 시딩한다.
 *
 * file-service 는 컨텍스트 행이 없으면 업로드를 전부 404(`Context <id> not found`)로 거절하는데,
 * 이 행을 넣는 정식 경로(`scripts/seeding/steps/file-service.seed-step.ts`)는 `sst shell` 의
 * `Resource.Db` 에 묶여 있어 로컬 postgres 에 못 쓴다(docs/local-dev.md "아직 로컬화 안 된 것").
 * 그래서 같은 시드 상수(`FILE_CONTEXTS`)를 읽어 로컬에만 적용하는 얇은 러너를 따로 둔다 —
 * 상수를 공유하므로 컨텍스트가 추가돼도 여기가 따로 낡지 않는다.
 *
 * 사용법: npm run dev:seed-file-contexts
 *         LOCAL_PG=postgresql://... npm run dev:seed-file-contexts   (포트가 다른 머신)
 */
// `import postgres from` 이 아니라 `* as` 다 — 레포 tsconfig 가 esModuleInterop 를 켜지 않아
// default import 가 런타임에 함수가 아니게 된다(libs/db/src/db.service.ts 와 같은 관례).
import * as postgres from 'postgres';
import { FILE_CONTEXTS } from '../../apps/file-service/src/database/default-file-contexts';

const DEFAULT_URL = 'postgresql://postgres:postgres@localhost:5432/file_service';

/**
 * 로컬 전용 가드. `scripts/local/seed-dev-core/guard.ts` 와 같은 계열이지만 그쪽처럼
 * 프롬프트를 띄우지는 않는다 — 이 스크립트는 파괴적이지 않고(UPSERT 뿐) 대상이 참조
 * 데이터라, 막아야 하는 건 "실수로 라이브를 가리키는 것" 하나다.
 */
function assertLocal(url: string): void {
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`로컬 전용 스크립트다. localhost 가 아닌 호스트: ${host}`);
  }
}

async function main(): Promise<void> {
  const url = process.env.LOCAL_PG
    ? `${process.env.LOCAL_PG.replace(/\/$/, '')}/file_service`
    : DEFAULT_URL;
  assertLocal(url);

  const sql = postgres(url, { max: 1 });
  try {
    for (const ctx of FILE_CONTEXTS) {
      await sql`
        INSERT INTO file_contexts (
          id, name, description, allow_public, allow_private,
          allowed_mime_types, max_file_size, path_prefix, is_active
        )
        VALUES (
          ${ctx.id}, ${ctx.name}, ${ctx.description}, ${ctx.allowPublic}, ${ctx.allowPrivate},
          ${JSON.stringify(ctx.allowedMimeTypes)}, ${ctx.maxFileSize}, ${ctx.pathPrefix}, ${ctx.isActive}
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          allow_public = EXCLUDED.allow_public,
          allow_private = EXCLUDED.allow_private,
          allowed_mime_types = EXCLUDED.allowed_mime_types,
          max_file_size = EXCLUDED.max_file_size,
          path_prefix = EXCLUDED.path_prefix,
          is_active = EXCLUDED.is_active,
          updated_at = now()
      `;
    }
    console.log(`✅ file_contexts ${FILE_CONTEXTS.length}건 적용 (${url})`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error('❌ file_contexts 시딩 실패:', error instanceof Error ? error.message : error);
  process.exit(1);
});
