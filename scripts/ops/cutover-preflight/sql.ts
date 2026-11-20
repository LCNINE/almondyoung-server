/**
 * 컷오버 런북(#1251)의 «읽기 전용으로 돌린다» SQL 을 실행하는 한 명령. 판정 스크립트와 같은 연결·READ ONLY 트랜잭션을 쓴다 —
 * 쓰기 문이 섞여도 DB 가 거부한다. 문장마다 30초 제한.
 *
 * 사용 (터널이 떠 있어야 한다. AWS_PROFILE 은 export 하지 않는다):
 *   cd deployments/lcnine/services
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/cutover-preflight/sql.ts --db core ../../../scripts/ops/cutover-preflight/sql/sellmate-shipments-after-init.sql
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/cutover-preflight/sql.ts --db medusa --set N=1234 ../../../scripts/ops/cutover-preflight/sql/collect-boundary.sql
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/cutover-preflight/sql.ts --db channel_adapter -e "select count(*) from inbox_events"
 *
 * --db: services 셸에서 core(기본 테넌트 1, CORE_DB_NAME 으로 바꾼다)·channel_adapter·medusa, auth 셸에서 user_service.
 * --set 이름=값: SQL 의 {{이름}} 을 바꾼다. 값은 영숫자·하이픈·밑줄만 받는다(주문번호·상자 id·시각 숫자) — SQL 을 끼워 넣지 못한다.
 * 결과에 개인정보가 나올 수 있는 SQL 은 돌린 사람 화면에만 둔다 — 이슈·커밋에 붙이지 않는다.
 */
import * as fs from 'fs';
import { connect, linkedResource, readOnly } from './db';

const SERVICE_DBS = ['core', 'channel_adapter', 'medusa'] as const;
const AUTH_DBS = ['user_service'] as const;
const VALUE = /^[A-Za-z0-9_-]+$/;
const MAX_ROWS = 200;

export type SqlArgs = { db: string; sql: string; vars: Record<string, string> };

export function parseSqlArgs(argv: readonly string[], readFile: (p: string) => string = (p) => fs.readFileSync(p, 'utf8')): SqlArgs {
  let db: string | null = null;
  let inline: string | null = null;
  let file: string | null = null;
  const vars: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') db = argv[++i] ?? null;
    else if (a.startsWith('--db=')) db = a.slice(5);
    else if (a === '-e') inline = argv[++i] ?? null;
    else if (a === '--set' || a.startsWith('--set=')) {
      const kv = a === '--set' ? (argv[++i] ?? '') : a.slice(6);
      const eq = kv.indexOf('=');
      const key = kv.slice(0, eq);
      const value = kv.slice(eq + 1);
      if (eq <= 0 || !VALUE.test(key) || !VALUE.test(value)) {
        throw new Error(`--set 은 이름=값 꼴이고 둘 다 영숫자·하이픈·밑줄만 받는다: ${kv}`);
      }
      vars[key] = value;
    } else if (!a.startsWith('-') && file === null) file = a;
    else throw new Error(`모르는 인자: ${a}`);
  }
  if (!db) throw new Error('--db <core|channel_adapter|medusa|user_service> 가 필요하다');
  if ((inline === null) === (file === null)) throw new Error('SQL 파일 경로 또는 -e "<SQL>" 중 정확히 하나를 준다');
  return { db, sql: fillVars(inline ?? readFile(file as string), vars), vars };
}

export function fillVars(sql: string, vars: Record<string, string>): string {
  const filled = sql.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`SQL 의 {{${k}}} 를 채울 --set ${k}=… 가 없다`);
    return vars[k];
  });
  return filled;
}

async function main() {
  const args = parseSqlArgs(process.argv.slice(2));
  const isAuth = (AUTH_DBS as readonly string[]).includes(args.db);
  if (!isAuth && !(SERVICE_DBS as readonly string[]).includes(args.db)) {
    throw new Error(`--db 는 ${[...SERVICE_DBS, ...AUTH_DBS].join('·')} 중 하나다: ${args.db}`);
  }
  const resource = await linkedResource(isAuth ? 'IdpDb' : 'Db');
  const database = args.db === 'core' ? (process.env.CORE_DB_NAME ?? 'core') : args.db;
  const sql = connect(undefined, resource, database);
  if (!sql) {
    throw new Error(
      `${args.db} 에 닿을 연결 정보가 없다 — ${isAuth ? 'deployments/lcnine/auth' : 'deployments/lcnine/services'} 에서 npx sst shell --stage live -- … 로 돌린다`,
    );
  }
  try {
    await readOnly(sql, async (tx) => {
      await tx.unsafe(`set local statement_timeout = '30s'`);
      const results = await tx.unsafe(args.sql);
      // 여러 문장이면 결과가 배열의 배열로 온다
      const sets: Record<string, unknown>[][] = Array.isArray(results[0]) ? (results as never) : [results as never];
      for (const rows of sets) {
        console.log(`(${rows.length}행${rows.length > MAX_ROWS ? ` — 앞 ${MAX_ROWS}행만` : ''})`);
        if (rows.length) console.table(rows.slice(0, MAX_ROWS).map((r) => ({ ...r })));
      }
    });
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
