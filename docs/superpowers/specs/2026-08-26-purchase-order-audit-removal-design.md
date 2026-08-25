# 발주 심사(audit) 워크플로 제거 (#724 항목 3)

- 날짜: 2026-08-26
- 이슈: #724 항목 3 (엄브렐러), 결정 D1=(b)
- 관련: #663/PR #680 (상품 승인 워크플로 제거 — 같은 형태의 선례) · [진단 문서](../../inventory-procurement-audit-2026-08.md) 발견 ② · [항목 9 스펙](2026-08-25-purchase-order-line-lifecycle-design.md) · ADR-0005 §5 (expand-contract)

## 1. 문제

발주 심사는 **제출 → 승인/반려** 3단계 API 와 화면을 갖췄지만, 감사 가치를 만드는 세 요소가 모두 없다 (진단 문서 발견 ②).

**① 권한 분리가 없다.** `purchase-order.controller.ts` 의 라우트 **17개 전부**가 `@RequireScopes(INVENTORY_SCOPE.MANAGE)` 하나를 요구한다. 심사 3라우트도 발주 생성·수정과 같은 스코프다 — 발주를 만들 수 있는 사람은 예외 없이 자기 발주를 승인할 수 있다.

**② 행위자가 기록되지 않는다.** 서비스 시그니처에는 자리가 있다:

```ts
async approvePo(poId: string, dto: ApprovePoDto, userId?: string, tx?: DbTx)   // :1114
async rejectPo(poId: string, dto: RejectPoDto, userId?: string, tx?: DbTx)     // :1158
```

그런데 컨트롤러가 `@User()` 를 넘기지 않는다 (`:336`, `:355` — 인자가 `@Param` 과 `@Body` 뿐). `userId` 는 항상 `undefined` 이고 `audited_by` 는 항상 NULL 이다.

**③ 승인 후 잠금이 없다.** 승인된 발주의 라인을 `PUT /:id/lines` 로 자유롭게 바꿀 수 있다. 승인 시점의 내용과 실제 발주 내용이 다를 수 있으므로 승인 기록이 무엇을 증명하는지 알 수 없다 (#724 파킹 항목 10-b).

셋이 함께 있으면 결재선이지만, 셋 다 없으면 **상태 컬럼 하나를 왕복시키는 의식**이다.

## 2. 왜 살리지 않고 지우는가 — D1 결정

살리는 쪽(a)의 비용은 코드 몇 줄이 아니다: 승인 전용 스코프 신설(`inventory.purchase.approve`) → **롤 재편** → admin-web 승인 화면 → 승인 후 라인 잠금. 그 비용을 지불해 얻는 것이 *지금 아무도 쓰지 않는 결재선*이다.

지우는 쪽(b)의 비용은 이번 작업 하나다. 그리고 **되살릴 여지를 남긴다** — DB 컬럼·enum 을 그대로 두므로, 다른 사람이 승인하는 절차가 실제로 생기면 그때 올바른 권한 모델로 다시 만든다.

**결정: 제거한다** (2026-08-25, 이슈 #724 D1).

이 결정은 항목 3 하나를 푸는 데 그치지 않는다. **파킹 항목 10-b 는 소멸한다** — 우회할 심사가 없어진다.

## 3. 범위 — L2 (파생 표면까지, DB 는 유지)

| 층위 | 포함 | 근거 |
|---|---|---|
| 심사 API 3개 · 심사 화면 | ✅ | 본류 |
| `auditStatus` 파생 표면 (응답 DTO 필드 · 게이트 사본 2곳 · 목록 컬럼 · 계획생성 필터 · 상세 배지) | ✅ | 값이 한 종류뿐인 죽은 축을 UI 에 남기지 않는다 |
| DB 컬럼 6개 · enum · 기존 행의 값 | ❌ 유지 | 마이그레이션 0 → 단일 PR · 되돌리기 자유 · 데이터 손실 0 |

컬럼 드롭(L3)은 별도 판단으로 미룬다. ADR-0005 §5 상 contract phase 라 PR 2개와 그 사이 배포 1회가 필요한데, 지금 그 비용을 낼 이유가 없다.

### PR 구성: 단일 PR

ADR-0005 의 다단계 PR 규율은 *destructive schema* 변경에 걸린다. L2 는 `schema.ts` 를 건드리지 않으므로 해당 없다. 남는 결합이 없어 쪼갤 이유도 약하다 — 리뷰는 "삭제 후 `type-check` 가 0" 이 그대로 검증이 된다.

## 4. core 변경

### 삭제 (파일 통째, 1개)

- `inbound/dto/purchase-order/audit-po.dto.ts` (63줄) — `SubmitForAuditDto` · `ApprovePoDto` · `RejectPoDto` 와 응답 3종

### 삭제 (라우트 3개 — 17 → 14)

| 라우트 | 컨트롤러 | 서비스 |
|---|---|---|
| `PUT /purchase-orders/:id/submit-for-audit` | `:302-318` | `submitForAudit` `:1067` |
| `PUT /purchase-orders/:id/approve` | `:321-336` | `approvePo` `:1114` |
| `PUT /purchase-orders/:id/reject` | `:340-355` | `rejectPo` `:1158` |

### 삭제 (게이트 사본 2곳 — **반드시 같이**)

| # | 위치 | 하던 일 |
|---|---|---|
| ① | `purchase-order.service.ts:188` | `PUT /:id/status` 의 `confirmed` 전이를 `auditStatus==='approved'` 로 막음 |
| ② | `purchase-order.service.ts:411` (`lockPurchaseOrderForLineExecution`) | 라인별 실행을 같은 조건으로 막음 |

②의 docstring 이 *"둘 다 살아 있어야 하고, 지울 땐 같이 지운다"* 고 예고해 뒀다. 이번이 그 "같이 지운다" 다. **②에서 지우는 것은 `auditStatus` 검사뿐이다** — 같은 메서드의 `FOR UPDATE`(락 순서 불변식, #732)와 `status === 'received'` 가드는 남는다.

### 삭제 (파생 표면)

- `purchase-order-response.dto.ts` — `auditStatus` 필드 (`:49`) 와 같은 파일이 소유한 타입 별칭 `PurchaseOrderAuditStatus` (`:5`)
- `schema/enum-values.ts:93-94` 의 `poAuditStatusValues` · `PoAuditStatusEnum`
- `platform/auth/inventory-scope-coverage.spec.ts` 배정표 3행 (`:136` `:138` `:140`)

### 수정 (스펙 4개)

| 파일 | 수정 |
|---|---|
| `purchase-order-line-execution.integration.spec.ts` | 시딩 옵션 `auditStatus` (`:87` `:135`) 제거 · **"draft 면 라인 실행 409" 케이스 (`:285`) 삭제** · `response.auditStatus` 단언 (`:740`) 삭제 |
| `purchase-order-single-plan.integration.spec.ts` | 시딩 `auditStatus:'approved'` (`:116`) 와 주석 (`:109`) 제거 |
| `inbound-plan-port-invariant.integration.spec.ts` | 시딩 (`:71`) 제거 |
| `inbound-pipeline.integration.spec.ts` | 시딩 (`:123` `:202`) 제거 |

`:285` 케이스는 **검증하던 동작 자체가 사라지므로 삭제가 맞다.** 다른 값으로 바꿔 살려두면 존재하지 않는 계약을 지키는 스펙이 된다.

### 수정 (개발 시드)

`scripts/local/seed-dev-core/inbound.ts:33,71` 의 `auditStatus:'approved'` 제거. 컬럼이 남으므로 두어도 타입은 통과하지만, 없는 워크플로를 암시하는 잔재다.

## 5. admin-web 변경

### 삭제 (디렉터리 1개)

- `features/inventory/purchase-orders/components/audit-action-bar/` (126줄)

### 삭제 (파생 표면)

- `lib/api/domains/inventory/purchase-orders.client.ts` — `submitForAudit` · `approve` · `reject` 3메서드
- `lib/services/inventory/mutations.ts` — `useSubmitForAudit` (`:654`) · `useApprovePo` (`:666`) · `useRejectPo` (`:678`) 와 import 3줄 (`:60-62`)
- `lib/types/dto/inventory.ts` — `SubmitForAuditRequest` · `ApprovePoRequest` · `RejectPoRequest` (`:1483-1493`), `PurchaseOrderDto.auditStatus` (`:1419`), `PurchaseOrderAuditStatus` (`:1401` — core 정의와 달리 `'rejected'` 가 빠져 있는 드리프트본이다)
- `hooks/table/columns/use-purchase-orders-table-columns.tsx:63` — 「심사 상태」 컬럼
- `features/.../purchase-order-detail-drawer/index.tsx` — 심사 배지 (`:88-92`) 와 「심사」 섹션 (`AuditActionBar` 렌더)
- `features/inventory/inbound/components/plan-create-tab/index.tsx` — `eligiblePos` 필터 (`:41-43`) 와 낡은 주석 (`:21-23`). 서버 질의가 이미 `status:'confirmed'` 이므로 **필터를 지우면 `poListData.data` 를 그대로 쓴다.**

> `plan-create-tab` 의 주석은 *"백엔드 가드 추가는 별도 PR 예정"* 이라고 적혀 있다. 그 별도 PR 이 이 PR 이고, 결론은 가드 추가가 아니라 축 제거다. 주석을 남기면 다음 사람이 미완의 TODO 로 읽는다.

### 수정 (드로어 상태 드롭다운)

`canChangeStatus = po.auditStatus === 'approved'` 를 제거하고 **드롭다운을 항상 표시**하되, 선택지에서 **`received` 를 뺀다** (`created` · `confirmed` 둘만).

이유: 심사 게이트가 우연히 덮고 있던 구멍이 드러난다. `received` 는 입고 경로가 소유한 종결 상태다 (항목 9 스펙 §5 헤더 status 파생표). 수동으로 걸면 그 발주는 라인 실행이 막히고 (`Cannot execute … status: received`) `refreshHeaderStatus` 도 조기 반환한다. 일괄 확정(`confirmed`)은 서비스 docstring 이 *"라인별 실행 화면을 쓰지 않는 운영자를 위한 일괄 경로"* 라고 의도를 명시했으므로 살린다.

API 로는 여전히 `received` 를 수동 설정할 수 있다. 서버 측 차단은 항목 9 의 3단계(contract phase) 몫으로 남긴다 — §10 참조.

## 6. DB — 손대지 않는다

`purchase_orders` 의 심사 컬럼 6개와 enum 을 그대로 둔다:

```
audit_status (po_audit_status, NOT NULL DEFAULT 'draft')
submitted_for_audit_at / submitted_for_audit_by
audited_at / audited_by
audit_notes
```

**귀결: 새 발주는 계속 `audit_status='draft'` 로 쌓이되 아무도 읽지 않는다.** #663 이 남긴 `approval_status` 와 같은 상태다. 죽은 컬럼이 늘어나는 대신 마이그레이션 0 · 단일 배포 · 롤백 자유를 얻는다.

## 7. 검증

| 명령 | 대상 | 기준 |
|---|---|---|
| `npm run type-check` | **백엔드만** | 에러 0 |
| `cd apps/admin-web && npx tsc --noEmit` | **admin-web** | 에러 0 |
| `npx jest --maxWorkers=2` | 백엔드 유닛 | 실패 0 (`--maxWorkers` 없으면 OOM) |
| `npm run test:core:integration:local` | core DB 통합 | **기준선 대조** |
| `npm run lint` | 백엔드 `.ts` | 통과 |

**루트 `type-check` 는 admin-web 을 보지 않는다** (루트 `tsconfig.json` 의 `exclude`). admin-web 은 컴포넌트 테스트도 불가하므로 그 `tsc --noEmit` 이 유일한 검증이다. 삭제 규모에 비해 결과가 지나치게 깨끗하면 `tsbuildinfo` 를 지우고 다시 돌린다 (`incremental: true`).

**통합 스펙은 숫자를 읽지 말고 기준선과 대조한다.** develop 부터 RED 인 suite 가 있으므로 `git stash -u` 로 기준선을 뜨고 실패 **항목명**이 문자열까지 같은지 본다 (#732 에서 쓴 방법).

### 이 PR 이 공짜로 얻는 방어선

`inventory-scope-coverage.spec.ts` 는 코드의 라우트 집합과 배정표의 **정확 일치**를 단언한다 (`missingFromTable`/`staleInTable` 둘 다 빈 배열). 라우트 3개를 지우고 표를 안 고치면 즉시 빨개진다 — 삭제 누락을 사람이 셀 필요가 없다.

### 수동 확인 4건

1. 발주 목록에 「심사 상태」 컬럼이 없다
2. 발주 상세에 「심사」 섹션이 없고, **상태 드롭다운이 항상 보이며 선택지가 `생성됨`/`확정됨` 둘뿐**이다
3. 입고 → 계획 생성 탭의 발주 선택 목록이 `confirmed` 발주를 그대로 보여준다 (심사와 무관하게)
4. Swagger 에서 발주 라우트가 14개이고 `submit-for-audit`/`approve`/`reject` 가 없다

## 8. 배포

마이그레이션 **0** · 시크릿 0 · env 0 · 이벤트 계약 변화 0.

**admin-web 과 core 는 한 번의 `sst deploy` 로 함께 롤린다.** 둘은 같은 SST 스택에 있고(`deployments/lcnine/services/infra/services.ts`), `url('core')` 가 리소스 참조가 아니라 문자열이라(`shared.ts:38`) 의존 간선이 없다. 문서화된 배포 단위는 `npx sst deploy --stage live` 하나이므로 **"admin-web 먼저"를 기본 명령으로는 표현할 수 없다.**

롤아웃 중 몇 분간 두 방향 중 하나의 일시적 저하가 나타났다 사라진다:

| 먼저 뜨는 쪽 | 증상 | 지속 |
|---|---|---|
| core 새 코드 | 옛 admin-web 의 `auditStatus` 가 `undefined` → 계획 생성 탭 발주 목록 공백, 상세 드롭다운 숨김, 목록에 빈 배지 | 롤아웃 완료까지 |
| admin-web 새 코드 | 새 UI 가 심사 없이 확정을 시도 → 옛 core 가 400 | 롤아웃 완료까지 |

**데이터 손상도 쓰기 실패도 없다.** 제거된 필드는 옛 admin-web 에서 **동등 비교에만** 쓰였다(`=== 'approved'`) — `.map()` 도 포맷팅도 없어 `undefined` 가 예외로 번지지 않는다. 롤아웃이 끝나면 자동으로 정상화된다.

순서를 굳이 지키고 싶으면 `npx sst deploy --stage live --target AdminWeb` 를 먼저 돌린 뒤 전체 배포를 하면 된다. 저장소에 그 절차는 없으므로 선택이다.

### 배포 전 실측 (이슈에 기록)

```sql
SELECT audit_status, status, count(*) FROM purchase_orders GROUP BY 1, 2 ORDER BY 1, 2;
```

게이트 ②가 사라지면 **지금 `draft`/`pending_audit`/`rejected` 에 멈춰 있는 발주가 전부 즉시 라인 실행 가능**해진다. 의도한 결과지만, `rejected` 가 유의미하게 있으면 "반려된 발주가 살아난다"는 뜻이므로 사람이 확인한다. 결과는 컬럼 드롭(L3)을 판단할 때의 유일한 근거이기도 하므로 이슈에 남긴다.

## 9. 영향 범위 밖 — 확인 완료

- **core·admin-web 밖에 소비자가 없다.** 저장소 전체 grep 결과 심사 필드를 참조하는 곳은 core(스키마·서비스·DTO·스펙) · admin-web · 스크립트 2개(개발 시드 `scripts/local/seed-dev-core/inbound.ts`, CSV 일괄등록 `apps/core/scripts/import-inbound-plans.ts`)뿐이다. `native/warehouse-app` · 타 마이크로서비스 · 외부 storefront 파급 **0**.
- **목록 필터에 심사 축이 없다.** `PurchaseOrderListFilters` 는 `auditStatus` 를 받지 않는다 — 필터 UI 를 지울 일이 없다.
- **Kafka 이벤트에 심사 축이 없다.** 발주는 이벤트를 발행하지 않는다.
- **`inbound_plans` 경로는 심사를 보지 않는다.** 계획 생성 자격은 `linkedPurchaseOrderId` 에서 도출된다 (항목 4 writer 단일화 이후).
- **감사 로그(`audit_logs`)와 무관하다.** 이름이 비슷하지만 별개 도메인이고, 그쪽 결함은 #724 항목 14 다.

## 10. 범위 밖 — 의도적으로 남기는 것

- **항목 9 의 3단계 (contract phase)** — 헤더 `expected_arrival` 격하와 `PUT /:id/status` 의 계약 정리. 2단계가 그 경로를 "컬럼 쓰기" 에서 "일괄 라인 실행" 으로 바꿔 **전제가 달라졌으므로**, 무엇을 차단할지부터 다시 판단해야 한다. 이 PR 은 그 판단을 선점하지 않는다.
  - 여기에 새로 추가되는 항목: **종결 상태(`received`)에서의 역방향 전이 차단.** `updatePurchaseOrderStatus` 에는 상태 전이 가드가 없다. 게이트 ①이 `CONFIRMED` 방향에서만 발화했던 탓에, `audit_status='draft'` 인 `received` 발주는 지금까지 `confirmed` 로 되돌릴 수 없었는데 **이 PR 이후엔 가능해진다.** 이중 계상은 라인 상태가 막고(`이미 입고된 발주를 다시 confirmed 로 불러도 아이템이 늘지 않는다` — `purchase-order-line-execution.integration.spec.ts:489` 가 고정), UI 로는 도달 불가하며(드로어가 `received` 면 상태 섹션을 감춘다 — `purchase-order-detail-drawer/index.tsx:95`), `received → created` 는 develop 에서도 이미 열려 있었다 — 즉 이 PR 이 구멍을 만든 게 아니라 넓혔다. §8 의 배포 전 실측 SQL 이 `GROUP BY audit_status, status` 라 이 모집단이 자동으로 드러난다.
- **컬럼 드롭 (L3)** — §6.
- **항목 12 (admin-web 라인 실행 UI)** — 이 PR 다음 차례. 드로어의 상태 드롭다운 정리도 그때 다시 본다.

## 11. 이슈 처리

#724 의 현황판에서 항목 3 을 🟩 로, 항목 10-b 를 **소멸**로 갱신하고 PR 번호와 §8 실측 결과를 남긴다. 엄브렐러이므로 이슈는 닫지 않는다.
