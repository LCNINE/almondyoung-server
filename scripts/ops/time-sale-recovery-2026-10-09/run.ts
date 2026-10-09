/**
 * 실행:
 *   npx tsx scripts/ops/time-sale-recovery-2026-10-09/run.ts --backup <백업.json>            # dry-run (기본)
 *   MEDUSA_ADMIN_API_KEY=sk_... npx tsx scripts/ops/time-sale-recovery-2026-10-09/run.ts \
 *     --backup <백업.json> --medusa https://medusa.almondyoung.com --apply
 *
 * DB 에 직접 쓰지 않는다 — 정상 저장과 같은 `POST /admin/time-sales` 를 부른다(같은 검증·같은 워크플로).
 * 재실행 안전: 같은 이름의 세일이 이미 있으면 건너뛴다.
 */
import { readFileSync } from 'node:fs';
import { reconstruct, type BackupFile, type RecoveryTarget } from './reconstruct';

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

// 새 구조로 옮긴 뒤 지울 옛 리스트(아직 삭제 안 된 것만). 노몬드 둘 + 끝난 인기 상품 둘.
const LEGACY_LISTS_TO_DELETE = [
  'plist_01M40PH53WQFC025YFBND1Z8E7',
  'plist_01M40PH5ACN26W7W8S34T60SZ6',
  'plist_01M4DPPRWYA5FZ7RNPD2QHAD3K',
  'plist_01M4DPPSEFVFZYFZ4BRA32EYKS',
];

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const backupPath = arg('--backup');
  if (!backupPath) throw new Error('--backup <파일> 이 필요합니다.');
  const apply = process.argv.includes('--apply');
  const backup = JSON.parse(readFileSync(backupPath, 'utf8')) as BackupFile;

  // 노몬드 시작·종료는 백업의 실제 값으로 덮는다(위 상수는 표시용 기본값).
  const nomondList = backup.lists.find((l) => l.id === NOMOND.generalListId);
  const nomond = nomondList?.starts_at && nomondList.ends_at
    ? { ...NOMOND, startsAt: new Date(nomondList.starts_at).toISOString(), endsAt: new Date(nomondList.ends_at).toISOString() }
    : NOMOND;

  const plan = reconstruct(backup, [...TARGETS, nomond]);
  console.table(plan.map((e) => ({ name: e.name, status: e.body.status, ...e.summary })));

  if (!apply) {
    console.log('dry-run — 반영하려면 --apply. 위 품목 수·합계를 백업과 대조할 것.');
    return;
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

  const existing = new Set(
    ((await call('/admin/time-sales')).timeSales as Array<{ title: string }>).map((s) => s.title),
  );
  for (const entry of plan) {
    if (existing.has(entry.body.title)) {
      console.log(`건너뜀(이미 있음): ${entry.name}`);
      continue;
    }
    const { timeSale } = await call('/admin/time-sales', { method: 'POST', body: JSON.stringify(entry.body) });
    console.log(`생성: ${entry.name} → ${timeSale.id} (${timeSale.status})`);
  }

  for (const id of LEGACY_LISTS_TO_DELETE) {
    await call(`/admin/price-lists/${id}`, { method: 'DELETE' });
    console.log(`옛 리스트 삭제: ${id}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
