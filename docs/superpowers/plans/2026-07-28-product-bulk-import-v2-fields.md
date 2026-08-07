# 판매상품 대량등록 v2 — 선행조건 + 필드 확장 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 엑셀 대량등록에 variant별 가격·`variantCode`를 넣을 수 있게 하고, 가격 없는 상품이 0원으로 게시되는 경로를 막는다. 배치 claim 착수 전 선행조건(red 테스트, 타임아웃 전무)도 함께 닫는다.

**Architecture:** 기존 무상태 파이프라인(`parse → normalize → validate → commit`)에 `Variants` 시트를 3번째 시트로 추가한다. 가격은 version 컬럼이 아니라 pricing rules 이므로, `updateVersion`(옵션 diff → variant 생성) **이후에** 조합 문자열을 variantId 로 해석해 `PricingService.replaceVersionRules` 를 상품당 1회 호출한다. 우회 없이 단건 정규경로를 재사용하는 v1 원칙을 유지한다.

**Tech Stack:** NestJS · Drizzle ORM · ExcelJS · Jest

## Global Constraints

스펙 `docs/superpowers/specs/2026-07-28-product-bulk-import-v2-design.md` 의 전역 요구사항. 모든 태스크에 암묵적으로 적용된다.

- **범위**: 이 계획은 스펙 §7 의 **0·1·2 단계**만 담는다. 3단계(commit/publish 비동기 잡화 + 게시상태 컬럼)와 4·5단계(레인 강등·배치 claim)는 별도 계획이다. 스펙은 "2~3 을 먼저 계획" 이라 적었으나, 3단계는 마이그레이션과 워커를 수반해 독립 배포 단위가 다르므로 분리한다.
- **트랜잭션 전파** (루트 CLAUDE.md, ADR-0025): public 메서드는 `tx?: DbTransaction` 을 마지막 파라미터로, private 헬퍼는 `tx: DbTransaction` 필수. `this.db.run(async (trx) => …, tx)` 단일 러너만 사용하고 내부에서는 `trx` 만 쓴다. 클래스별 `inTx` 헬퍼를 새로 만들지 않는다.
- **도메인 예외**: `@app/shared` 의 `BadRequestError` / `NotFoundError` / `ConflictError`. 서비스 계층에서 `HttpException` 을 import 하지 않는다.
- **타입 안전성**: `any` / `as` 캐스팅 금지 (근거를 주석으로 남기고 팀 승인을 받은 경우만).
- **권위 타입 게이트**: `nest build core`, `nest build channel-adapter`. 레포 eslint 는 전역 미게이트 debt 이므로 통과 여부를 판단 근거로 쓰지 않는다 (변경 파일의 신규 error 만 본다).
- **`optionCombination` 형식**: `옵션명=값` 을 `;` 로 이은 문자열. **축 순서는 무시**한다 — 옵션명 기준 정렬로 정규화한 뒤 비교한다.
- **`basePrice` 는 필수**다. `pricingRulesSetSchema` 가 "order 1 인 첫 `base_price` 규칙은 `all_variants` 여야 한다" 를 요구하기 때문이며, 동시에 0원 게시를 막는 장치다.
- **Medusa 호출 타임아웃은 60초**. 채택 배치(variant ≤ 4, 25건)의 실측 호출시간 약 0.73초, 측정 전체 최악값 22초의 약 3배.

---

### Task 1: `InboxWorkerService` supersede 테스트를 요구사항 기준으로 재작성 (#550)

배치 claim 을 얹기 전에 이 테스트가 무엇을 검증하는지 확정해야 한다. 현재는 "쿼리에 어떤 값이 바인딩되는가" 를 스니핑해서 red 다 — `2d238bd4b` 가 비교를 전부 SQL 로 옮기며 타임스탬프 바인딩을 없앴기 때문이다. 렌더된 SQL 을 검사하는 방식으로 바꿔 요구사항(발생시각 기준 정렬)을 직접 단정한다.

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts:356-388`
- Test: 같은 파일

**Interfaces:**
- Consumes: 기존 `createService({ newerEvents })` 헬퍼, `createDbMock` 의 `where(condition)` 콜백
- Produces: 없음 (테스트만 변경)

- [ ] **Step 1: 렌더 헬퍼를 스펙 파일 상단에 추가**

`collectValues` 아래에 붙인다. `PgDialect.sqlToQuery` 로 drizzle SQL 조각을 실제 SQL 문자열로 만든다 — 바인딩 값이 아니라 **비교식 자체**를 검사하기 위한 것이다.

```ts
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * drizzle 조건식을 SQL 문자열로 렌더한다.
 * supersede 비교는 전부 SQL 안에서 일어나므로(바인딩되는 값은 eventId 뿐),
 * "발생시각 기준으로 정렬한다" 는 요구사항은 렌더된 SQL 로만 단정할 수 있다.
 */
function renderSql(condition: unknown): string {
  return new PgDialect().sqlToQuery(condition as never).sql;
}
```

- [ ] **Step 2: 실패하는 테스트로 교체**

`orders lifecycle superseding by event occurrence time instead of inbox insertion time` 케이스(356-388행) 전체를 아래로 바꾼다. `newerEvents` 는 조건식을 캡처만 하고 항상 "더 최신 이벤트 있음" 을 반환한다 — 스킵 분기는 그것으로 타고, 시각 기준은 캡처한 SQL 로 단정한다.

```ts
it('supersede 비교는 삽입시각(created_at)이 아니라 발생시각(event_occurred_at)을 기준으로 한다', async () => {
  let captured = '';
  const { service, dbMock, syncService } = createService({
    newerEvents: (condition) => {
      captured = renderSql(condition);
      return [{ id: 'delete-event-1' }];
    },
  });
  const event = {
    id: 'active-event-1',
    eventType: 'ProductMasterActiveVersionChanged',
    aggregateId: 'master-1',
    payload: {
      masterId: 'master-1',
      versionId: 'version-1',
      changeReason: 'published',
      changedAt: '2026-05-26T00:00:00.000Z',
      snapshot: { masterId: 'master-1', versionId: 'version-1', version: 1, name: 'Lip Tint', variants: [] },
    },
    attempts: 1,
    eventOccurredAt: new Date('2026-05-26T00:00:00.000Z'),
    createdAt: new Date('2026-05-28T00:00:00.000Z'),
    metadata: { messageId: 'active-msg-1', chainId: 'chain-1' },
  };

  await (service as any).doProcessInboxEvent(event);

  // 양변 모두 coalesce(event_occurred_at, created_at) 여야 한다.
  // created_at 단독 비교로 회귀하면 이 단정이 깨진다.
  expect(captured).toContain('event_occurred_at');
  expect(captured.match(/coalesce/gi)?.length).toBeGreaterThanOrEqual(2);
  expect(captured).toMatch(/from\s+inbox_events\s+e\s+where\s+e\.\s*id/i);

  expect(syncService.handleActiveVersionChanged).not.toHaveBeenCalled();
  expect(dbMock.updates).toEqual([
    {
      status: 'published',
      publishedAt: new Date('2026-05-27T00:00:00.000Z'),
      errorMessage: 'Superseded by newer event (aggregateId: master-1)',
    },
  ]);
});
```

- [ ] **Step 3: 테스트 실행 — 통과 확인**

Run: `npx jest --testPathPattern='inbox-worker.service.spec' --silent`
Expected: PASS, 73/73 (기존 1건 실패가 사라짐)

- [ ] **Step 4: 회귀 방향 확인 — 일부러 깨보고 되돌린다**

`inbox-worker.service.ts:319-321` 의 `gt(...)` 좌변을 `sql\`${inboxEvents.createdAt}\`` 로 임시 변경한 뒤 위 명령을 다시 돌려 **FAIL** 하는지 본다. 통과해 버리면 단정이 무력하다는 뜻이므로 단정을 조인다. 확인 후 변경을 되돌린다.

Run: `git diff` → 되돌린 뒤 `git checkout -- apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts`

- [ ] **Step 5: 커버리지 한계를 코드에 남긴다**

교체한 테스트 바로 위에 주석을 붙인다. 단위테스트로는 **정렬 규칙의 실제 동작**(더 오래된 발생시각이 실제로 스킵되는지)을 검증할 수 없고 SQL 모양까지만 볼 수 있다는 사실을 숨기지 않는다.

```ts
// ⚠️ 단위테스트의 한계: DB 를 mock 하므로 비교의 실제 결과는 검증할 수 없고
// "어떤 컬럼으로 비교하는가" 까지만 단정한다. 발생시각 기준 supersede 가
// 실제로 동작하는지는 실제 DB 통합테스트가 필요하다 (#550).
```

- [ ] **Step 6: 커밋**

```bash
git add apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts
git commit -m "test(channel-adapter): supersede 테스트를 바인딩 값 스니핑에서 SQL 요구사항 단정으로 교체 (#550)"
```

---

### Task 2: inbox 핸들러 타임아웃 60초

동시성 1 전환의 선행조건. 현재 `medusa.client.ts` · `medusa-sdk.config.ts` · `inbox-worker.service.ts` 어디에도 타임아웃이 없어 Node/undici 기본값(300초)에 의존한다. 한 요청이 5분간 핸들러를 물 수 있고, 동시성 1 에서는 그것이 전면 정지가 된다.

> **`@medusajs/js-sdk` 2.13.5 의 `Config` 에는 요청 옵션/fetch 훅이 없다** — `baseUrl` · `globalHeaders` · `publishableKey` · `apiKey` · `auth` · `logger` · `debug` 뿐이다 (검증: `node_modules/@medusajs/js-sdk/dist/esm/types.d.ts`). 따라서 SDK 설정으로 per-request signal 을 심을 수 없고, `globalThis.fetch` 교체는 같은 프로세스의 Naver·Coupang 클라이언트까지 건드린다. **핸들러 단위로 시간을 묶는다** — 목적이 "한 작업 단위가 슬롯을 무한정 물지 않게" 이므로 이 층이 맞는 층이다.

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts:285-290` (`processInboxEvent`)
- Test: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts`

**Interfaces:**
- Consumes: 기존 `doProcessInboxEvent`, `handleFailure(event, message)`, `getErrorMessage(error)`, `readPositiveIntConfig(key, default)`
- Produces: `export const INBOX_HANDLER_TIMEOUT_MS = 60_000` 과 인스턴스 필드 `handlerTimeoutMs` (env `INBOX_HANDLER_TIMEOUT_MS` 로 덮을 수 있다)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { INBOX_HANDLER_TIMEOUT_MS } from './inbox-worker.service';

it('핸들러 타임아웃 기본값은 60초다', () => {
  expect(INBOX_HANDLER_TIMEOUT_MS).toBe(60_000);
});

it('핸들러가 타임아웃을 넘기면 실패 처리로 넘겨 슬롯을 놓아준다', async () => {
  jest.useFakeTimers();
  try {
    const { service } = createService({ env: { INBOX_HANDLER_TIMEOUT_MS: '1000' } });
    // 절대 resolve 되지 않는 핸들러
    jest.spyOn(service as any, 'doProcessInboxEvent').mockImplementation(() => new Promise(() => {}));
    const handleFailure = jest.spyOn(service as any, 'handleFailure').mockResolvedValue(undefined);

    const pending = (service as any).processInboxEvent({
      id: 'stuck-1',
      eventType: 'ProductMasterActiveVersionChanged',
      aggregateId: 'master-1',
      payload: {},
      attempts: 1,
      metadata: {},
    });

    await jest.advanceTimersByTimeAsync(1100);
    await pending;

    expect(handleFailure).toHaveBeenCalledTimes(1);
    expect(String(handleFailure.mock.calls[0][1])).toMatch(/timed out/i);
  } finally {
    jest.useRealTimers();
  }
});
```

`createService` 가 env 주입을 지원하지 않으면 헬퍼에 `env` 병합을 추가한다 — 기존 `coerces string worker env config to numbers` 테스트가 이미 `configService.get` 목을 쓰므로 같은 경로를 재사용한다.

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='inbox-worker.service.spec' --silent`
Expected: FAIL — `INBOX_HANDLER_TIMEOUT_MS` export 없음

- [ ] **Step 3: 상수와 설정 필드 추가**

`inbox-worker.service.ts` 의 상단 상수 근처(`BULK_EVENT_TYPES` 아래)에 추가한다.

```ts
/**
 * 한 inbox 핸들러가 슬롯을 물 수 있는 최대 시간.
 *
 * 채택 배치(variant ≤ 4, 25건)의 실측 호출시간이 약 0.73초, 측정 전체에서 최악이던
 * 조합이 22초였다 (설계 스펙 §3). 60초는 최악값의 약 3배다.
 *
 * 이 값은 동시성 1 전환의 선행조건이다. Medusa SDK 에 요청 타임아웃 훅이 없어
 * undici 기본값(300초)에 걸려 있었고, 동시성 2 에서는 한 요청이 멈춰도 절반이
 * 살아있지만 1 에서는 전면 정지가 된다.
 */
export const INBOX_HANDLER_TIMEOUT_MS = 60_000;
```

필드 선언을 다른 설정 필드 옆에 추가한다.

```ts
  private readonly handlerTimeoutMs: number;
```

생성자에 추가한다.

```ts
    this.handlerTimeoutMs = this.readPositiveIntConfig('INBOX_HANDLER_TIMEOUT_MS', INBOX_HANDLER_TIMEOUT_MS);
```

`start()` 의 기동 로그 문자열에 `handlerTimeoutMs=${this.handlerTimeoutMs}ms, ` 를 덧붙인다 — 운영자가 실제 적용값을 로그에서 확인할 수 있어야 한다.

- [ ] **Step 4: `processInboxEvent` 교체**

```ts
  private async processInboxEvent(event: InboxWorkerEventRecord): Promise<void> {
    const chainId = event.metadata?.chainId ?? v7();
    const eventId = event.metadata?.messageId ?? generateMessageId();

    try {
      await this.withHandlerTimeout(
        this.eventChainService.runWithChain(chainId, eventId, () => this.doProcessInboxEvent(event)),
        `inbox handler ${event.id} (${event.eventType})`,
      );
    } catch (error) {
      // doProcessInboxEvent 는 자체 catch 로 handleFailure 를 부르므로, 여기 도달하는 것은
      // 타임아웃(또는 그 catch 밖에서 터진 예외)뿐이다. 슬롯을 놓아주고 재시도로 넘긴다.
      await this.handleFailure(event, this.getErrorMessage(error));
    }
  }

  /**
   * ⚠️ 한계: in-flight HTTP 요청을 취소하지는 못한다 (SDK 에 signal 훅이 없다).
   * 이 타임아웃은 **슬롯을 놓아주는** 장치이고, 원 요청은 undici 기본값까지 배경에서
   * 계속된다. 그래서 재시도와 원 요청이 겹칠 수 있는데, Medusa 상품 경로는 handle 기준
   * upsert 라 중복 적용이 같은 결과를 낸다. 완전한 취소가 필요해지면 undici global
   * dispatcher(headersTimeout/bodyTimeout)로 올려야 하며, 그때는 Naver·Coupang
   * 클라이언트까지 영향 범위에 들어온다는 점을 함께 판단해야 한다.
   */
  private withHandlerTimeout<T>(work: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${this.handlerTimeoutMs}ms`)),
        this.handlerTimeoutMs,
      );
      timer.unref?.();
    });

    return Promise.race([work, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    }) as Promise<T>;
  }
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

Run: `npx jest --testPathPattern='inbox-worker.service.spec' --silent`
Expected: PASS (Task 1 의 supersede 건 + 신규 2건 포함)

- [ ] **Step 6: 회귀 방향 확인 — 타임아웃을 무력화해 보고 되돌린다**

`withHandlerTimeout` 본문을 `return work;` 로 임시 변경하고 Step 5 를 다시 돌려 타임아웃 테스트가 **FAIL** 하는지 본다. 통과해 버리면 단정이 무력하다는 뜻이므로 테스트를 조인다. 확인 후 되돌린다.

- [ ] **Step 7: 전체 Medusa 테스트 회귀 확인**

Run: `npx jest --testPathPattern='channel-adapter/src/adapters/medusa' --silent`
Expected: 전체 PASS

- [ ] **Step 8: 타입 게이트**

Run: `npx nest build channel-adapter`
Expected: exit 0

- [ ] **Step 9: 커밋**

```bash
git add apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts
git commit -m "fix(channel-adapter): inbox 핸들러에 60초 타임아웃 — 동시성 1 전환 선행조건"
```

---

### Task 3: Options 시트 `sortOrder` 를 실제로 반영

`sortOrder` 는 템플릿 헤더에 있으나 normalizer 가 읽지 않는 죽은 컬럼이다. `AddOptionDto` 는 이미 `sortOrder` 를 지원하므로 배선만 하면 된다.

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import.types.ts:20-23`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.ts:62-96`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.spec.ts`

**Interfaces:**
- Consumes: `RawRow`, `ParsedWorkbook`
- Produces: `NormalizedOption` 에 `sortOrder: number` 추가. `ProductImportManager` 가 `optionDiff.add` 로 그대로 넘긴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`product-import.normalizer.spec.ts` 에 추가한다.

```ts
it('Options 시트의 sortOrder 를 옵션에 반영하고, 비면 시트 등장 순서를 쓴다', () => {
  const normalizer = new ProductImportNormalizer();
  const [rec] = normalizer.normalize(
    {
      products: [{ rowNumber: 1, cells: { productKey: 'P1', name: '니트' } }],
      options: [
        { rowNumber: 1, cells: { productKey: 'P1', optionName: '사이즈', optionValues: 'S|M', sortOrder: '5' } },
        { rowNumber: 2, cells: { productKey: 'P1', optionName: '색상', optionValues: '빨강', sortOrder: '' } },
      ],
      variants: [],
    },
    [],
  );

  expect(rec.options.map((o) => [o.displayName, o.sortOrder])).toEqual([
    ['사이즈', 5],
    ['색상', 1],
  ]);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='product-import.normalizer.spec' --silent`
Expected: FAIL — `sortOrder` 프로퍼티 없음 + `variants` 키가 `ParsedWorkbook` 에 없음

- [ ] **Step 3: 타입 확장**

`import.types.ts` 의 `NormalizedOption` 과 `ParsedWorkbook` 을 고친다.

```ts
export interface ParsedWorkbook {
  products: RawRow[];
  options: RawRow[];
  /** 선택 시트 — 없으면 빈 배열 */
  variants: RawRow[];
}

export interface NormalizedOption {
  displayName: string;
  values: { displayName: string }[];
  /** Options 시트 sortOrder. 비어 있으면 시트 등장 순서(0-based+1) */
  sortOrder: number;
}
```

- [ ] **Step 4: normalizer 구현**

`normalize` 의 옵션 루프에서 `sortOrder` 를 파싱한다. 상품별 등장 순서를 세어 fallback 으로 쓴다.

```ts
    const optionSeqByKey = new Map<string, number>();

    for (const row of parsed.options) {
      const productKey = row.cells.productKey ?? '';
      const optionName = (row.cells.optionName ?? '').trim();
      const values = (row.cells.optionValues ?? '')
        .split(VALUE_DELIMITER)
        .map((v) => v.trim())
        .filter((v) => v !== '');

      const seq = (optionSeqByKey.get(productKey) ?? 0) + 1;
      optionSeqByKey.set(productKey, seq);
      const rawSortOrder = (row.cells.sortOrder ?? '').trim();
      const parsedSortOrder = Number(rawSortOrder);
      const sortOrder = rawSortOrder !== '' && Number.isInteger(parsedSortOrder) ? parsedSortOrder : seq;

      const option: NormalizedOption = {
        displayName: optionName,
        values: values.map((displayName) => ({ displayName })),
        sortOrder,
      };
      // …기존 target 조회/stub 생성 로직 그대로…
    }
```

고아 옵션 stub 을 만드는 분기에서도 `options: [option]` 을 그대로 쓰므로 추가 변경은 없다.

- [ ] **Step 5: 파서가 `variants` 키를 반환하도록 최소 수정**

`product-import.parser.ts` 의 `parse` 반환을 고친다. 시트 파싱은 Task 4 에서 채우고, 여기서는 타입만 맞춘다.

```ts
    return { products, options, variants: [] };
```

- [ ] **Step 6: 테스트 실행 — 통과 확인**

Run: `npx jest --testPathPattern='operations/import' --silent`
Expected: PASS (기존 29건 + 신규 1건 = 30건). 기존 테스트가 `ParsedWorkbook` 리터럴을 쓰면 `variants: []` 추가가 필요하다 — 실패 메시지대로 채운다.

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "fix(core): 대량등록 Options 시트 sortOrder 를 실제로 반영 (죽은 컬럼 해소)"
```

---

### Task 4: `Variants` 시트 파싱

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.parser.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.parser.spec.ts`

**Interfaces:**
- Consumes: `ParsedWorkbook`(Task 3 에서 `variants: RawRow[]` 추가됨)
- Produces: `parse(buffer)` 가 `Variants` 시트를 읽어 `variants` 에 채운다. 시트가 없으면 빈 배열. 상한 검사는 `MAX_VARIANT_ROWS = 20_000`.

- [ ] **Step 1: 실패하는 테스트 작성**

`product-import.parser.spec.ts` 에 추가한다. 기존 스펙의 워크북 생성 헬퍼를 그대로 쓴다(없으면 아래처럼 직접 만든다).

```ts
import * as ExcelJS from 'exceljs';
import { ProductImportParser, MAX_VARIANT_ROWS } from './product-import.parser';

async function workbook(
  sheets: Array<{ name: string; rows: string[][] }>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    for (const row of sheet.rows) ws.addRow(row);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

it('Variants 시트를 읽고, 없으면 빈 배열이다', async () => {
  const parser = new ProductImportParser();

  const withSheet = await parser.parse(
    await workbook([
      { name: 'Products', rows: [['productKey', 'name'], ['P1', '니트']] },
      {
        name: 'Variants',
        rows: [
          ['productKey', 'optionCombination', 'basePrice', 'membershipPrice', 'variantCode'],
          ['P1', '색상=빨강;사이즈=L', '31000', '', 'KNIT-RD-L'],
        ],
      },
    ]),
  );
  expect(withSheet.variants).toHaveLength(1);
  expect(withSheet.variants[0].cells).toMatchObject({
    productKey: 'P1',
    optionCombination: '색상=빨강;사이즈=L',
    basePrice: '31000',
    variantCode: 'KNIT-RD-L',
  });

  const withoutSheet = await parser.parse(
    await workbook([{ name: 'Products', rows: [['productKey', 'name'], ['P1', '니트']] }]),
  );
  expect(withoutSheet.variants).toEqual([]);
});

it('Variants 행이 상한을 넘으면 거부한다', async () => {
  const parser = new ProductImportParser();
  const rows: string[][] = [['productKey', 'optionCombination']];
  for (let i = 0; i <= MAX_VARIANT_ROWS; i++) rows.push(['P1', `색상=v${i}`]);

  await expect(
    parser.parse(
      await workbook([
        { name: 'Products', rows: [['productKey', 'name'], ['P1', '니트']] },
        { name: 'Variants', rows },
      ]),
    ),
  ).rejects.toThrow(/상한/);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='product-import.parser.spec' --silent`
Expected: FAIL — `MAX_VARIANT_ROWS` 없음, `variants` 빈 배열

- [ ] **Step 3: 구현**

`product-import.parser.ts` 를 고친다.

```ts
export const MAX_PRODUCT_ROWS = 1000;
/**
 * 상품 1000행 × 조합 상한 100 을 다 채우면 10만 행이지만, 그건 파일 크기 상한(10MB)에
 * 먼저 걸린다. 2만 행은 파싱 메모리를 보호하는 실용 상한이다.
 */
export const MAX_VARIANT_ROWS = 20_000;
```

`parse` 의 Options 시트 처리 아래에 붙인다.

```ts
    const variantsSheet = wb.getWorksheet('Variants');
    const variants = variantsSheet ? this.readSheet(variantsSheet) : [];
    if (variants.length > MAX_VARIANT_ROWS) {
      throw new BadRequestError(`Variants 행이 상한(${MAX_VARIANT_ROWS})을 초과했습니다. 파일을 나눠 올려주세요.`);
    }

    return { products, options, variants };
```

Task 3 Step 5 에서 넣은 `variants: []` 리터럴은 이 반환으로 대체된다.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npx jest --testPathPattern='operations/import' --silent`
Expected: PASS 32건

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "feat(core): 대량등록 Variants 시트 파싱"
```

---

### Task 5: 조합 문자열 정규화 + 오류 규칙

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import.types.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.spec.ts`

**Interfaces:**
- Consumes: `ParsedWorkbook.variants`
- Produces:
  - `export function comboKey(pairs: Array<{ name: string; value: string }>): string` — 옵션명 정렬 후 `name=value` 를 `;` 로 이은 정규화 키
  - `NormalizedVariantOverride { rowNumber: number; comboKey: string; combination: Array<{name,value}>; basePriceRaw: string; membershipPriceRaw: string; variantCode?: string }` — 숫자 파싱은 Task 6(validator)에서 한다
  - `ProductRecord.variantOverrides: NormalizedVariantOverride[]`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { ProductImportNormalizer } from './product-import.normalizer';
import { comboKey } from '../dto/import.types';

const OPTS = [
  { rowNumber: 1, cells: { productKey: 'P1', optionName: '색상', optionValues: '빨강|파랑', sortOrder: '0' } },
  { rowNumber: 2, cells: { productKey: 'P1', optionName: '사이즈', optionValues: 'S|L', sortOrder: '1' } },
];
const PRODUCTS = [{ rowNumber: 1, cells: { productKey: 'P1', name: '니트' } }];

it('comboKey 는 축 순서를 무시한다', () => {
  expect(comboKey([{ name: '색상', value: '빨강' }, { name: '사이즈', value: 'L' }])).toBe(
    comboKey([{ name: '사이즈', value: 'L' }, { name: '색상', value: '빨강' }]),
  );
});

it('축 순서가 뒤바뀐 조합도 같은 variant 로 해석한다', () => {
  const [rec] = new ProductImportNormalizer().normalize(
    { products: PRODUCTS, options: OPTS, variants: [
      { rowNumber: 1, cells: { productKey: 'P1', optionCombination: '사이즈=L;색상=빨강', basePrice: '31000' } },
    ] },
    [],
  );
  expect(rec.errors).toEqual([]);
  expect(rec.variantOverrides).toHaveLength(1);
  expect(rec.variantOverrides[0].comboKey).toBe(comboKey([{ name: '색상', value: '빨강' }, { name: '사이즈', value: 'L' }]));
});

it.each([
  ['미존재 옵션명', '소재=울;사이즈=L', /소재/],
  ['미존재 옵션값', '색상=검정;사이즈=L', /검정/],
  ['부분 조합', '색상=빨강', /축/],
])('%s 은 행 오류다', (_label, combination, pattern) => {
  const [rec] = new ProductImportNormalizer().normalize(
    { products: PRODUCTS, options: OPTS, variants: [{ rowNumber: 1, cells: { productKey: 'P1', optionCombination: combination } }] },
    [],
  );
  expect(rec.errors.some((e) => pattern.test(e.message))).toBe(true);
});

it('같은 조합을 두 번 지정하면 양쪽 다 오류다', () => {
  const [rec] = new ProductImportNormalizer().normalize(
    { products: PRODUCTS, options: OPTS, variants: [
      { rowNumber: 1, cells: { productKey: 'P1', optionCombination: '색상=빨강;사이즈=L', basePrice: '31000' } },
      { rowNumber: 2, cells: { productKey: 'P1', optionCombination: '사이즈=L;색상=빨강', basePrice: '32000' } },
    ] },
    [],
  );
  expect(rec.errors.filter((e) => /중복/.test(e.message))).toHaveLength(2);
});

it('존재하지 않는 productKey 참조는 오류 레코드가 된다', () => {
  const records = new ProductImportNormalizer().normalize(
    { products: PRODUCTS, options: OPTS, variants: [{ rowNumber: 1, cells: { productKey: 'NOPE', optionCombination: '색상=빨강;사이즈=L' } }] },
    [],
  );
  expect(records.some((r) => r.errors.some((e) => e.sheet === 'Variants' && /productKey/.test(e.message)))).toBe(true);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='product-import.normalizer.spec' --silent`
Expected: FAIL — `comboKey` export 없음

- [ ] **Step 3: 타입·헬퍼 추가**

`import.types.ts` 에 붙인다.

```ts
export interface NormalizedVariantOverride {
  rowNumber: number;
  comboKey: string;
  combination: Array<{ name: string; value: string }>;
  /** 숫자 파싱은 validator 가 한다 (오류 메시지를 한 곳에 모으기 위해) */
  basePriceRaw: string;
  membershipPriceRaw: string;
  variantCode?: string;
}

/** 조합 정규화 키 — 축 순서를 무시하기 위해 옵션명으로 정렬한다 */
export function comboKey(pairs: Array<{ name: string; value: string }>): string {
  return [...pairs]
    .map((p) => ({ name: p.name.trim(), value: p.value.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `${p.name}=${p.value}`)
    .join(';');
}
```

`RowError.sheet` 를 `'Products' | 'Options' | 'Variants'` 로 확장하고, `ProductRecord` 에 `variantOverrides: NormalizedVariantOverride[]` 를 추가한다.

- [ ] **Step 4: normalizer 구현**

옵션 루프 **뒤에** Variants 루프를 추가한다. 옵션 구조가 먼저 확정돼야 조합을 검증할 수 있다.

```ts
    for (const row of parsed.variants) {
      const productKey = row.cells.productKey ?? '';
      const target = byKey.get(productKey);
      const push = (message: string) =>
        (target ?? records[records.length - 1]).errors.push({ sheet: 'Variants', rowNumber: row.rowNumber, message });

      if (!target) {
        records.push({
          rowNumber: row.rowNumber,
          productKey,
          raw: {},
          version: {},
          categoryIds: [],
          categoryNames: [],
          options: [],
          variantOverrides: [],
          errors: [
            {
              sheet: 'Variants',
              rowNumber: row.rowNumber,
              message: `존재하지 않는 productKey 참조: ${productKey || '(빈 값)'}`,
            },
          ],
        });
        continue;
      }

      const raw = (row.cells.optionCombination ?? '').trim();
      const pairs = raw
        .split(';')
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk !== '')
        .map((chunk) => {
          const idx = chunk.indexOf('=');
          return idx < 0
            ? { name: chunk, value: '' }
            : { name: chunk.slice(0, idx).trim(), value: chunk.slice(idx + 1).trim() };
        });

      if (pairs.length === 0) {
        push('optionCombination 은 필수입니다.');
        continue;
      }

      let valid = true;
      for (const pair of pairs) {
        const group = target.options.find((o) => o.displayName === pair.name);
        if (!group) {
          push(`Options 시트에 없는 옵션명입니다: ${pair.name}`);
          valid = false;
          continue;
        }
        if (!group.values.some((v) => v.displayName === pair.value)) {
          push(`Options 시트에 없는 옵션값입니다: ${pair.name}=${pair.value}`);
          valid = false;
        }
      }
      if (pairs.length !== target.options.length) {
        push(`옵션 축을 전부 지정해야 합니다 (필요 ${target.options.length}개, 입력 ${pairs.length}개): ${raw}`);
        valid = false;
      }
      if (!valid) continue;

      const key = comboKey(pairs);
      const existing = target.variantOverrides.find((v) => v.comboKey === key);
      if (existing) {
        // 어느 쪽이 맞는지 알 수 없으므로 양쪽 다 오류로 남긴다
        push(`중복된 조합입니다: ${raw}`);
        target.errors.push({
          sheet: 'Variants',
          rowNumber: existing.rowNumber,
          message: `중복된 조합입니다: ${raw}`,
        });
        continue;
      }

      target.variantOverrides.push({
        rowNumber: row.rowNumber,
        comboKey: key,
        combination: pairs,
        basePriceRaw: (row.cells.basePrice ?? '').trim(),
        membershipPriceRaw: (row.cells.membershipPrice ?? '').trim(),
        variantCode: (row.cells.variantCode ?? '').trim() || undefined,
      });
    }
```

`ProductRecord` 를 만드는 기존 두 곳(정상 레코드, 고아 옵션 stub)에 `variantOverrides: []` 를 추가한다.

- [ ] **Step 5: 테스트 실행 — 통과 확인**

Run: `npx jest --testPathPattern='operations/import' --silent`
Expected: PASS (신규 8건 포함)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "feat(core): 대량등록 조합 문자열 정규화 및 검증 (축 순서 무시, 중복·부분조합 오류)"
```

---

### Task 6: 템플릿 생성기 갱신

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.template.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.template.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `generateTemplateWorkbook(): Promise<Buffer>` — 시트 3개(Products/Options/Variants). Products 에 `basePrice`·`membershipPrice` 헤더 추가

> **이 태스크는 Task 7(`basePrice` 필수화) 보다 먼저 실행한다.** 순서를 반대로 하면 Task 7 이
> 템플릿 예시 행을 검증에 걸리게 만들어 이 스펙이 red 인 채로 커밋되는 구간이 생긴다.
> 따라서 여기서는 `record.basePrice`(Task 7 이 채우는 필드)를 단정하지 않고, **원본 셀 값**과
> 시트 구조까지만 본다. `record.basePrice` 단정은 Task 7 이 이 파일에 추가한다.

- [ ] **Step 1: 실패하는 테스트 작성**

템플릿이 **자기 파이프라인을 통과해야 한다**. 지금까지 값 단정이 없어 템플릿이 깨져도 몰랐다.

```ts
import { generateTemplateWorkbook } from './product-import.template';
import { ProductImportParser } from './product-import.parser';
import { ProductImportNormalizer } from './product-import.normalizer';
import { ProductImportValidator } from './product-import.validator';

it('템플릿 예시 행은 자기 파이프라인을 오류 없이 통과한다', async () => {
  const buffer = await generateTemplateWorkbook();
  const parsed = await new ProductImportParser().parse(buffer);
  const records = new ProductImportValidator().validate(
    new ProductImportNormalizer().normalize(parsed, []),
  );

  expect(parsed.variants.length).toBeGreaterThan(0);
  // categoryPath 는 실제 카테고리 트리가 필요하므로 그 오류만 허용한다
  const unexpected = records.flatMap((r) => r.errors).filter((e) => !/카테고리/.test(e.message));
  expect(unexpected).toEqual([]);
});

it('Products 예시 행에 판매가 컬럼이 실제 값으로 들어있다', async () => {
  const parsed = await new ProductImportParser().parse(await generateTemplateWorkbook());
  // Task 7 이 basePrice 를 필수로 만들기 전이라 validator 는 아직 이 값을 읽지 않는다.
  // 원본 셀을 직접 확인해 템플릿이 빈 칸을 내보내지 않음을 보장한다.
  expect(Number(parsed.products[0].cells.basePrice)).toBeGreaterThan(0);
  expect(Number(parsed.products[0].cells.membershipPrice)).toBeGreaterThan(0);
});

it('Variants 예시 행은 Options 축을 전부 지정한다', async () => {
  const parsed = await new ProductImportParser().parse(await generateTemplateWorkbook());
  const axes = parsed.options.filter((o) => o.cells.productKey === 'P1').length;
  for (const row of parsed.variants) {
    expect(row.cells.optionCombination.split(';').filter((s) => s.trim() !== '')).toHaveLength(axes);
  }
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='product-import.template.spec' --silent`
Expected: FAIL — Variants 시트 없음(`parsed.variants` 빈 배열), Products 에 `basePrice` 컬럼 없음

- [ ] **Step 3: 구현**

`product-import.template.ts` 를 고친다.

```ts
const PRODUCT_HEADERS = [
  'productKey',
  'name',
  'basePrice',
  'membershipPrice',
  'productCode',
  'brand',
  'alternativeName',
  'description',
  'material',
  'marketPrice',
  'supplyPrice',
  'productType',
  'fulfillmentKind',
  'salesClassification',
  'purchaseClassification',
  'ageRestriction',
  'minQuantity',
  'maxQuantity',
  'seller',
  'categoryPath',
  'isOverseas',
  'isVisibleToMembersOnly',
  'hideMembershipPriceForNonMembers',
];

const OPTION_HEADERS = ['productKey', 'optionName', 'optionValues', 'sortOrder'];
const VARIANT_HEADERS = ['productKey', 'optionCombination', 'basePrice', 'membershipPrice', 'variantCode'];

export async function generateTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const products = wb.addWorksheet('Products');
  products.addRow(PRODUCT_HEADERS);
  products.addRow([
    'P1', '예시 니트', '29000', '26000', 'PROD-001', 'ACME', '', '부드러운 니트', '아크릴 100%',
    '19000', '12000', 'regular_sale', 'physical', '의류', '사입', '0', '1', '10', 'ACME',
    '여성패션>니트', 'N', 'N', 'N',
  ]);

  const options = wb.addWorksheet('Options');
  options.addRow(OPTION_HEADERS);
  options.addRow(['P1', '색상', '빨강|파랑', '0']);
  options.addRow(['P1', '사이즈', 'S|M|L', '1']);

  // 선택 시트. 조합별로 가격을 달리하거나 variantCode 를 심을 때만 채운다.
  // 빈 칸은 Products 기본가를 상속한다. 축 순서는 무시된다.
  const variants = wb.addWorksheet('Variants');
  variants.addRow(VARIANT_HEADERS);
  variants.addRow(['P1', '색상=빨강;사이즈=L', '31000', '', 'KNIT-RD-L']);
  variants.addRow(['P1', '색상=파랑;사이즈=S', '', '', 'KNIT-BL-S']);

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}
```

`marketPrice` 예시가 `basePrice`(29000)보다 낮으면 어색하므로 시중가 예시를 39000 으로 올려도 좋다 — 검증에 영향은 없다.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npx jest --testPathPattern='operations/import' --silent`
Expected: 전체 PASS. Task 6 Step 4 에서 확인만 하고 넘긴 템플릿 실패가 여기서 해소된다.

- [ ] **Step 5: 타입 게이트 + 커밋**

Run: `npx nest build core`
Expected: exit 0

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "feat(core): 대량등록 템플릿에 Variants 시트·가격 컬럼 추가 + 예시 행 파이프라인 검증"
```

---

### Task 7: 가격 필드 검증 — `basePrice` 필수화로 0원 게시 차단

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.validator.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.validator.spec.ts`

**Interfaces:**
- Consumes: `ProductRecord.variantOverrides` (Task 5), `ProductRecord.raw`
- Produces: `ProductRecord` 에 `basePrice: number` / `membershipPrice?: number` 채움. `NormalizedVariantOverride` 에 `basePrice?: number` / `membershipPrice?: number` 채움 (raw 문자열은 그대로 둔다)

- [ ] **Step 1: 실패하는 테스트 작성**

기존 스펙의 `record()` 헬퍼에 `variantOverrides: []` 를 추가한 뒤 아래를 붙인다.

```ts
it('basePrice 누락은 오류다 — 0원 게시 차단', () => {
  const [rec] = validator.validate([record({ productKey: 'P1', name: '니트' })]);
  expect(rec.errors.some((e) => /basePrice/.test(e.message))).toBe(true);
});

it('basePrice 0 은 오류다', () => {
  const [rec] = validator.validate([record({ productKey: 'P1', name: '니트', basePrice: '0' })]);
  expect(rec.errors.some((e) => /basePrice/.test(e.message))).toBe(true);
});

it('유효한 basePrice/membershipPrice 는 숫자로 채워진다', () => {
  const [rec] = validator.validate([
    record({ productKey: 'P1', name: '니트', basePrice: '29000', membershipPrice: '26000' }),
  ]);
  expect(rec.errors).toEqual([]);
  expect(rec.basePrice).toBe(29000);
  expect(rec.membershipPrice).toBe(26000);
});

it('membershipPrice 가 basePrice 보다 크면 오류다', () => {
  const [rec] = validator.validate([
    record({ productKey: 'P1', name: '니트', basePrice: '29000', membershipPrice: '31000' }),
  ]);
  expect(rec.errors.some((e) => /membershipPrice/.test(e.message))).toBe(true);
});

it('variant override 가격도 검증하고 숫자로 채운다', () => {
  const rec = record({ productKey: 'P1', name: '니트', basePrice: '29000' });
  rec.variantOverrides = [
    { rowNumber: 1, comboKey: '색상=빨강', combination: [{ name: '색상', value: '빨강' }], basePriceRaw: '31000', membershipPriceRaw: '' },
    { rowNumber: 2, comboKey: '색상=파랑', combination: [{ name: '색상', value: '파랑' }], basePriceRaw: '-1', membershipPriceRaw: '' },
  ];
  const [out] = validator.validate([rec]);
  expect(out.variantOverrides[0].basePrice).toBe(31000);
  expect(out.errors.some((e) => e.sheet === 'Variants' && e.rowNumber === 2)).toBe(true);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='product-import.validator.spec' --silent`
Expected: FAIL — `basePrice` 검증 없음

- [ ] **Step 3: 구현**

`validateFields` 안에 붙인다. `marketPrice`/`supplyPrice`(참고가) 와 달리 `basePrice` 는 **필수**다.

```ts
    // 판매가는 pricing rules 로 들어가므로 version 스칼라가 아니다.
    // 필수로 두는 이유가 둘이다: (1) pricingRulesSetSchema 가 order 1 all_variants
    // base_price 규칙을 요구한다 (2) 없으면 계산기가 0 을 내고 validateCalculatedPrices
    // 가 0 을 통과시켜 0원 상품이 스토어프론트까지 나간다.
    const basePrice = this.optionalMoney(raw.basePrice, 'basePrice', push);
    if (basePrice === undefined || basePrice <= 0) {
      push('basePrice 는 0보다 큰 숫자여야 합니다 (판매가 없이 게시할 수 없습니다).');
    } else {
      record.basePrice = basePrice;
    }

    const membershipPrice = this.optionalMoney(raw.membershipPrice, 'membershipPrice', push);
    if (membershipPrice !== undefined) {
      if (typeof basePrice === 'number' && membershipPrice > basePrice) {
        push(`membershipPrice 는 basePrice 이하여야 합니다: ${membershipPrice} > ${basePrice}`);
      } else {
        record.membershipPrice = membershipPrice;
      }
    }
```

`validate` 루프에 override 가격 검증을 추가한다.

```ts
  private validateVariantOverrides(record: ProductRecord): void {
    for (const override of record.variantOverrides) {
      const push = (message: string) =>
        record.errors.push({ sheet: 'Variants', rowNumber: override.rowNumber, message });

      if (override.basePriceRaw !== '') {
        const value = this.optionalMoney(override.basePriceRaw, 'basePrice', push);
        if (value === undefined || value <= 0) push('basePrice 는 0보다 큰 숫자여야 합니다.');
        else override.basePrice = value;
      }
      if (override.membershipPriceRaw !== '') {
        const value = this.optionalMoney(override.membershipPriceRaw, 'membershipPrice', push);
        if (value === undefined || value <= 0) push('membershipPrice 는 0보다 큰 숫자여야 합니다.');
        else override.membershipPrice = value;
      }

      const base = override.basePrice ?? record.basePrice;
      const member = override.membershipPrice;
      if (typeof base === 'number' && typeof member === 'number' && member > base) {
        push(`membershipPrice 는 basePrice 이하여야 합니다: ${member} > ${base}`);
      }
    }
  }
```

`validate()` 에서 `this.validateOptions(record)` 다음에 `this.validateVariantOverrides(record)` 를 호출한다.

`import.types.ts` 의 `ProductRecord` 에 `basePrice?: number` / `membershipPrice?: number`, `NormalizedVariantOverride` 에 `basePrice?: number` / `membershipPrice?: number` 를 추가한다.

- [ ] **Step 4: 템플릿 스펙에 `record.basePrice` 단정을 추가한다**

Task 6 이 템플릿에 `basePrice` 컬럼을 이미 넣었으므로 `product-import.template.spec.ts` 는 **깨지지 않는다**. 이제 validator 가 그 값을 읽으니, Task 6 이 미룬 단정을 여기서 채운다.

`product-import.template.spec.ts` 의 `템플릿 예시 행은 자기 파이프라인을 오류 없이 통과한다` 케이스 끝에 추가한다.

```ts
  // Task 7 에서 basePrice 가 필수가 되었으므로 이제 validator 가 채운 값을 확인할 수 있다.
  expect(records[0].basePrice).toBeGreaterThan(0);
  expect(records[0].membershipPrice).toBeGreaterThan(0);
```

- [ ] **Step 5: 전체 테스트 실행 — 통과 확인**

Run: `npx jest --testPathPattern='operations/import' --silent`
Expected: 전체 PASS. **템플릿 스펙이 실패하면 안 된다** — 실패하면 Task 6 의 템플릿 컬럼 추가가 빠졌거나 validator 의 필드명이 어긋난 것이다.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "feat(core): 대량등록 basePrice 필수화 — 0원 게시 차단"
```

---

### Task 8: 조합 → variantId 해석 + pricing rules 생성

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-pricing.builder.ts`
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-pricing.builder.spec.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-session.reader.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts:59-77`
- Modify: `apps/core/src/modules/catalog/operations/import/product-import.module.ts`

**Interfaces:**
- Consumes: `ProductRecord.basePrice` / `membershipPrice` / `variantOverrides` (Task 5·6), `OptionReadLoader.getVariantOptionValues(tx, variantId, versionId, locale)` → `{ id, optionGroupName, displayName }[]`, `PricingService.replaceVersionRules(versionId, dto, tx)`
- Produces:
  - `ProductImportSessionReader.getVariantComboMap(masterId, versionId, tx): Promise<Map<string, string>>` — comboKey → variantId. 옵션 없는 상품은 기본 variant 를 `''` 키로 담는다
  - `ProductImportPricingBuilder.build(record, comboMap): ReplacePricingRulesDto` — 순수 함수, DB 접근 없음

- [ ] **Step 1: 실패하는 테스트 작성 (빌더)**

```ts
import { ProductImportPricingBuilder } from './product-import-pricing.builder';
import { comboKey } from '../dto/import.types';
import { ProductRecord } from '../dto/import.types';

function rec(over: Partial<ProductRecord> = {}): ProductRecord {
  return {
    rowNumber: 1, productKey: 'P1', raw: {}, version: {},
    categoryIds: [], categoryNames: [], options: [], variantOverrides: [], errors: [],
    basePrice: 29000, ...over,
  } as ProductRecord;
}

describe('ProductImportPricingBuilder', () => {
  const builder = new ProductImportPricingBuilder();

  it('기본가만 있으면 all_variants override 규칙 1개', () => {
    const dto = builder.build(rec(), new Map());
    expect(dto.basePriceRules).toEqual([
      { layer: 'base_price', order: 1, scopeType: 'all_variants', operationType: 'override', operationValue: 29000 },
    ]);
    expect(dto.membershipPriceRules).toEqual([]);
    expect(dto.tieredPriceRules).toEqual([]);
  });

  it('멤버십가가 있으면 membership_price all_variants override 를 낸다', () => {
    const dto = builder.build(rec({ membershipPrice: 26000 }), new Map());
    expect(dto.membershipPriceRules).toEqual([
      { layer: 'membership_price', order: 1, scopeType: 'all_variants', operationType: 'override', operationValue: 26000 },
    ]);
  });

  it('override 는 variants scope 규칙으로 order 2 부터 붙는다', () => {
    const key = comboKey([{ name: '색상', value: '빨강' }]);
    const dto = builder.build(
      rec({
        variantOverrides: [
          { rowNumber: 1, comboKey: key, combination: [{ name: '색상', value: '빨강' }], basePriceRaw: '31000', membershipPriceRaw: '', basePrice: 31000 },
        ],
      }),
      new Map([[key, 'var-1']]),
    );
    expect(dto.basePriceRules).toHaveLength(2);
    expect(dto.basePriceRules[1]).toEqual({
      layer: 'base_price', order: 2, scopeType: 'variants', scopeTargetIds: ['var-1'],
      operationType: 'override', operationValue: 31000,
    });
  });

  it('comboMap 에 없는 조합은 예외다 — 조용히 버리지 않는다', () => {
    const key = comboKey([{ name: '색상', value: '검정' }]);
    expect(() =>
      builder.build(
        rec({ variantOverrides: [{ rowNumber: 3, comboKey: key, combination: [{ name: '색상', value: '검정' }], basePriceRaw: '1', membershipPriceRaw: '', basePrice: 1 }] }),
        new Map(),
      ),
    ).toThrow(/조합/);
  });

  it('가격을 안 적은 override 는 규칙을 만들지 않는다 (variantCode 만 지정한 행)', () => {
    const key = comboKey([{ name: '색상', value: '빨강' }]);
    const dto = builder.build(
      rec({ variantOverrides: [{ rowNumber: 1, comboKey: key, combination: [], basePriceRaw: '', membershipPriceRaw: '', variantCode: 'X' }] }),
      new Map([[key, 'var-1']]),
    );
    expect(dto.basePriceRules).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='product-import-pricing.builder' --silent`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 빌더 구현**

```ts
import { Injectable } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { ReplacePricingRulesDto } from '../../../core/pricing/dto';
import { ProductRecord } from '../dto/import.types';

/**
 * 엑셀 가격 컬럼 → pricing rules 변환. DB 접근이 없는 순수 변환이라 단위테스트가 쉽다.
 *
 * pricingRulesSetSchema 제약: order 1 인 첫 base_price 규칙은 scopeType 이
 * all_variants 여야 한다. 그래서 Products 시트 basePrice 가 필수다.
 */
@Injectable()
export class ProductImportPricingBuilder {
  build(record: ProductRecord, comboMap: Map<string, string>): ReplacePricingRulesDto {
    if (typeof record.basePrice !== 'number') {
      throw new BadRequestError(`basePrice 가 없어 가격 규칙을 만들 수 없습니다: ${record.productKey}`);
    }

    const basePriceRules: ReplacePricingRulesDto['basePriceRules'] = [
      {
        layer: 'base_price',
        order: 1,
        scopeType: 'all_variants',
        operationType: 'override',
        operationValue: record.basePrice,
      },
    ];
    const membershipPriceRules: ReplacePricingRulesDto['membershipPriceRules'] = [];

    if (typeof record.membershipPrice === 'number') {
      membershipPriceRules.push({
        layer: 'membership_price',
        order: 1,
        scopeType: 'all_variants',
        operationType: 'override',
        operationValue: record.membershipPrice,
      });
    }

    let baseOrder = 2;
    let memberOrder = membershipPriceRules.length + 1;

    for (const override of record.variantOverrides) {
      const variantId = comboMap.get(override.comboKey);
      if (!variantId) {
        // normalizer 가 조합을 검증했으므로 여기 도달하면 variant 생성과 어긋난 것이다.
        // 조용히 버리면 가격이 빠진 채로 게시되므로 실패시킨다.
        throw new BadRequestError(
          `조합에 해당하는 variant 를 찾을 수 없습니다: ${override.comboKey} (${record.productKey})`,
        );
      }

      if (typeof override.basePrice === 'number') {
        basePriceRules.push({
          layer: 'base_price',
          order: baseOrder++,
          scopeType: 'variants',
          scopeTargetIds: [variantId],
          operationType: 'override',
          operationValue: override.basePrice,
        });
      }
      if (typeof override.membershipPrice === 'number') {
        membershipPriceRules.push({
          layer: 'membership_price',
          order: memberOrder++,
          scopeType: 'variants',
          scopeTargetIds: [variantId],
          operationType: 'override',
          operationValue: override.membershipPrice,
        });
      }
    }

    return { basePriceRules, membershipPriceRules, tieredPriceRules: [] };
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npx jest --testPathPattern='product-import-pricing.builder' --silent`
Expected: PASS 5/5

- [ ] **Step 5: reader 에 combo map 조회 추가**

`product-import-session.reader.ts` 에 붙인다. `OptionReadLoader` 를 생성자에 주입한다.

```ts
  /**
   * 생성된 variant 의 옵션 조합 → variantId 맵. 키는 comboKey 와 같은 규칙으로 정규화한다.
   * 옵션 없는 상품(기본 variant 1개)은 빈 문자열 키로 담는다.
   */
  async getVariantComboMap(masterId: string, versionId: string, tx?: DbTransaction): Promise<Map<string, string>> {
    return this.db.run(async (trx) => {
      const rows = await trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(and(eq(productMasterVariants.masterId, masterId), eq(productMasterVariants.versionId, versionId)));

      const map = new Map<string, string>();
      for (const row of rows) {
        const displays = await this.optionReadLoader.getVariantOptionValues(trx, row.variantId, versionId, 'ko-KR');
        const key = comboKey(displays.map((d) => ({ name: d.optionGroupName, value: d.displayName })));
        map.set(key, row.variantId);
      }
      return map;
    }, tx);
  }
```

import 에 `productMasterVariants`, `comboKey`, `OptionReadLoader` 를 추가한다.

- [ ] **Step 6: manager 에 배선**

`product-import.manager.ts` 의 성공 경로(59-77행)를 고친다. **순서가 중요하다** — variant 가 생성된 뒤여야 조합을 해석할 수 있다.

```ts
        const masterId = await this.db.run(async (trx) => {
          const version = await this.productMastersService.createMaster(userId, trx);
          const data: UpdateProductMasterVersion = {
            ...record.version,
            categoryIds: record.categoryIds,
            primaryCategoryId: record.primaryCategoryId,
            optionDiff: record.options.length > 0 ? { add: record.options } : undefined,
          };
          await this.productMastersService.updateVersion(version.id, data, trx);

          // variant 생성 이후여야 조합 → variantId 해석이 가능하다.
          const comboMap = await this.reader.getVariantComboMap(version.masterId, version.id, trx);
          await this.pricingService.replaceVersionRules(
            version.id,
            this.pricingBuilder.build(record, comboMap),
            trx,
          );

          await trx.insert(productImportItems).values({
            sessionId,
            rowNumber: record.rowNumber,
            productKey: record.productKey,
            status: 'created',
            masterId: version.masterId,
          });
          return version.masterId;
        });
```

생성자에 `private readonly pricingService: PricingService`, `private readonly pricingBuilder: ProductImportPricingBuilder` 를 추가한다.

`variantCode` 처리는 이 태스크에 넣지 않는다 — Task 9 가 메서드와 호출 지점을 **함께** 도입한다. 빈 스텁을 미리 만들어 두면 이 태스크의 산출물에 죽은 코드가 남는다.

- [ ] **Step 7: 모듈 등록 — `OptionReadLoader` export 추가가 필요하다**

확인된 상태:

| 의존 | 위치 | export 여부 |
|---|---|---|
| `PricingService` | `core/pricing/pricing.module.ts` | **export 됨** (11·12행) — `PricingModule` 을 `imports` 에 넣으면 끝 |
| `OptionReadLoader` | `core/products/products.module.ts` | **providers 에만 있고 export 안 됨** (37행). `exports` 배열(41-49행)에 없다 |

따라서 두 곳을 고친다.

1. `apps/core/src/modules/catalog/core/products/products.module.ts` 의 `exports` 에 추가한다. 주석으로 이유를 남긴다 — 나중에 누가 정리할 때 근거가 있어야 한다.

```ts
  exports: [
    ProductMastersService,
    ProductVariantsService,
    ProductVersionsService,
    ProductPurchaseConstraintsService,
    ProductReadAssembler,
    // 카테고리 서비스가 상품-카테고리 변경 시 프로젝션 스냅샷을 재발행하는 데 사용한다.
    ProjectionSnapshotAssembler,
    // 대량등록이 조합 문자열 → variantId 해석에 사용한다 (엑셀에 UUID 가 없으므로
    // 옵션 표시명으로 variant 를 찾아야 한다).
    OptionReadLoader,
  ],
```

2. `apps/core/src/modules/catalog/operations/import/product-import.module.ts` 의 `providers` 에 `ProductImportPricingBuilder` 를 추가하고, `imports` 에 `PricingModule` 과 `ProductsModule` 을 넣는다. `ProductsModule` 이 이미 들어있는지 먼저 확인한다 (manager 가 `ProductMastersService` 를 쓰므로 있을 가능성이 높다).

Run:
```bash
cat apps/core/src/modules/catalog/operations/import/product-import.module.ts
```

3. 순환 의존이 생기지 않는지 확인한다. `PricingModule` 이 `ProductsModule` 을 import 하고 `ProductsModule` 이 `PricingModule` 을 import 하는 구조라면 `forwardRef` 가 필요하다 — `product-masters.service.ts:108` 이 이미 `forwardRef(() => ProductVersionsService)` 를 쓰고 있어 이 계열의 전례가 있다.

Run:
```bash
grep -n "imports" -A 8 apps/core/src/modules/catalog/core/pricing/pricing.module.ts apps/core/src/modules/catalog/core/products/products.module.ts
```

- [ ] **Step 8: manager 테스트 갱신 후 전체 실행**

`product-import.manager.spec.ts` 의 목에 `pricingService.replaceVersionRules`, `reader.getVariantComboMap`, `pricingBuilder.build` 를 추가한다. 그리고 **순서 단정**을 넣는다 — 이 순서가 깨지면 조합 해석이 빈 맵을 보게 된다.

```ts
it('variant 생성(updateVersion) 이후에 가격 규칙을 쓴다', async () => {
  const order: string[] = [];
  productMastersService.updateVersion.mockImplementation(async () => { order.push('updateVersion'); return version; });
  reader.getVariantComboMap.mockImplementation(async () => { order.push('comboMap'); return new Map(); });
  pricingService.replaceVersionRules.mockImplementation(async () => { order.push('pricing'); return {}; });

  await manager.commit({ fileName: 'f.xlsx', userId: 'u1', records: [validRecord()] });

  expect(order).toEqual(['updateVersion', 'comboMap', 'pricing']);
});
```

Run: `npx jest --testPathPattern='operations/import' --silent`
Expected: PASS

- [ ] **Step 9: 타입 게이트**

Run: `npx nest build core`
Expected: exit 0

- [ ] **Step 10: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "feat(core): 대량등록 가격을 pricing rules 로 반영 (조합→variantId 해석)"
```

---

### Task 9: `variantCode` 반영

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts`

**Interfaces:**
- Consumes: `NormalizedVariantOverride.variantCode`, Task 7 의 `comboMap`
- Produces: Task 7 에서 no-op 으로 둔 `applyVariantCodes` 의 실제 구현. `product_variants.variant_code` 를 조합별로 UPDATE 한다

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('variantCode 를 조합에 해당하는 variant 에 쓴다', async () => {
  const key = comboKey([{ name: '색상', value: '빨강' }]);
  reader.getVariantComboMap.mockResolvedValue(new Map([[key, 'var-1']]));
  const record = validRecord();
  record.variantOverrides = [
    { rowNumber: 1, comboKey: key, combination: [{ name: '색상', value: '빨강' }], basePriceRaw: '', membershipPriceRaw: '', variantCode: 'KNIT-RD-L' },
  ];

  await manager.commit({ fileName: 'f.xlsx', userId: 'u1', records: [record] });

  expect(dbMock.updatedVariantCodes).toEqual([{ variantId: 'var-1', variantCode: 'KNIT-RD-L' }]);
});

it('같은 파일 안에서 variantCode 가 중복되면 그 행을 실패로 만든다', async () => {
  const a = comboKey([{ name: '색상', value: '빨강' }]);
  const b = comboKey([{ name: '색상', value: '파랑' }]);
  reader.getVariantComboMap.mockResolvedValue(new Map([[a, 'var-1'], [b, 'var-2']]));
  const record = validRecord();
  record.variantOverrides = [
    { rowNumber: 1, comboKey: a, combination: [], basePriceRaw: '', membershipPriceRaw: '', variantCode: 'DUP' },
    { rowNumber: 2, comboKey: b, combination: [], basePriceRaw: '', membershipPriceRaw: '', variantCode: 'DUP' },
  ];

  const result = await manager.commit({ fileName: 'f.xlsx', userId: 'u1', records: [record] });

  expect(result.failedCount).toBe(1);
  expect(result.items[0].errorMessage).toMatch(/variantCode/);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='product-import.manager.spec' --silent`
Expected: FAIL — `applyVariantCodes` 가 no-op

- [ ] **Step 3: 구현 — 메서드와 호출 지점을 함께 넣는다**

`ProductImportManager` 에 아래 private 메서드를 **새로** 추가하고, 동시에 Task 8 이 만든 성공 경로에서 호출한다. `getVariantComboMap` 직후, `replaceVersionRules` **앞**에 넣는다 — 가격 규칙 생성이 실패하면 코드만 남는 상태를 피하려는 것이 아니라, 같은 트랜잭션이라 순서가 결과를 바꾸지 않으므로 읽는 순서를 조합 해석 → 코드 → 가격으로 맞추는 것이다.

```ts
          const comboMap = await this.reader.getVariantComboMap(version.masterId, version.id, trx);
          await this.applyVariantCodes(record, comboMap, trx);   // ← 이 줄을 추가
          await this.pricingService.replaceVersionRules(
```

```ts
  /**
   * 조합별 variantCode 를 write 한다. variantCode 는 채널·WMS 매칭의 다리라
   * 여기서 심어두면 대량 등록 후 별도 SKU 매칭 작업의 규모가 줄어든다.
   *
   * publishVersion 이 active 버전 내 중복을 검증하지만(_validateVariantCodeUniqueness),
   * 게시 시점까지 미루면 세션 단위로 터진다. 파일 안 중복은 여기서 먼저 막는다.
   */
  private async applyVariantCodes(
    record: ProductRecord,
    comboMap: Map<string, string>,
    tx: DbTransaction,
  ): Promise<void> {
    const withCode = record.variantOverrides.filter((o) => o.variantCode);
    if (withCode.length === 0) return;

    const seen = new Map<string, number>();
    for (const override of withCode) {
      const code = override.variantCode as string;
      const first = seen.get(code);
      if (first !== undefined) {
        throw new BadRequestError(`variantCode 가 파일 안에서 중복됩니다: ${code} (${first}행, ${override.rowNumber}행)`);
      }
      seen.set(code, override.rowNumber);
    }

    for (const override of withCode) {
      const variantId = comboMap.get(override.comboKey);
      if (!variantId) {
        throw new BadRequestError(
          `조합에 해당하는 variant 를 찾을 수 없습니다: ${override.comboKey} (${record.productKey})`,
        );
      }
      await tx
        .update(productVariants)
        .set({ variantCode: override.variantCode, updatedAt: new Date() })
        .where(eq(productVariants.id, variantId));
    }
  }
```

import 에 `productVariants`, `BadRequestError` 를 추가한다. 던진 예외는 기존 commit 루프의 `catch` 가 잡아 그 행을 `failed` 로 기록한다.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npx jest --testPathPattern='operations/import' --silent`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "feat(core): 대량등록에서 variantCode 지정 (채널·WMS 매칭 다리)"
```

---

## 다음 계획으로 넘기는 것

| 스펙 단계 | 내용 | 비고 |
|---|---|---|
| 3 | commit/publish 비동기 잡화 + `product_import_items` 게시상태 컬럼 | 마이그레이션 1건(additive) → `migrate` 먼저, 그 뒤 `deploy` |
| 4 | 이벤트 `origin='bulk_import'` 마커 + 레인 강등 | core 선배포 → channel-adapter |
| 5 | InboxWorker 배치 claim(variant ≤ 4) + 동시성 1 | Task 1·2 완료가 선행조건 |
| — | admin-web 위저드 재배선 (Variants 시트 안내·가격 프리뷰) | 2단계 백엔드 머지 후 |

## 자체 검토 결과

**스펙 커버리지** — 이 계획이 담는 스펙 항목:

| 스펙 | 태스크 |
|---|---|
| §7 0단계 (#550) | Task 1 |
| §4.5 타임아웃 60초 | Task 2 |
| §4.1 `sortOrder` 실제 반영 | Task 3 |
| §4.1 Variants 시트 (조합 문자열, 축 순서 무시, 오류 규칙) | Task 4·5 |
| §8 템플릿 값 assert | Task 6 (+ Task 7 Step 4 가 `record.basePrice` 단정 추가) |
| §4.2 0원 게시 차단 | Task 7 |
| §4.2 pricing rules 매핑 (order·scope 조합) | Task 8 |
| §4.1 `variantCode` | Task 9 |

스펙 §4.3(비동기 잡)·§4.4(레인 강등)·§4.5(배치 claim·동시성 1)은 의도적으로 다음 계획으로 넘겼다 — 위 표에 명시.

**타입 일관성** — `comboKey()` 는 Task 5 에서 정의하고 Task 8(reader·builder)·Task 9 에서 같은 이름으로 쓴다. `NormalizedVariantOverride` 의 `basePriceRaw`/`membershipPriceRaw`(문자열, Task 5)와 `basePrice`/`membershipPrice`(숫자, Task 7)를 분리해 파싱 책임이 validator 한 곳에 모이도록 했다. `getVariantComboMap` 은 Task 8 에서 정의하고 Task 9 가 같은 맵을 받는다.

**자체 검토에서 고친 것 2건**

1. **Task 2 의 원래 구현안이 무효 코드였다.** SDK 설정에 `customFetch` 를 넘겨 per-request signal 을 심는 방식이었는데, `@medusajs/js-sdk` 2.13.5 의 `Config` 타입에 그런 필드가 **없다** (`baseUrl`·`globalHeaders`·`publishableKey`·`apiKey`·`auth`·`logger`·`debug` 뿐). 넘겨도 조용히 무시되어 "타임아웃을 넣었다" 고 착각한 채 동시성 1 로 내렸을 것이다. 핸들러 단위 타임아웃으로 교체했고, 목적(슬롯을 무한정 물지 않게)에도 그 층이 맞다.
2. **Task 8 의 `OptionReadLoader` 가 주입 불가였다.** `ProductsModule` 의 `providers` 에는 있지만 `exports` 에는 없다. 해당 Step 에 export 추가를 명시했다.

3. **리뷰 루브릭과 부딪히는 계획 지시 2건을 순서 재배치로 없앴다** (사전 스캔 결과, 사용자 승인). 원래는 ① `basePrice` 필수화가 템플릿 스펙을 red 로 만든 상태로 커밋하고 뒤 태스크가 해소, ② `applyVariantCodes` 를 빈 스텁으로 미리 만들어 두는 구성이었다. 둘 다 "테스트가 깨진 채 커밋" · "죽은 코드" 로 잡힐 상태다. 템플릿(Task 6)을 `basePrice` 필수화(Task 7) **앞으로** 옮기고, `variantCode` 는 Task 9 가 메서드와 호출을 함께 넣도록 바꿨다. 이때 Task 6 의 테스트가 아직 없는 `record.basePrice` 를 단정하면 이번엔 Task 6 이 깨지므로, Task 6 은 원본 셀 값까지만 보고 `record.basePrice` 단정은 Task 7 Step 4 가 추가한다.

**남은 위험**

- **핸들러 타임아웃은 in-flight HTTP 요청을 취소하지 못한다** (SDK 에 signal 훅이 없으므로). 슬롯은 놓아주지만 원 요청은 undici 기본값까지 배경에서 계속되고, 재시도와 겹칠 수 있다. Medusa 상품 경로가 handle 기준 upsert 라 중복 적용이 같은 결과를 내는 데 의존한다. 완전한 취소가 필요해지면 undici global dispatcher 로 올려야 하고 그때는 Naver·Coupang 클라이언트도 영향 범위다 — Task 2 의 코드 주석에 남겼다.
- **Task 8 의 순환 의존 가능성** — `PricingModule` ↔ `ProductsModule` 관계를 해당 Step 에서 확인한다. 필요하면 `forwardRef`(같은 계열 전례: `product-masters.service.ts:108`).
- **Task 6→7 순서는 이제 필수 제약이다.** 뒤집으면 템플릿 스펙이 red 인 커밋이 생긴다. 재배치로 해소했지만 순서 자체가 요구사항이 되었으므로 Task 6 본문 상단에 그 사실을 명시해 두었다.
