# 상품 목록 운영 노출 정책 일괄 변경 — 설계

- 날짜: 2026-07-07
- 대상: `apps/admin-web` (mall/products-list) + `apps/core` (catalog bulk)
- 브랜치 기준: `feat/mall-products-list-selection-ux`

## 1. 배경 / 문제

`mall/products-list` 목록에서 상품을 하나 이상 선택하면 하단 툴바가 뜨고, `선택 상품상태변경` 버튼으로 **판매 상태(active/inactive)** 를 일괄 변경할 수 있다. 이 버튼은 공용 `BulkActionModal` 을 `action='status'` 로 연다.

한편 상품 **상세 페이지**에는 `운영 노출 정책` 섹션이 있어 3개의 boolean 을 개별 토글한다:

| 라벨 | 필드 | 의미 |
|---|---|---|
| 멤버십가 비공개 | `hideMembershipPriceForNonMembers` | 비회원에게 멤버십가 숫자를 숨김 (노출·구매 제한 아님) |
| 멤버십 회원 전용 노출 | `isVisibleToMembersOnly` | 비회원 목록·검색·상세에서 상품 자체를 숨김 |
| 해외직구 | `isOverseas` | 체크아웃 시 개인통관고유부호 입력 필수 |

이 정책을 목록에서 **일괄** 변경하는 수단이 없다. 목표는 일괄 변경 기능을 추가하되, 판매 상태 변경과는 **분리된** UX 로 제공하는 것.

### 현재 구조 (근거 파일)

**프론트엔드**
- 툴바 + 모달 렌더: `apps/admin-web/src/features/mall/products-list/components/table/index.tsx` (버튼 82–118, `BulkActionModal` 142–149)
- 판매 상태 모달: `apps/admin-web/src/features/mall/bulk/components/bulk-action-modal/index.tsx`
- 선택 스냅샷 모델: `apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.ts` (`SelectedProductSnapshot = { masterId, name, thumbnail }`)
- 목록 요약 타입: `apps/admin-web/src/lib/types/dto/products.ts` (`MasterSummaryDto`)
- bulk API 클라이언트: `apps/admin-web/src/lib/api/domains/products/bulk.client.ts`
- bulk mutation 훅: `apps/admin-web/src/lib/services/products/mutations.ts` (`useBulkUpdateMasters` 등)

**백엔드 (apps/core)**
- bulk 컨트롤러: `apps/core/src/modules/catalog/operations/bulk/product-bulk.controller.ts`
- bulk DTO: `apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.ts`
- bulk 서비스: `apps/core/src/modules/catalog/operations/bulk/product-bulk.service.ts`
- 단건 정책 메서드 + 이벤트: `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts` (`updateMembershipPriceVisibility` 641–664, `updateMembersOnlyVisibility` 676–695, `updateOverseas` 700–714, private `_emitActiveVersionChangedEvent` 773–811, `getActiveVersion`)
- 목록 요약 응답 DTO: `apps/core/src/modules/catalog/core/products/dto/products/product-response.dto.ts` (`ProductSummaryDto`, 164–171)
- 정책 컬럼: `apps/core/src/modules/catalog/schema/catalog.schema.ts` (`productMasterVersions` 의 `hideMembershipPriceForNonMembers`, `isVisibleToMembersOnly`, `isOverseas`, `isMembershipOnly`)

### 핵심 제약 (반드시 준수)

1. **정책 일괄 변경은 현재 백엔드에 없다.** `BulkUpdateDto` 는 `status/approvalStatus/basePrice/brand/seller` 만 가진다 (`basePrice` 는 사실상 무시되는 no-op). 3개 정책 플래그는 어떤 bulk 경로에도 없다 → **백엔드 신규 작업 필요.**
2. **정책 변경은 단순 DB write 가 아니다.** 단건 경로는 active 버전 row 를 갱신한 뒤 `ProductMasterActiveVersionChanged` outbox 이벤트를 발행해 **Medusa(스토어프론트)·search·analytics 를 재동기화**한다. 기존 bulk-update 의 "direct SQL" 분기는 **이벤트를 발행하지 않으므로** 정책 플래그에 재사용하면 스토어프론트가 stale 해진다. → 정책 일괄 변경은 반드시 **master 단위 loop + master 당 이벤트 발행**.
3. **정책 플래그는 이미 목록 API 응답에 포함되어 있다.** 백엔드 `ProductSummaryDto` 는 3개 플래그를 모두 반환한다. 프론트 `MasterSummaryDto` 타입만 `isOverseas` 가 누락된 타입 드리프트 상태 → count/impact 표시는 **순수 클라이언트 파생**으로 가능 (추가 fetch/백엔드 작업 불필요).

## 2. 목표 / 비목표

**목표 (v1)**
- 목록 툴바에 `운영 노출 정책 변경` 버튼 추가 → 전용 `BulkPolicyModal`.
- 3개 플래그를 **tri-state** (`변경 안 함` / `켜기` / `끄기`) 로 편집. 기본값 `변경 안 함`. 건드린 플래그만 전송.
- 플래그별 **현재 분포**(켜짐 N · 꺼짐 M) 와 선택 시 **영향 개수**(K개 변경) 를 실시간 표시.
- 신규 백엔드 엔드포인트 `POST /masters/bulk/policy` — master 단위 loop, master 당 정책 이벤트 발행, active 버전 없는 상품은 부분 실패로 수집.
- 부분 실패 목록 UI 재사용.

**비목표**
- 판매 상태 모달(`BulkActionModal`) 통합/개편.
- 기존 bulk-update 의 `basePrice` no-op 정리 (별도).
- 정책 변경 감사 로그 신규 추가 — 단건 경로와 동일하게 별도 audit log 없이 이벤트 발행에 위임 (일관성 유지).
- 스키마 변경/마이그레이션 — 컬럼이 이미 존재하므로 **없음**.

## 3. 백엔드 설계 (apps/core)

### 3.1 엔드포인트

`product-bulk.controller.ts` 에 추가:

```
@Post('policy')   // → POST /masters/bulk/policy
bulkUpdatePolicy(@Body() dto: BulkPolicyDto, @CurrentUser() user)
  → this.bulkService.bulkUpdatePolicy(dto, user.userId)
```

CLAUDE.md 규약에 따라 **컨트롤러에서 try/catch 로 에러→상태 매핑을 하지 않는다** (global filter 위임). 서비스는 도메인 예외(`BadRequestError` 등)를 던진다. (참고: 같은 파일의 기존 `bulkUpdate` 는 try/catch 로 400 을 감싸는 옛 패턴이지만, 이번 신규 메서드는 규약을 따르고 기존 메서드는 건드리지 않는다.)

### 3.2 DTO

`bulk-operations.dto.ts` 에 추가:

```ts
export class BulkPolicyDto {
  @IsArray() @IsString({ each: true })
  productIds: string[];                 // masterId 목록

  @IsOptional() @IsBoolean()
  hideMembershipPriceForNonMembers?: boolean;

  @IsOptional() @IsBoolean()
  isVisibleToMembersOnly?: boolean;

  @IsOptional() @IsBoolean()
  isOverseas?: boolean;
}
```

### 3.3 서비스 — `ProductVersionsService.updateExposurePolicy`

3개 단건 메서드는 각각 active 버전 조회 + UPDATE + 이벤트를 반복한다. 한 상품에 여러 플래그를 동시에 바꾸면 상품당 이벤트가 여러 번 나가므로, **여러 플래그를 한 번의 UPDATE + 한 번의 이벤트**로 처리하는 결합 메서드를 `ProductVersionsService` 에 추가한다 (`_emitActiveVersionChangedEvent` 가 private 이므로 같은 서비스 안에 두어야 함):

```ts
async updateExposurePolicy(
  masterId: string,
  patch: {
    hideMembershipPriceForNonMembers?: boolean;
    isVisibleToMembersOnly?: boolean;
    isOverseas?: boolean;
  },
  tx?: DbTx,
): Promise<void> {
  return this.db.run(async (trx) => {
    const activeVersion = await this.getActiveVersion(masterId, trx); // 없으면 NotFound 계열 throw

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.hideMembershipPriceForNonMembers !== undefined) {
      set.hideMembershipPriceForNonMembers = patch.hideMembershipPriceForNonMembers;
      set.isMembershipOnly = patch.hideMembershipPriceForNonMembers; // deprecated 컬럼 미러 (단건 경로와 동일)
    }
    if (patch.isVisibleToMembersOnly !== undefined) set.isVisibleToMembersOnly = patch.isVisibleToMembersOnly;
    if (patch.isOverseas !== undefined) set.isOverseas = patch.isOverseas;

    await trx.update(productMasterVersions).set(set).where(eq(productMasterVersions.id, activeVersion.id));

    // 스냅샷은 넘긴 version 객체에서 조립되므로, 적용된 값으로 patch 한 객체를 전달해야 snapshot 이 신규 값 반영
    const patchedVersion = { ...activeVersion, ...set };
    await this._emitActiveVersionChangedEvent(patchedVersion, null, 'published', trx);
  }, tx);
}
```

> 참고: 기존 3개 단건 메서드를 이 결합 메서드에 위임시키는 리팩터는 선택 사항이며 v1 범위 밖. 신규 메서드만 추가한다.

### 3.4 서비스 — `ProductBulkService.bulkUpdatePolicy`

기존 `bulkUnpublish` 의 master 단위 loop 구조를 따른다:

실패 항목은 기존 `bulkActivate` 가 쓰는 실패 형태(`{ masterId, name, reason }`)를 그대로 재사용한다 (해당 타입/응답 DTO 명칭은 구현 시 `product-bulk.service.ts` 의 기존 정의를 따른다).

```ts
async bulkUpdatePolicy(dto: BulkPolicyDto, userId: string): Promise<{ updated: number; failed: BulkFailure[] }> {
  const patch = pickDefined(dto);                 // 3개 플래그 중 정의된 것만
  if (Object.keys(patch).length === 0) throw new BadRequestError('변경할 노출 정책 항목이 없습니다.');

  let updated = 0;
  const failed: BulkFailure[] = [];               // { masterId, name, reason } — 기존 실패 형태 재사용

  for (const masterId of dto.productIds) {
    try {
      // master 단위 독립 트랜잭션 — 한 건 실패가 앞선 성공을 롤백하지 않도록
      await this.db.run((trx) => this.productVersionsService.updateExposurePolicy(masterId, patch, trx));
      updated++;
    } catch (e) {
      failed.push({ masterId, name: null, reason: 'active 버전이 없어 노출 정책을 적용할 수 없습니다.' });
    }
  }
  return { updated, failed };
}
```

- **트랜잭션**: master 단위 독립 실행(`this.db.run` per master), `bulkUnpublish` 와 동일. 부분 실패 허용.
- **부분 실패**: active 버전이 없는(draft-only) 상품은 `getActiveVersion` 이 throw → `failed[]` 로 수집. `name` 은 best-effort(우선 null; FE 가 masterId 로 폴백). 필요 시 이름 조회를 추가할 수 있으나 v1 은 null 허용.
- **반환**: `{ updated, failed }`. FE 의 기존 부분 실패 처리(`result.updated`, `result.failed`)와 호환.

## 4. 프론트엔드 설계 (apps/admin-web)

### 4.1 타입 정합

- `MasterSummaryDto` (`lib/types/dto/products.ts`) 에 `isOverseas: boolean` 추가 (응답에는 이미 존재, 타입만 보강).
- 신규 요청/응답 타입:
  ```ts
  export interface BulkUpdatePolicyDto {
    productIds: string[];
    hideMembershipPriceForNonMembers?: boolean;
    isVisibleToMembersOnly?: boolean;
    isOverseas?: boolean;
  }
  ```
  응답은 기존 `BulkUpdateResultDto` 호환 `{ updated, failed }` 재사용.

### 4.2 API 클라이언트 / 훅

- `bulk.client.ts` 에 `policy: (dto: BulkUpdatePolicyDto) => POST /masters/bulk/policy` 추가.
- `mutations.ts` 에 `useBulkUpdatePolicy()` 추가 — `products.bulk.policy(dto)` 호출, 성공 시 `productQueryKeys.masters` invalidate (`useBulkUpdateMasters` 와 동일 패턴). 목록 무효화로 count 도 갱신됨.

### 4.3 선택 스냅샷 확장 (count 파생의 근거)

`products-list-selection-model.ts`:
- `SelectedProductSnapshot` 에 3개 boolean 추가:
  ```ts
  export type SelectedProductSnapshot = {
    masterId: string;
    name: string;
    thumbnail: string | null;
    hideMembershipPriceForNonMembers: boolean;
    isVisibleToMembersOnly: boolean;
    isOverseas: boolean;
  };
  ```
- `snapshotsEqual` 에 3개 필드 비교 추가 (refetch 로 값이 바뀌면 재조정되도록).
- `reconcileSelectedSnapshots` 의 폴백 기본값(`prev[id] ?? {…}`)에 3개 필드 기본 `false` 포함.

`table/index.tsx` 의 reconcile effect(59–75)에서 `currentRows` 매핑에 3개 필드를 `r` 에서 복사. (선택 순간 행이 반드시 로드돼 있으므로 모든 선택 항목이 플래그 값을 갖는다.)

### 4.4 count/impact 파생 헬퍼 (순수 함수, 테스트 대상)

`bulk/components/bulk-policy-modal/policy-counts.ts`:
```ts
type Flag = 'hideMembershipPriceForNonMembers' | 'isVisibleToMembersOnly' | 'isOverseas';
type Choice = 'unchanged' | 'on' | 'off';

export function flagStats(items: SelectedProductSnapshot[], flag: Flag): { on: number; off: number } { … }
// impact: choice==='on' ? off : choice==='off' ? on : 0
export function flagImpact(stats, choice: Choice): number { … }
```

### 4.5 전용 모달 — `BulkPolicyModal`

`apps/admin-web/src/features/mall/bulk/components/bulk-policy-modal/index.tsx` (신규)

- Props: `{ open, onOpenChange, selectedIds: string[], selectedItems: SelectedProductSnapshot[], onSuccess }`.
- 상태: 플래그별 `Choice` (`'unchanged' | 'on' | 'off'`), 초기 `'unchanged'`.
- 컨트롤: **3-way 세그먼트 컨트롤** per 플래그. 디자인 시스템에 `ToggleGroup` 프리미티브가 있으면 사용, 없으면 `Button` variant 전환으로 구성 (구현 단계에서 확인).
- 각 행 표시: 라벨 + 설명 + `현재: 켜짐 {on} · 꺼짐 {off}`, 선택 시 `→ '켜기/끄기' 선택 시 {impact}개 변경` 라인.
- `확인` 은 **모든 플래그가 `unchanged` 이면 disabled** (기존 status 모달의 빈 업데이트 버그 회피).
- 확인 시 `unchanged` 아닌 플래그만 boolean 으로 묶어 `useBulkUpdatePolicy().mutateAsync(patch)`.
- 결과 처리: `failed.length > 0` 이면 모달 유지 + 부분 실패 목록 표시 + `toast.warning('{updated}개 적용, {failed}개 실패')`; 전량 성공 시 `toast.success('{updated}개 상품의 노출 정책이 변경되었습니다.')` + `onSuccess()` + 닫기.

### 4.6 부분 실패 목록 공용화

status/policy 두 모달이 동일한 실패 목록 마크업을 쓰므로, `BulkActionModal` 의 실패 블록(155–171)을 `bulk/components/bulk-failure-list/index.tsx` 공용 컴포넌트로 추출하고 양쪽에서 사용.

### 4.7 툴바 배선

`table/index.tsx`:
- `선택 상품상태변경` 옆에 `운영 노출 정책 변경` 버튼 추가 → 로컬 상태로 `BulkPolicyModal` open 제어 (기존 `modalAction` 과 별개 state).
- `BulkPolicyModal` 렌더, `selectedItems={selectedItemsList}` (확장된 스냅샷) 전달. `onSuccess` 는 기존 `handleSuccess` (선택 해제 + 스냅샷 초기화) 재사용.

## 5. 데이터 흐름

```
목록 API(GET /masters) → ProductSummaryDto(3 플래그 포함)
  → 행 선택 시 SelectedProductSnapshot(플래그 포함) 스냅샷
  → BulkPolicyModal: 스냅샷 reduce 로 현재 분포/영향 표시
  → 확인 → POST /masters/bulk/policy { productIds, 변경한 플래그만 }
  → ProductBulkService.bulkUpdatePolicy: master 단위 loop
      → ProductVersionsService.updateExposurePolicy: active 버전 UPDATE + ProductMasterActiveVersionChanged 이벤트
      → active 버전 없음 → failed[]
  → { updated, failed } → 모달 토스트/실패 목록 → 목록 invalidate
  → 이벤트 소비: channel-adapter(Medusa)·search·analytics 재동기화
```

## 6. 엣지 케이스 / 에러 처리

- **플래그 미선택 확인**: FE 에서 `확인` disabled + 백엔드에서 `BadRequestError` 이중 방어.
- **active 버전 없는 상품**: 부분 실패로 수집, 나머지는 계속 진행.
- **교차 페이지 선택**: 선택 순간 행이 로드돼 있으므로 스냅샷에 플래그 값 존재 → count 정확.
- **일부만 켜짐/꺼짐 혼재**: tri-state 기본 `변경 안 함` 이 혼재 상태를 강제로 덮어쓰지 않게 함. 사용자가 명시적으로 `켜기/끄기` 를 선택한 플래그만 전송.
- **deprecated `isMembershipOnly`**: `hideMembershipPriceForNonMembers` 변경 시 동일 값으로 미러 (단건 경로와 일치).

## 7. 테스트 계획

**백엔드**
- `updateExposurePolicy`: 제공된 플래그만 set, `isMembershipOnly` 미러, patch 된 스냅샷으로 이벤트 1회 발행.
- `bulkUpdatePolicy`: 전량 성공 카운트; active 버전 없는 master 부분 실패 수집; 빈 patch → `BadRequestError`; master 당 이벤트 1회.

**프론트엔드**
- `products-list-selection-model.spec.ts` 확장: 스냅샷에 플래그 포함/재조정.
- `policy-counts` 순수 함수: on/off 분포, impact 계산.
- `BulkPolicyModal`: 미선택 시 `확인` disabled; 선택 플래그만 payload; 부분 실패 시 목록 유지.

## 8. 미해결 / 후속

- 실패 항목 `name` 을 백엔드에서 채울지 (현재 null + FE masterId 폴백) — 필요 시 후속.
- 기존 `BulkUpdateDto.basePrice` no-op 정리 — 별도 PR.
- 단건 3개 메서드를 `updateExposurePolicy` 로 위임하는 리팩터 — 별도.
