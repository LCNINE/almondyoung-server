# 상품 승인 워크플로 제거 (#663)

- 날짜: 2026-08-19
- 이슈: #663
- 관련: #652 (채널 리스팅 승계) · #664 · #665 · #666 · #667 (같은 클러스터) · ADR-0004 (variant draft-scoped edit CoW) · ADR-0005 §5 (expand-contract)

## 1. 문제

`ProductApprovalService.approve` 가 활성 버전 전환을 **직접** 수행한다 — `publishVersion` 을 부르지 않는다.

`apps/core/src/modules/catalog/operations/approval/product-approval.service.ts:63-78`

```ts
await trx.update(productMasterVersions)
  .set({ status: 'inactive', updatedAt: new Date() })
  .where(and(eq(masterId, product.masterId), eq(status, 'active')));   // 기존 active 를 내리고

await trx.update(productMasterVersions)
  .set({ approvalStatus: 'approved', status: 'active', ... })
  .where(eq(productMasterVersions.id, productId));                     // 승인본을 올린다
```

같은 파일에 `publishVersion` 도 `reconcile` 도 등장하지 않는다 (grep 0건). 따라서 `publishVersion` 안에만 있는 승계가 통째로 건너뛰어진다.

| 빠지는 것 | 위치 |
|---|---|
| `_reconcileMatchingsAfterPublish` (product_matchings · SKU 링크 · 판매정책) | `product-versions.service.ts:333` |
| `_reconcileAssetLinksAfterPublish` (variant asset link) | `product-versions.service.ts:336` |
| `_reconcileChannelListingsAfterPublish` (채널 리스팅, #652) | `product-versions.service.ts:342` |

그 밖에 품번 발번 · 가격 캐시 · variantCode 중복 검증 · `_validateDigitalAssetLinks` · 변경 이벤트 발행 · 가용재고 재계산도 같이 빠진다. CoW 를 거친 드래프트가 승인 경로로 활성화되면 **#652 가 고친 증상이 이 경로에는 그대로 남는다.**

## 2. 왜 고치지 않고 지우는가

이슈는 "이 경로가 실제로 쓰이는가" 를 먼저 재라고 남겨뒀다. 실측 결과:

- **화면은 살아 있다.** `/mall/audit` → 「승인 대기」 탭 → `PendingApprovalTable` → `ApprovalModal` → `useApprove` → `POST /masters/:id/approve`.
- **그런데 `pending` 을 만드는 UI 가 없다.** `submitForApproval` 을 호출하는 `useSubmitApproval` 훅은 export 만 되고 호출하는 컴포넌트가 0곳이다.
- 버전을 `pending` 으로 만드는 다른 경로는 `product-bulk.service.ts:92` 하나뿐인데, 그 UPDATE 는 `where(status='active')` 라 **이미 활성인 버전**만 pending 으로 바꾼다. 그걸 승인하면 "자기 자신을 다시 active 로" 하는 셈이라 승계 대상이 없다.
- **`publishVersion` 은 `approvalStatus` 를 건드리지 않는다.** 정상 발행 경로를 탄 버전은 영원히 `'draft'` 다. 즉 `approvalStatus` 를 읽는 필터 · 대시보드 집계 · 응답 필드는 실질적으로 한 값만 나오는 죽은 축이다.

배선이 잘못된 채 아무도 쓰지 않는다. 나중에 상품 수정 요청/승인이 필요해지면 그때 `publishVersion` 을 타는 올바른 경로로 새로 만드는 편이 낫다 — 지금 고쳐 두면 검증되지 않은 경로를 유지비만 내며 안고 간다.

**결정: 제거한다.**

## 3. 범위 — L2 (파생 표면까지, DB 는 유지)

| 층위 | 포함 | 근거 |
|---|---|---|
| 승인 API · 화면 | ✅ | 본류 |
| `approvalStatus` 파생 표면 (필터 · 대시보드 집계 · bulk 액션 · 응답 DTO 필드) | ✅ | 값이 한 종류뿐인 죽은 축을 UI 에 남기지 않는다 |
| DB 컬럼 · 테이블 · enum · 인덱스 | ❌ | 마이그레이션 0 → 단일 PR · 단일 배포 · 되돌리기 자유, 데이터 손실 0 |

DB 드롭(L3)은 별도 판단으로 미룬다. ADR-0005 §5 상 contract phase 라 PR 2개와 그 사이 배포 1회가 필요한데, 지금 그 비용을 낼 이유가 없다.

### PR 구성: 단일 PR

ADR-0005 의 다단계 PR 규율은 *destructive schema* 변경에 걸린다. L2 는 `schema.ts` 를 건드리지 않으므로 해당 없다. 지우는 것뿐이고 남는 결합이 없어 쪼갤 이유가 약하다 — 리뷰는 "삭제 후 `type-check` 가 0" 이 그대로 검증이 된다.

## 4. core 변경

### 삭제 (파일 통째, 5개)

`apps/core/src/modules/catalog/operations/approval/`
`approval.module.ts` · `product-approval.controller.ts` · `product-approval.service.ts` · `dto/index.ts` · `dto/product-approval.dto.ts`

사라지는 라우트 5개:

- `POST /masters/:id/submit-approval`
- `POST /masters/:id/approve`
- `POST /masters/:id/reject`
- `GET /masters/pending-approval`
- `GET /masters/:id/approval-history`

### 수정

| 파일 | 지우는 것 |
|---|---|
| `catalog.module.ts:18,47` | `ApprovalModule` import · 등록 |
| `core/products/controllers/product-masters.controller.ts:153,215,262` | `approvalStatus` ApiQuery + 서비스 전달 2곳 |
| `core/products/dto/list-product-masters-query.dto.ts:41` | 쿼리 필드 |
| `core/products/services/product-masters.service.ts:116,719-721` | 필터 옵션 + where 술어 |
| `core/products/mappers/product.mapper.ts:31` | 응답 필드 |
| `core/products/dto/products/product-response.dto.ts:65-66` | `@ApiProperty` + 필드 |
| `core/products/dto/entities/master-version.entity.ts:109-110` | 〃 |
| `operations/bulk/dto/bulk-operations.dto.ts:17-19` | bulk 설정 필드 |
| `operations/bulk/product-bulk.service.ts:92` | 그 필드 반영 |
| `analytics/dashboard/dashboard.service.ts:53-61,113,132` | 「승인 상태별 제품 수」 집계 + top-products 필드 |
| `analytics/dashboard/dto/dashboard.dto.ts:27,105` | 대응 DTO 필드 |
| `core/products/controllers/product-masters.controller.spec.ts:40,57,71` | 픽스처의 승인 필드 |
| `core/products/dto/list-product-masters-query.dto.spec.ts:44,57,63` | 화이트리스트 기대값 |

`dashboard.service.ts:113` 근처의 중복 `eq(status,'active')` 술어는 승인과 무관하므로 이 PR 에서 건드리지 않는다.

## 5. admin-web 변경

### 삭제 (3개)

- `features/mall/audit/components/pending-approval-table/`
- `features/mall/audit/components/approval-modal/`
- `lib/api/domains/products/approval.client.ts`

### 수정

| 파일 | 지우는 것 |
|---|---|
| `features/mall/audit/template/index.tsx` | Tabs 제거 → `AuditLogTable` 단독. 헤더 '감사 이력 / 승인 관리' → '감사 이력' |
| `lib/api/domains/products/index.ts:4,39,58` | `approvalClient` import · 등록 · 재export |
| `lib/services/products/queries.ts:540-557` | `usePendingApprovals` · `useApprovalHistory` |
| `lib/services/products/mutations.ts:865-902` | `useSubmitApproval` · `useApprove` · `useReject` |
| `lib/services/products/query-keys.ts:157-159` | `pendingApprovals` · `approvalHistory` |
| `lib/types/dto/products.ts:137,1129` + 승인 섹션 `1191-1217` | `approvalStatus` 필드 2곳 + 승인 전용 인터페이스 4개 (`PendingApprovalDto` · `ApprovalHistoryItemDto` · `ApproveProductDto` · `RejectProductDto`) |
| `hooks/table/filters/use-products-list-table-filters.ts:71-81` | 상품목록 '승인 상태' 필터 |
| `hooks/table/query/use-products-list-table-query.ts:25,43,79-84` | 그 필터의 파싱 · 전달 |
| `features/mall/bulk/components/bulk-action-modal/index.tsx:36,68,90,121-123,206-209` | `approvalStatus` 액션 |
| `features/mall/bulk/components/table/index.tsx:65` | 그 액션 진입 버튼 |
| `components/common/breadcrumb-items.ts:15` · `lib/utils/menu.ts:247` | 라벨 '감사 이력/승인' → '감사 이력' |

### 유지

`/mall/audit` 페이지 자체 · `audit-log-table` · `history-drawer`. 셋 다 별개 `/products/audit/*` API 를 쓴다 (`history-drawer` 는 `useProductAuditHistory`). 승인과 무관하다.

## 6. DB — 손대지 않는다

`apps/core/src/modules/catalog/schema/catalog.schema.ts` 의 아래는 **전부 그대로** 둔다.

- `ProductMasterVersionApprovalStatusEnum` (115-119)
- `approvalStatus` · `approvedAt` · `approvedBy` · `rejectionReason` 컬럼 (205-208)
- `idx_versions_approval_status` 인덱스 (239)
- `productApprovalHistory` 테이블 (663-681)
- `PimSchema` 등록 (1392)

`catalog.types.ts` 와 `catalog.schema.types.ts` 의 `ProductApprovalHistory*` 타입 export 도 남긴다. 두 파일 모두 schema 의 기계적 미러(테이블 35개 전부 나열)라, 테이블이 남는 이상 미러만 예외로 뚫으면 다음 사람이 혼란한다.

대신 `schema.ts` 의 두 지점(컬럼 블록 · 테이블 정의)에 주석을 단다:

> 승인 워크플로는 #663 으로 제거됨. 읽는 코드 없음. 드롭 여부는 별도 판단.

이 주석이 이 PR 이 스키마에 남기는 유일한 흔적이다. 죽은 컬럼을 살아있는 것으로 오인하는 걸 막는 게 목적이다.

## 7. 검증

| 명령 | 대상 | 기준 |
|---|---|---|
| `npm run type-check` | **core 등 백엔드만** | 에러 0 |
| `cd apps/admin-web && npm run type-check` | **admin-web** | 에러 0 |
| `npx jest --maxWorkers=2` | 백엔드 유닛 | 실패 0 (`--maxWorkers` 없으면 OOM) |
| `npm run lint` | 백엔드 `.ts` | 통과 |

**루트 `type-check` 는 admin-web 을 보지 않는다.** 루트 `tsconfig.json` 의 `exclude` 에 `apps/admin-web` 이 들어 있다. admin-web 의 남은 참조는 `apps/admin-web` 안에서 `tsc --noEmit` 을 따로 돌려야만 잡힌다 — 이 프로젝트는 컴포넌트 테스트도 불가하므로 그 명령이 admin-web 의 유일한 검증이다.

루트 `tsconfig.json` 은 `incremental: true` 다. 삭제 규모에 비해 결과가 지나치게 깨끗하면 `tsbuildinfo` 를 지우고 다시 돌린다.

수동 확인 3건:

1. `/mall/audit` 이 열리고 감사 로그가 정상 표시된다 (탭 없이 단일 화면)
2. 상품목록 필터에서 '승인 상태' 가 사라졌다
3. 대량작업 모달에서 승인상태 액션이 사라졌다

Swagger 에서 승인 라우트 5개 소멸 확인.

## 8. 배포

- 마이그레이션 **0** · 시크릿 0 · env 0 · 이벤트 계약 변화 0
- 순서: **admin-web → core**. 역순이어도 아무도 쓰지 않는 화면이 잠깐 깨질 뿐이라 실질 무해하다.
- 전역 ValidationPipe 가 `forbidNonWhitelisted: false` 이므로, core 를 먼저 배포해 bulk DTO 에서 `approvalStatus` 가 사라져도 admin-web 이 계속 보내는 값은 400 이 아니라 조용히 제거된다.

### 배포 전 실측 (이슈에 기록)

```sql
SELECT approval_status, count(*) FROM product_master_versions GROUP BY 1;
SELECT count(*) FROM product_approval_history;
```

결과가 제거 여부를 바꾸지는 않는다(이미 결정). 나중에 컬럼 드롭(L3)을 판단할 때 유일한 근거가 되므로 남긴다.

## 9. 영향 범위 밖 — 확인 완료

- **공개 라우트는 `approvalStatus` 를 내보내지 않는다.** `GET /masters/:id` (`@Public`) → `getMasterDetail` → `ProductDetailDto` 에 매핑이 없다. 이 필드를 싣는 건 인증이 필요한 `POST /masters` (`ProductMapper.toDto`) 하나뿐 → 외부 storefront 파급 0.
- **대시보드 집계는 소비자가 0이다.** admin-web 에 `dashboard` API 클라이언트 자체가 없다. `GET /dashboard/metrics` 를 부르는 코드가 없다.
- **`product_approval_history` 는 승인 서비스 전용이다.** 다른 참조가 없다. 「감사 로그」 기능은 `product_audit_log` 를 쓴다.
- `apps/core/src/modules/inventory/` 의 `approvedBy` (발주 승인) 는 이름만 같은 별개 도메인이다. 건드리지 않는다.

## 10. 이슈 처리

#663 을 이 PR 로 close 하고, 본문에 "L2 범위로 제거 — DB 컬럼·테이블은 유지, 드롭은 별도 판단" 과 §8 의 실측 결과를 남긴다.

같은 클러스터의 #664 · #665 · #666 · #667 은 살아있는 `publishVersion` 경로의 결함이므로 이 PR 의 영향을 받지 않는다. 다만 #663 이 닫히면 "승계가 안 도는 경로" 목록에서 하나가 빠진다.
