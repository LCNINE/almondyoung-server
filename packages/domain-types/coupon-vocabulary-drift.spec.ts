import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COUPON_VISIBILITIES } from './coupon-visibility';

/**
 * 어휘 드리프트 가드 (#488 N3 · ADR-0033 §7).
 *
 * 쿠폰의 두 어휘(`visibility` · `auto_issue_trigger`)는 컴파일러가 닿을 수 없는 곳에도
 * 산다 — Medusa 트리(번들러가 없어 `@packages/*` 를 런타임에 해석하지 못한다), 마이그레이션의
 * DB CHECK 제약(애초에 TypeScript 가 아니다), storefront DTO(읽는 코드가 0곳이라 의존성을
 * 더할 이유가 없다), channel-adapter 의 인라인 시그니처.
 *
 * 그래서 **소스의 리터럴을 읽어 정본과 대조한다.** 값을 하나 늘리면 이 스펙이 그 값을 아직
 * 안 고친 곳을 전부 이름으로 지목한다 — ADR-0033 §7 의 체크리스트를 사람이 지키는 표에서
 * 기계가 지키는 검사로 바꾼 것이다.
 *
 * ⚠️ 이 가드는 **파일 경로와 앵커 정규식에 의존한다.** 선언을 옮기면 앵커가 안 맞아 실패하는데,
 * 그것은 버그가 아니라 의도다 — 조용히 통과하는 가드보다 시끄럽게 죽는 가드가 낫다.
 * 옮겼다면 아래 표의 경로·앵커를 같이 고칠 것.
 *
 * **앵커의 알려진 한계 (2026-08-30 최종 리뷰):**
 * - `visibility\?:` 에 단어 경계가 없다 — `price_visibility?:` 같은 필드가 앞에 생기면 그것에 먼저 걸린다.
 *   결과는 값 불일치로 **시끄럽게** 실패하니 안전 방향이지만 오탐이다.
 * - `String.match` 는 non-global 이라 **같은 형태의 선언이 한 파일에 둘이면 첫 것만** 검사한다.
 */

const REPO_ROOT = join(__dirname, '..', '..');

/** `auto_issue_trigger` 어휘. 정본은 `apps/medusa/.../promotion-meta/service.ts` 이고 여기는 사본이다 — ADR-0033 §7 이 공유 타입을 아직 만들지 않기로 했기 때문이다. */
const AUTO_ISSUE_TRIGGERS = ['customer_registered', 'membership_activated', 'birthday'] as const;

interface Site {
  /** 실패 메시지에 그대로 나가는 사람이 읽는 이름. */
  readonly name: string;
  readonly path: string;
  /** 선언 한 덩어리를 잡는 앵커. 캡처그룹 1번 안의 문자열 리터럴만 본다. */
  readonly anchor: RegExp;
}

function extractVocabulary(site: Site): string[] {
  const source = readFileSync(join(REPO_ROOT, site.path), 'utf8');
  const matched = source.match(site.anchor);
  if (!matched) {
    throw new Error(
      `[어휘 가드] 앵커를 찾지 못했다: ${site.name} (${site.path})\n` +
        `선언이 옮겨졌거나 형태가 바뀌었다. packages/domain-types/coupon-vocabulary-drift.spec.ts 의 앵커를 갱신할 것.`,
    );
  }
  const literals = [...matched[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  return [...new Set(literals)].sort();
}

const VISIBILITY_SITES: Site[] = [
  {
    name: 'medusa PromotionMetaData.visibility 유니온',
    path: 'apps/medusa/src/modules/promotion-meta/service.ts',
    anchor: /visibility\?:\s*([^;]+);/,
  },
  {
    name: 'medusa upsert() 인라인 검증 배열',
    path: 'apps/medusa/src/modules/promotion-meta/service.ts',
    anchor: /\[([^\]]*)\]\.includes\(data\.visibility\)/,
  },
  {
    name: 'DB CHECK 제약 (Migration20260526140000)',
    path: 'apps/medusa/src/modules/promotion-meta/migrations/Migration20260526140000.ts',
    anchor: /visibility IN \(([^)]*)\)/,
  },
  {
    name: 'storefront PromotionDto.visibility 유니온',
    path: 'web/almondyoung-storefront/src/lib/types/dto/promotion.ts',
    anchor: /visibility\?:\s*([^\n]+)/,
  },
];

const TRIGGER_SITES: Site[] = [
  {
    name: 'medusa AutoIssueTrigger 타입',
    path: 'apps/medusa/src/modules/promotion-meta/service.ts',
    anchor: /export type AutoIssueTrigger = ([^;]+);/,
  },
  {
    name: 'medusa upsert() 인라인 검증 배열',
    path: 'apps/medusa/src/modules/promotion-meta/service.ts',
    anchor: /\[([^\]]*)\]\.includes\(data\.auto_issue_trigger\)/,
  },
  {
    name: 'medusa issue-coupons 라우트 VALID_TRIGGERS',
    path: 'apps/medusa/src/api/admin/customers/[id]/issue-coupons/route.ts',
    anchor: /VALID_TRIGGERS[^=]*=\s*\[([^\]]*)\]/,
  },
  {
    name: 'DB CHECK 제약 (Migration20260527100000)',
    path: 'apps/medusa/src/modules/promotion-meta/migrations/Migration20260527100000.ts',
    anchor: /auto_issue_trigger IN \(([^)]*)\)/,
  },
  {
    name: 'channel-adapter issuePromotionsByTrigger 시그니처',
    path: 'apps/channel-adapter/src/adapters/medusa/medusa.client.ts',
    anchor: /issuePromotionsByTrigger\([^)]*?trigger:\s*([^,)]+),/s,
  },
  {
    name: 'admin-web AUTO_ISSUE_TRIGGERS 사본',
    path: 'apps/admin-web/src/features/mall/marketing/coupons/lib/coupon-meta.ts',
    anchor: /AUTO_ISSUE_TRIGGERS\s*=\s*\[([^\]]*)\]/,
  },
];

describe('쿠폰 visibility 어휘는 저장소 전체에서 하나다', () => {
  const expected = [...COUPON_VISIBILITIES].sort();

  // `it.each` 대신 평범한 루프인 것은 의도다 — 타입 추론이 개입하지 않아 루트 `tsc --noEmit`
  // 에서 터질 여지가 없고, 실패 메시지에 사이트 이름이 그대로 나온다.
  for (const site of VISIBILITY_SITES) {
    it(site.name, () => {
      expect(extractVocabulary(site)).toEqual(expected);
    });
  }
});

describe('쿠폰 auto_issue_trigger 어휘는 저장소 전체에서 하나다 (ADR-0033 §7)', () => {
  const expected = [...AUTO_ISSUE_TRIGGERS].sort();

  for (const site of TRIGGER_SITES) {
    it(site.name, () => {
      expect(extractVocabulary(site)).toEqual(expected);
    });
  }
});
