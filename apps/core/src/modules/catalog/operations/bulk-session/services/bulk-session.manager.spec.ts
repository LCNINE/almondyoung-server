// Task 6(purgeDrafts) 부터 이 매니저가 `product-versions.service.ts`/`product-masters.service.ts`
// 를 정적으로 끌어오는데, 그 둘이 bare `@packages/event-contracts` 를 import 한다 — 루트 jest
// 설정의 moduleNameMapper 에는 `^@packages/event-contracts/(.*)$`(하위 경로)만 있고 bare 경로
// 항목이 없어 해석되지 않는다(레포 상시 debt). 이미 있는 선례(bulk-draft.applier.spec.ts:1-12,
// product-versions.service.spec.ts:1-7)와 같은 모양으로 가상 모듈을 세운다.
jest.mock(
  '@packages/event-contracts',
  () => ({ PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' } }),
  { virtual: true },
);

import * as ExcelJS from 'exceljs';
import { Logger } from '@nestjs/common';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { SQL } from 'drizzle-orm';
import { BulkSessionManager } from './bulk-session.manager';
import { BulkSessionReader } from './bulk-session.reader';
import { buildFormWorkbook } from './form-export.workbook';
import {
  productBulkImages,
  productBulkItems,
  productBulkSessions,
  productFormExportItems,
  productFormExports,
  productMasterVersions,
} from '../../../schema/catalog.schema';
import { type FakeRow, rowMatchesCondition } from './__support__/drizzle-row-matcher';

// ─── `.where()` 를 실제로 거는 공용 렌더러(`rowMatchesCondition`, `__support__/drizzle-row-matcher.ts`) ───
//
// 이 파일의 두 하네스(accept 용 `harness`, 쓰기 경로용 `writeHarness`)가 **같은 것**을 쓴다.
// 처음에는 쓰기 경로에만 있었고 accept 하네스는 `where: () => rows` 로 술어를 통째로 버렸다 —
// 그래서 접수 게이트(만료·해석 불가 양식 거부)가 WHERE 를 잘못 걸어도 목이 초록이었다.
// 그 게이트는 "프리필 행을 신규로 재분류해 카탈로그를 통째로 중복 생성"하는 사고를 막는
// 유일한 서버측 방어선이라(스펙 §3.1 ⚠️) 목이 그것을 검증하지 못하는 것 자체가 결함이다.
//
// 렌더러는 이 파일에서 `__support__/` 로 옮겨졌다(Task 7 리뷰) — `bulk-session.cleaner.spec.ts`
// 도 같은 렌더러가 필요해졌는데, 처음에는 이 스펙 파일을 직접 import 하게 했더니 그 스펙을
// 단독 실행해도 이 파일의 describe/it 61건이 같이 등록되어 도는 부작용이 났다(자세한 이유는
// 헬퍼 파일 주석 참조). `__support__/*.ts` 는 `*.spec.ts` 로 안 끝나 jest `testRegex` 에 안
// 걸리므로 그 부작용이 없다.

interface WriteSelectChain extends Promise<FakeRow[]> {
  where(condition?: unknown): WriteSelectChain;
  orderBy(...args: unknown[]): WriteSelectChain;
  groupBy(...args: unknown[]): WriteSelectChain;
  limit(n?: number): WriteSelectChain;
  offset(n?: number): WriteSelectChain;
  /** `FOR UPDATE` 행 잠금. Task 5(excludeItem)의 "잠금이 트랜잭션 첫 문장인가" 관측이 이걸
   *  쓴다 — `onFor` 콜백은 `.where()`/`.limit()` 체이닝을 거쳐도(재귀 호출로 새 체인을
   *  만들므로) 그대로 전달된다. */
  for(mode?: string): WriteSelectChain;
}

/**
 * `.select(fields)` 에 넘어온 필드 객체가 drizzle 집계(`count()` 등)를 담고 있는지 판정한다.
 * 리뷰 발견 1 픽스 — 평범한 컬럼 투영(`{ phase: table.phase }`)의 값은 `PgColumn` 인스턴스라
 * `SQL` 이 아니고, `count()`/`sum()` 같은 집계는 `SQL` 인스턴스를 돌려준다(직접 렌더해
 * `count()` → `{ sql: 'count(*)', params: [] }` 로 확인했다). 그 필드의 **키 이름**을 그대로
 * 돌려준다 — 매니저 코드가 실제로 쓴 별칭(`{ value: count() }` 의 `value`)과 결과 행의 키가
 * 어긋나지 않아야 하기 때문이다.
 *
 * **`groupBy` 는 다루지 않는다(YAGNI)** — 지금 이 파일의 유일한 집계 쿼리(`purgeDrafts` 의
 * `remaining` 재집계)는 group 없이 단일 합계 한 행만 요구한다. 그룹별 집계가 필요해지면
 * 그때 넓힌다.
 */
function aggregateCountKey(fields: unknown): string | undefined {
  if (!fields || typeof fields !== 'object') return undefined;
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (value instanceof SQL) return key;
  }
  return undefined;
}

/**
 * `aggregateKey` 가 있으면 이 체인이 결국 돌려주는 값은 원시 행 배열이 아니라 **매칭된 행
 * 수를 담은 행 하나**(`[{ [aggregateKey]: rows.length }]`)다 — `.select({ value: count() })`
 * 를 실제로 흉내내는 지점. `.where()` 로 필터링된 뒤의 행 수를 세야 하므로, 재귀 호출마다
 * (아래 `builder.where`) `aggregateKey` 를 그대로 전달해 최종 필터링 결과에 반영되게 한다.
 */
function writeSelectChain(rows: FakeRow[], onFor?: () => void, aggregateKey?: string): WriteSelectChain {
  const resolvedValue: FakeRow[] = aggregateKey ? [{ [aggregateKey]: rows.length }] : rows;
  const builder = Promise.resolve(resolvedValue) as WriteSelectChain;
  builder.where = (condition) =>
    writeSelectChain(
      rows.filter((row) => rowMatchesCondition(row, condition)),
      onFor,
      aggregateKey,
    );
  builder.orderBy = () => builder;
  builder.groupBy = () => builder;
  builder.limit = () => builder;
  builder.offset = () => builder;
  builder.for = () => {
    onFor?.();
    return builder;
  };
  return builder;
}

/** BulkSessionManager.accept 가 실제로 호출하는 메서드만 흉내낸 최소 trx 모양. */
interface FakeTrx {
  insert: (table: unknown) => { values: (v: FakeRow) => { returning: () => Promise<FakeRow[]> } };
  select: (fields?: unknown) => { from: (table: unknown) => WriteSelectChain };
}

interface FakeDb {
  run: <T>(fn: (trx: FakeTrx) => Promise<T>) => Promise<T>;
}

const FUTURE = new Date(Date.now() + 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

/**
 * postgres.js 의 FK 위반 에러를 흉내낸다 — 실제 형태는 scratch DB 에 대고 직접 확인했다
 * (task-8-report.md 픽스 리포트 참조): top-level 은 drizzle-orm 의 `DrizzleQueryError`
 * (`.code` 없음)고, `.cause` 가 postgres.js `PostgresError` 이며 거기 `.code === '23503'`
 * 이 있다. `isForeignKeyViolation` 이 `.cause` 를 타고 내려가며 찾는 바로 그 모양이다.
 * 둘 다 실제 `Error` 인스턴스로 만든다 — `prefer-promise-reject-errors` 를 만족시키면서
 * 실제 형태(Error 서브클래스 + `.cause` 도 Error)와도 더 가깝다.
 */
const FK_VIOLATION_CAUSE = Object.assign(
  new Error(
    'insert or update on table "product_bulk_sessions" violates foreign key constraint "product_bulk_sessions_export_id_product_form_exports_id_fk"',
  ),
  { code: '23503', constraint_name: 'product_bulk_sessions_export_id_product_form_exports_id_fk' },
);
const FK_VIOLATION_ERROR = new Error('Failed query: insert into "product_bulk_sessions" ...', {
  cause: FK_VIOLATION_CAUSE,
});

/**
 * `accept()` 하네스. 게이트가 읽는 두 테이블을 **테이블 정체성으로** 픽스처에 물리고,
 * `.where()` 는 위 `rowMatchesCondition` 으로 실제로 건다.
 *
 * 예전에는 select 호출 순서를 세는 큐였고 술어를 전부 버렸다 — 그래서 게이트가
 * `eq(exportId)` 나 `isNull(snapshot)` 을 빠뜨려도 목이 통과했다. 지금은 픽스처에 **관계
 * 없는 행**(다른 export 의 아이템, 다른 export 행)을 섞어 두면 술어를 잃은 구현이 빨간불이 된다.
 *
 * 게이트(assertExportUsable)와 INSERT 는 **서로 다른** `db.run` 을 연다(리뷰 #3 재수정 —
 * 하나로 묶는 최초 픽스는 READ COMMITTED 에서 경쟁을 닫지 못하면서 트랜잭션만 `fetch`
 * 왕복 동안 열어두는 손해만 남겼다). 이 페이크의 `db.run` 은 항상 같은 `trx` 싱글턴을
 * 넘기므로 "몇 번 열렸는지"는 `runCalls` 로 별도 추적한다.
 */
function harness(
  opts: {
    /** `product_form_exports` 픽스처. 행 하나에 `id`·`status`·`expiresAt` 이 필요하다. */
    exports?: FakeRow[];
    /** `product_form_export_items` 픽스처. `exportId`·`snapshot` 이 필요하다. */
    exportItems?: FakeRow[];
    onInsert?: (values: FakeRow) => void;
    insertError?: Error;
    softDeleteImpl?: (fileId: string, userId: string) => Promise<void>;
  } = {},
) {
  const rowsFor = (table: unknown): FakeRow[] => {
    if (table === productFormExports) return opts.exports ?? [];
    if (table === productFormExportItems) return opts.exportItems ?? [];
    return [];
  };
  const insertedTables: unknown[] = [];
  const trx: FakeTrx = {
    insert: (table) => ({
      values: (v) => {
        insertedTables.push(table);
        opts.onInsert?.(v);
        // 지역 const 로 좁혀 클로저 안에서도 `Error | undefined` 로 되돌아가지 않게 한다
        // (property access 는 클로저 경계를 넘으면 narrowing 이 유지되지 않는다) —
        // prefer-promise-reject-errors 가 Error 타입임을 정적으로 확인할 수 있어야 한다.
        const insertError = opts.insertError;
        if (insertError) return { returning: () => Promise.reject(insertError) };
        return { returning: () => Promise.resolve([{ id: 'session-1', ...v }]) };
      },
    }),
    select: () => ({ from: (table) => writeSelectChain(rowsFor(table)) }),
  };
  let runCalls = 0;
  const db: FakeDb = {
    run: (fn) => {
      runCalls += 1;
      return fn(trx);
    },
  };
  const fileClient = {
    upload: jest.fn(() => Promise.resolve({ fileId: 'file-1' })),
    softDelete: opts.softDeleteImpl ? jest.fn(opts.softDeleteImpl) : jest.fn(() => Promise.resolve(undefined)),
  };

  // Manager 생성자는 실제 DbService<PimSchema>/FormExportFileClient/BulkSessionReader/
  // ProductVersionsService/ProductMastersService 타입을 요구한다 — 이 페이크는 Manager 가
  // 실제로 부르는 메서드(run/upload/softDelete)만 구조적으로 흉내내므로 완전한 구조 일치가
  // 아니다. form-export.manager.spec.ts harness 와 같은 관례로 `as never` 캐스팅한다.
  // accept() 는 reader/versions/masters 를 전혀 쓰지 않으므로 빈 객체로 충분하다 —
  // setConflictDecision/approve/cancel/purgeDrafts 를 도는 테스트는 아래 writeHarness 를
  // 따로 쓴다.
  const manager = new BulkSessionManager(db as never, fileClient as never, {} as never, {} as never, {} as never);
  return { manager, trx, fileClient, runCalls: () => runCalls, insertedTables };
}

async function newOnlyWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('상품');
  ws.addRow(['상품키', '상품명', '판매가']);
  ws.addRow(['A', '새 상품', '1000']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const EXPORT_ID = '11111111-1111-7111-8111-111111111111';
/** 게이트가 절대 집어서는 안 되는 **남의** 양식. 픽스처에 늘 섞어 두어 `eq(id)` 를 잠근다. */
const OTHER_EXPORT_ID = '22222222-2222-7222-8222-222222222222';

/** 유효한 양식 잡 한 건 + 반드시 걸러져야 하는 남의 행 하나. */
const usableExports = (overrides: FakeRow = {}): FakeRow[] => [
  // 이 행이 먼저 온다 — `eq(id)` 를 잃은 구현은 이걸 집어 "만료됨"으로 오판한다.
  { id: OTHER_EXPORT_ID, status: 'expired', expiresAt: PAST },
  { id: EXPORT_ID, status: 'completed', expiresAt: FUTURE, ...overrides },
];

/** 전부 스냅샷이 채워진 items + 남의 양식에 속한 NULL 스냅샷 행(걸러져야 한다). */
const usableExportItems = (): FakeRow[] => [
  { id: 'other-item', exportId: OTHER_EXPORT_ID, snapshot: null },
  { id: 'item-1', exportId: EXPORT_ID, snapshot: { product: {} } },
];

async function exportBackedWorkbook(exportId: string = EXPORT_ID): Promise<Buffer> {
  return buildFormWorkbook({
    exportId,
    products: [{ rowKey: 'P-000001', name: '티셔츠', basePrice: '19000', brand: 'ACME' }],
    options: [],
    variants: [],
    categories: [],
    constraints: [],
    images: [],
    categoryPaths: ['여성패션>티셔츠'],
  });
}

describe('BulkSessionManager.accept — exportId 3갈래', () => {
  it('exportId 가 없으면 신규 전용 세션이다', async () => {
    const inserted: FakeRow[] = [];
    const { manager } = harness({ onInsert: (v) => inserted.push(v) });

    const out = await manager.accept({ buffer: await newOnlyWorkbook(), fileName: 'form.xlsx', userId: 'u1' });

    expect(out.phase).toBe('uploaded');
    expect(out.totalRows).toBe(1);
    expect(inserted[0]?.exportId).toBeNull();
  });

  it('exportId 가 있고 해석되면 정상 세션이다 — 올린 파일과 올린 사람이 그대로 실린다', async () => {
    const inserted: FakeRow[] = [];
    const { manager, runCalls, fileClient, insertedTables } = harness({
      exports: usableExports(),
      exportItems: usableExportItems(),
      onInsert: (v) => inserted.push(v),
    });

    const out = await manager.accept({ buffer: await exportBackedWorkbook(), fileName: 'form.xlsx', userId: 'u1' });

    expect(out.phase).toBe('uploaded');
    expect(insertedTables).toEqual([productBulkSessions]);
    // 파싱 슬라이스는 이 두 값으로 파일을 다시 내려받는다(bulk-session-job.manager.ts 의
    // `fileClient.download(sourceFileId, uploadedBy)`) — 어느 한쪽이 어긋나면 세션이 첫
    // 틱에서 다운로드 실패로 굳는다. 업로드 호출 인자와 삽입 행을 함께 못 박는다.
    // 매처(expect.any)를 object literal 안에 섞으면 그 `any` 반환 타입이 no-unsafe-assignment
    // 를 낸다 — bulk-session-job.manager.spec.ts:226-227 과 같은 이유로 따로 뗀다.
    const anyBuffer: unknown = expect.any(Buffer);
    expect(fileClient.upload).toHaveBeenCalledWith({ buffer: anyBuffer, fileName: 'form.xlsx', userId: 'u1' });
    expect(inserted[0]).toMatchObject({
      exportId: EXPORT_ID,
      sourceFileId: 'file-1',
      uploadedBy: 'u1',
      fileName: 'form.xlsx',
      phase: 'uploaded',
    });
    // 게이트(gate select 들)와 INSERT 가 서로 다른 db.run 을 연다 — 하나로 묶지 않는다는
    // 리뷰 #3 재수정의 회귀 가드.
    expect(runCalls()).toBe(2);
  });

  it('exportId 가 있는데 그 양식이 없으면 업로드를 거부한다', async () => {
    // 남의 양식만 있다 — `eq(id)` 를 잃은 구현은 이걸 집어 통과시킨다.
    const { manager } = harness({ exports: [{ id: OTHER_EXPORT_ID, status: 'completed', expiresAt: FUTURE }] });

    await expect(
      manager.accept({ buffer: await exportBackedWorkbook(), fileName: 'form.xlsx', userId: 'u1' }),
    ).rejects.toThrow('양식을 다시 받아');
  });

  it('exportId 는 있는데 items 에 스냅샷이 없으면 업로드를 거부한다', async () => {
    const { manager, fileClient } = harness({
      exports: usableExports(),
      exportItems: [
        { id: 'item-1', exportId: EXPORT_ID, snapshot: { product: {} } },
        // NULL 스냅샷 행이 **하나라도** 있으면 거부다(스냅샷 컬럼 이전에 만들어진 양식).
        // 채워진 행을 먼저 둔다 — `isNull(snapshot)` 을 잃은 구현은 첫 행을 집어 거부하므로
        // 이 테스트만으로는 술어를 못 잠근다. 바로 아래 통과 케이스가 나머지 절반이다.
        { id: 'item-2', exportId: EXPORT_ID, snapshot: null },
      ],
    });

    await expect(
      manager.accept({ buffer: await exportBackedWorkbook(), fileName: 'form.xlsx', userId: 'u1' }),
    ).rejects.toThrow('양식을 다시 받아');
    expect(fileClient.upload).not.toHaveBeenCalled();
  });

  it('스냅샷이 전부 채워진 양식은 통과한다 — 그리고 남의 양식의 NULL 스냅샷은 영향이 없다', async () => {
    // 이 케이스가 위 거부 케이스와 짝이다: `isNull(snapshot)` 을 잃으면 여기서 빨간불,
    // `eq(exportId)` 를 잃으면 남의 NULL 행에 걸려 역시 빨간불이 된다.
    const { manager } = harness({ exports: usableExports(), exportItems: usableExportItems() });

    await expect(
      manager.accept({ buffer: await exportBackedWorkbook(), fileName: 'form.xlsx', userId: 'u1' }),
    ).resolves.toMatchObject({ phase: 'uploaded' });
  });

  it('양식 잡이 완료 상태가 아니면 업로드를 거부한다', async () => {
    const { manager } = harness({ exports: usableExports({ status: 'running' }) });

    await expect(
      manager.accept({ buffer: await exportBackedWorkbook(), fileName: 'form.xlsx', userId: 'u1' }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('양식 잡이 completed 여도 만료 시각이 지났으면 업로드를 거부한다 (정리 크론을 기다리지 않는다)', async () => {
    const { manager, fileClient } = harness({
      exports: usableExports({ expiresAt: PAST }),
      exportItems: usableExportItems(),
    });

    await expect(
      manager.accept({ buffer: await exportBackedWorkbook(), fileName: 'form.xlsx', userId: 'u1' }),
    ).rejects.toThrow('양식을 다시 받아');
    // 만료 정리는 하루 한 번만 돈다 — status 만 보면 만료 후 최대 하루를 "정상"으로
    // 통과시킨다. 파일도 올라가면 안 된다.
    expect(fileClient.upload).not.toHaveBeenCalled();
  });

  it('items 가 0행인 양식(active 상품이 없었음)은 거부하지 않는다', async () => {
    const { manager } = harness({
      exports: usableExports(),
      // 이 양식에 속한 아이템이 아예 없다. 프리필 행이 없다는 뜻이라 신규 전용과 같다.
      exportItems: [{ id: 'other-item', exportId: OTHER_EXPORT_ID, snapshot: null }],
    });

    await expect(
      manager.accept({ buffer: await exportBackedWorkbook(), fileName: 'form.xlsx', userId: 'u1' }),
    ).resolves.toMatchObject({ phase: 'uploaded' });
  });

  it('메타 셀의 exportId 가 uuid 형태가 아니면 업로드를 거부한다 (uuid 컬럼 22P02 대신 400)', async () => {
    const { manager, fileClient } = harness();

    // readExportIdFromWorkbook 은 메타 셀 문자열을 형식 검증 없이 그대로 돌려준다 — 손상된
    // 워크북이나 수기 편집으로 이런 값이 들어올 수 있다. select 없이 바로 거부해야 한다.
    await expect(
      manager.accept({ buffer: await exportBackedWorkbook('not-a-uuid'), fileName: 'form.xlsx', userId: 'u1' }),
    ).rejects.toThrow('양식을 다시 받아');
    expect(fileClient.upload).not.toHaveBeenCalled();
  });

  it('거부할 때는 file-service 에 파일을 올리지 않는다', async () => {
    const { manager, fileClient } = harness({ exports: [] });

    await expect(
      manager.accept({ buffer: await exportBackedWorkbook(), fileName: 'form.xlsx', userId: 'u1' }),
    ).rejects.toThrow();
    expect(fileClient.upload).not.toHaveBeenCalled();
  });

  it('게이트 통과 후 INSERT 시점에 export 가 사라져 FK(23503)가 나면 같은 거부 메시지로 바꾸고 업로드 파일을 지운다', async () => {
    const { manager, fileClient } = harness({
      exports: usableExports(), // 게이트는 통과한다
      exportItems: usableExportItems(),
      insertError: FK_VIOLATION_ERROR, // 그 사이 정리 크론이 export 를 지웠다고 가정
    });

    await expect(
      manager.accept({ buffer: await exportBackedWorkbook(), fileName: 'form.xlsx', userId: 'u1' }),
    ).rejects.toThrow('양식을 다시 받아');
    // 이미 올라간 파일(file-1)을 best-effort 로 지운다 — 업로드는 게이트 통과 후 실행됐다.
    expect(fileClient.softDelete).toHaveBeenCalledWith('file-1', 'u1');
  });

  it('그 정리(softDelete)가 실패해도 원래의 거부 오류가 그대로 나간다', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { manager, fileClient } = harness({
      exports: usableExports(),
      exportItems: usableExportItems(),
      insertError: FK_VIOLATION_ERROR,
      softDeleteImpl: () => Promise.reject(new Error('file-service 삭제 실패 (500)')),
    });

    // 파일 정리 실패가 작업자에게 보이는 오류를 바꾸면 안 된다 — 여전히 표준 거부 메시지다.
    await expect(
      manager.accept({ buffer: await exportBackedWorkbook(), fileName: 'form.xlsx', userId: 'u1' }),
    ).rejects.toThrow('양식을 다시 받아');
    expect(fileClient.softDelete).toHaveBeenCalledWith('file-1', 'u1');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('file-1'));

    warnSpy.mockRestore();
  });

  it('FK 위반이 아닌 INSERT 실패는 그대로 전파된다 (같은 거부 메시지로 바뀌지 않는다)', async () => {
    const { manager, fileClient } = harness({
      exports: usableExports(),
      exportItems: usableExportItems(),
      insertError: new Error('일시적 DB 커넥션 오류'),
    });

    await expect(
      manager.accept({ buffer: await exportBackedWorkbook(), fileName: 'form.xlsx', userId: 'u1' }),
    ).rejects.toThrow('일시적 DB 커넥션 오류');
    // FK 위반이 아니므로 정리 시도를 하지 않는다 — 파일은 여전히 유효한 세션을 기다릴 수 있다.
    expect(fileClient.softDelete).not.toHaveBeenCalled();
  });
});

describe('BulkSessionManager.accept — 세션 이름', () => {
  it('name 을 안 주면 업로드 파일명이 들어간다', async () => {
    const inserted: FakeRow[] = [];
    const { manager } = harness({ onInsert: (v) => inserted.push(v) });

    await manager.accept({ buffer: await newOnlyWorkbook(), fileName: '내파일.xlsx', userId: 'u1' });

    expect(inserted[0]?.name).toBe('내파일.xlsx');
  });

  it('공백만 있는 name 도 파일명으로 대체한다', async () => {
    const inserted: FakeRow[] = [];
    const { manager } = harness({ onInsert: (v) => inserted.push(v) });

    await manager.accept({ buffer: await newOnlyWorkbook(), fileName: '내파일.xlsx', name: '   ', userId: 'u1' });

    expect(inserted[0]?.name).toBe('내파일.xlsx');
  });

  it('name 을 주면 trim 해서 쓴다', async () => {
    const inserted: FakeRow[] = [];
    const { manager } = harness({ onInsert: (v) => inserted.push(v) });

    await manager.accept({ buffer: await newOnlyWorkbook(), fileName: 'x.xlsx', name: '  내 세션  ', userId: 'u1' });

    expect(inserted[0]?.name).toBe('내 세션');
  });

  it('파일명 폴백이 varchar(200) 상한을 넘으면 잘라서 쓴다 (INSERT 22001 + 고아 파일 방지)', async () => {
    const inserted: FakeRow[] = [];
    const { manager } = harness({ onInsert: (v) => inserted.push(v) });
    const longFileName = `${'가'.repeat(210)}.xlsx`; // 215자 — OS 파일명 한계(255) 안이지만 varchar(200) 밖

    await manager.accept({ buffer: await newOnlyWorkbook(), fileName: longFileName, userId: 'u1' });

    expect((inserted[0]?.name as string).length).toBe(200);
    expect(inserted[0]?.name).toBe(longFileName.slice(0, 200));
  });
});

describe('BulkSessionManager.accept — 파일 수준 오류', () => {
  it('파싱 실패는 그대로 전파되고 file-service 를 부르지 않는다', async () => {
    const { manager, fileClient } = harness();

    await expect(manager.accept({ buffer: Buffer.from('not xlsx'), fileName: 'x.xlsx', userId: 'u1' })).rejects.toThrow(
      '유효한 엑셀',
    );
    expect(fileClient.upload).not.toHaveBeenCalled();
  });
});

// ─── setConflictDecision / approve / cancel ───
//
// 위 harness() 는 accept() 전용(게이트 두 테이블 + insert)이라 재사용하지 않는다. 이 세
// 메서드는 같은 세션/아이템 행을 여러 번 읽고 **쓰므로**(승인·취소는 마지막에
// reader.getProgress 까지 부른다) 상태가 update 로 실제로 변형돼야 한다 — 승인 후
// getProgress 가 새 phase 를 봐야 하므로 정적 픽스처로는 안 된다. 조건 매칭
// (`rowMatchesCondition`)과 select 체인은 파일 상단의 공용 렌더러를 **그대로 공유한다**.
//
// **Task 10 리뷰 #3 픽스: `.where(condition)` 를 무시하지 않는다.** 이전 버전은
// `builder.where = () => builder` 로 조건을 통째로 버려 세션/status 필터가 실제로 걸리는지
// 전혀 검증하지 못했다(빠뜨려도 테스트가 그대로 초록이었다). update 도 같은 매칭으로 "어느
// 행이 조건에 맞는지" 를 가려 그 행만 고치고 `.returning()` 한다 — CAS 가 0행이 되는
// 경로(#4)도 이걸로 실행 가능해진다.

interface WriteUpdateChain extends Promise<void> {
  returning(cols?: unknown): Promise<FakeRow[]>;
}

interface WriteFakeTrx {
  select: (fields?: unknown) => { from: (table: unknown) => WriteSelectChain };
  update: (table: unknown) => { set: (values: FakeRow) => { where: (condition?: unknown) => WriteUpdateChain } };
}

function tableKey(table: unknown): 'sessions' | 'items' | 'images' | 'versions' | 'other' {
  if (table === productBulkSessions) return 'sessions';
  if (table === productBulkItems) return 'items';
  if (table === productBulkImages) return 'images';
  if (table === productMasterVersions) return 'versions';
  return 'other';
}

/** 실제 SQL 테이블명(snake_case) — Task 5 잠금 순서 관측(`calls`)이 단정하는 값. */
function sqlTableName(table: unknown): string {
  if (table === productBulkSessions) return 'product_bulk_sessions';
  if (table === productBulkItems) return 'product_bulk_items';
  if (table === productBulkImages) return 'product_bulk_images';
  if (table === productMasterVersions) return 'product_master_versions';
  return 'unknown_table';
}

interface WriteHarnessOpts {
  session: FakeRow;
  items?: FakeRow[];
  images?: FakeRow[];
  /** 취소가 잠금을 푸는 대상 — 이 세션이 `bulkSessionId` 로 잠근 draft 픽스처. */
  versions?: FakeRow[];
  /**
   * `취소 CAS 가 0행이면` 시나리오 전용 훅. `cancel()` 의 초기 가드와 CAS 는 같은 `phase`
   * 필드를 보므로(다른 필드로는 이 페이크에서 경쟁을 재현할 수 없다) SELECT 가 픽스처를
   * 읽은 **직후** `sessions` 배열을 이 값으로 갈아치워 "읽은 뒤 다른 탭이 phase 를
   * 바꿨다"를 흉내낸다. select 가 반환한 결과(`rows`)는 교체 전 배열을 이미 캡처했으므로
   * 가드는 원래 phase 로 통과하고, 뒤이은 CAS UPDATE 의 `.where()` 매칭만 새 phase 를 본다.
   */
  raceSessionPhaseTo?: string;
}

/**
 * Manager 가 승인·취소 끝에 `this.reader.getProgress(...)` 를 그대로 호출하므로(중복 구현을
 * 피하려는 설계, bulk-session.manager.ts 주석 참조), 여기서도 **진짜 BulkSessionReader** 를
 * 같은 페이크 db 로 생성해 Manager 에 주입한다 — reader 자체의 집계 로직은 이미
 * bulk-session.reader.spec.ts 가 따로 검증하므로, 여기 items/images 픽스처는 phase 전이
 * 판정에만 맞게 최소로 둔다(집계값 자체는 이 스위트의 관심사가 아니다).
 *
 * 세션은 배열 하나로 둔다(행이 하나뿐이라도) — update 가 "조건에 맞는 행만" 고치는 같은
 * 경로를 items/images 와 공유하기 위해서다.
 */
function writeHarness(opts: WriteHarnessOpts) {
  let sessions: FakeRow[] = [{ ...opts.session }];
  // Task 6(purgeDrafts) 픽스처는 `sessionId` 를 생략한다 — 다른 describe 들의
  // `conflictItemFixture()` 처럼 매번 반복해서 적을 이유가 없다(테스트 세션이 하나뿐이므로
  // "이 행이 어느 세션 것인지"는 항상 자명하다). `eq(productBulkItems.sessionId, sessionId)`
  // 술어가 실제로 걸리려면 행에 그 필드가 있어야 하므로, item 이 명시하지 않으면 세션의
  // `id` 를 기본값으로 채운다 — item 자신의 `sessionId` 가 있으면 그대로 우선한다.
  let items: FakeRow[] = (opts.items ?? []).map((item): FakeRow => ({ sessionId: opts.session.id, ...item }));
  let images = [...(opts.images ?? [])];
  let versions = [...(opts.versions ?? [])];
  const sessionUpdates: FakeRow[] = [];
  const itemUpdates: FakeRow[] = [];
  const versionUpdates: FakeRow[] = [];
  // Task 5(excludeItem)의 "잠금이 트랜잭션 첫 문장인가" 관측. **모든** select 문을 실행
  // 순서대로 기록한다 — `.for()` 가 붙은 것만 기록하면 "잠갔는가"만 보게 되어, 잠금이
  // 두 번째 문장으로 밀려도 여전히 `calls[0]` 이 그 하나뿐인 for-update 항목이 되는 함정에
  // 빠진다(실제로 그렇게 짰다가 순서를 일부러 뒤집는 변이 테스트로 잡아냈다). `.from()`
  // 시점에 `kind: 'select'` 로 항목을 밀어 넣고, 같은 체인에서 나중에 `.for()` 가 불리면
  // (`.where()` 뒤에 온다) **같은 객체**를 `'select-for-update'` 로 바꿔 쓴다 — `calls` 는
  // 그 객체 참조를 이미 담고 있으므로 나중의 변경이 그대로 보인다.
  const calls: Array<{ kind: string; table: string }> = [];

  const tableRows = (table: unknown): FakeRow[] => {
    const key = tableKey(table);
    if (key === 'sessions') return sessions;
    if (key === 'items') return items;
    if (key === 'images') return images;
    if (key === 'versions') return versions;
    return [];
  };

  const trx: WriteFakeTrx = {
    select: (fields) => ({
      from: (table) => {
        const call = { kind: 'select', table: sqlTableName(table) };
        calls.push(call);
        const chain = writeSelectChain(
          tableRows(table),
          () => {
            call.kind = 'select-for-update';
          },
          aggregateCountKey(fields),
        );
        // raceSessionPhaseTo 문서 참조 — select 가 `tableRows`(교체 전 배열)를 이미
        // 캡처한 뒤에 배열을 갈아치운다. 이후의 CAS UPDATE 는 새 배열을 본다.
        if (table === productBulkSessions && opts.raceSessionPhaseTo !== undefined) {
          sessions = sessions.map((row) => ({ ...row, phase: opts.raceSessionPhaseTo }));
        }
        return chain;
      },
    }),
    update: (table) => ({
      set: (values) => ({
        where: (condition): WriteUpdateChain => {
          const key = tableKey(table);
          const current = tableRows(table);
          const matched = current.filter((row) => rowMatchesCondition(row, condition));
          const matchedIds = new Set(matched.map((row) => row.id));
          const next = current.map((row) => (matchedIds.has(row.id) ? { ...row, ...values } : row));

          if (matched.length > 0) {
            if (key === 'sessions') {
              sessions = next;
              sessionUpdates.push(values);
            } else if (key === 'items') {
              items = next;
              itemUpdates.push(values);
            } else if (key === 'images') {
              images = next;
            } else if (key === 'versions') {
              versions = next;
              versionUpdates.push(values);
            }
          }

          const result = Promise.resolve() as WriteUpdateChain;
          const returned = matched.length === 0 ? [] : next.filter((row) => matchedIds.has(row.id));
          result.returning = () => Promise.resolve(returned);
          return result;
        },
      }),
    }),
  };

  const db = { run: <T>(fn: (t: WriteFakeTrx) => Promise<T>) => fn(trx) };
  const fileClient = { upload: jest.fn(), softDelete: jest.fn() };
  // 이 파일 상단 harness() 와 같은 관례 — 페이크는 db.run 만 구조적으로 흉내낸다.
  const reader = new BulkSessionReader(db as never);
  // Task 6(purgeDrafts) 전용 페이크. `versions`/`masters` 라는 이름은 이미 위에서 이 세션이
  // 잠근 draft 픽스처 배열(`let versions: FakeRow[]`)에 쓰이고 있어 겹친다 — 서비스 페이크는
  // `productVersionsService`/`productMastersService` 로 구분한다. 메서드는 jest.fn() 하나뿐이라
  // (bulk-draft.applier.spec.ts 의 fileClient 페이크와 같은 관례로) 기본 구현 없이 둔다 —
  // `await jest.fn()()` 은 `undefined` 를 즉시 resolve 하므로 성공 케이스엔 그걸로 충분하고,
  // 실패 케이스는 개별 테스트가 `mockRejectedValueOnce` 로 얹는다.
  const deleteDraftVersion = jest.fn();
  const deleteMaster = jest.fn();
  const productVersionsService = { deleteDraftVersion };
  const productMastersService = { deleteMaster };
  const manager = new BulkSessionManager(
    db as never,
    fileClient as never,
    reader,
    productVersionsService as never,
    productMastersService as never,
  );
  return {
    manager,
    session: () => sessions[0],
    items: () => items,
    /** purgeDrafts 테스트 전용 — 처리 대상이 아닌 행이 그대로인지 그 자리에서 바로 읽는다. */
    itemRows: items,
    versions: () => versions,
    sessionUpdates,
    itemUpdates,
    versionUpdates,
    calls,
    deleteDraftVersion,
    deleteMaster,
  };
}

function conflictItemFixture(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'item-1',
    sessionId: 'sess-1',
    rowNumber: 2,
    rowKey: 'P-1',
    kind: 'update',
    status: 'pending',
    masterId: 'm-1',
    errorMessage: null,
    payload: { fields: {} },
    conflict: { 'product.brand': { base: 'A', mine: 'B', current: 'C' } },
    conflictDecision: null,
    baseSnapshot: null,
    ...overrides,
  };
}

/** 충돌은 없고 **IMG-1 을 대표 이미지로 참조하는** 행. 이미지 게이트 테스트의 기본형이다. */
function imageRefItem(overrides: FakeRow = {}): FakeRow {
  return conflictItemFixture({
    conflict: null,
    conflictDecision: null,
    payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] },
    ...overrides,
  });
}

/** 아직 파일이 없는 이미지 행 하나. */
function awaitingImage(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'img-1',
    sessionId: 'sess-1',
    imageKey: 'IMG-1',
    usage: 'main',
    status: 'awaiting_upload',
    ...overrides,
  };
}

const SESSION_REVIEW: FakeRow = {
  id: 'sess-1',
  uploadedBy: 'u1',
  phase: 'review',
  phaseError: null,
  totalRows: 1,
  cancelRequestedAt: null,
};

describe('BulkSessionManager.setConflictDecision', () => {
  it('review 가 아니면 409 다', async () => {
    const { manager } = writeHarness({
      session: { ...SESSION_REVIEW, phase: 'validating' },
      items: [conflictItemFixture()],
    });

    await expect(
      manager.setConflictDecision('sess-1', 'item-1', 'u1', { 'product.brand': 'overwrite' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('충돌하지 않은 필드에 결정을 달면 400 이다 — 화면이 낡았다는 뜻이다', async () => {
    const { manager } = writeHarness({ session: SESSION_REVIEW, items: [conflictItemFixture()] });

    await expect(
      manager.setConflictDecision('sess-1', 'item-1', 'u1', { 'product.name': 'overwrite' }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('overwrite/skip 이 아닌 값은 400 이다', async () => {
    const { manager } = writeHarness({ session: SESSION_REVIEW, items: [conflictItemFixture()] });

    await expect(
      manager.setConflictDecision('sess-1', 'item-1', 'u1', { 'product.brand': 'keep-mine' }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('부분 갱신은 기존 결정에 머지된다 — 두 번 호출하면 두 필드가 다 남는다', async () => {
    const { manager } = writeHarness({
      session: SESSION_REVIEW,
      items: [
        conflictItemFixture({
          conflict: {
            'product.brand': { base: 'A', mine: 'B', current: 'C' },
            'product.name': { base: 'X', mine: 'Y', current: 'Z' },
          },
        }),
      ],
    });

    await manager.setConflictDecision('sess-1', 'item-1', 'u1', { 'product.brand': 'overwrite' });
    const second = await manager.setConflictDecision('sess-1', 'item-1', 'u1', { 'product.name': 'skip' });

    expect(second.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'product.brand', decision: 'overwrite' }),
        expect.objectContaining({ field: 'product.name', decision: 'skip' }),
      ]),
    );
  });

  it('남의 세션은 404 다', async () => {
    const { manager } = writeHarness({
      session: { ...SESSION_REVIEW, uploadedBy: 'other' },
      items: [conflictItemFixture()],
    });

    await expect(
      manager.setConflictDecision('sess-1', 'item-1', 'u1', { 'product.brand': 'overwrite' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // Task 10 리뷰 #3: itemId 로 정확히 그 행만 골라 쓰는지 — where() 를 무시하는 이전 하네스
  // 로는 두 아이템이 있으면 어느 쪽에 결정을 달아도 늘 배열의 첫 행만(또는 둘 다) 바뀌어
  // 이 시나리오를 아예 쓸 수 없었다.
  it('itemId 로 정확히 그 행만 고친다 — 세션의 다른 행은 그대로다', async () => {
    const other = conflictItemFixture({ id: 'item-2', rowNumber: 5, rowKey: 'P-2' });
    const { manager, items } = writeHarness({
      session: SESSION_REVIEW,
      items: [conflictItemFixture(), other],
    });

    await manager.setConflictDecision('sess-1', 'item-1', 'u1', { 'product.brand': 'overwrite' });

    const untouched = items().find((row) => row.id === 'item-2');
    expect(untouched?.conflictDecision).toBeNull();
  });
});

describe('BulkSessionManager.approve', () => {
  it('미결정 충돌이 있으면 409 다 — 메시지에 미결정 건수와 행번호 미리보기가 들어간다', async () => {
    const { manager } = writeHarness({ session: SESSION_REVIEW, items: [conflictItemFixture()] });

    // conflictItemFixture() 는 rowNumber: 2 다 — Task 10 리뷰 #7: 건수만으로는 1,000행
    // 세션에서 그 행을 못 찾는다.
    await expect(manager.approve('sess-1', 'u1')).rejects.toThrow('1건 있습니다 (예: 2행)');
  });

  // Task 10 리뷰 #2 회귀 가드: invalid 행의 충돌은 4단계가 애초에 집지 않으므로 승인을
  // 막으면 안 된다. status:'pending' 필터가 빠지면 이 테스트가 (거꾸로) 409 로 실패한다.
  it('invalid 행의 미결정 충돌은 승인을 막지 않는다 — 그 행은 어차피 적용되지 않는다', async () => {
    const { manager } = writeHarness({
      session: SESSION_REVIEW,
      items: [conflictItemFixture({ status: 'invalid', errorMessage: '이미지키 오타' })],
      images: [],
    });

    const result = await manager.approve('sess-1', 'u1');

    expect(result.phase).toBe('drafting');
  });

  it('요구 이미지가 남아 있으면 awaiting_images 로 간다', async () => {
    const { manager } = writeHarness({
      session: SESSION_REVIEW,
      items: [imageRefItem()],
      images: [awaitingImage()],
    });

    const result = await manager.approve('sess-1', 'u1');

    expect(result.phase).toBe('awaiting_images');
  });

  // ─── 이미지 게이트는 **적용될 행이 참조하는 것만** 요구한다 ───
  //
  // `product_bulk_images` 행은 파싱 시점에 만들어진다 — 그때는 접합 오류만 알고 필드 검증
  // 결과는 모른다. 그래서 나중에 invalid 이 된 행이 참조하던 파일명 이미지가 그대로
  // `awaiting_upload` 로 남는다. 그것까지 세면 30행이 invalid 인 세션에서 작업자가 **절대
  // 쓰이지 않을 파일 30개**를 올려야 다음으로 넘어간다. 바로 위 미결정 충돌 게이트가
  // `status='pending'` 만 세는 것과 같은 이유·같은 필터다.
  it('invalid 행만 참조하는 이미지는 승인을 막지 않는다 — 그 파일은 절대 쓰이지 않는다', async () => {
    const { manager } = writeHarness({
      session: SESSION_REVIEW,
      items: [imageRefItem({ status: 'invalid', errorMessage: '판매가는 0보다 커야 합니다' })],
      images: [awaitingImage()],
    });

    const result = await manager.approve('sess-1', 'u1');

    expect(result.phase).toBe('drafting');
  });

  it('아무 pending 행도 참조하지 않는 고아 이미지는 승인을 막지 않는다', async () => {
    const { manager } = writeHarness({
      session: SESSION_REVIEW,
      // payload 에 imageRefs 가 아예 없는 평범한 행.
      items: [conflictItemFixture({ conflict: null, conflictDecision: null })],
      images: [awaitingImage()],
    });

    const result = await manager.approve('sess-1', 'u1');

    expect(result.phase).toBe('drafting');
  });

  it('용도(usage)까지 맞아야 기다린다 — 본문용 업로드가 대표용 참조를 막지 않는다', async () => {
    const { manager } = writeHarness({
      session: SESSION_REVIEW,
      // 이 행은 IMG-1 을 **대표**로만 쓴다.
      items: [imageRefItem()],
      // 아직 안 올라온 것은 같은 키의 **본문용** 행이다(다른 행이 참조했었다).
      images: [awaitingImage({ usage: 'description' })],
    });

    const result = await manager.approve('sess-1', 'u1');

    expect(result.phase).toBe('drafting');
  });

  it('pending 행이 실제로 참조하면 기다린다 — invalid 형제가 섞여 있어도 마찬가지다', async () => {
    const { manager } = writeHarness({
      session: SESSION_REVIEW,
      items: [imageRefItem({ id: 'item-2', status: 'invalid', errorMessage: '오타' }), imageRefItem()],
      images: [awaitingImage()],
    });

    const result = await manager.approve('sess-1', 'u1');

    expect(result.phase).toBe('awaiting_images');
  });

  it('요구 이미지가 없으면 drafting 으로 간다', async () => {
    const { manager } = writeHarness({
      session: SESSION_REVIEW,
      items: [conflictItemFixture({ conflict: null, conflictDecision: null })],
      images: [],
    });

    const result = await manager.approve('sess-1', 'u1');

    expect(result.phase).toBe('drafting');
  });

  // Task 10 리뷰 #3: 이 테스트는 harness 가 where() 를 무시하던 이전 버전으로는 작성이
  // 불가능했다 — status 필터 없이는 'resolved' 이미지도 그대로 반환돼 awaiting_images 로
  // (잘못) 갔을 것이다. 이제 rowMatchesCondition 이 실제로 `status = 'awaiting_upload'` 를
  // 걸러내므로, 이 케이스가 올바른 구현에서만 통과한다(status 필터를 지우면 빨간불이 된다).
  it('resolved 이미지만 있으면(awaiting_upload 없음) drafting 으로 간다', async () => {
    const { manager } = writeHarness({
      session: SESSION_REVIEW,
      items: [conflictItemFixture({ conflict: null, conflictDecision: null })],
      images: [{ id: 'img-1', sessionId: 'sess-1', status: 'resolved' }],
    });

    const result = await manager.approve('sess-1', 'u1');

    expect(result.phase).toBe('drafting');
  });

  it('review 가 아니면 409 다', async () => {
    const { manager } = writeHarness({ session: { ...SESSION_REVIEW, phase: 'validating' }, items: [] });

    await expect(manager.approve('sess-1', 'u1')).rejects.toBeInstanceOf(ConflictError);
  });

  // Task 10 리뷰 #4: SELECT 는 phase='review' 를 봤지만(위 가드를 통과) 그 사이 취소가
  // cancel_requested_at 을 이미 찍어둔 경우 — CAS(isNull(cancelRequestedAt))가 UPDATE 를
  // 0행으로 만들어야 한다. writeHarness 의 실제 조건 매칭이 없으면 이 테스트는 (잘못) 성공한다.
  it('SELECT 이후 취소가 끼어들면(CAS 불일치) 409 다', async () => {
    const { manager } = writeHarness({
      session: { ...SESSION_REVIEW, cancelRequestedAt: new Date() },
      items: [],
      images: [],
    });

    await expect(manager.approve('sess-1', 'u1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('남의 세션은 404 다', async () => {
    const { manager } = writeHarness({ session: { ...SESSION_REVIEW, uploadedBy: 'other' }, items: [] });

    await expect(manager.approve('sess-1', 'u1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('BulkSessionManager.cancel', () => {
  it('검증 중인 세션을 취소하면 cancel_requested_at 과 phase 가 함께(같은 UPDATE 로) 찍힌다', async () => {
    const { manager, sessionUpdates } = writeHarness({
      session: { ...SESSION_REVIEW, phase: 'validating' },
      items: [],
    });

    const result = await manager.cancel('sess-1', 'u1');

    expect(result.phase).toBe('canceled');
    expect(sessionUpdates).toHaveLength(1);
    expect(sessionUpdates[0]).toMatchObject({ phase: 'canceled' });
    expect(sessionUpdates[0].cancelRequestedAt).toBeInstanceOf(Date);
  });

  // v3 는 굳은 세션이 취소도 409 를 받아 영영 못 풀렸다(스펙 §3.2) — 회귀 가드.
  it('failed 세션도 취소할 수 있다', async () => {
    const { manager } = writeHarness({ session: { ...SESSION_REVIEW, phase: 'failed' }, items: [] });

    const result = await manager.cancel('sess-1', 'u1');

    expect(result.phase).toBe('canceled');
  });

  // Task 9: 취소는 이 세션이 잠근 draft 의 잠금을 푼다(draft 자체는 남긴다). CAS 성공 뒤
  // 같은 트랜잭션의 두 번째 UPDATE 로 나가야 한다.
  it('취소는 이 세션이 잠근 draft 의 bulk_session_id 를 NULL 로 되돌린다', async () => {
    const { manager, versionUpdates, versions } = writeHarness({
      session: { ...SESSION_REVIEW, phase: 'validating' },
      items: [],
      versions: [{ id: 'v-1', masterId: 'm-1', bulkSessionId: 'sess-1', draftOwnerId: 'u1' }],
    });

    await manager.cancel('sess-1', 'u1');

    expect(versionUpdates).toHaveLength(1);
    expect(versionUpdates[0]).toEqual(expect.objectContaining({ bulkSessionId: null }));
    expect(versions()[0].bulkSessionId).toBeNull();
  });

  // 취소 CAS 가 0행이면(그 사이 다른 탭이 발행을 끝냈으면) 잠금 UPDATE 는 나가면 안 된다 —
  // 발행된 세션의 draft 잠금을 푸는 것은 명백히 틀렸다. raceSessionPhaseTo 로 "가드는
  // 통과했지만 CAS 직전에 phase 가 published 로 바뀌었다"를 흉내낸다.
  it('취소 CAS 가 0행이면 잠금을 풀지 않는다', async () => {
    const { manager, versionUpdates } = writeHarness({
      session: { ...SESSION_REVIEW, phase: 'validating' },
      items: [],
      versions: [{ id: 'v-1', masterId: 'm-1', bulkSessionId: 'sess-1', draftOwnerId: 'u1' }],
      raceSessionPhaseTo: 'published',
    });

    await expect(manager.cancel('sess-1', 'u1')).rejects.toBeInstanceOf(ConflictError);
    expect(versionUpdates).toHaveLength(0);
  });

  it('published 는 409 다 — 초기 가드에서 걸리며, 이 경로에서도 잠금 UPDATE 는 나가지 않는다', async () => {
    const { manager, versionUpdates } = writeHarness({
      session: { ...SESSION_REVIEW, phase: 'published' },
      items: [],
      versions: [{ id: 'v-1', masterId: 'm-1', bulkSessionId: 'sess-1', draftOwnerId: 'u1' }],
    });

    await expect(manager.cancel('sess-1', 'u1')).rejects.toBeInstanceOf(ConflictError);
    expect(versionUpdates).toHaveLength(0);
  });

  it('이미 canceled 인 세션도 409 다', async () => {
    const { manager } = writeHarness({ session: { ...SESSION_REVIEW, phase: 'canceled' }, items: [] });

    await expect(manager.cancel('sess-1', 'u1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('남의 세션은 404 다', async () => {
    const { manager } = writeHarness({ session: { ...SESSION_REVIEW, uploadedBy: 'other' }, items: [] });

    await expect(manager.cancel('sess-1', 'u1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('BulkSessionManager.queuePublish', () => {
  it('drafted 세션의 미발행 행을 pending 으로 돌리고 publishing 으로 민다', async () => {
    const { manager, session, items } = writeHarness({
      session: { ...SESSION_REVIEW, phase: 'drafted' },
      items: [
        conflictItemFixture({
          id: 'item-1',
          status: 'drafted',
          publishStatus: 'idle',
          conflict: null,
          conflictDecision: null,
        }),
      ],
    });

    await manager.queuePublish('sess-1', 'u1');

    expect(items()[0]).toMatchObject({ publishStatus: 'pending', publishError: null });
    expect(session().phase).toBe('publishing');
  });

  it('published 세션에서는 실패 행만 다시 pending 으로 돌린다', async () => {
    const { manager, items } = writeHarness({
      session: { ...SESSION_REVIEW, phase: 'published' },
      items: [
        conflictItemFixture({
          id: 'item-1',
          status: 'drafted',
          publishStatus: 'published',
          conflict: null,
          conflictDecision: null,
        }),
        conflictItemFixture({
          id: 'item-2',
          status: 'drafted',
          publishStatus: 'failed',
          conflict: null,
          conflictDecision: null,
        }),
      ],
    });

    await manager.queuePublish('sess-1', 'u1');

    // 이미 발행된 행은 건드리지 않는다 — 재호출 멱등성이 여기 걸려 있다.
    expect(items().find((row) => row.id === 'item-1')?.publishStatus).toBe('published');
    expect(items().find((row) => row.id === 'item-2')?.publishStatus).toBe('pending');
  });

  it('발행할 행이 하나도 없으면 409 다', async () => {
    const { manager } = writeHarness({
      session: { ...SESSION_REVIEW, phase: 'published' },
      items: [
        conflictItemFixture({
          id: 'item-1',
          status: 'drafted',
          publishStatus: 'published',
          conflict: null,
          conflictDecision: null,
        }),
      ],
    });

    await expect(manager.queuePublish('sess-1', 'u1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('drafting 중인 세션은 발행할 수 없다', async () => {
    const { manager } = writeHarness({ session: { ...SESSION_REVIEW, phase: 'drafting' }, items: [] });

    await expect(manager.queuePublish('sess-1', 'u1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('남의 세션은 404 다', async () => {
    const { manager } = writeHarness({
      session: { ...SESSION_REVIEW, phase: 'drafted', uploadedBy: 'other' },
      items: [],
    });

    await expect(manager.queuePublish('sess-1', 'u1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('BulkSessionManager.retryDraft', () => {
  it('draft 생성 실패 행만 pending 으로 돌리고 drafting 으로 민다', async () => {
    const { manager, session, items } = writeHarness({
      session: { ...SESSION_REVIEW, phase: 'drafted' },
      items: [
        conflictItemFixture({
          id: 'item-1',
          status: 'failed',
          errorMessage: '무언가 실패',
          conflict: null,
          conflictDecision: null,
        }),
        conflictItemFixture({ id: 'item-2', status: 'drafted', conflict: null, conflictDecision: null }),
      ],
    });

    await manager.retryDraft('sess-1', 'u1');

    expect(items().find((row) => row.id === 'item-1')).toMatchObject({ status: 'pending', errorMessage: null });
    expect(items().find((row) => row.id === 'item-2')?.status).toBe('drafted');
    expect(session().phase).toBe('drafting');
  });
});

// ─── excludeItem ───
//
// 발행 대상에서 행을 빼고 그 draft 의 세션 잠금을 푼다(스펙 §10.5) — cancel() 이 세션 전체에
// 대해 하는 일(Task 9)을 행 하나에 대해 하는 것이라 같은 규약을 쓴다. `bulk-session-job.
// manager.ts` 의 `publishOne` 이 같은 세션 행을 `FOR UPDATE` 로 잠그고 이어 행 상태
// (`status='drafted' ∧ publishStatus='pending'`)를 재확인하므로, 이 메서드도 같은 세션 행을
// **트랜잭션 첫 문장**으로 잠가야 둘이 직렬화된다 — 그러지 않으면 제외가 잠금을 푸는 사이
// 발행이 커밋되는 창이 열린다.
describe('BulkSessionManager.excludeItem', () => {
  it('제외한 행의 draft 잠금을 푼다', async () => {
    const { manager, items, versions } = writeHarness({
      session: { id: 'sess-1', uploadedBy: 'u1', phase: 'drafted' },
      items: [
        conflictItemFixture({
          id: 'item-1',
          status: 'drafted',
          draftVersionId: 'v-1',
          publishStatus: 'idle',
          conflict: null,
          conflictDecision: null,
        }),
      ],
      versions: [{ id: 'v-1', masterId: 'm-1', bulkSessionId: 'sess-1', draftOwnerId: 'u1' }],
    });

    await manager.excludeItem('sess-1', 'item-1', 'u1');

    expect(items()[0].status).toBe('excluded');
    expect(versions()[0].bulkSessionId).toBeNull();
  });

  // 발행 레인의 publishOne 과 같은 행을 두고 경합한다 — 둘 다 같은 세션 행을 잠가야
  // 직렬화된다. 잠그지 않으면 "제외했는데 발행됨"이 열린다. 이 테스트는 잠갔는지가 아니라
  // **트랜잭션의 첫 문장인지**를 단정한다 — 잠금이 뒤로 밀리면(예: item 조회 뒤) 경쟁의
  // 창이 그대로 남기 때문이다.
  it('트랜잭션 첫 문장은 세션 행 FOR UPDATE 잠금이다', async () => {
    const { manager, calls } = writeHarness({
      session: { id: 'sess-1', uploadedBy: 'u1', phase: 'drafted' },
      items: [
        conflictItemFixture({
          id: 'item-1',
          status: 'drafted',
          draftVersionId: 'v-1',
          conflict: null,
          conflictDecision: null,
        }),
      ],
      versions: [{ id: 'v-1', masterId: 'm-1', bulkSessionId: 'sess-1', draftOwnerId: 'u1' }],
    });

    await manager.excludeItem('sess-1', 'item-1', 'u1');

    expect(calls[0]).toEqual({ kind: 'select-for-update', table: 'product_bulk_sessions' });
  });

  // draft 생성 슬라이스가 아직 처리하지 않은 행(payload 검증만 끝나고 draftVersionId 가
  // 없는 pending-이었던 행은 애초에 status 가 'drafted'/'failed' 가 아니라 여기 안 온다 —
  // 다만 'failed'(draft 생성 자체가 실패한 행)는 draftVersionId 가 null 인 채로 제외
  // 대상이다. 잠글 draft 가 없으니 잠금 해제 UPDATE 만 건너뛰어야지, 행 자체를 못 뺀다고
  // 착각하면 안 된다.
  it('draft 생성이 실패해 draftVersionId 가 없는 행도 제외된다 — 잠금 해제만 건너뛴다', async () => {
    const { manager, items, versionUpdates } = writeHarness({
      session: { id: 'sess-1', uploadedBy: 'u1', phase: 'drafted' },
      items: [
        conflictItemFixture({
          id: 'item-1',
          status: 'failed',
          draftVersionId: null,
          publishStatus: 'idle',
          conflict: null,
          conflictDecision: null,
        }),
      ],
    });

    await manager.excludeItem('sess-1', 'item-1', 'u1');

    expect(items()[0].status).toBe('excluded');
    expect(versionUpdates).toHaveLength(0);
  });

  it('이미 발행된 행은 제외할 수 없다', async () => {
    const { manager } = writeHarness({
      session: { id: 'sess-1', uploadedBy: 'u1', phase: 'published' },
      items: [
        conflictItemFixture({
          id: 'item-1',
          status: 'drafted',
          publishStatus: 'published',
          draftVersionId: 'v-1',
          conflict: null,
          conflictDecision: null,
        }),
      ],
      versions: [{ id: 'v-1', masterId: 'm-1', bulkSessionId: null, draftOwnerId: 'u1' }],
    });

    await expect(manager.excludeItem('sess-1', 'item-1', 'u1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('drafted·published 가 아닌 phase 에서는 제외할 수 없다', async () => {
    const { manager } = writeHarness({
      session: { id: 'sess-1', uploadedBy: 'u1', phase: 'review' },
      items: [conflictItemFixture({ id: 'item-1', status: 'pending' })],
    });

    await expect(manager.excludeItem('sess-1', 'item-1', 'u1')).rejects.toBeInstanceOf(ConflictError);
  });
});

// ─── purgeDrafts ───
//
// Task 6: 취소된 세션이 남긴 draft 를 명시적으로 지운다(스펙 §3.12). 취소(cancel) 는 draft
// 잠금만 풀고 draft 자체는 남긴다 — 이 메서드가 그 나머지를 사람이 판단해 실행하는 관리자
// 동작이다. writeHarness 가 새로 노출하는 `deleteDraftVersion`/`deleteMaster` 는 주입한
// ProductVersionsService/ProductMastersService 페이크의 jest.fn 이고, `itemRows` 는 처리
// 대상이 아닌 행이 건드려지지 않았는지 그 자리에서 바로 읽기 위한 원본 배열 참조다.
describe('BulkSessionManager.purgeDrafts', () => {
  it('취소된 세션에서만 열린다', async () => {
    const { manager } = writeHarness({ session: { id: 'S1', uploadedBy: 'U1', phase: 'drafted' }, items: [] });
    await expect(manager.purgeDrafts('S1', 'U1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('수정 행은 draft 만 지운다', async () => {
    const { manager, deleteDraftVersion, deleteMaster } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'canceled' },
      items: [{ id: 'I1', kind: 'update', masterId: 'M1', draftVersionId: 'V1', publishStatus: 'idle' }],
    });
    await manager.purgeDrafts('S1', 'U1');
    expect(deleteDraftVersion).toHaveBeenCalledWith('V1', expect.anything());
    expect(deleteMaster).not.toHaveBeenCalled();
  });

  it('신규 행은 master 까지 지운다 — draft 만 지우면 빈 껍데기가 남는다', async () => {
    const { manager, deleteDraftVersion, deleteMaster } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'canceled' },
      items: [{ id: 'I1', kind: 'create', masterId: 'M1', draftVersionId: 'V1', publishStatus: 'idle' }],
    });
    await manager.purgeDrafts('S1', 'U1');
    expect(deleteDraftVersion).toHaveBeenCalledWith('V1', expect.anything());
    expect(deleteMaster).toHaveBeenCalledWith('M1', 'U1', expect.anything());
  });

  it('한 번이라도 발행된 행은 건드리지 않는다', async () => {
    const { manager, deleteDraftVersion, itemRows } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'canceled' },
      items: [{ id: 'I1', kind: 'update', draftVersionId: 'V1', publishStatus: 'published' }],
    });
    const result = await manager.purgeDrafts('S1', 'U1');
    expect(deleteDraftVersion).not.toHaveBeenCalled();
    expect(itemRows[0].draftVersionId).toBe('V1');
    expect(result).toEqual({ purged: 0, failed: 0, remaining: 0 });
  });

  it('한 행이 실패해도 나머지는 지우고 failed 로 센다', async () => {
    const { manager, deleteDraftVersion } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'canceled' },
      items: [
        { id: 'I1', kind: 'update', draftVersionId: 'V1', publishStatus: 'idle' },
        { id: 'I2', kind: 'update', draftVersionId: 'V2', publishStatus: 'idle' },
      ],
    });
    deleteDraftVersion.mockRejectedValueOnce(new Error('boom'));
    const result = await manager.purgeDrafts('S1', 'U1');
    expect(result.purged).toBe(1);
    expect(result.failed).toBe(1);
  });

  // 리뷰 발견 1 픽스: 실패한 행은 draftVersionId 를 남기므로 재집계에 다시 잡혀야 한다.
  // 2행 중 1행만 실패하면 remaining 은 정확히 1이어야 한다 — writeHarness 의 select 페이크가
  // `{ value: count() }` 를 실제로 흉내내지 못하면(원시 행을 그대로 돌려주면) 이 값이 늘
  // 0이 되어 이 단정이 거짓 초록을 낸다(리뷰가 지적한 바로 그 결함).
  it('실패한 행은 remaining 재집계에 다시 잡힌다', async () => {
    const { manager, deleteDraftVersion } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'canceled' },
      items: [
        { id: 'I1', kind: 'update', draftVersionId: 'V1', publishStatus: 'idle' },
        { id: 'I2', kind: 'update', draftVersionId: 'V2', publishStatus: 'idle' },
      ],
    });
    deleteDraftVersion.mockRejectedValueOnce(new Error('boom'));
    const result = await manager.purgeDrafts('S1', 'U1');
    expect(result).toEqual({ purged: 1, failed: 1, remaining: 1 });
  });

  // 리뷰 발견 3 픽스: "실패 → 다음 호출에서 성공"이 이 메서드의 정상 흐름이다. 첫 실패가
  // 남긴 errorMessage 를 성공 UPDATE 가 지우지 않으면, 이미 정리가 끝난 행이 옛 오류 문구를
  // 영구히 달고 있는다.
  it('실패 후 재호출로 성공하면 옛 errorMessage 가 지워진다', async () => {
    // `itemRows` (writeHarness 상단 문서 참조)는 초기 배열에 대한 **정적** 참조라, 이
    // 케이스처럼 행이 실제로 UPDATE 되면(`items = next` 로 재할당) 갱신을 못 본다 —
    // 반드시 `items()` 게터를 써야 한다(4번째 테스트의 "안 건드려짐" 단정과는 다른 경우다).
    const { manager, deleteDraftVersion, items } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'canceled' },
      items: [
        { id: 'I1', kind: 'update', draftVersionId: 'V1', publishStatus: 'idle', errorMessage: '이전 정리 실패 문구' },
      ],
    });
    deleteDraftVersion.mockResolvedValueOnce(undefined);

    await manager.purgeDrafts('S1', 'U1');

    expect(items()[0].errorMessage).toBeNull();
  });

  // 최종 리뷰 발견 ①: targetFilter 가 draftVersionId·publishStatus 만 보고 status 를 안 봐서
  // excludeItem 이 남긴 status='excluded' 행(작업자에게 넘긴 개인 draft)까지 정리 대상으로
  // 잡았다 — 세션 취소 후 purge-drafts 를 부르면 그 draft 가 하드 삭제되는 데이터 손실이었다.
  it('제외된 행은 정리 대상이 아니다 — draft 를 지우지 않고 remaining 에도 잡히지 않는다', async () => {
    const { manager, deleteDraftVersion, itemRows } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'canceled' },
      items: [{ id: 'I1', kind: 'update', status: 'excluded', draftVersionId: 'V1', publishStatus: 'idle' }],
    });
    const result = await manager.purgeDrafts('S1', 'U1');
    expect(deleteDraftVersion).not.toHaveBeenCalled();
    expect(itemRows[0].draftVersionId).toBe('V1');
    expect(result).toEqual({ purged: 0, failed: 0, remaining: 0 });
  });

  it('제외된 행과 함께 있어도 나머지 정리 대상 행은 정상 처리된다', async () => {
    const { manager, deleteDraftVersion, items } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'canceled' },
      items: [
        { id: 'I1', kind: 'update', status: 'excluded', draftVersionId: 'V1', publishStatus: 'idle' },
        { id: 'I2', kind: 'update', draftVersionId: 'V2', publishStatus: 'idle' },
      ],
    });
    const result = await manager.purgeDrafts('S1', 'U1');
    expect(deleteDraftVersion).toHaveBeenCalledTimes(1);
    expect(deleteDraftVersion).toHaveBeenCalledWith('V2', expect.anything());
    expect(items().find((row) => row.id === 'I1')?.draftVersionId).toBe('V1');
    expect(result).toEqual({ purged: 1, failed: 0, remaining: 0 });
  });
});
