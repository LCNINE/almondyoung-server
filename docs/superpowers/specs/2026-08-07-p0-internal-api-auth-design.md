# P0 무인증 내부 API 2건 — 내부키 인증 설계

> 상위 문서: `docs/api-authz-audit-2026-08.md` §2 P0
> 작성: 2026-08-07

## 1. 문제

`@Public()` 만 붙고 키 검증이 없어 공개 ALB 에서 누구나 호출 가능한 내부 API 2건.

| # | 라우트 | 위치 |
|---|---|---|
| P0-1 | `POST /reviews/eligibilities` | `apps/ugc-service/src/reviews/controllers/review-eligibility.controller.ts:18` |
| P0-2 | `POST /membership/benefits/internal/record`<br>`POST /membership/benefits/internal/cancel` | `apps/membership/src/controllers/benefit-tracking.controller.ts:14,33` |

**P0-1 은 금전 영향이다.** `CreateReviewEligibilityDto` 가 `userId` 를 바디로 받으므로 인증 없이
임의 사용자에게 리뷰 작성 자격을 부여할 수 있고, 리뷰 작성 →
`review-reward-publisher.service.ts:23` 이 `EarnPointsRequested` 발행 →
`apps/wallet/.../ugc-command.consumer.ts:15` 가 포인트를 적립한다.

P0-2 는 임의 `userId` 의 멤버십 절약액 조작, `cancel` 은 `orderId` 만으로 남의 기록 취소.

## 2. 감사 문서에 없던 발견 2건

### 2-1. `POST /reviews/eligibilities` 의 두 번째 호출자는 이미 죽어 있다

`web/almondyoung-storefront/src/lib/api/ugc/reviews.ts:148` 이 **고객 토큰**으로 같은 라우트를
호출한다 (`orders.ts:174`, `confirm-purchase` 직후). 그런데 바디가 `{ orderId, items }` 로
**`userId` 가 없다** — ugc DTO 는 `@IsUUID() @IsNotEmpty() userId` 를 요구하므로 **항상 400**이고,
`orders.ts:175` 의 try/catch 가 그 실패를 삼킨다.

즉 실제로 동작하는 호출자는 Medusa 워크플로 스텝 하나뿐이고, 스토어프론트 호출은 같은 일을
중복 시도하다 조용히 실패해 온 죽은 코드다. **누군가 나중에 `userId` 를 채워 "고쳐 놓으면"
그 순간 취약점이 되살아나므로 삭제한다.**

### 2-2. ugc 가 401 을 내면 결제 캡처가 롤백된다

`confirm-purchase-workflow.ts` 에서 `createReviewEligibilityStep` 은 **step 2** 이고,
step 2 실패는 step 1(`captureOrderPaymentsStep`)을 롤백시킨다. 가드가 키보다 먼저 뜨면
리뷰 자격 유실이 아니라 **고객 구매확정 자체가 실패**한다. membership 쪽은 로그만 남는 것과
위험도가 다르다.

그런데 **Medusa·ugc·membership 이 한 `sst deploy` 로 같이 뜬다** — 한 배포 안에서 태스크 교체
순서를 통제할 수 없다. 따라서 "키 보내는 쪽 먼저"는 PR 분리가 아니라 **배포 분리**여야 한다.

## 3. 설계

### PR1 — 호출자가 키를 보낸다 (배포 A)

단독으로 무해하다: 받는 쪽에 가드가 없으므로 헤더는 그냥 무시된다.

1. **SST 배선** — `deployments/lcnine/services/infra/services.ts`
   - `const ugcInternalKey = new sst.Secret('UgcInternalKey')` (membership 시크릿 옆)
   - `ugcEnv` 에 `UGC_INTERNAL_KEY: ugcInternalKey.value`
     - `withPrefix('UGC', …)` 가 `UGC__UGC_INTERNAL_KEY` 로 내보내고 컨테이너의 `supervisor.mjs`
       가 프리픽스를 벗겨 프로세스엔 `UGC_INTERNAL_KEY` 로 도착한다 (membership 과 같은 관용구)
   - Medusa 서비스 env 에 `UGC_INTERNAL_KEY` 추가 (`UGC_SERVICE_URL` 옆)
   - **사람 선행작업**: `sst secret set UgcInternalKey <값> --stage live`.
     안 하면 배포 A 자체가 실패한다.

2. **`apps/medusa/src/workflows/orders/steps/create-review-eligibility-step.ts`**
   - `Authorization: Bearer ${UGC_INTERNAL_KEY}` 추가
   - 키 미설정 시 `UGC_SERVICE_URL` 과 **동일하게 throw**. 조용히 헤더를 빠뜨리면 배포 B 에서
     결제 캡처 롤백으로 터진다 — 지금 크게 우는 쪽이 안전하다.

3. **`apps/medusa/src/subscribers/membership-benefit-order.ts`**
   - `record`(248)·`cancel`(275) 양쪽에 `Authorization: Bearer ${MEMBERSHIP_INTERNAL_KEY}` 추가
     (env 는 `services.ts:539` 에 이미 있다)
   - **`cancel` 에 `res.ok` 검사 + 에러 로그 추가**. 현재 응답을 안 보므로 키가 틀리면 영영 모른다
     (`record` 에는 이미 있다)

4. **스토어프론트 죽은 경로 삭제** (§2-1)
   - `src/lib/api/ugc/reviews.ts` — `createReviewEligibility` 함수
   - `src/lib/types/dto/ugc.ts` — `CreateReviewEligibilityDto` 타입 + export
   - `src/lib/api/medusa/orders.ts` — 호출부(172-179) + 미사용이 되는 `items` 파라미터
   - `orderItems` prop 배선 — `order-actions.tsx`, `order-list.tsx`,
     `shipping-items-wrapper.tsx`, `mypage-types.ts`
   - 동작 변화 0 (현재 400 → 삼켜짐).

### PR2 — 가드 부착 (배포 B)

단독으로 무해하다: 키는 배포 A 이후 이미 오고 있다.

5. **ugc 내부키 가드 신설** — `apps/ugc-service/src/shared/` (신규 디렉터리), membership 구조 복제
   - `guards/internal-api-key.guard.ts` — `UGC_INTERNAL_KEY` 검증.
     **키 미설정이면 전부 거부(fail-closed)** — 무인증으로 열리는 것보다 호출자가 즉시 실패를
     보는 쪽이 안전하다
   - `decorators/internal-auth.decorator.ts` —
     `UgcInternalAuth = () => applyDecorators(Public(), UseGuards(UgcInternalApiKeyGuard))`
   - 공용 lib 추출은 하지 않는다. 보안 PR 범위를 ugc 로 가두어 membership·channel-adapter 회귀
     위험을 만들지 않는다. 사본 3개 통합은 별도 리팩토링 이슈로 남긴다.

6. **라우트 3개 전환**
   - ugc `create`: `@Public()` → `@UgcInternalAuth()`
   - membership `record`/`cancel`: `@Public()` → `@MembershipInternalAuth()`

7. **감사 도구 갱신** — `scripts/security/route-authz-audit.js` 의 `APPS['ugc-service'].authz` 에
   `'UgcInternalAuth'` 추가. 안 하면 고친 라우트가 "인가 표시 없음"으로 오분류된다
   (감사문서 §3-1 그대로).

8. **문서 갱신** — `docs/api-authz-audit-2026-08.md` P0 항목 🟩 + §2 발견 2건 기록.

## 4. 테스트

- `apps/ugc-service/.../internal-api-key.guard.spec.ts` (신규)
- `apps/membership/.../internal-api-key.guard.spec.ts` (신규 — 현재 spec 0개)
  - 케이스: 키 미설정 → 401 / 헤더 없음 → 401 / 토큰 불일치 → 401 / 일치 → 통과
- **바인딩 회귀 spec** — 두 컨트롤러 핸들러에 가드가 실제로 붙어 있는지 `Reflect.getMetadata`
  로 검사. 이번 사고가 정확히 "데코레이터를 빠뜨림"이라 이게 진짜 방어선이다
  (`apps/core/src/platform/auth/scope-guard-binding.spec.ts` 선례).

## 5. 검증

- `node scripts/security/route-authz-audit.js` → `[A] 무력화 0` 유지,
  ugc 버킷 C 1건 → 0, membership 버킷 C 2건 감소
- `npx jest apps/ugc-service apps/membership` — 감사문서 §3-3 기준선 대비 신규 실패 0
- 변경 파일 타입체크: 루트에 임시 tsconfig 생성 (감사문서 §3-2 — `type-check:scoped` 의
  include 는 bulk-session 등 5개뿐이라 이 파일들이 안 들어간다)
- 스토어프론트: `npm run build` (또는 `tsc --noEmit`) 로 prop 제거 누락 확인

## 6. 배포 순서 (어기면 고객 구매확정이 깨진다)

1. `sst secret set UgcInternalKey <값> --stage live`
2. PR1 머지 → `sst deploy --stage live`
3. **배포 A 완료 확인** (Medusa 태스크가 새 이미지로 교체됐는지)
4. PR2 머지 → `sst deploy --stage live`

마이그레이션 0건. 롤백은 각 PR revert 로 대칭이다 (PR2 revert 는 구멍을 다시 열지만 장애는 없고,
PR1 revert 는 PR2 가 살아있으면 401 을 만드므로 **PR2 → PR1 역순**으로만 되돌린다).

## 7. 범위 밖 (의도적)

- `cancelDiscount` 가 `new Error(...)` 로 500 을 내는 것 — 가드가 붙으면 신뢰된 호출자만
  닿으므로 급하지 않다. 상태코드 변경은 별건.
- 내부키 가드 사본 3개(channel-adapter·membership·ugc) 통합.
- P0-2 `cancel` 의 소유권 바인딩 — 내부키로 호출자가 신뢰되면 IDOR 이 성립하지 않는다.
