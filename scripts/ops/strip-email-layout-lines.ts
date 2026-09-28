/**
 * 옛 메일 본문을 새 양식에 맞게 정리한다.
 *  - 공통 레이아웃이 대신 넣는 줄(아래 REMOVABLE 과 정확히 같은 줄)을 지운다.
 *  - 본문이 통째로 HTML 문서인 행은 기본 메시지(default_contents)로 되돌린다.
 * 기본은 dry-run, `--apply` 를 줘야 쓴다.
 *
 * 사용법 (deployments/lcnine/services 에서):
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/strip-email-layout-lines.ts [--apply]
 * 로컬:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/notification npx tsx scripts/ops/strip-email-layout-lines.ts --apply
 */
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');

const REMOVABLE = [
  '<p>문의: <a href="https://pf.kakao.com/_xaxgxazs">카카오톡 채널 아몬드영</a> · 고객센터 1877-7184</p>',
  '<p>문의: 고객센터 1877-7184</p>',
];

function conn() {
  if (process.env.DATABASE_URL) return postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 30 });
  const { Resource } = require('sst');
  const db = Resource.Db;
  return postgres({
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database: 'notification',
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
  });
}

/** 제거 대상 줄만 뺀 본문. 바뀐 게 없으면 null. */
export function stripLines(body: string): string | null {
  const kept = body.split('\n').filter((line) => !REMOVABLE.includes(line.trim()));
  const next = kept.join('\n').trimEnd();
  return next === body ? null : next;
}

/** EMAIL 본문만 고친 사본. 바뀐 게 없으면 null. contents 모양은 `<lang>.EMAIL` 과 옛 `EMAIL.<lang>` 둘이다. */
export function stripContents(contents: unknown): unknown | null {
  if (!contents || typeof contents !== 'object' || Array.isArray(contents)) return null;
  let changed = false;

  const fixLeaf = (leaf: unknown): unknown => {
    if (!leaf || typeof leaf !== 'object' || Array.isArray(leaf)) return leaf;
    const body = (leaf as Record<string, unknown>).body;
    if (typeof body !== 'string') return leaf;
    const next = stripLines(body);
    if (next === null) return leaf;
    changed = true;
    return { ...(leaf as Record<string, unknown>), body: next };
  };

  const fixEmailBlock = (block: unknown): unknown => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return block;
    const email = (block as Record<string, unknown>).EMAIL;
    if (email === undefined) return block;
    return { ...(block as Record<string, unknown>), EMAIL: fixLeaf(email) };
  };

  const root = contents as Record<string, unknown>;
  const next: Record<string, unknown> = { ...root };
  for (const [key, value] of Object.entries(root)) {
    if (key === 'EMAIL') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        next[key] = Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([lang, leaf]) => [lang, fixLeaf(leaf)]),
        );
      }
      continue;
    }
    next[key] = fixEmailBlock(value);
  }

  return changed ? next : null;
}

/** 본문이 통째로 HTML 문서인가. 그런 본문은 새 양식과 겹쳐 두 겹으로 보인다. */
export function isWholeHtmlDocument(contents: unknown): boolean {
  if (!contents || typeof contents !== 'object') return false;
  const bodies: string[] = [];
  const collect = (node: unknown) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'body' && typeof value === 'string') bodies.push(value);
      else collect(value);
    }
  };
  collect(contents);
  return bodies.some((body) => body.trimStart().toLowerCase().startsWith('<!doctype html>'));
}

async function main() {
  const sql = conn();
  try {
    const rows = (await sql`SELECT template_id, template_key, contents, default_contents FROM templates`) as any[];
    let touched = 0;

    for (const row of rows) {
      const wholeDocument = isWholeHtmlDocument(row.contents);
      const next = wholeDocument ? row.default_contents : stripContents(row.contents);
      if (!next) {
        if (wholeDocument) console.log(`건너뜀(기본 메시지 없음): ${row.template_key}`);
        continue;
      }
      touched += 1;
      const what = wholeDocument ? '기본 메시지로 되돌림' : '중복 줄 정리';
      console.log(`${APPLY ? what : `${what} 예정`}: ${row.template_key}`);
      if (APPLY) {
        await sql`UPDATE templates SET contents = ${sql.json(next as any)}, updated_at = now() WHERE template_id = ${row.template_id}`;
      }
    }

    console.log(`\n템플릿 ${rows.length}개 중 ${touched}개 ${APPLY ? '정리 완료' : '정리 대상'}`);
    if (!APPLY && touched) console.log('실제로 반영하려면 --apply 를 붙여 다시 실행할 것');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
