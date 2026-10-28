# 구매 만족도 (결제 완료 화면 별점 + 사유) 설계

작성일 2026-10-28. 시안: https://claude.ai/artifact/DozcVMUK9BAGk3CbVJEqnq
근거 조사: 세션 리서치 보고서 두 편(구매 만족도 피드백 UX, 만족도 사유 칩 실사례) — 결론만 아래 근거에 옮긴다.

## 목표

결제 완료 화면의 별점 카드가 지금은 화면 상태만 바꾸고 아무것도 저장하지 않는다.
고객이 주문하면서 겪은 어려움을 별점과 사유로 받아 저장하고, 운영팀이 어드민에서 모아 보고 저점수를 확인 처리할 수 있게 한다.

성공 기준
- 결제 완료 화면에서 별을 누르면 그 주문의 만족도가 저장된다(주문당 1건, 다시 누르면 덮어씀).
- 3점 이하일 때 사유 칩(여러 개)과 메모(선택, 300자)를 받는다.
- 어드민 `/cs/purchase-satisfaction` 에서 요약·분포·사유 집계·목록을 보고, 3점 이하를 확인 처리한다.
- 어드민 주문내역(`/order/history`) 상세 패널에 그 주문의 만족도가 보인다.
- GA4 에 별점·사유 개수 이벤트가 남는다.

## 근거 (요약)

- 결제 과정 만족도에 사유 칩을 붙인 공개 선례는 국내외에서 확인하지 못했다. 칩 형식(4~12자 해요체 문장, 저점수 전용 묶음, 여러 개 선택)만 당근·카카오T·네이버에서 가져온다.
- 칩 내용은 live 데이터에서 골랐다: 결제창 이탈 19%(그중 64% 가 2시간 안 재결제), 환불 사유(현금영수증 신청 실패 등), 1:1 문의(배송지 동·호수 누락, 카드결제 가능 여부).
- 리뷰 별점이 5점에 쏠려 있어 4점도 불만일 수 있으나, 사용자 결정으로 사유는 3점 이하만 묻는다.

## 고객 화면 (storefront)

위치: `web/almondyoung-storefront/src/app/[countryCode]/(checkout)/checkout/success/[intentId]/page.tsx`.
기존 `ReviewPromptCard`(저장 없음)를 `PurchaseSatisfactionCard` 로 바꾼다. 소유권 확인된 주문(`order` 가 null 이 아님)일 때만 렌더한다.

흐름 (시안과 동일)
1. 제목 `구매 과정은 어땠나요?`, 부제 `상품 후기는 받아보신 뒤에 남길 수 있어요`. 별 5개(기존 `Rating` 재사용), 아래에 점수 라벨 `별로예요 / 아쉬워요 / 보통이에요 / 좋아요 / 최고예요`.
2. 별을 누르면 즉시 저장(`저장하고 있어요` 표시). 성공 시 GA4 `purchase_satisfaction { rating }`.
3. 4~5점: 감사 화면으로 바뀐다.
4. 1~3점: 같은 카드 안에 `어떤 점이 아쉬웠나요?`(여러 개 고를 수 있어요) + 칩 + 메모(`더 알려주실 내용 (선택)`, placeholder `예: 원하는 결제 수단이 없었어요`, 0/300) + `다음에` / `보내기`.
   - `보내기` 는 칩이나 메모가 하나라도 있을 때만 활성. 누르면 저장 후 GA4 `purchase_satisfaction_detail { reasons_count }` → 감사 화면.
   - `다음에` 는 요청 없이 감사 화면(별점은 이미 저장됨).
5. 감사 화면: 제목 `소중한 의견 감사합니다`, 설명 3점 이하 `남겨 주신 내용을 바탕으로 개선하겠습니다` / 4~5점 `다음에도 만족스러운 쇼핑을 준비하겠습니다`, `별점 바꾸기` 로 1번으로 돌아간다.
6. 저장 실패: `저장하지 못했어요. 별을 다시 눌러 주세요`, 별 선택을 되돌린다.
7. 다시 방문(새로고침): 서버에 이미 응답이 있으면 감사 화면부터 보여 준다.

사유 칩 (순서 고정, 코드 ↔ 문구)

| 코드 | 문구 |
|---|---|
| `ADDRESS_INPUT` | 배송지 입력이 불편했어요 |
| `COUPON_DISCOUNT` | 쿠폰·할인 적용이 어려웠어요 |
| `CASH_RECEIPT` | 현금영수증 신청이 어려웠어요 |
| `PAYMENT_METHOD` | 결제 수단이 불편했어요 |
| `PAYMENT_ERROR` | 결제 중 오류가 났어요 |
| `PRODUCT_SEARCH` | 원하는 상품을 찾기 어려웠어요 |
| `OTHER` | 기타 |

접근성: 별은 radiogroup(라벨 `n점 라벨`), 칩은 `aria-pressed` 버튼, 별 탭 영역 48px 이상.
호출: storefront 서버 액션이 `_medusa_jwt` 로 Medusa 의 새 고객 라우트를 부른다(아래). ugc 를 직접 부르지 않는다.

## 소유권 확인 (Medusa)

실제로 그 주문을 한 고객만 저장·조회할 수 있어야 한다. ugc 는 user-service 토큰을, Medusa 는 `_medusa_jwt` 를 받으므로
ugc 혼자서는 주문 주인을 알 수 없다. 그래서 리뷰 작성 자격 발급(`create-review-eligibility-step.ts`)과 같은 길을 쓴다:
Medusa 가 주문 고객을 확인한 뒤 내부 키(`UgcInternalAuth`)로 ugc 를 부른다.

새 라우트(코어 라우트 override 가 아니라 새 경로) `apps/medusa/src/api/store/orders/[id]/purchase-satisfaction/route.ts`

| 메서드 | 동작 |
|---|---|
| GET | 주문을 읽어 `order.customer_id === req.auth_context.actor_id` 가 아니면 404. 맞으면 ugc 내부 GET 결과를 그대로 돌려준다(없으면 404). |
| PUT | 같은 확인 후 body `{ rating, reasons?, memo? }` 를 zod 로 검증하고, 주문에서 `display_id` 와 고객의 almond user id(자격 발급 step 과 같은 출처)를 꺼내 ugc 내부 PUT 으로 넘긴다. |

- `middlewares.ts` 에 `authenticate("customer", ["session","bearer"])` 와 body 검증을 붙인다.
- 주문번호·사용자 id 는 클라이언트가 보내지 않는다. Medusa 가 주문에서 꺼낸 값만 쓴다.
- 비회원 주문(고객 계정 없음)·almond user id 가 없는 고객은 404 로 끝나고 카드를 띄우지 않는다.
- ugc 호출이 실패하면 502. storefront 는 저장 실패 문구를 띄운다.

## 저장 (ugc-service)

ugc-service 는 리뷰 등 고객 작성 콘텐츠를 이미 들고 있어 여기에 둔다. 새 모듈 `purchase-satisfaction`(Controller → Service → Manager/Reader → Repository).

테이블 `purchase_satisfactions` (`apps/ugc-service/src/db/schema.ts`, 새 마이그레이션 `add-purchase-satisfactions`, additive 라 1 PR)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `order_id` | varchar(255) not null | Medusa 주문 id (`order_…`) |
| `order_display_id` | integer not null | 어드민 표시용 주문번호 |
| `user_id` | uuid not null | Medusa 가 넘긴 주문 고객의 almond user id |
| `rating` | smallint not null | CHECK 1~5 |
| `reasons` | varchar(32)[] not null default `{}` | 위 코드. 값 검증은 TS 유니온 + DTO |
| `memo` | varchar(300) | |
| `checked_at` | timestamptz | 어드민 확인 시각 |
| `checked_by` | uuid | 확인한 관리자 |
| `created_at` / `updated_at` | timestamptz | |

- UNIQUE `(order_id)` — 주문당 1건 upsert. 주문 주인 확인은 Medusa 가 끝내고 오므로 주문 하나에 응답 하나다.
- 인덱스 `(created_at)`, `(rating, checked_at)`.

규칙 (Manager)
- `rating >= 4` 로 저장하면 `reasons`·`memo` 를 비운다.
- `reasons`·`memo` 는 `rating <= 3` 일 때만 받는다. 아니면 400.
- 별점·사유·메모가 바뀌면 `checked_at`·`checked_by` 를 null 로 되돌린다(새 내용은 다시 확인해야 함).
- 소유권은 Medusa 가 확인한다(위). ugc 의 고객용 경로는 내부 키로만 열리고, 고객 토큰으로는 부를 수 없다.

API

| 메서드 | 경로 | 권한 | 용도 |
|---|---|---|---|
| PUT | `/purchase-satisfactions/internal/orders/:orderId` | `@UgcInternalAuth` (Medusa 만) | upsert `{ userId, orderDisplayId, rating, reasons?, memo? }` |
| GET | `/purchase-satisfactions/internal/orders/:orderId` | `@UgcInternalAuth` (Medusa 만) | 그 주문의 응답(없으면 404) — 재방문 시 감사 화면 |
| GET | `/purchase-satisfactions/admin` | `cs.satisfaction.read` | 목록 + 요약 |
| GET | `/purchase-satisfactions/admin/orders/:orderId` | `cs.satisfaction.read` | 주문 상세 패널용 |
| PATCH | `/purchase-satisfactions/admin/:id/check` | `cs.satisfaction.manage` | `{ checked: boolean }` |

어드민 목록 쿼리: `from`, `to`(응답 시각 `updated_at` 기준, KST 일 경계), `score=all|low|high`, `reason`, `hasMemo`, `unchecked`, `page`, `limit`.
요약(필터의 기간에만 적용, 점수·사유 필터 무관): `count`, `average`, `csatPercent`(4~5점 비율), `uncheckedLow`, `distribution[1..5]`, `reasonCounts`(3점 이하 응답 기준). 집계는 SQL 에서 끝낸다.

권한 (`libs/authorization/src/permissions/permission-catalog.ts`)
- `cs.satisfaction.read` 구매 만족도 조회 — owners `ugc-service`, grant `ADMIN_INTERN`(리뷰 조회와 같음).
- `cs.satisfaction.manage` 구매 만족도 확인 처리 — owners `ugc-service`, grant `ADMIN`, requires `cs.satisfaction.read`.

개인정보: 응답에 고객 이름·연락처를 싣지 않는다(주문번호와 회원 링크만). 그래서 `@PiiResponse` 대상이 아니다. 메모는 고객이 쓴 자유 텍스트라 그대로 보여 준다.

## 어드민 (admin-web)

1. 새 페이지 `/cs/purchase-satisfaction` — `app/(admin)/cs/purchase-satisfaction/page.tsx` + `features/cs/purchase-satisfaction/`.
   `RouteGuard screen="/cs/purchase-satisfaction"`, `screen-access.ts` 에 `any('cs.satisfaction.read')`, CS 메뉴에 항목 추가.
   구성(시안 그대로): 기간 버튼(오늘·최근 7일·최근 30일) → KPI 4장(응답, 평균 별점, 만족 비율, 확인 안 한 3점 이하[누르면 필터]) → 별점 분포 + 3점 이하 사유 막대(사유 누르면 필터) → 필터(전체/3점 이하/4점 이상, 메모 있음, 확인 안 한 것만) + 표(응답 시각·주문번호·별점·사유·메모·확인) → 행 클릭 시 오른쪽 상세(별점, 사유 칩, 메모 전문, `확인했어요`/`확인 취소`, `주문내역에서 열기`).
   확인 처리 훅은 `useX.permission = 'cs.satisfaction.manage'`, 버튼은 `run={useX}`.
2. 주문내역 상세 패널 — `features/order/history/components/table/index.tsx` 의 `OrderDetailPanel` 상품 목록 아래에 `구매 만족도` 섹션.
   자사몰 주문일 때만 `channelOrderId`(Medusa 주문 id)로 조회한다. 응답이 없으면 `아직 응답이 없어요`. 확인 처리 버튼과 `만족도 목록에서 보기` 링크.
   `cs.satisfaction.read` 가 없으면 섹션을 숨긴다.
3. 사유 코드 ↔ 문구 표는 storefront·admin-web 에 각각 둔다(두 곳, 7줄).

시안에 있던 고객 이름(마스킹)과 응답률 KPI 는 뺀다 — 이름은 PII 경로를 새로 열어야 하고, 응답률은 ugc 가 주문 수를 모른다.

## 테스트

- ugc Manager 단위: 4점 이상이면 사유·메모 비움 / 4점 이상에 사유 보내면 400 / 수정 시 확인 상태 초기화 / 같은 주문 재저장은 덮어씀.
- Medusa 라우트 단위: 남의 주문·비회원 주문은 404, 본인 주문은 ugc 에 Medusa 가 꺼낸 userId·display_id 를 넘긴다(클라이언트 값 무시), ugc 실패는 502.
- ugc Reader 통합(`describeIfDb`): 요약 집계(평균·CSAT%·분포·사유 수)와 필터.
- 게이트 스펙: `route-classification`, `permission-dependencies`, `screen-access.gate`, `mutation-guard.gate` 가 새 라우트·권한·화면을 받아들이는지.
- storefront: 카드 상태 전이(별→저장→분기→보내기/다음에→감사, 실패 시 되돌림) 컴포넌트 테스트 하나.

## 범위 밖

4점 사유, 처리 상태 3단계(연락함)와 내부 메모, 응답률, 고객 이름 표시, 미확인 저점수 알림(슬랙·메일), Medusa 쪽 응답 캐시.

## 배포

ugc 마이그레이션(expand) → ugc → Medusa(MedusaAdmin 먼저) → storefront·admin-web 순(`migrate → deploy`). Medusa 는 마이그레이션 없음. 권한은 첫 등록 때 grant 대로 부여된다.
