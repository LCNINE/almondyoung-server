/**
 * 실행:
 *   npx tsx scripts/ops/time-sale-recovery-2026-10-09/run.ts --backup <백업.json>            # dry-run (기본)
 *   MEDUSA_ADMIN_API_KEY=sk_... npx tsx scripts/ops/time-sale-recovery-2026-10-09/run.ts \
 *     --backup <백업.json> --medusa https://medusa.almondyoung.com --apply
 *
 * DB 에 직접 쓰지 않는다 — 정상 저장과 같은 `POST /admin/time-sales` 를 부른다(같은 검증·같은 워크플로).
 * 재실행 안전: 같은 이름의 세일이 이미 있으면 만들지 않고, 옛 리스트는 404(이미 지움)를 건너뛴다.
 * 옛 리스트 삭제는 그 리스트의 대체 세일이 계획과 맞게 살아 있을 때만 한다(제목만 보지 않는다).
 */
import { readFileSync } from 'node:fs';
import {
  reconstruct,
  replacementMismatches,
  type BackupFile,
  type RecoveryPlanEntry,
  type RecoveryTarget,
  type ReplacementSale,
} from './reconstruct';

// 10-09 KST 00:00 ~ 10-16 KST 23:59. 인기 상품과 ①의 일반용은 운영자가 종료를 당겨 끝내 원래 종료가
// 남아 있지 않다 — 모두 이 기간으로 넣고, 운영자가 공개 전에 고친다.
const STARTS_AT = '2026-10-08T15:00:00.000Z';
const ENDS_AT = '2026-10-16T14:59:00.000Z';

const TARGETS: RecoveryTarget[] = [
  { name: '복구 ① 741품목', generalListId: 'plist_01M4B2Y5X9NR2VY2CSSDEDQ88J', membershipListIds: ['plist_01M4B2Y76621BA5XXCNY3JTQ1Z', 'plist_01M4B4T0N4YMPM9D8M885A9EAQ'] },
  { name: '복구 ② 642품목', generalListId: 'plist_01M4CKCFD3GQR19EF4QKS8MH0D', membershipListIds: ['plist_01M4CKCGD13VQBGPF7WRMXM5F8'] },
  { name: '복구 ③ 400품목', generalListId: 'plist_01M4B9MY88N7TJD8HSN1QCBNEN', membershipListIds: ['plist_01M4B9MYZWX2QH4BQ7K8A7K78P'] },
  { name: '복구 ④ 322품목', generalListId: 'plist_01M4CH5TRSDSSACGT9ZKBQDG9P', membershipListIds: ['plist_01M4CH5VG16XN7PBJANGG4Y4HC'] },
  { name: '복구 ⑤ 87품목', generalListId: 'plist_01M4DSVM1PEP2TBSD1WZ4RHGYY', membershipListIds: ['plist_01M4DSVMJ2HJDY57Y0BCW4WA88'] },
  { name: '인기 상품 타임 세일', generalListId: 'plist_01M4DPPRWYA5FZ7RNPD2QHAD3K', membershipListIds: ['plist_01M4DPPSEFVFZYFZ4BRA32EYKS'] },
].map((t) => ({ ...t, status: 'draft' as const, startsAt: STARTS_AT, endsAt: ENDS_AT }));

// 진행 중인 노몬드: 같은 기간·같은 가격의 active 세일로 옮긴 뒤 옛 리스트를 지운다.
const NOMOND: RecoveryTarget = {
  name: '노몬드 펌제 글루 출시 타임 세일',
  generalListId: 'plist_01M40PH53WQFC025YFBND1Z8E7',
  membershipListIds: ['plist_01M40PH5ACN26W7W8S34T60SZ6'],
  status: 'active',
  startsAt: '2026-10-03T10:50:00.000Z',
  endsAt: '2026-10-16T14:59:00.000Z',
};

// 옛 리스트 → 대체 세일. 그룹 단위로 대체 세일을 검증한 뒤에만 그 그룹의 리스트를 지운다.
const LEGACY_GROUPS: Array<{ replacementName: string; listIds: string[] }> = [
  {
    replacementName: NOMOND.name,
    listIds: [NOMOND.generalListId, ...NOMOND.membershipListIds],
  },
  {
    replacementName: '인기 상품 타임 세일',
    listIds: ['plist_01M4DPPRWYA5FZ7RNPD2QHAD3K', 'plist_01M4DPPSEFVFZYFZ4BRA32EYKS'],
  },
];

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

type Outcome = { name: string; entry?: RecoveryPlanEntry; error?: string };

async function main() {
  const backupPath = arg('--backup');
  if (!backupPath) throw new Error('--backup <파일> 이 필요합니다.');
  const apply = process.argv.includes('--apply');
  // JSON.parse 는 형태를 검사하지 않으므로 캐스트한다 — 백업은 이 저장소의 덤프 스크립트가 만든 파일이고,
  // 실제 값은 reconstruct() 가 금액·묶음 대조로 한 번 더 확인한다.
  const backup = JSON.parse(readFileSync(backupPath, 'utf8')) as BackupFile;

  // 노몬드 시작·종료는 백업의 실제 값으로 덮는다(위 상수는 표시용 기본값).
  const nomondList = backup.lists.find((l) => l.id === NOMOND.generalListId);
  let nomond = NOMOND;
  if (nomondList?.starts_at && nomondList.ends_at) {
    nomond = {
      ...NOMOND,
      startsAt: new Date(nomondList.starts_at).toISOString(),
      endsAt: new Date(nomondList.ends_at).toISOString(),
    };
  } else {
    console.log('노몬드 기간: 백업 리스트에 기간이 없어 코드의 기본값을 쓴다');
  }

  // 대상마다 따로 재구성한다 — 한 대상이 던져도 나머지 표는 찍는다.
  const outcomes: Outcome[] = [...TARGETS, nomond].map((target) => {
    try {
      return { name: target.name, entry: reconstruct(backup, [target])[0] };
    } catch (error) {
      return { name: target.name, error: error instanceof Error ? error.message : String(error) };
    }
  });
  console.table(
    outcomes.map((o) =>
      o.entry
        ? { name: o.name, status: o.entry.body.status, ...o.entry.summary, error: '' }
        : { name: o.name, error: o.error },
    ),
  );
  const failed = outcomes.filter((o) => o.error !== undefined);
  const plan = outcomes.flatMap((o) => (o.entry ? [o.entry] : []));

  if (!apply) {
    console.log(
      failed.length > 0
        ? `dry-run — 오류 대상 ${failed.length}개. --apply 는 오류가 하나라도 있으면 거부된다.`
        : 'dry-run — 반영하려면 --apply. 위 품목 수·합계를 백업과 대조할 것.',
    );
    return;
  }

  if (failed.length > 0) {
    console.error(`--apply 거부: 오류 대상 ${failed.length}개 — ${failed.map((f) => f.name).join(', ')}`);
    process.exit(1);
  }

  const base = arg('--medusa');
  const key = process.env.MEDUSA_ADMIN_API_KEY;
  if (!base || !key) throw new Error('--medusa <URL> 와 MEDUSA_ADMIN_API_KEY 가 필요합니다.');
  const headers = {
    'content-type': 'application/json',
    // Medusa secret API key 는 Basic 인증(키를 사용자명, 비밀번호 비움)으로 보낸다.
    authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
  };
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${base}${path}`, { ...init, headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  // 404 는 «이미 지워짐» 으로 본다 — 재실행이 옛 리스트 때문에 죽지 않게. 그 밖의 실패는 던진다.
  const remove = async (path: string): Promise<boolean> => {
    const res = await fetch(`${base}${path}`, { method: 'DELETE', headers });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`DELETE ${path} → ${res.status} ${await res.text()}`);
    return true;
  };
  // 응답 형태는 apps/medusa 의 관리자 DTO 와 같다고 가정한다. 실제 값은 replacementMismatches 가 대조한다.
  type AdminSale = ReplacementSale & { title: string };
  const listSales = async (): Promise<AdminSale[]> => (await call('/admin/time-sales')).timeSales;

  const existing = new Set((await listSales()).map((s) => s.title));
  for (const entry of plan) {
    if (existing.has(entry.body.title)) {
      console.log(`건너뜀(이미 있음): ${entry.name}`);
      continue;
    }
    const { timeSale } = await call('/admin/time-sales', { method: 'POST', body: JSON.stringify(entry.body) });
    console.log(`생성: ${entry.name} → ${timeSale.id} (${timeSale.status})`);
  }

  // 옛 리스트 삭제: 그룹마다 새로 읽은 목록에서 대체 세일을 찾아 계획과 대조하고, 맞을 때만 지운다.
  const sales = await listSales();
  let skipped = 0;
  for (const group of LEGACY_GROUPS) {
    const entry = plan.find((e) => e.body.title === group.replacementName);
    const sale = sales.find((s) => s.title === group.replacementName);
    const reasons = !entry
      ? ['계획 항목 없음']
      : !sale
        ? ['대체 세일 없음']
        : replacementMismatches(entry, sale);
    if (reasons.length > 0) {
      skipped += 1;
      console.warn(`!! 옛 리스트 삭제 건너뜀 — ${group.replacementName}: ${reasons.join('; ')}`);
      continue;
    }
    for (const id of group.listIds) {
      const deleted = await remove(`/admin/price-lists/${id}`);
      console.log(deleted ? `옛 리스트 삭제: ${id}` : `이미 삭제됨(404): ${id}`);
    }
  }
  if (skipped > 0) {
    console.error(`옛 리스트 ${skipped}개 그룹의 삭제를 건너뛰었다 — 대체 세일을 확인한 뒤 재실행할 것.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
