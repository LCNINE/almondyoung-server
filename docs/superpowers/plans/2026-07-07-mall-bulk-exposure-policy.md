# 상품 목록 운영 노출 정책 일괄 변경 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상품 목록에서 선택한 상품들의 운영 노출 정책(멤버십가 비공개·회원 전용 노출·해외직구)을 판매 상태 변경과 분리된 전용 모달에서 tri-state로 일괄 변경한다.

**Architecture:** 신규 백엔드 엔드포인트 `POST /masters/bulk/policy`가 master 단위 loop로 `ProductVersionsService.updateExposurePolicy`(active 버전 UPDATE + `ProductMasterActiveVersionChanged` 이벤트 1회)를 호출해 Medusa·search·analytics 재동기화를 보장한다. 프론트는 목록 응답에 이미 존재하는 플래그 값을 선택 스냅샷에 담아, 현재 분포·영향 개수를 순수 함수로 파생하고 전용 `BulkPolicyModal`에서 표시한다.

**Tech Stack:** NestJS + Drizzle (apps/core), Next.js + React Query + shadcn/Radix (apps/admin-web), Jest(ts-jest, node env).

## Global Constraints

- **레이어/예외:** 이 bulk 모듈의 기존 컨벤션을 따른다 — 컨트롤러는 sibling들과 동일하게 `try/catch → HttpException(400)`으로 감싸고, 서비스는 Nest 예외(`BadRequestException`, `NotFoundException` from `@nestjs/common`)를 던진다. (스펙 §3.1은 CLAUDE.md의 no-try/catch 규약을 언급했으나, 같은 파일의 기존 3개 메서드가 모두 이 패턴이라 로컬 일관성을 우선한다.)
- **트랜잭션 전파:** public 메서드는 `tx?: DbTransaction`를 마지막 인자로. 내부는 `this.db.run(run, tx)` 사용. `DbTransaction`/`DbClient`는 `apps/core/src/modules/catalog/catalog.types`에서 import.
- **타입 안전:** 신규 코드에 `any`/`as` 미사용 (기존 코드의 `any`는 건드리지 않음).
- **정책 감사 로그 없음:** 단건 정책 경로와 동일하게 별도 audit row 없이 이벤트 발행에 위임. 따라서 서비스 메서드는 `userId`를 받지 않는다.
- **FE 테스트 제약:** 루트 jest 하나가 admin-web `.spec.ts`도 `testEnvironment: node`로 실행한다. jsdom 없음, `@/` alias 미매핑. 따라서 **테스트되는 로직은 전부 순수 함수**로 두고, spec과 그 spec이 로드하는 소스는 **상대 경로 import만** 사용하며 `@/`를 import하지 않는다. React 컴포넌트는 렌더 테스트하지 않는다(로직은 이미 순수 함수로 커버).
- **UI 카피:** 한국어.
- **DTO 배럴:** `apps/core/src/modules/catalog/operations/bulk/dto/index.ts`는 `export * from './bulk-operations.dto'`라서 `bulk-operations.dto.ts`에 클래스만 추가하면 배럴 수정 불필요.

---

## File Structure

**백엔드 (apps/core)**
- Modify `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts` — `updateExposurePolicy` 추가
- Modify `apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts` — 테스트 추가
- Modify `apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.ts` — `BulkPolicyDto` 추가
- Modify `apps/core/src/modules/catalog/operations/bulk/product-bulk.service.ts` — `bulkUpdatePolicy` 추가
- Create `apps/core/src/modules/catalog/operations/bulk/product-bulk.service.spec.ts` — 신규 테스트
- Modify `apps/core/src/modules/catalog/operations/bulk/product-bulk.controller.ts` — `POST policy` 엔드포인트

**프론트엔드 (apps/admin-web)**
- Modify `apps/admin-web/src/lib/types/dto/products.ts` — `MasterSummaryDto.isOverseas`, `BulkUpdatePolicyDto`, `BulkPolicyResultDto`
- Modify `apps/admin-web/src/lib/api/domains/products/bulk.client.ts` — `policy` 메서드
- Modify `apps/admin-web/src/lib/services/products/mutations.ts` — `useBulkUpdatePolicy`
- Modify `apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.ts` — 스냅샷에 3 플래그
- Modify `apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.spec.ts` — 스냅샷 테스트
- Modify `apps/admin-web/src/features/mall/products-list/components/table/index.tsx` — 스냅샷 매핑 + 버튼/모달 배선
- Create `apps/admin-web/src/features/mall/bulk/components/bulk-policy-modal/policy-counts.ts` (+ `.spec.ts`)
- Create `apps/admin-web/src/features/mall/bulk/components/bulk-policy-modal/build-policy-patch.ts` (+ `.spec.ts`)
- Create `apps/admin-web/src/features/mall/bulk/components/bulk-failure-list/index.tsx`
- Modify `apps/admin-web/src/features/mall/bulk/components/bulk-action-modal/index.tsx` — 실패 목록 컴포넌트 사용
- Create `apps/admin-web/src/features/mall/bulk/components/bulk-policy-modal/index.tsx`

---

## Task 1: 백엔드 — `ProductVersionsService.updateExposurePolicy`

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts` (add after `updateOverseas`, ~line 714)
- Test: `apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts`

**Interfaces:**
- Consumes: `getActiveVersion(masterId, tx)`, `_emitActiveVersionChangedEvent(newVersion, prev, reason, tx)`, `this.db.run`, `productMasterVersions`, `eq` — 모두 이 파일에 이미 존재.
- Produces: `updateExposurePolicy(masterId: string, patch: { hideMembershipPriceForNonMembers?: boolean; isVisibleToMembersOnly?: boolean; isOverseas?: boolean }, tx?: DbTransaction): Promise<void>` — Task 2가 호출.

- [ ] **Step 1: 실패 테스트 작성** — 기존 spec의 `describe('ProductVersionsService Medusa projection outbox events', ...)` 블록 **안**(makeService가 스코프에 있음), 기존 `it(...)` 뒤에 추가:

```ts
  it('updateExposurePolicy: 제공된 플래그만 set 하고 이벤트를 published로 1회 발행한다', async () => {
    const { service, outboxPublisher, projectionSnapshotAssembler } = makeService();
    projectionSnapshotAssembler.assembleActiveVersionSnapshot.mockResolvedValue({
      snapshot: { name: 'N' },
      categoryIds: [],
      primaryCategoryId: null,
    });
    jest
      .spyOn(service as any, 'getActiveVersion')
      .mockResolvedValue({ id: 'v1', masterId: 'm1', name: 'N' });

    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    const tx = { update: jest.fn().mockReturnValue({ set }) } as any;

    await service.updateExposurePolicy(
      'm1',
      { isVisibleToMembersOnly: true, hideMembershipPriceForNonMembers: false },
      tx,
    );

    const setArg = set.mock.calls[0][0];
    expect(setArg).toMatchObject({
      isVisibleToMembersOnly: true,
      hideMembershipPriceForNonMembers: false,
      isMembershipOnly: false, // deprecated 컬럼 미러
    });
    expect(setArg.isOverseas).toBeUndefined(); // 미제공 플래그는 건드리지 않음
    expect(outboxPublisher.saveEvent).toHaveBeenCalledTimes(1);
    const [event, txArg] = outboxPublisher.saveEvent.mock.calls[0];
    expect(event.payload.changeReason).toBe('published');
    expect(txArg).toBe(tx);
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest --testPathPattern=product-versions.service.spec -t "updateExposurePolicy"`
Expected: FAIL — `service.updateExposurePolicy is not a function`

- [ ] **Step 3: 메서드 구현** — `updateOverseas` 메서드 바로 뒤(line 714 이후)에 추가:

```ts
  /**
   * 운영 노출 정책(멤버십가 비공개/회원 전용 노출/해외직구)을 한 번의 UPDATE + 한 번의
   * 이벤트로 반영한다. undefined 아닌 필드만 변경. draft 없이 active 버전 직접 수정 후 채널 재싱크.
   */
  async updateExposurePolicy(
    masterId: string,
    patch: {
      hideMembershipPriceForNonMembers?: boolean;
      isVisibleToMembersOnly?: boolean;
      isOverseas?: boolean;
    },
    tx?: DbTransaction,
  ): Promise<void> {
    return this.db.run(async (tx) => {
      const activeVersion = await this.getActiveVersion(masterId, tx);

      const set: Partial<typeof productMasterVersions.$inferInsert> = { updatedAt: new Date() };
      if (patch.hideMembershipPriceForNonMembers !== undefined) {
        set.hideMembershipPriceForNonMembers = patch.hideMembershipPriceForNonMembers;
        set.isMembershipOnly = patch.hideMembershipPriceForNonMembers; // deprecated 컬럼 미러 (단건 경로와 동일)
      }
      if (patch.isVisibleToMembersOnly !== undefined) {
        set.isVisibleToMembersOnly = patch.isVisibleToMembersOnly;
      }
      if (patch.isOverseas !== undefined) {
        set.isOverseas = patch.isOverseas;
      }

      await tx.update(productMasterVersions).set(set).where(eq(productMasterVersions.id, activeVersion.id));

      // 스냅샷은 _emit 내부에서 같은 tx로 UPDATE 이후의 DB 상태를 다시 조회해 조립하므로,
      // 갱신 전 activeVersion 객체를 그대로 넘겨도 새 값이 반영된다 (단건 경로와 동일).
      await this._emitActiveVersionChangedEvent(activeVersion, null, 'published', tx);

      this.logger.log(`updateExposurePolicy: master=${masterId} patch=${JSON.stringify(patch)}`);
    }, tx);
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --testPathPattern=product-versions.service.spec -t "updateExposurePolicy"`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/core/products/services/product-versions.service.ts \
        apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts
git commit -m "$(cat <<'EOF'
[core] ProductVersionsService.updateExposurePolicy 추가

여러 노출 정책 플래그를 active 버전에 한 번의 UPDATE + 한 번의
ProductMasterActiveVersionChanged 이벤트로 반영.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 백엔드 — `BulkPolicyDto` + `ProductBulkService.bulkUpdatePolicy`

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk/product-bulk.service.ts`
- Test (create): `apps/core/src/modules/catalog/operations/bulk/product-bulk.service.spec.ts`

**Interfaces:**
- Consumes: `updateExposurePolicy` (Task 1), `this.db.run`, `NotFoundException`/`BadRequestException` (이미 import됨).
- Produces:
  - `class BulkPolicyDto { productIds: string[]; hideMembershipPriceForNonMembers?: boolean; isVisibleToMembersOnly?: boolean; isOverseas?: boolean }`
  - `bulkUpdatePolicy(dto: BulkPolicyDto, tx?: DbTransaction): Promise<{ updated: number; failed: { masterId: string; name: string | null; reason: string }[] }>` — Task 3 컨트롤러가 호출.

- [ ] **Step 1: DTO 추가** — `bulk-operations.dto.ts` 상단 import에 `IsBoolean` 추가하고 파일 끝에 클래스 추가:

```ts
// import 줄을 아래로 교체:
import { IsArray, IsString, IsOptional, IsEnum, IsInt, IsBoolean, Min } from 'class-validator';

// 파일 끝에 추가:
export class BulkPolicyDto {
  @IsArray()
  @IsString({ each: true })
  productIds: string[];

  @IsOptional()
  @IsBoolean()
  hideMembershipPriceForNonMembers?: boolean;

  @IsOptional()
  @IsBoolean()
  isVisibleToMembersOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  isOverseas?: boolean;
}
```

- [ ] **Step 2: 실패 테스트 작성** — 신규 파일 `apps/core/src/modules/catalog/operations/bulk/product-bulk.service.spec.ts`:

```ts
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ProductBulkService } from './product-bulk.service';

function makeService(updateExposurePolicy = jest.fn().mockResolvedValue(undefined)) {
  const db = { run: (fn: any, t?: any) => (t ? fn(t) : fn(undefined)) } as any;
  const productVersionsService = { updateExposurePolicy } as any;
  const productMastersService = {} as any;
  const service = new ProductBulkService(db, productVersionsService, productMastersService);
  return { service, productVersionsService };
}

describe('ProductBulkService.bulkUpdatePolicy', () => {
  it('제공된 정책을 각 master 에 적용하고 updated 카운트를 반환한다', async () => {
    const { service, productVersionsService } = makeService();
    const result = await service.bulkUpdatePolicy({ productIds: ['m1', 'm2'], isOverseas: true });

    expect(productVersionsService.updateExposurePolicy).toHaveBeenCalledTimes(2);
    expect(productVersionsService.updateExposurePolicy).toHaveBeenCalledWith('m1', { isOverseas: true }, undefined);
    expect(result).toEqual({ updated: 2, failed: [] });
  });

  it('active 버전이 없는 master 는 failed 로 수집하고 나머지는 계속한다', async () => {
    const updateExposurePolicy = jest.fn().mockImplementation((masterId: string) =>
      masterId === 'm2'
        ? Promise.reject(new NotFoundException('no active version'))
        : Promise.resolve(undefined),
    );
    const { service } = makeService(updateExposurePolicy);
    const result = await service.bulkUpdatePolicy({
      productIds: ['m1', 'm2', 'm3'],
      isVisibleToMembersOnly: true,
    });

    expect(result.updated).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].masterId).toBe('m2');
  });

  it('변경할 플래그가 없으면 BadRequestException', async () => {
    const { service } = makeService();
    await expect(service.bulkUpdatePolicy({ productIds: ['m1'] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx jest --testPathPattern=product-bulk.service.spec`
Expected: FAIL — `service.bulkUpdatePolicy is not a function`

- [ ] **Step 4: 서비스 구현** — `product-bulk.service.ts`의 import(line 5)에 `BulkPolicyDto` 추가하고, 클래스 안(예: `bulkUpdate` 위)에 메서드 추가:

```ts
// line 5 import 를 아래로 교체:
import { BulkUpdateDto, BulkDeleteDto, BulkRestoreDto, BulkPolicyDto } from './dto';

// 클래스 메서드로 추가:
  /**
   * 선택 상품의 운영 노출 정책(멤버십가 비공개/회원 전용 노출/해외직구) 일괄 변경.
   * undefined 아닌 플래그만 반영. active 버전이 없는 master 는 failed 로 수집한다.
   * master 단위 독립 처리 — 각 건이 자체 이벤트를 발행(Medusa·검색·analytics 재싱크).
   */
  async bulkUpdatePolicy(dto: BulkPolicyDto, tx?: DbTransaction) {
    const patch: {
      hideMembershipPriceForNonMembers?: boolean;
      isVisibleToMembersOnly?: boolean;
      isOverseas?: boolean;
    } = {};
    if (dto.hideMembershipPriceForNonMembers !== undefined)
      patch.hideMembershipPriceForNonMembers = dto.hideMembershipPriceForNonMembers;
    if (dto.isVisibleToMembersOnly !== undefined) patch.isVisibleToMembersOnly = dto.isVisibleToMembersOnly;
    if (dto.isOverseas !== undefined) patch.isOverseas = dto.isOverseas;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('변경할 노출 정책 항목이 없습니다.');
    }

    let updated = 0;
    const failed: { masterId: string; name: string | null; reason: string }[] = [];

    for (const masterId of dto.productIds) {
      const run = async (trx: DbTransaction) => {
        await this.productVersionsService.updateExposurePolicy(masterId, patch, trx);
      };
      try {
        await this.db.run(run, tx);
        updated += 1;
      } catch (error) {
        // active 버전이 없는 master 는 부분 실패로 수집 — 나머지는 계속
        if (error instanceof NotFoundException) {
          failed.push({ masterId, name: null, reason: 'active 버전이 없어 노출 정책을 적용할 수 없습니다.' });
          continue;
        }
        throw error;
      }
    }

    return { updated, failed };
  }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest --testPathPattern=product-bulk.service.spec`
Expected: PASS (3 passing)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk/dto/bulk-operations.dto.ts \
        apps/core/src/modules/catalog/operations/bulk/product-bulk.service.ts \
        apps/core/src/modules/catalog/operations/bulk/product-bulk.service.spec.ts
git commit -m "$(cat <<'EOF'
[core] ProductBulkService.bulkUpdatePolicy + BulkPolicyDto 추가

master 단위 loop 로 updateExposurePolicy 호출, active 버전 없는
상품은 부분 실패로 수집, 빈 patch 는 400.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 백엔드 — `POST /masters/bulk/policy` 엔드포인트

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk/product-bulk.controller.ts`

**Interfaces:**
- Consumes: `bulkUpdatePolicy` (Task 2), `BulkPolicyDto` (Task 2).
- Produces: HTTP `POST /masters/bulk/policy`.

- [ ] **Step 1: 컨트롤러 엔드포인트 추가** — import(line 5)에 `BulkPolicyDto` 추가하고 `bulkRestore` 뒤에 메서드 추가:

```ts
// line 5 import 를 아래로 교체:
import { BulkUpdateDto, BulkDeleteDto, BulkRestoreDto, BulkPolicyDto } from './dto';

// 클래스 끝, bulkRestore 뒤에 추가:
  @Post('policy')
  @ApiOperation({
    summary: '운영 노출 정책 일괄 변경',
    description:
      '선택 상품의 운영 노출 정책(멤버십가 비공개/회원 전용 노출/해외직구)을 일괄 변경합니다. active 버전이 없는 상품은 실패 목록으로 반환됩니다.',
  })
  @ApiBody({ type: BulkPolicyDto })
  @ApiResponse({ status: 200, description: '일괄 변경 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  async bulkUpdatePolicy(@Body() dto: BulkPolicyDto) {
    try {
      return await this.bulkService.bulkUpdatePolicy(dto);
    } catch (error) {
      throw new HttpException(`Failed to bulk update policy: ${error.message}`, HttpStatus.BAD_REQUEST);
    }
  }
```

- [ ] **Step 2: 컴파일 확인**

Run: `npx nest build core`
Expected: 에러 없이 빌드 성공

- [ ] **Step 3: (선택) 스모크 테스트** — 서버 구동 중이면 확인. 미구동 시 스킵 가능.

Run: `curl -sS -X POST "$ALMONDYOUNG_API_BASE_URL/masters/bulk/policy" -H 'Content-Type: application/json' -d '{"productIds":["<masterId>"],"isOverseas":true}'`
Expected: `{ "updated": 1, "failed": [] }` 형태 JSON (또는 active 버전 없으면 failed에 수집)

- [ ] **Step 4: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk/product-bulk.controller.ts
git commit -m "$(cat <<'EOF'
[core] POST /masters/bulk/policy 엔드포인트 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: FE — 타입/클라이언트/훅 배선

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/products.ts`
- Modify: `apps/admin-web/src/lib/api/domains/products/bulk.client.ts`
- Modify: `apps/admin-web/src/lib/services/products/mutations.ts`

**Interfaces:**
- Produces:
  - `MasterSummaryDto.isOverseas: boolean`
  - `interface BulkUpdatePolicyDto { productIds: string[]; hideMembershipPriceForNonMembers?: boolean; isVisibleToMembersOnly?: boolean; isOverseas?: boolean }`
  - `interface BulkPolicyResultDto { updated: number; failed?: BulkUpdateFailureDto[] }`
  - `bulkClient.policy(dto): Promise<BulkPolicyResultDto>`
  - `useBulkUpdatePolicy()` — Task 8 모달이 사용.

- [ ] **Step 1: `MasterSummaryDto`에 `isOverseas` 추가** — `products.ts`의 `isMembershipOnly` 필드 바로 뒤(line ~177)에 추가:

```ts
  /** @deprecated use hideMembershipPriceForNonMembers */
  isMembershipOnly: boolean;
  /** 해외직구 상품 여부 — 체크아웃 시 개인통관고유부호 필수. (목록 API가 이미 반환) */
  isOverseas: boolean;
```

- [ ] **Step 2: 신규 DTO 추가** — `products.ts`의 `BulkUpdateResultDto` 정의 뒤에 추가:

```ts
export interface BulkUpdatePolicyDto {
  productIds: string[];
  hideMembershipPriceForNonMembers?: boolean;
  isVisibleToMembersOnly?: boolean;
  isOverseas?: boolean;
}

// POST /masters/bulk/policy 응답 모양 (products 없음).
export interface BulkPolicyResultDto {
  updated: number;
  failed?: BulkUpdateFailureDto[];
}
```

- [ ] **Step 3: `bulkClient.policy` 추가** — `bulk.client.ts`의 import 타입에 두 타입을 추가하고 `restore` 뒤에 메서드 추가:

```ts
// import 타입 블록에 추가:
  BulkUpdatePolicyDto,
  BulkPolicyResultDto,

// bulkClient 객체 안, restore 뒤에 추가:
  policy: async (dto: BulkUpdatePolicyDto): Promise<BulkPolicyResultDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/masters/bulk/policy`,
      dto
    );
    return response.data;
  },
```

- [ ] **Step 4: `useBulkUpdatePolicy` 훅 추가** — `mutations.ts`의 `@/lib/types/dto/products` import에 `BulkUpdatePolicyDto`를 추가하고, `useBulkRestoreMasters` 뒤(line ~921)에 추가:

```ts
export const useBulkUpdatePolicy = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: BulkUpdatePolicyDto) => products.bulk.policy(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.masters });
    },
  });
};
```

- [ ] **Step 5: 서비스 인덱스 재노출 확인** — `apps/admin-web/src/lib/services/products/index.ts`가 `export * from './mutations'`인지 확인. 명시적 named export라면 `useBulkUpdatePolicy`를 추가한다. (모달은 `@/lib/services/products`에서 import한다.)

Run: `grep -n "mutations" apps/admin-web/src/lib/services/products/index.ts`
Expected: `export * from './mutations';` 존재 → 추가 작업 없음

- [ ] **Step 6: 타입 컴파일 확인**

Run: `npx tsc -p apps/admin-web/tsconfig.json --noEmit`
Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src/lib/types/dto/products.ts \
        apps/admin-web/src/lib/api/domains/products/bulk.client.ts \
        apps/admin-web/src/lib/services/products/mutations.ts
git commit -m "$(cat <<'EOF'
[admin-web] bulk policy 타입/클라이언트/훅 배선

MasterSummaryDto.isOverseas, BulkUpdatePolicyDto/BulkPolicyResultDto,
bulkClient.policy, useBulkUpdatePolicy 추가.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: FE — 선택 스냅샷에 정책 플래그 확장

**Files:**
- Modify: `apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.ts`
- Modify: `apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.spec.ts`
- Modify: `apps/admin-web/src/features/mall/products-list/components/table/index.tsx` (스냅샷 매핑)

**Interfaces:**
- Consumes: `MasterSummaryDto.isOverseas` (Task 4).
- Produces: `SelectedProductSnapshot`에 `hideMembershipPriceForNonMembers`, `isVisibleToMembersOnly`, `isOverseas: boolean` — Task 8 모달이 사용.

- [ ] **Step 1: spec 헬퍼/기대값 갱신 후 실패 테스트 추가** — `products-list-selection-model.spec.ts`의 `snap` 헬퍼를 교체하고, orphan 기대값을 갱신하고, 플래그 변경 테스트를 추가:

```ts
// snap 헬퍼 교체:
const snap = (
  masterId: string,
  name = masterId,
  thumbnail: string | null = null,
  flags: Partial<
    Pick<
      SelectedProductSnapshot,
      'hideMembershipPriceForNonMembers' | 'isVisibleToMembersOnly' | 'isOverseas'
    >
  > = {},
): SelectedProductSnapshot => ({
  masterId,
  name,
  thumbnail,
  hideMembershipPriceForNonMembers: false,
  isVisibleToMembersOnly: false,
  isOverseas: false,
  ...flags,
});

// '로드도 안 됐고 이전 스냅샷도 없으면...' 테스트의 기대값 교체:
    expect(next.orphan).toEqual({
      masterId: 'orphan',
      name: 'orphan',
      thumbnail: null,
      hideMembershipPriceForNonMembers: false,
      isVisibleToMembersOnly: false,
      isOverseas: false,
    });

// describe('reconcileSelectedSnapshots', ...) 안에 테스트 추가:
  it('정책 플래그만 바뀌어도 changed=true 로 갱신한다', () => {
    const prev = { p1: snap('p1', '상품1', 't.jpg', { isOverseas: false }) };
    const { changed, next } = reconcileSelectedSnapshots(
      prev,
      { p1: true },
      [snap('p1', '상품1', 't.jpg', { isOverseas: true })],
    );
    expect(changed).toBe(true);
    expect(next.p1.isOverseas).toBe(true);
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest --testPathPattern=products-list-selection-model`
Expected: FAIL — 타입/구조 불일치 (SelectedProductSnapshot에 플래그 없음)

- [ ] **Step 3: 소스 구현** — `products-list-selection-model.ts`:

```ts
// 타입 교체:
export type SelectedProductSnapshot = {
  masterId: string;
  name: string;
  thumbnail: string | null;
  hideMembershipPriceForNonMembers: boolean;
  isVisibleToMembersOnly: boolean;
  isOverseas: boolean;
};

// snapshotsEqual 교체:
function snapshotsEqual(
  a: SelectedProductSnapshot,
  b: SelectedProductSnapshot,
): boolean {
  return (
    a.masterId === b.masterId &&
    a.name === b.name &&
    a.thumbnail === b.thumbnail &&
    a.hideMembershipPriceForNonMembers === b.hideMembershipPriceForNonMembers &&
    a.isVisibleToMembersOnly === b.isVisibleToMembersOnly &&
    a.isOverseas === b.isOverseas
  );
}

// reconcileSelectedSnapshots 내부 폴백 객체 교체:
    next[id] =
      byId.get(id) ??
      prev[id] ?? {
        masterId: id,
        name: id,
        thumbnail: null,
        hideMembershipPriceForNonMembers: false,
        isVisibleToMembersOnly: false,
        isOverseas: false,
      };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --testPathPattern=products-list-selection-model`
Expected: PASS

- [ ] **Step 5: 테이블 스냅샷 매핑 갱신** — `table/index.tsx`의 `currentRows` 매핑(line 60–66)을 교체:

```tsx
    const currentRows: SelectedProductSnapshot[] = (data?.data ?? []).map(
      (r) => ({
        masterId: r.masterId,
        name: r.name,
        thumbnail: r.thumbnail ?? null,
        hideMembershipPriceForNonMembers: r.hideMembershipPriceForNonMembers,
        isVisibleToMembersOnly: r.isVisibleToMembersOnly,
        isOverseas: r.isOverseas,
      }),
    );
```

- [ ] **Step 6: 컴파일 확인**

Run: `npx tsc -p apps/admin-web/tsconfig.json --noEmit`
Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.ts \
        apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.spec.ts \
        apps/admin-web/src/features/mall/products-list/components/table/index.tsx
git commit -m "$(cat <<'EOF'
[admin-web] 선택 스냅샷에 운영 노출 정책 플래그 확장

count/impact 파생을 위해 SelectedProductSnapshot 에 3개 플래그 추가.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: FE — count/impact 및 patch 순수 헬퍼

**Files:**
- Create: `apps/admin-web/src/features/mall/bulk/components/bulk-policy-modal/policy-counts.ts` (+ `.spec.ts`)
- Create: `apps/admin-web/src/features/mall/bulk/components/bulk-policy-modal/build-policy-patch.ts` (+ `.spec.ts`)

**Interfaces:**
- Produces (Task 8이 사용):
  - `type PolicyFlag = 'hideMembershipPriceForNonMembers' | 'isVisibleToMembersOnly' | 'isOverseas'`
  - `type PolicyChoice = 'unchanged' | 'on' | 'off'`
  - `flagStats(items: Record<PolicyFlag, boolean>[], flag): { on: number; off: number }`
  - `flagImpact(stats, choice): number`
  - `type PolicyChoices = Record<PolicyFlag, PolicyChoice>`
  - `buildPolicyPatch(choices): Partial<Record<PolicyFlag, boolean>>`
  - `hasAnyChange(choices): boolean`

> 제약: 이 두 파일과 spec은 `@/` import 금지, 상대 경로만. (node jest가 로드)

- [ ] **Step 1: `policy-counts.spec.ts` 실패 테스트 작성**

```ts
import { flagStats, flagImpact, type PolicyFlagValues } from './policy-counts';

const item = (over: Partial<PolicyFlagValues> = {}): PolicyFlagValues => ({
  hideMembershipPriceForNonMembers: false,
  isVisibleToMembersOnly: false,
  isOverseas: false,
  ...over,
});

describe('flagStats', () => {
  it('플래그의 켜짐/꺼짐 개수를 센다', () => {
    const items = [item({ isOverseas: true }), item({ isOverseas: true }), item()];
    expect(flagStats(items, 'isOverseas')).toEqual({ on: 2, off: 1 });
  });
  it('빈 목록은 0/0', () => {
    expect(flagStats([], 'isVisibleToMembersOnly')).toEqual({ on: 0, off: 0 });
  });
});

describe('flagImpact', () => {
  it("'on' 은 꺼진 개수만큼 변경", () => {
    expect(flagImpact({ on: 2, off: 3 }, 'on')).toBe(3);
  });
  it("'off' 는 켜진 개수만큼 변경", () => {
    expect(flagImpact({ on: 2, off: 3 }, 'off')).toBe(2);
  });
  it("'unchanged' 는 0", () => {
    expect(flagImpact({ on: 2, off: 3 }, 'unchanged')).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest --testPathPattern=policy-counts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `policy-counts.ts` 구현**

```ts
export type PolicyFlag =
  | 'hideMembershipPriceForNonMembers'
  | 'isVisibleToMembersOnly'
  | 'isOverseas';

export type PolicyChoice = 'unchanged' | 'on' | 'off';

export type PolicyFlagValues = Record<PolicyFlag, boolean>;

export function flagStats(
  items: PolicyFlagValues[],
  flag: PolicyFlag,
): { on: number; off: number } {
  let on = 0;
  for (const it of items) if (it[flag]) on += 1;
  return { on, off: items.length - on };
}

/** 선택(choice) 적용 시 값이 실제로 바뀌는 상품 수. */
export function flagImpact(
  stats: { on: number; off: number },
  choice: PolicyChoice,
): number {
  if (choice === 'on') return stats.off; // 꺼진 것들이 켜짐
  if (choice === 'off') return stats.on; // 켜진 것들이 꺼짐
  return 0;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --testPathPattern=policy-counts`
Expected: PASS

- [ ] **Step 5: `build-policy-patch.spec.ts` 실패 테스트 작성**

```ts
import { buildPolicyPatch, hasAnyChange, type PolicyChoices } from './build-policy-patch';

const choices = (over: Partial<PolicyChoices> = {}): PolicyChoices => ({
  hideMembershipPriceForNonMembers: 'unchanged',
  isVisibleToMembersOnly: 'unchanged',
  isOverseas: 'unchanged',
  ...over,
});

describe('buildPolicyPatch', () => {
  it("'unchanged' 아닌 플래그만 boolean 으로 담는다", () => {
    expect(buildPolicyPatch(choices({ isOverseas: 'on', isVisibleToMembersOnly: 'off' }))).toEqual({
      isOverseas: true,
      isVisibleToMembersOnly: false,
    });
  });
  it('모두 unchanged 면 빈 객체', () => {
    expect(buildPolicyPatch(choices())).toEqual({});
  });
});

describe('hasAnyChange', () => {
  it('하나라도 변경이면 true', () => {
    expect(hasAnyChange(choices({ isOverseas: 'off' }))).toBe(true);
  });
  it('전부 unchanged 면 false', () => {
    expect(hasAnyChange(choices())).toBe(false);
  });
});
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `npx jest --testPathPattern=build-policy-patch`
Expected: FAIL — 모듈 없음

- [ ] **Step 7: `build-policy-patch.ts` 구현**

```ts
import type { PolicyFlag, PolicyChoice } from './policy-counts';

export type PolicyChoices = Record<PolicyFlag, PolicyChoice>;

/** 'unchanged' 아닌 플래그만 boolean 으로 담은 patch. 모두 unchanged 면 빈 객체. */
export function buildPolicyPatch(
  choices: PolicyChoices,
): Partial<Record<PolicyFlag, boolean>> {
  const patch: Partial<Record<PolicyFlag, boolean>> = {};
  (Object.keys(choices) as PolicyFlag[]).forEach((flag) => {
    const c = choices[flag];
    if (c === 'on') patch[flag] = true;
    else if (c === 'off') patch[flag] = false;
  });
  return patch;
}

export function hasAnyChange(choices: PolicyChoices): boolean {
  return Object.keys(buildPolicyPatch(choices)).length > 0;
}
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `npx jest --testPathPattern=build-policy-patch`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add apps/admin-web/src/features/mall/bulk/components/bulk-policy-modal/policy-counts.ts \
        apps/admin-web/src/features/mall/bulk/components/bulk-policy-modal/policy-counts.spec.ts \
        apps/admin-web/src/features/mall/bulk/components/bulk-policy-modal/build-policy-patch.ts \
        apps/admin-web/src/features/mall/bulk/components/bulk-policy-modal/build-policy-patch.spec.ts
git commit -m "$(cat <<'EOF'
[admin-web] 노출 정책 count/impact/patch 순수 헬퍼 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: FE — 실패 목록 공용 컴포넌트 추출

**Files:**
- Create: `apps/admin-web/src/features/mall/bulk/components/bulk-failure-list/index.tsx`
- Modify: `apps/admin-web/src/features/mall/bulk/components/bulk-action-modal/index.tsx`

**Interfaces:**
- Produces: `<BulkFailureList items={BulkUpdateFailureDto[]} />` — Task 8 모달도 사용.

- [ ] **Step 1: 컴포넌트 생성** — `bulk-failure-list/index.tsx`:

```tsx
import type { BulkUpdateFailureDto } from '@/lib/types/dto/products';

export function BulkFailureList({ items }: { items: BulkUpdateFailureDto[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <p className="text-sm font-medium text-destructive">
        실패한 상품 ({items.length}개)
      </p>
      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
        {items.map((item) => (
          <li key={item.masterId}>
            <span className="font-medium text-foreground">
              {item.name ?? item.masterId}
            </span>{' '}
            — {item.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: `BulkActionModal`에서 인라인 블록 교체** — `bulk-action-modal/index.tsx` 상단에 import 추가하고, 실패 목록 인라인 블록(155–171, `{failedItems.length > 0 && (...)}` 전체)을 아래로 교체:

```tsx
// import 추가:
import { BulkFailureList } from '@/features/mall/bulk/components/bulk-failure-list';

// 인라인 블록 교체:
          <BulkFailureList items={failedItems} />
```

- [ ] **Step 3: 컴파일 확인 (동작 불변)**

Run: `npx tsc -p apps/admin-web/tsconfig.json --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add apps/admin-web/src/features/mall/bulk/components/bulk-failure-list/index.tsx \
        apps/admin-web/src/features/mall/bulk/components/bulk-action-modal/index.tsx
git commit -m "$(cat <<'EOF'
[admin-web] 벌크 실패 목록 BulkFailureList 컴포넌트 추출

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: FE — `BulkPolicyModal` 전용 모달

**Files:**
- Create: `apps/admin-web/src/features/mall/bulk/components/bulk-policy-modal/index.tsx`

**Interfaces:**
- Consumes: `flagStats`/`flagImpact` (Task 6), `buildPolicyPatch`/`hasAnyChange`/`PolicyChoices` (Task 6), `useBulkUpdatePolicy` (Task 4), `SelectedProductSnapshot` (Task 5), `BulkFailureList` (Task 7), `ToggleGroup`/`ToggleGroupItem`.
- Produces: `<BulkPolicyModal open onOpenChange selectedIds selectedItems onSuccess />` — Task 9가 배선.

- [ ] **Step 1: 모달 구현** — `bulk-policy-modal/index.tsx`:

```tsx
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { toast } from 'sonner';
import { useBulkUpdatePolicy } from '@/lib/services/products';
import type { BulkUpdateFailureDto } from '@/lib/types/dto/products';
import type { SelectedProductSnapshot } from '@/features/mall/products-list/components/table/products-list-selection-model';
import { BulkFailureList } from '@/features/mall/bulk/components/bulk-failure-list';
import { flagStats, flagImpact, type PolicyFlag, type PolicyChoice } from './policy-counts';
import { buildPolicyPatch, hasAnyChange, type PolicyChoices } from './build-policy-patch';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  selectedItems: SelectedProductSnapshot[];
  onSuccess: () => void;
}

const ROWS: { flag: PolicyFlag; label: string; desc: string }[] = [
  {
    flag: 'hideMembershipPriceForNonMembers',
    label: '멤버십가 비공개',
    desc: '비회원에게 멤버십가 숫자 대신 "멤버십 회원 공개"를 표시합니다.',
  },
  {
    flag: 'isVisibleToMembersOnly',
    label: '멤버십 회원 전용 노출',
    desc: '비회원의 상품 목록·검색·상세 접근에서 숨깁니다.',
  },
  {
    flag: 'isOverseas',
    label: '해외직구',
    desc: '체크 시 주문 단계에서 개인통관고유부호 입력이 필수가 됩니다.',
  },
];

const INITIAL: PolicyChoices = {
  hideMembershipPriceForNonMembers: 'unchanged',
  isVisibleToMembersOnly: 'unchanged',
  isOverseas: 'unchanged',
};

export function BulkPolicyModal({
  open,
  onOpenChange,
  selectedIds,
  selectedItems,
  onSuccess,
}: Props) {
  const [choices, setChoices] = useState<PolicyChoices>(INITIAL);
  const [failedItems, setFailedItems] = useState<BulkUpdateFailureDto[]>([]);
  const bulkPolicy = useBulkUpdatePolicy();

  function handleOpenChange(next: boolean) {
    if (!next) {
      setChoices(INITIAL);
      setFailedItems([]);
    }
    onOpenChange(next);
  }

  async function handleConfirm() {
    const patch = buildPolicyPatch(choices);
    setFailedItems([]);
    try {
      const result = await bulkPolicy.mutateAsync({ productIds: selectedIds, ...patch });
      const failures = (result.failed ?? []).map((f) => ({
        ...f,
        name: f.name ?? selectedItems.find((s) => s.masterId === f.masterId)?.name ?? null,
      }));
      if (failures.length > 0) {
        setFailedItems(failures);
        toast.warning(`${result.updated}개 적용, ${failures.length}개 실패했습니다.`);
        onSuccess();
        return;
      }
      toast.success(`${result.updated}개 상품의 노출 정책이 변경되었습니다.`);
      onSuccess();
      onOpenChange(false);
    } catch {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>운영 노출 정책 일괄 변경</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            선택된 <strong>{selectedIds.length}개</strong> 상품에 적용됩니다. 변경할 항목만 켜기/끄기를 선택하세요.
          </p>

          {ROWS.map(({ flag, label, desc }) => {
            const stats = flagStats(selectedItems, flag);
            const choice = choices[flag];
            const impact = flagImpact(stats, choice);
            return (
              <div key={flag} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label>{label}</Label>
                  <span className="text-xs text-muted-foreground">
                    현재: 켜짐 {stats.on} · 꺼짐 {stats.off}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{desc}</p>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={choice}
                  onValueChange={(v) =>
                    v && setChoices((prev) => ({ ...prev, [flag]: v as PolicyChoice }))
                  }
                  className="w-full"
                >
                  <ToggleGroupItem value="unchanged">변경 안 함</ToggleGroupItem>
                  <ToggleGroupItem value="on">켜기</ToggleGroupItem>
                  <ToggleGroupItem value="off">끄기</ToggleGroupItem>
                </ToggleGroup>
                {choice !== 'unchanged' && (
                  <p className="text-xs text-muted-foreground">
                    → {choice === 'on' ? '켜기' : '끄기'} 선택 시 {impact}개 변경됩니다
                  </p>
                )}
              </div>
            );
          })}

          <BulkFailureList items={failedItems} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={bulkPolicy.isPending || !hasAnyChange(choices)}
          >
            {bulkPolicy.isPending ? '처리 중...' : '확인'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

> 주의(Radix): `ToggleGroup type="single"`은 선택된 항목을 다시 클릭하면 `onValueChange('')`를 호출한다. `v && ...` 가드로 빈 문자열을 무시해 항상 하나가 선택된 상태를 유지한다.

- [ ] **Step 2: 컴파일 확인**

Run: `npx tsc -p apps/admin-web/tsconfig.json --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add apps/admin-web/src/features/mall/bulk/components/bulk-policy-modal/index.tsx
git commit -m "$(cat <<'EOF'
[admin-web] BulkPolicyModal 전용 모달 추가

3개 노출 정책 플래그 tri-state + 현재 분포/영향 개수 표시.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: FE — 툴바 버튼 + 모달 배선

**Files:**
- Modify: `apps/admin-web/src/features/mall/products-list/components/table/index.tsx`

**Interfaces:**
- Consumes: `BulkPolicyModal` (Task 8), `selectedItemsList`/`selectedIds`/`handleSuccess` (기존).

- [ ] **Step 1: import + 상태 추가** — `table/index.tsx` 상단 import에 추가하고, `modalAction` 상태 옆에 `policyOpen` 상태 추가:

```tsx
// import 추가:
import { BulkPolicyModal } from '@/features/mall/bulk/components/bulk-policy-modal';

// 컴포넌트 함수 상단, useState(modalAction) 아래에 추가:
  const [policyOpen, setPolicyOpen] = useState(false);
```

- [ ] **Step 2: 버튼 추가** — `선택 상품상태변경` 버튼(102–108) 뒤에 추가:

```tsx
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPolicyOpen(true)}
          >
            운영 노출 정책 변경
          </Button>
```

- [ ] **Step 3: 모달 렌더** — 기존 `<BulkActionModal ... />`(142–149) 뒤에 추가:

```tsx
      <BulkPolicyModal
        open={policyOpen}
        onOpenChange={setPolicyOpen}
        selectedIds={selectedIds}
        selectedItems={selectedItemsList}
        onSuccess={handleSuccess}
      />
```

- [ ] **Step 4: 컴파일 확인**

Run: `npx tsc -p apps/admin-web/tsconfig.json --noEmit`
Expected: 에러 없음

- [ ] **Step 5: 수동 UI 확인** — `npm run start:admin-web:dev` 실행 후 `mall/products-list`에서:
  1. 상품 2개 이상 선택 → 툴바에 `운영 노출 정책 변경` 버튼 노출.
  2. 클릭 → 모달에 3개 플래그, 각 `현재: 켜짐 N · 꺼짐 M` 표시. 초기 `확인` 비활성.
  3. 한 플래그 `켜기` 선택 → `→ 켜기 선택 시 K개 변경됩니다` 표시, `확인` 활성.
  4. `확인` → 성공 토스트 + 선택 해제 + 목록 갱신(분포 재계산). active 버전 없는 상품 포함 시 실패 목록 노출.

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/features/mall/products-list/components/table/index.tsx
git commit -m "$(cat <<'EOF'
[admin-web] 상품 목록 툴바에 운영 노출 정책 일괄 변경 배선

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Final Verification

- [ ] 백엔드 테스트 전체: `npx jest --testPathPattern="product-versions.service.spec|product-bulk.service.spec"` → 모두 PASS
- [ ] FE 테스트 전체: `npx jest --testPathPattern="products-list-selection-model|policy-counts|build-policy-patch"` → 모두 PASS
- [ ] 백엔드 빌드: `npx nest build core` → 성공
- [ ] FE 타입: `npx tsc -p apps/admin-web/tsconfig.json --noEmit` → 에러 없음
- [ ] Lint: `npm run lint` (변경 파일 기준) → 통과
- [ ] Task 9 Step 5 수동 UI 시나리오 통과

---

## Notes / Follow-ups (범위 밖)

- 실패 항목 `name`은 백엔드에서 null 반환, FE가 selectedItems로 폴백 표시. 백엔드 채움은 후속.
- 기존 `BulkUpdateDto.basePrice` no-op 정리 — 별도 PR.
- 단건 3개 정책 메서드를 `updateExposurePolicy`로 위임하는 리팩터 — 별도.
- 정책 변경 감사 로그(productAuditLog) 추가 여부 — 현재는 이벤트 발행으로 대체(단건 경로와 일치).
- 이 브랜치는 `feat/mall-products-list-selection-ux` 위에 스택됨 — PR base를 그 브랜치로 두거나, 선행 브랜치 머지 후 develop로 리베이스.
