# 타임세일 구현 인계 — 2026-10-07

## 다음 AI에게 맡길 작업

현재 초안을 독립적으로 리뷰하고, 조사된 원본 기능·디자인·토스트를 기준으로 구현을 완성한다. 코드는 미완성이며 승인·배포·완료 상태가 아니다. 사용자 요청으로 기존 구현자는 추가 제품 코드 작성을 멈추고 인계 문서를 작성했다.

작업 경로: `/Users/jeongjungsig/github/almondyoung-server`
브랜치: `feat/time-sale-admin-styles` (develop의 `58f347cd6`에서 시작)
변경은 **커밋되지 않은 작업 트리 + untracked 파일**이다. 브랜치 이름만 체크아웃하면 현재 코드가 전달되지 않는다. 같은 작업 디렉터리에서 이어가거나, 변경 파일과 새 파일을 함께 전달해야 한다. reset/clean/stash/drop으로 초안을 없애지 말 것. 새 브랜치 생성·전환 전에 git status를 확인할 것.

## 정본 자료 — 먼저 읽기

내용을 여기 중복하지 않는다. 세부 기능·수치·원본 동작은 아래 자료가 정본이다.

1. `AGENTS.md`, 루트 `CLAUDE.md` — 저장소 정책과 Medusa 확장 규칙.
2. `docs/time-sale-reference-investigation-2026-10-07.md` — 원본 조사 기록, 요구사항, 우리 시스템의 차이, 검증 기준. 초기 조사 한계는 이후 추가 실험 기록으로 보완됐으므로 파일 전체를 읽을 것.
3. `docs/time-sale-reference-evidence/` — 실제 원본 화면 PNG, AX, DOM, 디자인 수치 JSON. 코드로 추측한 디자인으로 대체하지 말 것.
4. `docs/superpowers/plans/2026-10-07-time-sale-admin-styles.md` — 기존 구현 계획. **5개 작업 모두 미완료 표시가 의도적**이다. 개괄 계획이므로 상세 실행 계획은 리뷰 후 보완할 것.
5. 스토어프론트 작업 전 `web/almondyoung-storefront/CLAUDE.md`, `DESIGN.md`. 사용자의 원본 디자인 복제 지시가 일반 디자인 지침보다 우선하는 부분을 명시할 것.

원본: `https://amit.sweetoffer.co.kr/user_admin_interface/`
사용자는 Chrome/Computer Use로 실제 버튼과 옵션을 하나씩 눌러 조사한 뒤 구현하라고 요청했다. 조사 증거가 있는 기능을 다시 전부 처음부터 조사할 필요는 없다. 미확인 동작이나 디자인 차이는 증거를 확인하고 필요하면 UI로 확인한다.

## 사용자 지시와 승인 범위

- 메인 매대, 더보기 매대, 상품상세 스타일과 타임세일 섹션을 중점적으로 복제.
- 상태 선택, 품절모드, 모바일/PC 전환, 새로고침 포함 실제 동작을 구현.
- 디자인과 토스트까지 복제.
- 환경설정에서 회원 가격 공개 정책과 일반/멤버십 할인 가격을 설정.
- IAP, PV 충전, 외부 서비스 결제/청구·결제내역은 새 타임세일 기능에서 제외. 기존 쇼핑몰 결제 서비스를 제거하라는 뜻이 아님.
- 서버에 저장하고 실제 쇼핑몰에 반영. localStorage 전용 데모로 끝내지 말 것.
- 추가로 필요해 보이는 시스템 항목은 사용자에게 근거와 함께 알려줄 것.
- 새 브랜치에서 작업; 구현은 명시적으로 승인됨. 다시 구현 시작 승인 질문을 하지 말 것.
- 다른 AI의 구현과 독립 리뷰를 원함. 독립 리뷰는 아직 수행되지 않았다.
- 모델 비교 질문은 있었지만 모델 변경 지시는 없었다.

## 현재 초안 구조 — 코드를 읽어 확인

공통 계약/검증/기본값: `packages/domain-types/time-sale.ts`
공통 React 렌더러: `packages/time-sale-ui/index.tsx`

서버:
- `apps/medusa/src/utils/time-sale-settings.ts`: store.metadata 저장, revision 충돌 체크, 기존 locking 사용, 반복 기간 이동, 비회원 가격 비공개 상품 집합.
- `apps/medusa/src/api/admin/time-sale-settings/route.ts`: 설정 GET/POST. 기존 admin 인증 미들웨어 적용 범위 확인 필요.
- `apps/medusa/src/api/store/time-sale/route.ts`: 설정과 세일 목록 제공, 일반/멤버십 numeric price는 이 응답에 담지 않음.
- `apps/medusa/src/utils/time-sale.ts`: admin 조회에서 draft 세일 포함, status 반환.
- `apps/medusa/src/jobs/time-sale-repeat.ts`: 매분 반복. 기존 `time-sale-cache-boundary.ts`는 유지.
- 기존 `membership-filter.ts`와 products 응답 미들웨어에 세일 가격 비공개 처리를 추가.

어드민:
- `.../time-sale/components/time-sale-workspace.tsx` 및 `.css`: 섹션 메뉴, 스타일/속성/프리뷰 3열, 환경설정/변수, 저장/가져오기/초기화/토스트 초안.
- `.../template/marketing-time-sale-template.tsx`: 섹션 목록, 순서, 활성/중지 확인창.
- `.../template/time-sale-form-template.tsx`: 기존 상품/가격 편집에 진열·반복·회원 공개 설정 추가.
- `apps/admin-web/src/lib/services/time-sale.ts`: 기존 pricing API 재사용; 생성은 draft로 생성→설정 저장→활성, 실패 시 삭제 시도. 수정 경로는 여전히 충분한 복구가 없음.
- API 클라이언트와 할인 반올림 함수 변경.

스토어프론트:
- `src/lib/api/medusa/time-sale.ts`: presentation 응답 조회.
- 국가 layout/TimeSaleProvider로 설정 전달.
- 홈 wrapper/configured 컴포넌트, 더보기 페이지, 상품상세 가격 컴포넌트에서 공통 렌더러 사용.
- 기존 고정 카테고리 탭 UI는 wrapper에서 제거된 상태다. 사용자의 원하는 동작과 회귀 여부를 검토해야 한다.

TS 설정에는 공유 React 소스가 호스트 앱의 React 선언을 찾도록 react/jsx-runtime paths가 추가됐다. 임시 해결책에 가까우므로 빌드·런타임·패키지 경계 적합성을 리뷰할 것. 새 의존성 설치는 하지 않았다.

## 우선 수정/확인할 구체적 문제

### P0 — 검증과 가격 정책

1. **최신 어드민 타입 오류:** `time-sale-workspace.tsx`의 `optionLabels: Record<keyof SaleComponent['options'], string>`가 마지막에 추가한 CSS 옵션 키들을 포함하지 않는다. `productCss` 등 9개 키가 누락됐다. 모델 확장을 UI/렌더러에 완전히 연결하거나 사용되지 않는 모델 확장을 정리해야 한다. 오류 로그: `/tmp/time-sale-admin-types.txt`.
2. 비회원 가격 비공개는 제품 응답 필터 초안이다. 숫자를 제거하는 테스트만으로 검색·상세·장바구니·SSR HTML·캐시 누출이 없다고 주장할 수 없다. 모든 실제 호출 경로, 인증 전달, metadata 별칭, 금액 필드와 캐시 키를 추적하여 검사할 것. 가격 공개 제한과 상품 노출/구매 제한은 별도 정책으로 구분.
3. 서버에서 상품/기간/가격 중복 검사와 동시 쓰기 안전성이 완성되지 않았다. 생성의 클라이언트 중복 검사만으로 충분하지 않다. 수정 경로에도 중복 검사가 필요하다. 반복 회차가 다른 세일과 겹치는 경우도 검토.
4. 일반/멤버십 price list 수정과 settings 저장의 부분 실패 복구를 완성할 것. 신규 생성 rollback도 삭제 실패·잔여 설정 처리를 검증할 것. 가격 목록 그룹의 title+startsAt 키가 수정 도중 쪼개질 수 있다.
5. global `environment.enabled`는 현재 진열/반복만 제어하고 price list의 할인 적용을 중지시키지 않는다. 서비스 OFF 동작을 정본 증거와 대조해 가격과 진열에 일관되게 연결할 것. 사용자 승인 없이 기존 draft 세일까지 일괄 활성화하지 말 것.

### P1 — 저장된 옵션이 실제로 작동하도록

6. 최신 추가 `stateCss`, `productTexts`, product/soldout/scheduled/ended/badge/overlay/image/header/footer CSS는 **모델·검증만 추가됐고 UI와 렌더러는 아직 사용하지 않는다.**
7. 렌더러에서 carousel dots, duration, environment.imageSize 등 일부 저장 옵션이 실제 사용되지 않는다. 배지 11종은 이름 선택만 있고 실제 서로 다른 도형은 아직 구현되지 않았다. 플립 타이머는 정적인 그라디언트이며 원본의 실제 플립 동작 구현이 아니다.
8. 프리뷰의 `end = now + duration` 때문에 tick마다 기준이 이동해 남은 시간이 줄지 않는다. 상태 전환 기준을 고정하고 새로고침 동작까지 검증.
9. 변수 값은 현재 세일 단위다. UI 안내는 상품별이라고 적혀 있으나 상품별 편집·저장·값 매핑은 미구현. 원본의 per-product 변수와 사용자 요구에 맞게 수정.
10. 스타일 라이브러리 신규 생성 시 savedStyles에 snapshot을 추가하지만 활성 layout.id를 연결하지 않는다. 스타일 삭제 버튼이 비활성인 채 남을 수 있고 수정/다시 저장 시 library snapshot 반영이 없다. Header/Footer/컨테이너 저장 범위도 검토.
11. 원본 목록의 파티션/웹 ID/반복/진열·품절 옵션/선택 일괄 작업 등은 현재 표에 모두 재현되지 않았다. 폼에서 가능한 옵션과 목록 요구를 증거 기반으로 매핑할 것.
12. 원본의 상품별 기간 방식은 미구현. Cafe24 연동형은 우리 시스템에 직접 복제할 필요가 없지만 상품별 기간 기능을 조용히 생략하지 말 것.
13. 더보기 wrapper에 기존 MAX_PRODUCTS=100 한도가 남아 있다. 홈 10개 제한은 제거됐지만 전체 대상 상품과 페이지네이션 요구를 충족하는지 추가 검증.
14. 상품상세 렌더러에 `products=[]`가 전달돼 상세 스타일에 상품 carousel/grid를 추가하면 빈다. 추천/현재 상품 데이터 정책을 구현할 것.
15. 미저장 경고는 beforeunload만 있다. 내부 라우트 이동·dirty 상태 refetch에 대한 변경 보존/취소 기능, 모달의 focus trap/Escape/복귀, 프리뷰 링크의 의도치 않은 페이지 이탈을 확인할 것.
16. 원본 이미지·패널 폭·타이포·토스트·상태별 스타일과 실제 화면 비교가 미완료다. 현재 디자인은 초안이며 픽셀 동일 복제라고 주장하지 말 것.

## 검증 사실 — 완료 주장과 구분

2026-10-07 인계 작성 중 새로 실행:

```sh
yarn --cwd apps/medusa test:unit --watchman=false --runTestsByPath \
  src/utils/__tests__/time-sale-settings.unit.spec.ts \
  src/utils/__tests__/membership-filter.unit.spec.ts \
  src/utils/__tests__/time-sale.unit.spec.ts
```
결과: 3 suites, **45 tests 통과**. 설정 trust boundary/반복 함수, 비회원 필터, 기존 세일·캐시 경계 테스트. 서버 설정 저장/락/반복 잡 전체 통합 검증을 의미하지 않는다.

```sh
yarn --ignore-engines test --watchman=false --runInBand --runTestsByPath \
  apps/admin-web/src/features/mall/marketing/time-sale/time-sale-model.spec.ts
```
결과: 1 suite, **30 tests 통과**. 환경 Node 25, 저장소 요구 Node >=22 <23라 해당 실행은 ignore-engines를 사용했다. 최종 검증은 지원 Node 22 환경을 우선할 것. Watchman은 샌드박스 경로 권한 오류가 있어 --watchman=false 사용.

어드민 tsc는 마지막 모델 확장 전에는 통과했으나 **현재는 위 P0 타입 오류로 실패**한다. 이전 진행 메시지의 타입 통과를 최신 상태로 해석하지 말 것.
Medusa tsc를 인계 시 새로 실행했으며 현재 보고된 오류는 다음 3개다:
- `src/admin/lib/sdk.ts` import.meta / CommonJS 2개.
- `src/api/store/orders/[id]/__tests__/confirm-purchase.unit.spec.ts` workflow 경로 1개.
위 경로는 이번 변경 파일이 아니다. 기반 브랜치와 대조 전에는 기존 오류라고 단정하지 말 것. 로그 `/tmp/time-sale-handoff-medusa-types.txt`.
스토어프론트 전체 tsc는 다른 경로의 다수 오류로 실패했다. 기반 오류 분리와 변경 파일 재검증이 필요. `/tmp/time-sale-storefront-types.txt`.

Chrome 로컬 `http://localhost:8002/mall/marketing/time-sale`에서 기존 계정 선택 로그인 후 목록과 메인 스타일 편집기가 렌더되는 것은 확인했다. 컨테이너 padding을 16px로 바꾸고 저장을 클릭했으나 마지막 관찰은 '저장 중…'였다. **저장 성공/재진입 복원은 확인하지 못했다.** 현재 그 탭은 종료됐다. 재검증 시작 시 해당 설정이 테스트 값으로 저장됐는지 확인하고 안전하게 복원할 것.
외부 원본의 기존 검증 객체들은 조사 문서/증거에서 확인 가능. 일부 테스트 세일/스타일/변수가 남아 있고 서비스 OFF 상태였다. 외부 영구 삭제는 별도 승인 없이 수행하지 말 것. 원본의 실제 상품 가격 변경/복원 실험은 지정 상품을 받지 못해 완료하지 못했다.

## 이어서 작업하는 순서

1. git status와 diff, 정본 자료, 변경 파일 전체를 읽는다. untracked를 포함한다.
2. 독립 리뷰 결과를 중요도별로 기록한다. 기존 초안을 무조건 버리거나 완성됐다고 가정하지 않는다.
3. P0 수정 → 핵심 API/저장/권한 계약 확정 → P1 기능·디자인 완성 순으로 작은 변경을 한다.
4. 요구사항별로 구현 경로·테스트·스크린샷 증거를 연결한 검증표를 갱신한다.
5. 타입/테스트/실제 브라우저 저장 복원·상태 3종 × 모바일/PC × 품절 검증. 비회원/일반회원/멤버십의 API·SSR·캐시·카트 가격 검증.
6. 독립 코드 리뷰 후 중요 결함을 수정하고 재검증한다. 남은 기능을 완료로 표시하지 않는다.
7. 사용자에게 실제 완료 범위와 남은 제한을 명확히 보고. 사용자 승인 없는 공유 브랜치 push/merge/deploy는 하지 않는다.

## Suggested skills

- `handoff`: 다른 세션으로 다시 넘길 때 상태를 갱신.
- `review` 또는 `superpowers:requesting-code-review`: 현재 미완성 diff의 독립 리뷰.
- `superpowers:writing-plans`, `superpowers:executing-plans`: 상세 계약과 현재 진행 상태를 반영해 계획 보완·실행.
- `superpowers:test-driven-development`, `superpowers:verification-before-completion`: 가격/보안/반복/저장 검증과 완료 근거.
- `ego-browser`: 브라우저 조사·로컬 UI 검증 시 읽고 Computer Use로 실제 조작.
- `ponytail:ponytail`: 기존 Medusa 가격/설정/권한 경로 재사용. 단, 사용자가 요청한 기능과 보안 검증을 생략하지 않는다.

스킬은 다음 AI 환경에 실제 존재하는 것을 사용한다. 이 인계 문서를 이유로 새 외부 서비스 권한을 부여하거나 인증을 우회하지 않는다.
