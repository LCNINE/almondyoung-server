/**
 * 일회성 데이터 전환: "멤버십 회원 전용 노출"(완전 숨김) → "멤버십 전용 구매"(노출·크롤링 O, 구매 X)
 *
 * 배경: 멤버십 상품 17개가 isVisibleToMembersOnly 로 걸려 있어 비회원·검색엔진·카톡 스크래퍼에
 * 404 가 나갔다. 링크 공유 미리보기가 상품이 아니라 사이트 기본 og-image 로 뜨는 원인.
 * 노출은 열되 구매만 막는 건 이미 requiresMembership 이 하는 일이라 플래그만 갈아끼운다.
 *
 * 제외 대상(그대로 완전 숨김 유지): 퍼마 브랜드 101개, [멤버십 전용] 접두어 글루 3종.
 *
 * Core API 를 쓴다 — DB 직접 수정과 달리 ProductActiveVersionChanged 가 발행돼
 * Medusa product.metadata 까지 자동 전파된다.
 *
 * 기본은 dry-run (현재 상태 조회만). `--apply` 를 줘야 PATCH 실행.
 * live 는 `--allow-live` 를 명시해야 실행된다.
 * 되돌리려면 `--revert` (노출 ON / 구매게이트 OFF 로 원복).
 *
 * Usage:
 *   CORE_ADMIN_TOKEN=<accessToken> npx tsx scripts/flip-members-only-to-purchase-gate.ts
 *   CORE_ADMIN_TOKEN=<accessToken> npx tsx scripts/flip-members-only-to-purchase-gate.ts --apply --allow-live
 *   CORE_ADMIN_TOKEN=<accessToken> npx tsx scripts/flip-members-only-to-purchase-gate.ts --apply --allow-live --revert
 */

const CORE_BASE_URL = process.env.CORE_API_URL ?? 'https://core.almondyoung.com';

/** Core masterId (= Medusa handle = 스토어프론트 URL 의 UUID). 제목 매칭은 쓰지 않는다. */
const TARGETS: Record<string, string> = {
  'cb16f068-2a0f-42c5-a9ea-b9265f5f53c4': 'VEGA 베가 반영구 색소 10ml',
  '5302f5cf-3b24-4122-9950-3002c062e038': '노몬드 색소 (리퀴드)',
  'ef8d7ea4-f01b-420a-86b1-8c5e54c3441b': '노몬드 색소 (에멀젼)',
  'a1d7402c-079d-4f99-801a-bb7f023fe7fc': '루가 루가컨투어 색소 모음',
  '2a3480b6-ce82-4165-894a-8653567f853d': '래쉬클리닉 래쉬 케어 시스템 10ml',
  '019fac2e-2510-7329-8bf1-b9dd4e807867': '래쉬트리 영양제 5ml 블랙/투명 듀얼',
  '019fac31-a598-70ea-9db7-23f739e39958': '래쉬트리 영양제 5ml 투명 듀얼',
  '019fb5e2-4c04-7745-bbd2-8d466ec6cf7b': '모먼트 아이래쉬 클리닉 패드 150ml',
  '019fab8a-c8b1-7039-9c4c-0c9316282d1d': '미니롱 펌제 1제2제',
  'b3713045-c508-406b-b194-c6d82fc83ec6': '순 LED 글루 5g 인시아노',
  '019f890c-ab2b-7605-b12a-ed45a850f202': '스노우 래쉬 버터 10ml 투명 듀얼 에센스',
  '019f891b-a459-77fd-84a1-de87a9050f77': '스노우 래쉬 버터 10ml 투명/블랙 듀얼 에센스',
  '019fa74f-38b6-77eb-885d-8863955060a5': '올라가 펌제 1제 단품',
  '019f4063-187e-7771-a7fa-a2c0f79bb01e': '올라가 펌제 1제2제',
  'cc22185a-bfc8-4725-b6e9-011f83b55290': '잘마라 펌제 1제2제 10개입',
  '0aeb00a8-afe9-4372-9964-aa17b6a2e9b9': '펌 젤루 10ml',
  '019fa7bd-8cde-774e-8819-1fcbb153856b': '펑키블랙 영양제 5ml',
};
const EXPECTED_COUNT = Object.keys(TARGETS).length; // 17

async function patch(token: string, masterId: string, path: string, body: unknown) {
  const res = await fetch(`${CORE_BASE_URL}/masters/${masterId}/${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`PATCH ${path} ${masterId} → ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const revert = process.argv.includes('--revert');
  const allowLive = process.argv.includes('--allow-live');

  const token = process.env.CORE_ADMIN_TOKEN;
  if (!token) {
    console.error('CORE_ADMIN_TOKEN 이 없습니다. admin.almondyoung.com 의 accessToken 쿠키 값을 넣으세요.');
    process.exit(1);
  }

  const isLive = CORE_BASE_URL.includes('almondyoung.com');
  if (isLive && apply && !allowLive) {
    console.error('live 거부 — live 에 실행하려면 --allow-live 를 명시하세요.');
    process.exit(1);
  }

  // 노출 차단 해제 + 구매 게이트 적용이 한 세트다. 하나만 적용되면
  // (노출만 열림) 비회원이 그대로 구매 가능해지므로 순서를 뒤집지 말 것 —
  // 구매 게이트를 먼저 걸고 노출을 연다.
  const requiresMembership = !revert;
  const isVisibleToMembersOnly = revert;

  console.log(`${CORE_BASE_URL} | ${EXPECTED_COUNT}개 | ${revert ? 'REVERT' : 'FLIP'} | ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`  requiresMembership=${requiresMembership}, isVisibleToMembersOnly=${isVisibleToMembersOnly}\n`);

  if (!apply) {
    for (const [masterId, title] of Object.entries(TARGETS)) {
      console.log(`  [dry-run] ${title}  (${masterId})`);
    }
    console.log('\n--apply 를 붙여야 실제로 반영됩니다.');
    return;
  }

  const failures: string[] = [];
  for (const [masterId, title] of Object.entries(TARGETS)) {
    try {
      await patch(token, masterId, 'requires-membership', { requiresMembership });
      await patch(token, masterId, 'members-only-visibility', { isVisibleToMembersOnly });
      console.log(`  ✓ ${title}`);
    } catch (error) {
      failures.push(`${title}: ${(error as Error).message}`);
      console.error(`  ✗ ${title} — ${(error as Error).message}`);
    }
  }

  console.log(`\n성공 ${EXPECTED_COUNT - failures.length} / 실패 ${failures.length}`);
  if (failures.length > 0) process.exit(1);
}

void main();
