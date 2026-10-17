/**
 * #1016 40번 — 옛 wallet 환불 행(`refunds.kind is null`)에 종류를 채운다(스펙 §7, 세 단계).
 *
 *   1단계  사유 코드·결제 의도로 확정 가능한 행   → `--apply` 가 바로 채운다
 *   2단계  사유 문구로 «후보»만 나오는 행         → CSV 로 저장, 사람이 고치거나 지운 뒤 `--apply --from <csv>`
 *   3단계  하나로 좁혀지지 않는 행               → 건드리지 않는다(kind 는 null 로 남는다)
 *
 * `reason_code` / `reason_message` 는 읽기만 한다. 쓰기는 항상 `where id = … and kind is null` 이라
 * 다시 돌려도 안전하고, 이미 값이 있는 행은 덮어쓰지 않는다.
 *
 * 사용법 (deployments/lcnine/services 에서):
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-40-backfill-refund-kind.ts                       # 조회만 (기본) + 2단계 CSV 저장
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-40-backfill-refund-kind.ts --out /path/x.csv     # CSV 경로 지정
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-40-backfill-refund-kind.ts --apply               # 1단계만 적용
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-40-backfill-refund-kind.ts --apply --from x.csv  # CSV 에 남은 행의 candidate 적용
 *
 * CSV 는 조회만 모드에서만 만든다. `--out` 이 없으면 현재 작업 디렉터리의 `refund-kind-step2-candidates.csv` 이고,
 * 이미 있으면 덮어쓰지 않고 거절한다(사람이 고치는 파일). `--from` 은 `--apply` 와 함께만 쓴다.
 * `--from`/`--out` 은 값이 필수다. `--apply --from` 은 전 행을 먼저 검증한 뒤 한 트랜잭션으로 쓴다.
 * 컬럼: id,amount,created_at,reason_code,reason_message,candidate
 * 전제: wallet `refunds.kind` 컬럼이 이미 배포·마이그레이션되어 있어야 한다(없으면 조회가 실패한다).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { Resource } from 'sst';
import { classifyOldRefund, isKind, Kind, OldRefund } from './1016-40-refund-kind-rules';

const APPLY = process.argv.includes('--apply');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--')) fail(`${flag} 에는 값이 필요하다`);
  return value;
}
const STEP3_EXAMPLES = 20;
const FROM = argValue('--from');
const OUT = argValue('--out') ?? 'refund-kind-step2-candidates.csv';
// DB 에 붙기 전에 거른다 — --from 은 검토한 CSV 를 «적용»하는 용도뿐이다.
if (!APPLY && existsSync(OUT)) fail(`${OUT} 가 이미 있다 — 검토 중인 파일을 덮어쓰지 않는다. --out 으로 다른 경로를 주거나 파일을 지울 것`);
if (FROM !== undefined && !APPLY) fail('--from 은 --apply 와 함께만 쓴다 (조회만 모드에서는 CSV 를 새로 만든다)');

type Conn = { host: string; port: number; username: string; password: string };
type WalletRow = {
  id: string;
  amount: string;
  created_at: Date;
  reason_code: string | null;
  reason_message: string | null;
  purpose: string;
};

const CSV_HEADER = ['id', 'amount', 'created_at', 'reason_code', 'reason_message', 'candidate'];

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC4180 최소 파서 — 따옴표 안의 쉼표·개행·`""` 를 처리한다. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

function connect(database: string, Db: Conn) {
  return postgres({
    host: Db.host,
    port: Db.port,
    username: Db.username,
    password: Db.password,
    database,
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
  });
}

async function applyFromCsv(wallet: postgres.Sql, path: string) {
  const [header, ...rows] = parseCsv(readFileSync(path, 'utf8'));
  const idCol = header.indexOf('id');
  const candCol = header.indexOf('candidate');
  if (idCol < 0 || candCol < 0) throw new Error('CSV 에 id / candidate 컬럼이 없다');

  // 쓰기 전에 전 행을 먼저 검증한다 — 하나라도 틀리면 아무것도 쓰지 않는다.
  const todo: { id: string; kind: Kind }[] = [];
  let blank = 0;
  for (const row of rows) {
    const id = row[idCol];
    const candidate = (row[candCol] ?? '').trim();
    if (!id || candidate === '') {
      blank++; // 사람이 candidate 를 비웠다 — 건너뛴다
      continue;
    }
    if (!isKind(candidate)) throw new Error(`알 수 없는 종류 '${candidate}' (id ${id}) — 아무것도 쓰지 않고 중단한다`);
    todo.push({ id, kind: candidate });
  }

  // postgres 의 TransactionSql 타입 선언은 태그 호출을 잃는다(scripts/sellmate/* 와 같은 이유로 캐스팅).
  let applied = 0;
  await wallet.begin(async (trxRaw) => {
    const trx = trxRaw as unknown as postgres.Sql;
    for (const { id, kind } of todo) {
      const result = await trx`UPDATE refunds SET kind = ${kind} WHERE id = ${id} AND kind IS NULL`;
      applied += result.count;
    }
  });
  console.log(`CSV 적용: ${applied}건 (비움 ${blank}건, 이미 값 있음·없는 id ${todo.length - applied}건)`);
}

async function main() {
  // `Resource` 의 타입 선언에는 `Db` 가 없다(SST 가 배포 시점에 채운다). close-obsolete 스크립트와 같은 이유로 캐스팅한다.
  const Db = (Resource as unknown as { Db: Conn }).Db;
  const wallet = connect('wallet', Db);
  const medusa = connect('medusa', Db);

  try {
    console.log(`모드: ${APPLY ? '적용 (--apply)' : '조회만 — 적용하려면 --apply'}\n`);

    if (APPLY && FROM) {
      await applyFromCsv(wallet, FROM);
      return;
    }

    const rows = await wallet<WalletRow[]>`
      SELECT r.id, r.amount::text AS amount, r.created_at, r.reason_code, r.reason_message, pi.purpose::text AS purpose
        FROM refunds r
        JOIN payment_intents pi ON pi.id = r.intent_id
       WHERE r.kind IS NULL
       ORDER BY r.created_at`;

    // MEDUSA_REFUND 행만 Medusa 노트를 붙인다: payment.data->'walletRefundIds' 에 그 환불 id 가 든 결제의 refund.note.
    const medusaIds = rows.filter((r) => r.reason_code === 'MEDUSA_REFUND').map((r) => r.id);
    const notesById = new Map<string, string[]>();
    if (medusaIds.length > 0) {
      const found = await medusa<{ wallet_refund_ids: string[]; note: string | null }[]>`
        SELECT p.data->'walletRefundIds' AS wallet_refund_ids, r.note
          FROM payment p
          JOIN refund r ON r.payment_id = p.id
         WHERE p.deleted_at IS NULL
           AND r.deleted_at IS NULL
           AND jsonb_typeof(p.data->'walletRefundIds') = 'array'
           AND p.data->'walletRefundIds' ?| ${medusaIds}::text[]`;
      for (const f of found) {
        for (const id of f.wallet_refund_ids) {
          const list = notesById.get(id) ?? [];
          // 노트 없는 환불은 «품목 취소임을 증명 못 함» — 접두사 검사를 통과 못 하는 '' 로 남겨 3단계로 보낸다.
          list.push(f.note ?? '');
          notesById.set(id, list);
        }
      }
    }

    const step1: { id: string; kind: Kind; why: string }[] = [];
    const step2: { row: WalletRow; candidate: Kind; why: string }[] = [];
    const step3: { id: string; why: string }[] = [];
    for (const row of rows) {
      const old: OldRefund = {
        id: row.id,
        reasonCode: row.reason_code,
        reasonMessage: row.reason_message,
        intentPurpose: row.purpose,
        medusaNotes: row.reason_code === 'MEDUSA_REFUND' ? (notesById.get(row.id) ?? null) : null,
      };
      const verdict = classifyOldRefund(old);
      if (verdict.step === 1) step1.push({ id: row.id, kind: verdict.kind, why: verdict.why });
      else if (verdict.step === 2) step2.push({ row, candidate: verdict.candidate, why: verdict.why });
      else step3.push({ id: row.id, why: verdict.why });
    }

    console.log(`kind 가 null 인 행: ${rows.length}건`);
    console.log(`  1단계(확정): ${step1.length}건`);
    console.log(`  2단계(후보, 사람 검토): ${step2.length}건`);
    console.log(`  3단계(미분류로 남김): ${step3.length}건`);

    // 판정 근거(스펙 §7). 1·2단계는 전부, 3단계는 앞 N건만 — 나머지는 건수로 본다.
    if (!APPLY) {
      console.log('\n[1단계] id · kind · 근거');
      for (const v of step1) console.log(`  ${v.id} · ${v.kind} · ${v.why}`);
      console.log('\n[2단계] id · candidate · 근거');
      for (const v of step2) console.log(`  ${v.row.id} · ${v.candidate} · ${v.why}`);
      console.log(`\n[3단계] 앞 ${STEP3_EXAMPLES}건 (전체 ${step3.length}건)`);
      for (const v of step3.slice(0, STEP3_EXAMPLES)) console.log(`  ${v.id} · ${v.why}`);

      const lines = [CSV_HEADER.join(',')];
      for (const { row, candidate } of step2) {
        lines.push(
          [row.id, row.amount, row.created_at.toISOString(), row.reason_code ?? '', row.reason_message ?? '', candidate]
            .map(csvCell)
            .join(','),
        );
      }
      writeFileSync(OUT, `${lines.join('\n')}\n`, { encoding: 'utf8', flag: 'wx' });
      console.log(`\n2단계 후보 CSV 저장: ${OUT}`);
      console.log('\n조회만 했다. 1단계를 적용하려면 --apply, 검토한 CSV 를 적용하려면 --apply --from <csv>.');
      return;
    }

    let applied = 0;
    for (const { id, kind } of step1) {
      const result = await wallet`UPDATE refunds SET kind = ${kind} WHERE id = ${id} AND kind IS NULL`;
      applied += result.count;
    }
    console.log(`\n1단계 적용 완료: ${applied}건`);
  } finally {
    await wallet.end();
    await medusa.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
