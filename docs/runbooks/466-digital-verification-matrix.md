# PR #466 디지털 커머스 — 검증 매트릭스 & finding 해결 기록

대상 PR: #466 (feat: 디지털 상품 커머스 통합). base develop, head feat/digital-commerce.

## 판별 SSOT (단일 기준)
- 스토어프론트: `web/almondyoung-storefront/src/lib/api/medusa/shipping-method-policy.ts`
  - `itemRequiresShipping` (line `requires_shipping` 우선 → `product_type==='digital_sale'` 폴백)
  - `cartRequiresShipping`, `isDigitalItem`, `isDigitalProduct`(metadata.fulfillmentKind/requiresShipping/type)
- core / 이벤트 계약: `fulfillmentKind==='digital' || requiresShipping===false` (둘 다 null = 물리로 간주)
  - `fulfillments.service.ts: isDigitalFulfillmentLine`
- 사용권(ownership): grant SoT = OrderCreated(status='confirmed'), revoke SoT = OrderCancelled (ADR-0008/0010/0006)
- 디지털 자산 파일: 메타/버전/링크/소유권은 core DB(library 스키마), **실제 파일 바이너리는 file-service(S3)** — `digital_asset_file_versions.fileId` 가 참조

## finding 해결 상태
| 심각도 | finding | 상태 | 처리 |
|---|---|---|---|
| High | ownership admin API 권한 가드 누락 | ✅ 수정 | `OwnershipAdminController` 에 `@UseGuards(RolesGuard('master','admin'))` + `@ApiBearerAuth()` |
| High | 수동 부여가 주문/고객/자산 정합성 미검증 | ✅ 수정 | `ownership.service.grantManual` — 주문 존재·고객 일치·asset↔주문 variant 링크 검증 후 멱등 insert. 단위테스트 5개 추가 |
| High | 디지털 단독 카트 stale 배송 method → 결제금액 불일치 | ✅ 수정 | medusa `DELETE /store/carts/:id/shipping-methods` 라우트 + 스토어프론트 `ensureCorrectShippingMethod` 에서 제거 → Medusa total 정합 |
| Low/UX | 디지털 단독 체크아웃 FreeShippingProgress 항상 노출 | ✅ 수정 | `order-products-shipping.tsx` 에서 `cartRequiresShipping` 분기로 진행바/배송비 라인 숨김 |
| High | #455 OrderModified 무시 | ⚠️ 의도적(ADR-0016) | 수집 이후 상품/금액 변경은 격리(no-op). ownership 은 OrderCreated/OrderCancelled 만 SoT. 핸들러에 ADR 참조 주석 명시. **판단 필요** |
| Medium | 어드민 FO 디지털 분기 없음 | 🔍 대체로 moot | 디지털 단독 주문은 물리 FO 자체 미생성(not_required) → FO 상세는 항상 물리/혼합. 디지털 운영면은 신규 ownership 어드민 화면이 담당 |
| Medium | #458 projection 생성 로직 단일화 미완 | 🔍 보류 | predicate 는 일관·정확. apps/medusa ↔ channel-adapter 는 별개 배포단위라 교차패키지 단일화는 라이브 재고/결제 코드 리팩터 리스크 > 가치. **판단 필요** |

## 검증 (코드 레벨)
- core 빌드 ✅ / medusa tsc(신규 라우트) ✅ / 스토어프론트 Next 프로덕션 빌드 ✅
- 단위테스트: ownership.service 19 (grantManual 5 신규), library.service / fulfillments.service 포함 107 통과

## 사전점검 (머지 전, read-only 리뷰)
| 점검 | 결과 |
|---|---|
| 스키마 마이그레이션 안전성 | **GREEN** — `sales_order_lines` 에 nullable `fulfillment_kind`/`requires_shipping` 추가뿐. DEFAULT/NOT NULL 없어 테이블 rewrite·락 없음(메타데이터 변경). autodeploy `deploy→migrate` 순서상 구/신 코드 모두 호환(null=물리). ADR-0005 expand 규칙 부합 → 라이브 1-PR 적용 안전 |
| 회귀 영향(기존 기능/주문/결제) | **SAFE** — 물리/혼합 주문·결제·이행 경로 불변. 디지털은 `cartRequiresShipping`/`isDigitalFulfillmentLine`/`isDigitalVariant` 명시 분기로 격리, null→물리 기본. 신규 `DELETE shipping-methods` 라우트는 `!requiresShipping`(디지털 단독)일 때만 호출돼 물리 카트 배송 method 미손상. 발행 가드는 디지털에만 적용 |

## dev E2E 실증 결과 (2026-06-25, 브랜치 dev 배포 후)
브랜치를 dev 에 배포(`sst deploy --stage dev`) + 마이그레이션 적용 후, Store API 로 실측. 디지털=골드키위(core 자산+링크+Medusa digital 마킹), 물리=`[테스트] 정식등록 수동품절`(수동품절 해제 + void matched 매칭 생성 + 재고 100 + allow_backorder 동기화로 구매 가능화).

| 시나리오 | 결과 |
|---|---|
| **A1 디지털 단독** | 디지털 담기 → `cart_line_item.requires_shipping=false`, `shipping_total=0`, `total=상품가만(2900)` ✅ |
| **A2 물리 단독(회귀)** | 물리 add 200, `requires_shipping=true`, 배송옵션 적용 → `shipping_total=2500, total=32500` ✅ 물리 결제 정상 |
| **A3 혼합(물리+디지털)** | 둘 다 add 200, 물리 `req_ship=true` & 디지털 `req_ship=false`, 카트 배송 필요 → `total=35400` ✅ |
| **A4 전환(핵심 결함)** | 혼합+배송비 2500 → 물리 라인 제거 → 디지털 단독인데 stale 2500 잔존 → 신규 `DELETE /store/carts/:id/shipping-methods` 호출(`deleted_count=1`) → `shipping_total=0, methods=0` ✅ **결제 금액 불일치 실증 해소** |
| **신규 DELETE 라우트** | dev 배포·200·정상 동작 ✅ |
| **B1 무통장 결제→소유권 부여(전 구간)** | hyunji1 고객 OIDC 인증 → 디지털 카트 → 결제세션(intentId) → 무통장 confirm(AWAITING_DEPOSIT, 가상계좌) → webhook 주문 선생성 → 관리자 입금확인(CAPTURED) → channel-adapter 수집 → core SO(customer_id=hyunji1) → **digital_asset_ownerships 행 부여**(customer=hyunji1, asset=골드키위, granted_at) ✅ 실 PG 미경유(무통장)로 결제까지 입증 |

미수행: 브라우저 시각 렌더 + 실제 결제(토스/월렛) + 다운로드(자산 파일 placeholder) — 결제 샌드박스/실파일 필요. 데이터·Store API 레벨까지 전 시나리오 검증 완료.

dev 테스트 데이터(검증용으로 남김, 필요시 revert): 골드키위=디지털 마킹, `[테스트] 정식등록 수동품절`=void 매칭+재고100+구매가능.

## E2E 현황
- dev 데이터 상태(2026-06-25 tunnel read-only): core 디지털 active master 36개 존재하나 **digital_asset/file_version/variant-asset 링크 0, ownership 0**, Medusa digital 마킹 0. 즉 현재 dev엔 구매 가능한 디지털 상품 없음(발행 가드가 자산 없으면 차단).
- **주의**: dev 는 *배포된* 코드를 실행한다. 본 PR(특히 신규 수정 4건)의 실제 E2E 는 브랜치를 dev 에 배포한 뒤라야 가능. 배포 후 아래 매트릭스의 A/B/C/D/E 시나리오를 dev 에서 수행.

---

## 시나리오 매트릭스

### A. 카트/체크아웃 (고객)
| # | 시나리오 | 고객 UI/UX 기대 | 결제금액 | 상태 |
|---|---|---|---|---|
| A1 | 디지털 단독 카트 | 배송지/메모 숨김, 배송비 0, FreeShippingProgress 숨김, 배송옵션 [] | 상품가만 (배송 method 없음) | ✅ Fix + 정책SSOT |
| A2 | 물리 단독 카트 | 배송지/메모 강제, 배송비 표시, 무료배송바 노출 | 상품가+배송비 | 기존 |
| A3 | 물리+디지털 혼합 | any 물리 → 배송지/메모 강제, 배송비 표시 | 상품가+배송비 | cartRequiresShipping=true |
| A4 | 물리→디지털 단독 전환(물리 삭제) | 배송 UI 사라짐 | **stale 배송 method 제거 → 배송비 0** | ✅ Fix(핵심 결함) |
| A5 | 디지털 단독, 비로그인 | 체크아웃 로그인 유도 | — | ProtectedRoute |
| A6 | 0원 디지털 | 디지털 단독과 동일, 0원 결제 | 0 | ADR-0008 동일 경로 |

### B. 주문 생성/결제 → 소유권 부여
| # | 시나리오 | 기대 | 상태 |
|---|---|---|---|
| B1 | 디지털 결제완료(OrderCreated confirmed) | variant↔asset 링크별 ownership 생성 | 자동 grant |
| B2 | 동일 이벤트 재전달 | 멱등(unique customer/asset/order) | ✅ onConflictDoNothing |
| B3 | 비로그인 채널(네이버/쿠팡) | customerId 없음 → grant skip | 의도적(ADR-0008) |
| B4 | 결제 미확정 | grant 안 함(fail-closed) | ADR-0010 |
| B5 | 디지털 라인 WMS 수집 | 물리 FO item 미생성, digital-only는 FO 없음(not_required) | fulfillments skip |
| B6 | 혼합 주문 FO | 물리 라인만 FO, 디지털 제외 | ✅ spec |

### C. 취소/환불 → 소유권 회수
| # | 시나리오 | 기대 | 상태 |
|---|---|---|---|
| C1 | 미사용 디지털 주문 취소 | ownership revoke | revokeForOrder |
| C2 | 사용(exercise) 후 취소 | revoke 안 함, 환불은 결제측 | ADR-0006 |
| C3 | 혼합 주문 취소 | 디지털 revoke + 물리 FO 취소 | cancel 경로 |
| C4 | OrderModified로 디지털 라인 변경 | **재조정 안 함(의도적)** | ⚠️ ADR-0016 |

### D. 소유권 행사/다운로드 (고객)
| # | 시나리오 | 기대 | 상태 |
|---|---|---|---|
| D1 | success 페이지 | 디지털 있으면 다운로드 CTA, 단독이면 배송지 숨김 | 기존 |
| D2 | 마이페이지 주문상세 | 디지털 "다운로드"/물리 "장바구니", 단독이면 배송정보·배송조회 숨김 | 기존 |
| D3 | exercise 전 다운로드 | ForbiddenError | ✅ spec |
| D4 | exercise 후 다운로드 | currentFileVersion fileId 서빙 | ✅ spec #352 |
| D5 | revoke된 ownership | ForbiddenError + 목록서 숨김 | ✅ spec #353 |
| D6 | 새 파일버전 등록 후 | 기존 보유자도 최신본 자동 | ✅ spec |

### E. 어드민 운영
| # | 시나리오 | 기대 | 상태 |
|---|---|---|---|
| E1 | ownership 조회(필터) | revoke 포함 전체 | 신규 화면 |
| E2 | 수동 부여 | 주문존재+고객일치+asset↔variant 링크 검증 후 멱등 | ✅ Fix |
| E3 | 일반 사용자 admin API 호출 | 403(RolesGuard) | ✅ Fix |
| E4 | 강제 회수 | revokedAt/이유 채워 차단 | 신규 |
| E5 | 재발급 | revoke 해제 재활성화 | 신규 |
| E6 | 디지털 단독 주문 FO 상세 | 물리 FO 미생성 → FO 상세 없음 | 🔍 #5 moot |

### F. 채널/게시 가드
| # | 시나리오 | 기대 | 상태 |
|---|---|---|---|
| F1 | 디지털 외부채널 게시 | BadRequest 차단 | ✅ spec |
| F2 | asset 없는 디지털 variant 게시 | BadRequest | ✅ spec |
| F3 | 상품카드/상세 디지털 배지 | isDigitalProduct → 배지 | 기존 |
| F4 | sellable projection inventory | 디지털은 requires_shipping projection 미생성/제거 | ✅ predicate 일관 |
