# warehouse-app 한진 운송장 인쇄 배선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 창고 스테이션 PC 의 warehouse-app 이 core 의 한진 운송장 ZPL 을 PC 별로 설정된 라벨 프린터로 배치 일괄·건별 재출력한다.

**Architecture:** 순수 로직(프린터 설정 저장·`print_raw` 래퍼·409 접두어 파싱·배치 오케스트레이터)을 두 모듈에 두고, 얇은 컴포넌트 셋(설정 절·배치 버튼·재출력 버튼)이 그걸 부른다. 스테이션 판정은 라우트에서 한 번 하고 화면엔 `labelPrinting` 불리언 prop 으로 내린다. core·Rust 변경 없음.

**Tech Stack:** React 19 · TanStack Router/Query · Tauri 2 (`@tauri-apps/api/core` `invoke`) · vitest + @testing-library/react · TypeScript(`erasableSyntaxOnly` — 매개변수 프로퍼티·enum 금지)

**Spec:** `docs/superpowers/specs/2026-09-27-warehouse-app-waybill-label-print-design.md`

## Global Constraints

- 모든 명령은 `native/warehouse-app` 에서 돈다. 루트 게이트(`npm run type-check`·루트 jest)는 이 앱을 보지 않는다.
- 판정 기준(기준선 2026-09-27 develop): `npx vitest run` 전부 통과(기준 92 files / 704 tests) · `npx tsc -b` 에러 0 · `npx oxlint` exit 0 이고 **새 파일에서 경고 0** (기존 경고 22건은 손대지 않는다).
- core·`src-tauri` 는 수정하지 않는다.
- prefs 키는 기존 관례(`almondwms.warehouse`, `almondwms.outbound.lastBox`)를 따라 `almondwms.labelPrinter`(프린터 target)와 `almondwms.labelPrinter.batch.<batchId>`(이 기기의 마지막 배치 인쇄 시각, ISO)를 쓴다. 스펙 §3 의 `labelPrinter.target` 은 이 이름으로 대체한다.
- 저장값 형식은 `spooler://<Windows 프린터 이름>`.
- 라벨 API: `GET /shipments/:shipmentId/waybill/label` → `{ waybillId, trackingNo, format, data }`. **`format` 은 검사하지 않는다** — `data` 를 그대로 보낸다.
- 배치 대상: `GET /outbound-batches/:batchId/work-items` 에서 `status` 가 `completed`·`excluded` 가 아닌 항목의 `shipmentId`, 서버 순서 유지.
- 409 사유는 `ConflictError.message` 의 `^(WAYBILL_[A-Z_]+):` 접두어로 판별한다 (응답 `code` 는 전부 `CONFLICT`).
- 현장 문구(스펙 §4.2 표 그대로):
  - `WAYBILL_NOT_DISPATCHABLE` → `한진 등록이 끝나지 않은 송장이에요. 관리자에게 운송장 발급 상태를 확인해 달라고 해 주세요.`
  - `WAYBILL_STALE` → `주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요.`
  - `WAYBILL_LABEL_UNAVAILABLE` → `이 송장은 앱에서 인쇄할 수 없어요(수기 등록 또는 한진 외 택배사).`
  - 그 밖의 409 → `송장 상태가 바뀌었어요. 관리자에게 문의해 주세요.`
  - 404 → `출고 정보를 찾을 수 없어요.`
  - 5xx·빈 라벨 → `라벨을 만들지 못했어요(서버 문제). 관리자에게 알려 주세요.`
  - 프린터 실패 → `프린터로 보내지 못했어요. 전원·연결과 설정의 프린터 이름을 확인해 주세요.` (원문은 작은 글씨로 함께)
  - 프린터 미설정 → `이 PC 에 라벨 프린터가 설정되지 않았어요. 설정에서 지정해 주세요.`
- API 거절은 건 단위(건너뛰고 계속), 프린터 실패는 실행 단위(즉시 중단). 자동 재시도 없음.
- 설정·인쇄 UI 는 스테이션(Windows) 프로필에서만 보인다.
- 커밋 메시지 끝에 빈 줄 + `Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS`.

### 스펙과 의도적으로 다른 점

- prefs 키 이름 — 위 「prefs 키」 줄.
- `LabelPrinterSettings` 는 `domains/outbound/` 가 아니라 `core/hardware/print/` 에 둔다 — 출고 도메인을 모르는 하드웨어 설정이다.
- 스펙 §4.2 의 `useFetchWaybillLabel()` 훅 대신 `fetchWaybillLabel(api, shipmentId)` 평함수 — 캐시하지 않으므로 훅일 이유가 없고, 컴포넌트는 `useApiClient()` 로 받은 `api` 를 넘긴다.
- 배치 결과의 실패 목록은 건별이 아니라 **사유별 건수**로 보인다 — 실패 건은 운송장번호를 모르고(조회가 실패했다) shipmentId 는 현장이 읽을 값이 아니다.

## Review Focus

1. **버튼 연타** — 「라벨 인쇄」·「라벨 재출력」을 빠르게 두 번 누르면 실행은 한 번이어야 한다(같은 번호 라벨 두 장). → Task 4·5 테스트
2. **서버가 빈 `data` 를 준다** — `print_raw` 가 `nothing to print` 로 실패해 «프린터 오류»로 오인되면 배치 전체가 멈춘다. 빈 라벨은 그 건만 서버 문제로 건너뛴다. → Task 2 테스트
3. **이름에 `spooler://` 를 붙여 넣거나 앞뒤 공백** — `spooler://spooler://…` 나 공백 포함 이름으로 저장되면 인쇄가 전부 실패한다. → Task 1 테스트
4. **work-items 조회 실패** — 확인창을 띄우지 않고 안내만 하며, 인쇄 기록도 남기지 않는다. → Task 5 테스트
5. **전부 거절돼 0장 인쇄** — 이 기기 인쇄 기록을 남기면 다음 확인창이 「이미 인쇄했어요」라고 거짓말한다. 1장 이상 찍혔을 때만 기록한다. → Task 5 테스트

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `src/core/hardware/print/labelPrinter.ts` (신규) | 프린터 target 저장·읽기, `printRaw` (`invoke('print_raw')` 래퍼), `PrinterError`, 프린터 관련 문구 상수 |
| `src/core/hardware/print/LabelPrinterSettings.tsx` (신규) | 설정 화면의 「라벨 프린터」 절 |
| `src/domains/outbound/waybillLabel.ts` (신규) | 라벨·work-items API 호출, 409 접두어 파싱, 현장 문구, `printOneLabel`, `runBatchLabelPrint`, 배치 인쇄 기록 |
| `src/domains/outbound/ReprintLabelButton.tsx` (신규) | 박스 화면의 한 장 재출력 |
| `src/domains/outbound/BatchLabelPrintButton.tsx` (신규) | 배치 행의 일괄 인쇄 (확인 → 진행 → 요약 → 재시도) |
| `src/app/station.ts` (신규) | `isStationDevice()` — 스테이션 판정 한 곳 |
| `src/profiles/shared/DiagnosticsScreen.tsx` (수정) | 테스트 인쇄가 `printRaw` 를 쓰게 |
| `src/app/routes/SettingsRoute.tsx` (수정) | 스테이션이면 `LabelPrinterSettings` |
| `src/domains/outbound/SimpleOutboundScreen.tsx`·`LocationOutboundScreen.tsx` (수정) | `labelPrinting` prop → `ReprintLabelButton` |
| `src/app/routes/SimpleOutboundRoute.tsx` (수정) | `labelPrinting={isStationDevice()}` |
| `src/domains/outbound/OutboundQueueScreen.tsx` (수정) | `labelPrinting` prop → 배치 행마다 `BatchLabelPrintButton` |
| `src/app/routes/OutboundRoute.tsx` (수정) | `labelPrinting={isStationDevice()}` |

---

### Task 1: 프린터 설정 저장과 `printRaw`

**Files:**
- Create: `native/warehouse-app/src/core/hardware/print/labelPrinter.ts`
- Test: `native/warehouse-app/src/core/hardware/print/labelPrinter.test.ts`
- Modify: `native/warehouse-app/src/profiles/shared/DiagnosticsScreen.tsx`

**Interfaces:**
- Consumes: `DevicePrefs`, `createMemoryPrefs` (`src/core/data/devicePrefs.ts`), `invoke` (`@tauri-apps/api/core`)
- Produces:
  - `LABEL_PRINTER_KEY = 'almondwms.labelPrinter'`
  - `readLabelPrinter(prefs: DevicePrefs): string | null`
  - `writeLabelPrinter(prefs: DevicePrefs, name: string): void`
  - `printerNameOf(target: string): string`
  - `class PrinterError extends Error { readonly detail: string }`
  - `type PrintRaw = (target: string, text: string) => Promise<void>`
  - `printRaw: PrintRaw`
  - `NO_PRINTER_MESSAGE: string`, `PRINTER_FAILURE_MESSAGE: string`

- [ ] **Step 1: 실패하는 테스트 작성**

`native/warehouse-app/src/core/hardware/print/labelPrinter.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryPrefs } from '../../data/devicePrefs';
import {
  LABEL_PRINTER_KEY,
  PrinterError,
  printRaw,
  printerNameOf,
  readLabelPrinter,
  writeLabelPrinter,
} from './labelPrinter';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

describe('라벨 프린터 설정', () => {
  it('이름을 spooler:// target 으로 저장하고 되읽는다', () => {
    const prefs = createMemoryPrefs();
    writeLabelPrinter(prefs, 'XP-DT108B');
    expect(prefs.get(LABEL_PRINTER_KEY)).toBe('spooler://XP-DT108B');
    expect(readLabelPrinter(prefs)).toBe('spooler://XP-DT108B');
  });

  it('앞뒤 공백을 지운다', () => {
    const prefs = createMemoryPrefs();
    writeLabelPrinter(prefs, '  XP-DT108B  ');
    expect(readLabelPrinter(prefs)).toBe('spooler://XP-DT108B');
  });

  it('이미 spooler:// 를 붙여 넣어도 접두어를 겹치지 않는다', () => {
    const prefs = createMemoryPrefs();
    writeLabelPrinter(prefs, ' spooler://XP-DT108B ');
    expect(readLabelPrinter(prefs)).toBe('spooler://XP-DT108B');
  });

  it('빈 이름이면 설정을 지운다', () => {
    const prefs = createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://OLD' });
    writeLabelPrinter(prefs, '   ');
    expect(readLabelPrinter(prefs)).toBeNull();
  });

  it('설정이 없으면 null', () => {
    expect(readLabelPrinter(createMemoryPrefs())).toBeNull();
  });

  it('printerNameOf 는 입력칸에 되돌릴 이름만 준다', () => {
    expect(printerNameOf('spooler://XP-DT108B')).toBe('XP-DT108B');
    expect(printerNameOf('')).toBe('');
  });
});

describe('printRaw', () => {
  beforeEach(() => invokeMock.mockReset());

  it('텍스트를 바이트 배열로 print_raw 에 넘긴다', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await printRaw('spooler://XP', '^XA');
    expect(invokeMock).toHaveBeenCalledWith('print_raw', {
      target: 'spooler://XP',
      data: [94, 88, 65],
    });
  });

  it('invoke 실패는 원문을 보존한 PrinterError 로 감싼다', async () => {
    invokeMock.mockRejectedValueOnce('OpenPrinterW failed: 1801');
    const error = await printRaw('spooler://XP', '^XA').catch((e) => e);
    expect(error).toBeInstanceOf(PrinterError);
    expect((error as PrinterError).detail).toBe('OpenPrinterW failed: 1801');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd native/warehouse-app && npx vitest run src/core/hardware/print/labelPrinter.test.ts`
Expected: FAIL — `Failed to resolve import "./labelPrinter"`

- [ ] **Step 3: 구현**

`native/warehouse-app/src/core/hardware/print/labelPrinter.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import type { DevicePrefs } from '../../data/devicePrefs';

/**
 * 이 PC 의 라벨 프린터 설정과 원시 인쇄(#913). 창고 XP-DT108B 는 USB 로 PC 에 물려 있어
 * Windows 스풀러 이름만 받는다 — `print_raw` 는 `tcp://` 도 알지만 설정 UI 는 만들지 않았다.
 * 바이트는 core 가 다 만들어 준다: 여기서는 언어(ZPL/TSPL)를 모른 채 그대로 넘긴다.
 */
export const LABEL_PRINTER_KEY = 'almondwms.labelPrinter';
const SPOOLER = 'spooler://';

export const NO_PRINTER_MESSAGE =
  '이 PC 에 라벨 프린터가 설정되지 않았어요. 설정에서 지정해 주세요.';
export const PRINTER_FAILURE_MESSAGE =
  '프린터로 보내지 못했어요. 전원·연결과 설정의 프린터 이름을 확인해 주세요.';

export function readLabelPrinter(prefs: DevicePrefs): string | null {
  const target = prefs.get(LABEL_PRINTER_KEY);
  return target ? target : null;
}

export function writeLabelPrinter(prefs: DevicePrefs, name: string): void {
  // 붙여 넣은 `spooler://` 를 벗겨야 접두어가 겹치지 않는다 — 겹치면 인쇄가 전부 실패한다.
  const bare = printerNameOf(name.trim()).trim();
  if (!bare) prefs.remove(LABEL_PRINTER_KEY);
  else prefs.set(LABEL_PRINTER_KEY, `${SPOOLER}${bare}`);
}

export function printerNameOf(target: string): string {
  return target.startsWith(SPOOLER) ? target.slice(SPOOLER.length) : target;
}

/** 프린터까지 못 간 실패. API 거절과 구별해야 배치가 «건너뛰기» 대신 «중단» 한다. */
export class PrinterError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`printer: ${detail}`);
    this.name = 'PrinterError';
    this.detail = detail;
  }
}

export type PrintRaw = (target: string, text: string) => Promise<void>;

export const printRaw: PrintRaw = async (target, text) => {
  try {
    await invoke('print_raw', {
      target,
      data: Array.from(new TextEncoder().encode(text)),
    });
  } catch (error) {
    throw new PrinterError(String(error));
  }
};
```

- [ ] **Step 4: 통과 확인**

Run: `cd native/warehouse-app && npx vitest run src/core/hardware/print/labelPrinter.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 진단 화면을 같은 배관으로**

`native/warehouse-app/src/profiles/shared/DiagnosticsScreen.tsx` 에서 `import { invoke } from '@tauri-apps/api/core';` 줄을 지우고 `import { printRaw } from '../../core/hardware/print/labelPrinter';` 를 추가한다. 테스트 인쇄 버튼의 `try` 블록을 바꾼다:

```tsx
            try {
              await printRaw(target, zpl);
              setStatus('printed');
            } catch (e) {
              setStatus(`print error: ${e}`);
            }
```

- [ ] **Step 6: 진단 화면 테스트·타입 확인**

Run: `cd native/warehouse-app && npx vitest run src/profiles/shared && npx tsc -b`
Expected: PASS, tsc 출력 없음

- [ ] **Step 7: 커밋**

```bash
git add native/warehouse-app/src/core/hardware/print/labelPrinter.ts native/warehouse-app/src/core/hardware/print/labelPrinter.test.ts native/warehouse-app/src/profiles/shared/DiagnosticsScreen.tsx
git commit -m "feat(warehouse-app): 라벨 프린터 설정 저장과 printRaw 래퍼 (#913)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 2: 라벨 API·409 문구·배치 오케스트레이터

**Files:**
- Create: `native/warehouse-app/src/domains/outbound/waybillLabel.ts`
- Test: `native/warehouse-app/src/domains/outbound/waybillLabel.test.ts`

**Interfaces:**
- Consumes (Task 1): `PrinterError`, `PrintRaw`, `PRINTER_FAILURE_MESSAGE`; 기존 `ApiClient`·`ApiError`·`ConflictError` (`src/core/data/httpClient.ts` — `new ConflictError(message, code?)`, `new ApiError(message, status, code?)`), `errorMessage` (`src/core/data/errorMessage.ts`), `DevicePrefs`
- Produces:
  - `interface WaybillLabel { waybillId: string; trackingNo: string; format: string; data: string }`
  - `interface BatchWorkItem { id: string; shipmentId: string; status: string }`
  - `fetchWaybillLabel(api: ApiClient, shipmentId: string): Promise<WaybillLabel>`
  - `fetchBatchWorkItems(api: ApiClient, batchId: string): Promise<BatchWorkItem[]>`
  - `printableShipmentIds(items: BatchWorkItem[]): string[]`
  - `waybillConflictCode(error: unknown): string | undefined`
  - `labelErrorMessage(error: unknown): string`
  - `class EmptyLabelError extends Error`
  - `type LabelPrintDeps = { fetchLabel: (shipmentId: string) => Promise<WaybillLabel>; print: PrintRaw; target: string }`
  - `printOneLabel(deps: LabelPrintDeps, shipmentId: string): Promise<WaybillLabel>`
  - `interface BatchPrintResult { printed: string[]; skipped: { shipmentId: string; message: string }[]; notAttempted: string[]; printerError?: string }`
  - `runBatchLabelPrint(o: LabelPrintDeps & { shipmentIds: string[]; onProgress?: (done: number, total: number) => void }): Promise<BatchPrintResult>`
  - `retryTargets(result: BatchPrintResult): string[]`
  - `readBatchPrintedAt(prefs: DevicePrefs, batchId: string): string | null`
  - `writeBatchPrintedAt(prefs: DevicePrefs, batchId: string, iso: string): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`native/warehouse-app/src/domains/outbound/waybillLabel.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ApiError, ConflictError } from '../../core/data/httpClient';
import type { ApiClient } from '../../core/data/httpClient';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { PrinterError } from '../../core/hardware/print/labelPrinter';
import {
  EmptyLabelError,
  fetchBatchWorkItems,
  fetchWaybillLabel,
  labelErrorMessage,
  printOneLabel,
  printableShipmentIds,
  readBatchPrintedAt,
  retryTargets,
  runBatchLabelPrint,
  waybillConflictCode,
  writeBatchPrintedAt,
  type WaybillLabel,
} from './waybillLabel';

// core 가 실제로 내는 메시지 모양(waybill.manager.ts · waybill-label.manager.ts). 접두어가 계약이다.
const NOT_DISPATCHABLE = new ConflictError(
  'WAYBILL_NOT_DISPATCHABLE: shipment s1 needs one registered waybill',
  'CONFLICT'
);
const STALE = new ConflictError(
  'WAYBILL_STALE: waybill w1 manifest/recipient changed between guard and assembly',
  'CONFLICT'
);
const UNAVAILABLE = new ConflictError(
  'WAYBILL_LABEL_UNAVAILABLE: manual waybill w1 has no carrier label data',
  'CONFLICT'
);

const label = (shipmentId: string): WaybillLabel => ({
  waybillId: `w-${shipmentId}`,
  trackingNo: `T-${shipmentId}`,
  format: 'zpl',
  data: `^XA${shipmentId}^XZ`,
});

describe('API 호출', () => {
  it('라벨과 work-items 경로', async () => {
    const paths: string[] = [];
    const api: ApiClient = {
      request: (async (o: { path: string }) => {
        paths.push(o.path);
        return o.path.endsWith('/label') ? label('s1') : [];
      }) as unknown as ApiClient['request'],
    };
    await fetchWaybillLabel(api, 's1');
    await fetchBatchWorkItems(api, 'b1');
    expect(paths).toEqual([
      '/shipments/s1/waybill/label',
      '/outbound-batches/b1/work-items',
    ]);
  });

  it('completed·excluded 는 인쇄 대상에서 빼고 순서를 유지한다', () => {
    expect(
      printableShipmentIds([
        { id: '1', shipmentId: 'a', status: 'queued' },
        { id: '2', shipmentId: 'b', status: 'completed' },
        { id: '3', shipmentId: 'c', status: 'packing' },
        { id: '4', shipmentId: 'd', status: 'excluded' },
        { id: '5', shipmentId: 'e', status: 'short_pick_recovery' },
      ])
    ).toEqual(['a', 'c', 'e']);
  });
});

describe('409 접두어와 현장 문구', () => {
  it('core 메시지의 접두어를 뽑는다', () => {
    expect(waybillConflictCode(STALE)).toBe('WAYBILL_STALE');
    expect(waybillConflictCode(new ConflictError('version conflict'))).toBeUndefined();
    expect(waybillConflictCode(new Error('WAYBILL_STALE: x'))).toBeUndefined();
  });

  it.each([
    [NOT_DISPATCHABLE, '한진 등록이 끝나지 않은 송장이에요. 관리자에게 운송장 발급 상태를 확인해 달라고 해 주세요.'],
    [STALE, '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요.'],
    [UNAVAILABLE, '이 송장은 앱에서 인쇄할 수 없어요(수기 등록 또는 한진 외 택배사).'],
    [new ConflictError('WAYBILL_SOMETHING_NEW: x', 'CONFLICT'), '송장 상태가 바뀌었어요. 관리자에게 문의해 주세요.'],
    [new ConflictError('no prefix at all', 'CONFLICT'), '송장 상태가 바뀌었어요. 관리자에게 문의해 주세요.'],
    [new ApiError('GET /shipments/s1/waybill/label → 404', 404, 'NOT_FOUND'), '출고 정보를 찾을 수 없어요.'],
    [new Error('GET /shipments/s1/waybill/label → 404'), '출고 정보를 찾을 수 없어요.'],
    [new ApiError('GET /x → 500', 500, 'INTERNAL_SERVER_ERROR'), '라벨을 만들지 못했어요(서버 문제). 관리자에게 알려 주세요.'],
    [new EmptyLabelError('empty'), '라벨을 만들지 못했어요(서버 문제). 관리자에게 알려 주세요.'],
    [new PrinterError('OpenPrinterW failed'), '프린터로 보내지 못했어요. 전원·연결과 설정의 프린터 이름을 확인해 주세요.'],
    [new Error('GET /x → 401'), '권한이 없어요. 다시 로그인해 주세요.'],
  ])('%s → 문구', (error, expected) => {
    expect(labelErrorMessage(error)).toBe(expected);
  });
});

describe('printOneLabel', () => {
  it('받은 data 를 그대로 target 으로 보낸다 (format 은 보지 않는다)', async () => {
    const print = vi.fn(async () => {});
    const got = await printOneLabel(
      {
        fetchLabel: async () => ({ ...label('s1'), format: 'tspl' }),
        print,
        target: 'spooler://XP',
      },
      's1'
    );
    expect(print).toHaveBeenCalledWith('spooler://XP', '^XAs1^XZ');
    expect(got.trackingNo).toBe('T-s1');
  });

  it('빈 data 는 프린터로 보내지 않고 EmptyLabelError', async () => {
    const print = vi.fn(async () => {});
    await expect(
      printOneLabel(
        { fetchLabel: async () => ({ ...label('s1'), data: '' }), print, target: 't' },
        's1'
      )
    ).rejects.toBeInstanceOf(EmptyLabelError);
    expect(print).not.toHaveBeenCalled();
  });
});

describe('runBatchLabelPrint', () => {
  it('전부 성공하면 순서대로 찍고 진행을 건마다 알린다', async () => {
    const printed: string[] = [];
    const progress: Array<[number, number]> = [];
    const result = await runBatchLabelPrint({
      shipmentIds: ['a', 'b', 'c'],
      target: 't',
      fetchLabel: async (id) => label(id),
      print: async (_t, text) => {
        printed.push(text);
      },
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(printed).toEqual(['^XAa^XZ', '^XAb^XZ', '^XAc^XZ']);
    expect(result).toEqual({ printed: ['a', 'b', 'c'], skipped: [], notAttempted: [] });
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('API 거절은 그 건만 건너뛰고 계속한다', async () => {
    const result = await runBatchLabelPrint({
      shipmentIds: ['a', 'b', 'c'],
      target: 't',
      fetchLabel: async (id) => {
        if (id === 'b') throw STALE;
        return label(id);
      },
      print: async () => {},
    });
    expect(result.printed).toEqual(['a', 'c']);
    expect(result.skipped).toEqual([
      { shipmentId: 'b', message: '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요.' },
    ]);
    expect(result.notAttempted).toEqual([]);
  });

  it('빈 라벨은 프린터 오류로 오인하지 않고 그 건만 건너뛴다', async () => {
    const result = await runBatchLabelPrint({
      shipmentIds: ['a', 'b'],
      target: 't',
      fetchLabel: async (id) => (id === 'a' ? { ...label(id), data: '' } : label(id)),
      print: async () => {},
    });
    expect(result.printed).toEqual(['b']);
    expect(result.skipped.map((s) => s.shipmentId)).toEqual(['a']);
    expect(result.printerError).toBeUndefined();
  });

  it('프린터 실패면 즉시 멈추고 그 건부터 나머지를 notAttempted 로 둔다', async () => {
    const fetched: string[] = [];
    const result = await runBatchLabelPrint({
      shipmentIds: ['a', 'b', 'c', 'd'],
      target: 't',
      fetchLabel: async (id) => {
        fetched.push(id);
        return label(id);
      },
      print: async (_t, text) => {
        if (text === '^XAb^XZ') throw new PrinterError('OpenPrinterW failed');
      },
    });
    expect(result.printed).toEqual(['a']);
    expect(result.notAttempted).toEqual(['b', 'c', 'd']);
    expect(result.printerError).toBe('OpenPrinterW failed');
    expect(fetched).toEqual(['a', 'b']);
  });

  it('동시에 두 건을 부르지 않는다', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await runBatchLabelPrint({
      shipmentIds: ['a', 'b', 'c'],
      target: 't',
      fetchLabel: async (id) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return label(id);
      },
      print: async () => {},
    });
    expect(maxInFlight).toBe(1);
  });

  it('retryTargets 는 실패·미인쇄를 원래 순서로 돌려준다', () => {
    expect(
      retryTargets({
        printed: ['a'],
        skipped: [{ shipmentId: 'b', message: 'x' }],
        notAttempted: ['c', 'd'],
        printerError: 'p',
      })
    ).toEqual(['b', 'c', 'd']);
  });
});

describe('배치 인쇄 기록', () => {
  it('배치별로 이 기기의 마지막 인쇄 시각을 저장한다', () => {
    const prefs = createMemoryPrefs();
    expect(readBatchPrintedAt(prefs, 'b1')).toBeNull();
    writeBatchPrintedAt(prefs, 'b1', '2026-09-27T00:12:00.000Z');
    expect(readBatchPrintedAt(prefs, 'b1')).toBe('2026-09-27T00:12:00.000Z');
    expect(prefs.get('almondwms.labelPrinter.batch.b1')).toBe('2026-09-27T00:12:00.000Z');
    expect(readBatchPrintedAt(prefs, 'b2')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/waybillLabel.test.ts`
Expected: FAIL — `Failed to resolve import "./waybillLabel"`

- [ ] **Step 3: 구현**

`native/warehouse-app/src/domains/outbound/waybillLabel.ts`:

```ts
import { ApiError, ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import {
  PRINTER_FAILURE_MESSAGE,
  PrinterError,
  type PrintRaw,
} from '../../core/hardware/print/labelPrinter';

/** GET /shipments/:id/waybill/label (#913). core 가 마스킹·템플릿·래스터화까지 끝낸 프린터 바이트. */
export interface WaybillLabel {
  waybillId: string;
  trackingNo: string;
  format: string;
  data: string;
}

export interface BatchWorkItem {
  id: string;
  shipmentId: string;
  status: string;
}

export function fetchWaybillLabel(api: ApiClient, shipmentId: string): Promise<WaybillLabel> {
  return api.request<WaybillLabel>({ path: `/shipments/${shipmentId}/waybill/label` });
}

export function fetchBatchWorkItems(api: ApiClient, batchId: string): Promise<BatchWorkItem[]> {
  return api.request<BatchWorkItem[]>({ path: `/outbound-batches/${batchId}/work-items` });
}

// 이미 출고됐거나(completed) 배치에서 빠진(excluded) 박스는 라벨이 필요 없다.
const NOT_PRINTABLE = new Set(['completed', 'excluded']);

export function printableShipmentIds(items: BatchWorkItem[]): string[] {
  return items.filter((item) => !NOT_PRINTABLE.has(item.status)).map((item) => item.shipmentId);
}

// 라벨 API 의 409 는 응답 code 가 전부 CONFLICT 다 — @app/shared ConflictError 가 코드를 싣지 않는다.
// 사유는 메시지 앞머리(`WAYBILL_STALE: …`, core 의 WAYBILL.ERROR 상수)에만 있으므로 그걸 읽는다.
// 형식이 바뀌어도 문구가 「그 밖」으로 떨어질 뿐 인쇄 흐름은 깨지지 않는다.
const CODE_PREFIX = /^(WAYBILL_[A-Z_]+):/;

export function waybillConflictCode(error: unknown): string | undefined {
  if (!(error instanceof ConflictError)) return undefined;
  return CODE_PREFIX.exec(error.message)?.[1];
}

const CONFLICT_MESSAGES: Record<string, string> = {
  WAYBILL_NOT_DISPATCHABLE:
    '한진 등록이 끝나지 않은 송장이에요. 관리자에게 운송장 발급 상태를 확인해 달라고 해 주세요.',
  WAYBILL_STALE:
    '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요.',
  WAYBILL_LABEL_UNAVAILABLE:
    '이 송장은 앱에서 인쇄할 수 없어요(수기 등록 또는 한진 외 택배사).',
};
const OTHER_CONFLICT = '송장 상태가 바뀌었어요. 관리자에게 문의해 주세요.';
const NOT_FOUND = '출고 정보를 찾을 수 없어요.';
const SERVER_FAILURE = '라벨을 만들지 못했어요(서버 문제). 관리자에게 알려 주세요.';

/** 서버가 200 에 빈 data 를 준 경우. print_raw 의 «nothing to print» 가 프린터 오류로 오인되지 않게 먼저 거른다. */
export class EmptyLabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyLabelError';
  }
}

function statusOf(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.status;
  if (error instanceof Error) {
    const match = /→\s*(\d{3})/.exec(error.message);
    return match ? Number(match[1]) : undefined;
  }
  return undefined;
}

export function labelErrorMessage(error: unknown): string {
  if (error instanceof PrinterError) return PRINTER_FAILURE_MESSAGE;
  if (error instanceof EmptyLabelError) return SERVER_FAILURE;
  if (error instanceof ConflictError) {
    const code = waybillConflictCode(error);
    return (code && CONFLICT_MESSAGES[code]) || OTHER_CONFLICT;
  }
  const status = statusOf(error);
  if (status === 404) return NOT_FOUND;
  if (status !== undefined && status >= 500) return SERVER_FAILURE;
  return errorMessage(error);
}

export type LabelPrintDeps = {
  fetchLabel: (shipmentId: string) => Promise<WaybillLabel>;
  print: PrintRaw;
  target: string;
};

/** 한 장. format 은 보지 않는다 — core 가 TSPL 로 옮겨도 앱을 다시 배포하지 않기 위해서다. */
export async function printOneLabel(deps: LabelPrintDeps, shipmentId: string): Promise<WaybillLabel> {
  const label = await deps.fetchLabel(shipmentId);
  if (!label.data) throw new EmptyLabelError(`empty label for shipment ${shipmentId}`);
  await deps.print(deps.target, label.data);
  return label;
}

export interface BatchPrintResult {
  printed: string[];
  skipped: { shipmentId: string; message: string }[];
  notAttempted: string[];
  printerError?: string;
}

/**
 * 배치 일괄 인쇄. 순차로 돈다 — 프린터는 한 줄로 받고, core 의 래스터화도 가볍지 않다.
 * API 거절은 건 단위(건너뛰고 계속), 프린터 실패는 실행 단위(즉시 중단): 프린터가 죽었는데
 * 남은 라벨을 서버에서 계속 렌더링할 이유가 없다.
 */
export async function runBatchLabelPrint(
  o: LabelPrintDeps & {
    shipmentIds: string[];
    onProgress?: (done: number, total: number) => void;
  }
): Promise<BatchPrintResult> {
  const result: BatchPrintResult = { printed: [], skipped: [], notAttempted: [] };
  const total = o.shipmentIds.length;
  for (let i = 0; i < total; i++) {
    const shipmentId = o.shipmentIds[i];
    try {
      await printOneLabel(o, shipmentId);
      result.printed.push(shipmentId);
    } catch (error) {
      if (error instanceof PrinterError) {
        result.printerError = error.detail;
        result.notAttempted = o.shipmentIds.slice(i);
        return result;
      }
      result.skipped.push({ shipmentId, message: labelErrorMessage(error) });
    }
    o.onProgress?.(i + 1, total);
  }
  return result;
}

export function retryTargets(result: BatchPrintResult): string[] {
  return [...result.skipped.map((s) => s.shipmentId), ...result.notAttempted];
}

const batchKey = (batchId: string) => `almondwms.labelPrinter.batch.${batchId}`;

/** 이 기기에서 이 배치를 마지막으로 인쇄한 시각(ISO). 서버에는 남기지 않는다(스펙 §8). */
export function readBatchPrintedAt(prefs: DevicePrefs, batchId: string): string | null {
  return prefs.get(batchKey(batchId));
}

export function writeBatchPrintedAt(prefs: DevicePrefs, batchId: string, iso: string): void {
  prefs.set(batchKey(batchId), iso);
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/waybillLabel.test.ts && npx tsc -b`
Expected: PASS (전 케이스), tsc 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound/waybillLabel.ts native/warehouse-app/src/domains/outbound/waybillLabel.test.ts
git commit -m "feat(warehouse-app): 운송장 라벨 조회·409 문구·배치 인쇄 오케스트레이터 (#913)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 3: 스테이션 판정과 설정 화면의 「라벨 프린터」

**Files:**
- Create: `native/warehouse-app/src/app/station.ts`
- Test: `native/warehouse-app/src/app/station.test.ts`
- Create: `native/warehouse-app/src/core/hardware/print/LabelPrinterSettings.tsx`
- Test: `native/warehouse-app/src/core/hardware/print/LabelPrinterSettings.test.tsx`
- Modify: `native/warehouse-app/src/app/routes/SettingsRoute.tsx`

**Interfaces:**
- Consumes (Task 1): `readLabelPrinter`, `writeLabelPrinter`, `printerNameOf`, `printRaw`, `PrintRaw`, `PrinterError`, `NO_PRINTER_MESSAGE`, `PRINTER_FAILURE_MESSAGE`; 기존 `renderTestLabel` (`src/core/hardware/print/zpl.ts`), `resolveProfile` (`src/app/profile.ts`), `platform` (`@tauri-apps/plugin-os`), `Button`
- Produces:
  - `isStationDevice(): boolean`
  - `LabelPrinterSettings({ prefs?: DevicePrefs; print?: PrintRaw })`

- [ ] **Step 1: 실패하는 테스트 작성**

`native/warehouse-app/src/app/station.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { isStationDevice } from './station';

const os = vi.hoisted(() => ({ name: 'windows' }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => os.name }));

describe('isStationDevice', () => {
  it('Windows 면 스테이션', () => {
    os.name = 'windows';
    expect(isStationDevice()).toBe(true);
  });
  it('Android 면 아니다', () => {
    os.name = 'android';
    expect(isStationDevice()).toBe(false);
  });
});
```

`native/warehouse-app/src/core/hardware/print/LabelPrinterSettings.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryPrefs } from '../../data/devicePrefs';
import { LABEL_PRINTER_KEY, PrinterError } from './labelPrinter';
import { LabelPrinterSettings } from './LabelPrinterSettings';

describe('LabelPrinterSettings', () => {
  it('저장된 이름을 입력칸에 보여준다', () => {
    const prefs = createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://XP-DT108B' });
    render(<LabelPrinterSettings prefs={prefs} print={vi.fn()} />);
    expect(screen.getByLabelText('라벨 프린터 이름')).toHaveValue('XP-DT108B');
  });

  it('저장하면 spooler:// target 으로 남는다', async () => {
    const prefs = createMemoryPrefs();
    render(<LabelPrinterSettings prefs={prefs} print={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('라벨 프린터 이름'), 'XP-DT108B');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(prefs.get(LABEL_PRINTER_KEY)).toBe('spooler://XP-DT108B');
    expect(screen.getByRole('status')).toHaveTextContent('저장했어요');
  });

  it('테스트 인쇄는 입력값을 저장하고 그 target 으로 ZPL 을 보낸다', async () => {
    const prefs = createMemoryPrefs();
    const print = vi.fn(async () => {});
    render(<LabelPrinterSettings prefs={prefs} print={print} />);
    await userEvent.type(screen.getByLabelText('라벨 프린터 이름'), 'XP');
    await userEvent.click(screen.getByRole('button', { name: '테스트 인쇄' }));
    expect(prefs.get(LABEL_PRINTER_KEY)).toBe('spooler://XP');
    expect(print).toHaveBeenCalledTimes(1);
    const [target, text] = print.mock.calls[0] as unknown as [string, string];
    expect(target).toBe('spooler://XP');
    expect(text.startsWith('^XA')).toBe(true);
    expect(await screen.findByRole('status')).toHaveTextContent('테스트 라벨을 보냈어요');
  });

  it('이름 없이 테스트 인쇄하면 안내만 한다', async () => {
    const print = vi.fn(async () => {});
    render(<LabelPrinterSettings prefs={createMemoryPrefs()} print={print} />);
    await userEvent.click(screen.getByRole('button', { name: '테스트 인쇄' }));
    expect(print).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('라벨 프린터가 설정되지 않았어요');
  });

  it('프린터 실패는 현장 문구와 원문을 함께 보인다', async () => {
    const print = vi.fn(async () => {
      throw new PrinterError('OpenPrinterW failed: 1801');
    });
    render(<LabelPrinterSettings prefs={createMemoryPrefs()} print={print} />);
    await userEvent.type(screen.getByLabelText('라벨 프린터 이름'), 'WRONG');
    await userEvent.click(screen.getByRole('button', { name: '테스트 인쇄' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('프린터로 보내지 못했어요');
    expect(alert).toHaveTextContent('OpenPrinterW failed: 1801');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd native/warehouse-app && npx vitest run src/app/station.test.ts src/core/hardware/print/LabelPrinterSettings.test.tsx`
Expected: FAIL — `Failed to resolve import "./station"` / `"./LabelPrinterSettings"`

- [ ] **Step 3: 구현**

`native/warehouse-app/src/app/station.ts`:

```ts
import { platform } from '@tauri-apps/plugin-os';
import { resolveProfile } from './profile';

/**
 * 라벨 인쇄처럼 Windows 스테이션에만 있는 기능의 판정 한 곳(#913). 핸드헬드(Android)엔 스풀러가 없다.
 * 화면은 이 값을 props 로 받는다 — 컴포넌트마다 platform() 을 부르면 테스트 모킹이 번진다.
 */
export function isStationDevice(): boolean {
  return resolveProfile(platform()) === 'station';
}
```

`native/warehouse-app/src/core/hardware/print/LabelPrinterSettings.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '../../design/Button';
import { localStoragePrefs, type DevicePrefs } from '../../data/devicePrefs';
import { renderTestLabel } from './zpl';
import {
  NO_PRINTER_MESSAGE,
  PRINTER_FAILURE_MESSAGE,
  PrinterError,
  printRaw,
  printerNameOf,
  readLabelPrinter,
  writeLabelPrinter,
  type PrintRaw,
} from './labelPrinter';

type Status = { kind: 'ok' | 'error'; text: string; detail?: string };

/** 설정 화면의 「라벨 프린터」 절. 이 PC 에 물린 운송장 프린터의 Windows 이름을 받는다(#913). */
export function LabelPrinterSettings({
  prefs = localStoragePrefs,
  print = printRaw,
}: {
  prefs?: DevicePrefs;
  print?: PrintRaw;
}) {
  const [name, setName] = useState(() => printerNameOf(readLabelPrinter(prefs) ?? ''));
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const save = (): string | null => {
    writeLabelPrinter(prefs, name);
    const saved = readLabelPrinter(prefs);
    setName(printerNameOf(saved ?? ''));
    return saved;
  };

  const testPrint = async () => {
    // 입력만 하고 저장을 안 누른 채 시험하는 게 자연스러워서, 시험 전에 저장한다.
    const target = save();
    if (!target) {
      setStatus({ kind: 'error', text: NO_PRINTER_MESSAGE });
      return;
    }
    setBusy(true);
    try {
      await print(target, renderTestLabel({ title: 'ALMOND WMS', barcode: '8801234' }));
      setStatus({ kind: 'ok', text: '테스트 라벨을 보냈어요. 프린터에서 나왔는지 확인해 주세요.' });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: PRINTER_FAILURE_MESSAGE,
        detail: error instanceof PrinterError ? error.detail : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-700">라벨 프린터</h2>
      <p className="text-xs text-gray-500">
        이 PC 에 연결된 운송장 프린터의 이름을 적어 주세요. Windows 설정 → 프린터 및 스캐너에 보이는 이름 그대로예요.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const saved = save();
          setStatus({ kind: 'ok', text: saved ? '저장했어요.' : '라벨 프린터 설정을 지웠어요.' });
        }}
      >
        <input
          className="flex-1 rounded border px-3 py-2"
          aria-label="라벨 프린터 이름"
          placeholder="예: XP-DT108B"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit">저장</Button>
      </form>
      <Button
        type="button"
        className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
        disabled={busy}
        onClick={() => void testPrint()}
      >
        테스트 인쇄
      </Button>
      {status && (
        <p role={status.kind === 'error' ? 'alert' : 'status'} className="text-sm">
          {status.text}
          {status.detail && <span className="block text-xs text-gray-500">{status.detail}</span>}
        </p>
      )}
    </section>
  );
}
```

`native/warehouse-app/src/app/routes/SettingsRoute.tsx` — import 두 줄 추가:

```tsx
import { LabelPrinterSettings } from '../../core/hardware/print/LabelPrinterSettings';
import { isStationDevice } from '../station';
```

그리고 「이 기기의 창고」 `</section>` 바로 뒤에 추가:

```tsx
      {isStationDevice() && <LabelPrinterSettings />}
```

- [ ] **Step 4: 통과 확인**

Run: `cd native/warehouse-app && npx vitest run src/app/station.test.ts src/core/hardware/print/LabelPrinterSettings.test.tsx && npx tsc -b`
Expected: PASS (7 tests), tsc 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/app/station.ts native/warehouse-app/src/app/station.test.ts native/warehouse-app/src/core/hardware/print/LabelPrinterSettings.tsx native/warehouse-app/src/core/hardware/print/LabelPrinterSettings.test.tsx native/warehouse-app/src/app/routes/SettingsRoute.tsx
git commit -m "feat(warehouse-app): 설정 화면에 라벨 프린터 지정·테스트 인쇄 (#913)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 4: 박스 화면의 「라벨 재출력」

**Files:**
- Create: `native/warehouse-app/src/domains/outbound/ReprintLabelButton.tsx`
- Test: `native/warehouse-app/src/domains/outbound/ReprintLabelButton.test.tsx`
- Modify: `native/warehouse-app/src/domains/outbound/SimpleOutboundScreen.tsx`
- Modify: `native/warehouse-app/src/domains/outbound/LocationOutboundScreen.tsx`
- Modify: `native/warehouse-app/src/app/routes/SimpleOutboundRoute.tsx`
- Test (modify): `native/warehouse-app/src/domains/outbound/SimpleOutboundScreen.test.tsx`, `native/warehouse-app/src/domains/outbound/LocationOutboundScreen.test.tsx`

**Interfaces:**
- Consumes (Task 1·2·3): `printRaw`, `PrintRaw`, `PrinterError`, `readLabelPrinter`, `NO_PRINTER_MESSAGE`, `fetchWaybillLabel`, `printOneLabel`, `labelErrorMessage`, `isStationDevice`; 기존 `useApiClient` (`src/core/data/ApiClientProvider.tsx`)
- Produces:
  - `ReprintLabelButton({ shipmentId: string; prefs?: DevicePrefs; print?: PrintRaw })`
  - `SimpleOutboundScreen` · `LocationOutboundScreen` 의 새 optional prop `labelPrinting?: boolean` (기본 `false`)

- [ ] **Step 1: 실패하는 컴포넌트 테스트 작성**

`native/warehouse-app/src/domains/outbound/ReprintLabelButton.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { LABEL_PRINTER_KEY, PrinterError } from '../../core/hardware/print/labelPrinter';
import { ReprintLabelButton } from './ReprintLabelButton';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function mount(opts: {
  respond: (path: string) => Promise<unknown>;
  print?: (target: string, text: string) => Promise<void>;
  printer?: string | null;
}) {
  const paths: string[] = [];
  const client: ApiClient = {
    request: (async (o: { path: string }) => {
      paths.push(o.path);
      return opts.respond(o.path);
    }) as unknown as ApiClient['request'],
  };
  const prefs = createMemoryPrefs(
    opts.printer === null ? {} : { [LABEL_PRINTER_KEY]: opts.printer ?? 'spooler://XP' }
  );
  const print = vi.fn(opts.print ?? (async () => {}));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={new QueryClient()}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(<ReprintLabelButton shipmentId="s-1" prefs={prefs} print={print} />, { wrapper });
  return { paths, print };
}

const label = { waybillId: 'w', trackingNo: 'T-1', format: 'zpl', data: '^XA^XZ' };

describe('ReprintLabelButton', () => {
  it('라벨을 받아 설정된 프린터로 보낸다', async () => {
    const { paths, print } = mount({ respond: async () => label });
    await userEvent.click(screen.getByRole('button', { name: '라벨 재출력' }));
    expect(await screen.findByRole('status')).toHaveTextContent('T-1');
    expect(paths).toEqual(['/shipments/s-1/waybill/label']);
    expect(print).toHaveBeenCalledWith('spooler://XP', '^XA^XZ');
  });

  it('409 는 현장 문구로', async () => {
    mount({
      respond: async () => {
        throw new ConflictError('WAYBILL_STALE: waybill w changed', 'CONFLICT');
      },
    });
    await userEvent.click(screen.getByRole('button', { name: '라벨 재출력' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('재발급을 요청해 주세요');
  });

  it('프린터 실패는 원문을 함께 보인다', async () => {
    mount({
      respond: async () => label,
      print: async () => {
        throw new PrinterError('OpenPrinterW failed: 1801');
      },
    });
    await userEvent.click(screen.getByRole('button', { name: '라벨 재출력' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('프린터로 보내지 못했어요');
    expect(alert).toHaveTextContent('OpenPrinterW failed: 1801');
  });

  it('프린터 미설정이면 API 를 부르지 않고 안내한다', async () => {
    const { paths } = mount({ respond: async () => label, printer: null });
    await userEvent.click(screen.getByRole('button', { name: '라벨 재출력' }));
    expect(screen.getByRole('alert')).toHaveTextContent('설정에서 지정해 주세요');
    expect(paths).toEqual([]);
  });

  it('인쇄 중 연타해도 한 번만 부른다', async () => {
    let release: (v: unknown) => void = () => {};
    const { paths } = mount({
      respond: () => new Promise((resolve) => (release = resolve)),
    });
    const button = screen.getByRole('button', { name: '라벨 재출력' });
    await userEvent.click(button);
    await userEvent.click(button);
    release(label);
    expect(await screen.findByRole('status')).toHaveTextContent('T-1');
    expect(paths).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/ReprintLabelButton.test.tsx`
Expected: FAIL — `Failed to resolve import "./ReprintLabelButton"`

- [ ] **Step 3: 구현**

`native/warehouse-app/src/domains/outbound/ReprintLabelButton.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Button } from '../../core/design/Button';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import {
  NO_PRINTER_MESSAGE,
  PrinterError,
  printRaw,
  readLabelPrinter,
  type PrintRaw,
} from '../../core/hardware/print/labelPrinter';
import { fetchWaybillLabel, labelErrorMessage, printOneLabel } from './waybillLabel';

type Status = { kind: 'ok' | 'error'; text: string; detail?: string };

/** 박스 한 개의 운송장을 다시 찍는다 — 훼손·분실 대비(#913). 라벨 API 는 부작용이 없다. */
export function ReprintLabelButton({
  shipmentId,
  prefs = localStoragePrefs,
  print = printRaw,
}: {
  shipmentId: string;
  prefs?: DevicePrefs;
  print?: PrintRaw;
}) {
  const api = useApiClient();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  // state 는 다음 렌더에야 보인다 — 같은 틱의 연타는 ref 로 막아야 같은 번호 라벨이 두 장 안 나온다.
  const running = useRef(false);

  const run = async () => {
    if (running.current) return;
    const target = readLabelPrinter(prefs);
    if (!target) {
      setStatus({ kind: 'error', text: NO_PRINTER_MESSAGE });
      return;
    }
    running.current = true;
    setBusy(true);
    setStatus(null);
    try {
      const label = await printOneLabel(
        { fetchLabel: (id) => fetchWaybillLabel(api, id), print, target },
        shipmentId
      );
      setStatus({ kind: 'ok', text: `라벨을 다시 인쇄했어요 (${label.trackingNo}).` });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: labelErrorMessage(error),
        detail: error instanceof PrinterError ? error.detail : undefined,
      });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button
        type="button"
        className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
        disabled={busy}
        onClick={() => void run()}
      >
        라벨 재출력
      </Button>
      {status && (
        <p role={status.kind === 'error' ? 'alert' : 'status'} className="text-sm">
          {status.text}
          {status.detail && <span className="block text-xs text-gray-500">{status.detail}</span>}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/ReprintLabelButton.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: 화면 배선 테스트 추가 (실패)**

`native/warehouse-app/src/domains/outbound/SimpleOutboundScreen.test.tsx`:
- `renderScreen` 에 다섯째 매개변수 `labelPrinting = false` 를 추가하고, `<SimpleOutboundScreen … prefs={prefs} />` 에 `labelPrinting={labelPrinting}` 를 넘긴다.
- 파일 끝에 추가:

```tsx
describe('라벨 재출력 배선', () => {
  it('labelPrinting 이면 송장 카드에 재출력 버튼이 있다', async () => {
    renderScreen([], [], createMemoryPrefs(), shipment, true);
    expect(await screen.findByRole('button', { name: '라벨 재출력' })).toBeInTheDocument();
  });

  it('기본(핸드헬드)에서는 없다', async () => {
    renderScreen([]);
    await screen.findByText('HANJIN T-1');
    expect(screen.queryByRole('button', { name: '라벨 재출력' })).toBeNull();
  });
});
```

(`describe` 가 import 에 없으면 `vitest` import 에 추가한다.)

`native/warehouse-app/src/domains/outbound/LocationOutboundScreen.test.tsx`:
- `mount` 에 넷째 매개변수 `labelPrinting = false` 를 추가하고, `<LocationOutboundScreen … prefs={prefs} />` 에 `labelPrinting={labelPrinting}` 를 넘긴다.
- 파일 끝에 추가:

```tsx
it('labelPrinting 이면 송장 줄 아래에 라벨 재출력 버튼이 있다', async () => {
  mount(
    (async () => ({ capabilities: {} })) as ApiClient['request'],
    'w',
    null,
    true
  );
  expect(await screen.findByRole('button', { name: '라벨 재출력' })).toBeInTheDocument();
});

it('기본(핸드헬드)에서는 라벨 재출력 버튼이 없다', async () => {
  mount((async () => ({ capabilities: {} })) as ApiClient['request']);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '라벨 재출력' })).toBeNull();
});
```

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/SimpleOutboundScreen.test.tsx src/domains/outbound/LocationOutboundScreen.test.tsx`
Expected: FAIL — tsc 없이도 vitest 는 돌지만 `labelPrinting` 이 무시돼 「있다」 두 케이스가 `Unable to find role="button" and name "라벨 재출력"` 로 실패

- [ ] **Step 6: 화면 배선 구현**

`SimpleOutboundScreen.tsx`:
- `import { ReprintLabelButton } from './ReprintLabelButton';` 추가
- `SimpleOutboundScreenContent` 의 props 에 `labelPrinting = false` 와 타입 `labelPrinting?: boolean` 추가
- 송장 카드 `<section className="rounded border px-3 py-2">` 안, `recipientMasked` `<p>` 바로 뒤에:

```tsx
        {labelPrinting && (
          <ReprintLabelButton shipmentId={shipmentId} prefs={prefs} />
        )}
```

`SimpleOutboundScreen` 래퍼는 `Parameters<typeof SimpleOutboundScreenContent>[0]` 를 그대로 넘기므로 수정 불필요.

`LocationOutboundScreen.tsx`:
- `import { ReprintLabelButton } from './ReprintLabelButton';` 추가
- `LocationWork` props 에 `labelPrinting: boolean` 추가(구조분해·타입 둘 다)
- `<p>{shipment.carrier} {shipment.trackingNo} · {shipment.recipientMasked}</p>` 바로 뒤에:

```tsx
      {labelPrinting && (
        <ReprintLabelButton shipmentId={shipment.shipmentId} prefs={prefs} />
      )}
```

- `LocationOutboundScreen` props 에 `labelPrinting = false` / `labelPrinting?: boolean` 추가하고 `<LocationWork … prefs={prefs} labelPrinting={labelPrinting} />` 로 넘긴다.

`SimpleOutboundRoute.tsx`:
- `import { isStationDevice } from '../station';` 추가
- 함수 첫 줄에 `const labelPrinting = isStationDevice();`
- 두 화면 JSX 에 `labelPrinting={labelPrinting}` 추가

- [ ] **Step 7: 통과 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound && npx tsc -b`
Expected: PASS (outbound 전체), tsc 출력 없음

- [ ] **Step 8: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound/ReprintLabelButton.tsx native/warehouse-app/src/domains/outbound/ReprintLabelButton.test.tsx native/warehouse-app/src/domains/outbound/SimpleOutboundScreen.tsx native/warehouse-app/src/domains/outbound/SimpleOutboundScreen.test.tsx native/warehouse-app/src/domains/outbound/LocationOutboundScreen.tsx native/warehouse-app/src/domains/outbound/LocationOutboundScreen.test.tsx native/warehouse-app/src/app/routes/SimpleOutboundRoute.tsx
git commit -m "feat(warehouse-app): 박스 화면에서 운송장 라벨 재출력 (#913)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```

---

### Task 5: 배치 일괄 인쇄와 최종 게이트

**Files:**
- Create: `native/warehouse-app/src/domains/outbound/BatchLabelPrintButton.tsx`
- Test: `native/warehouse-app/src/domains/outbound/BatchLabelPrintButton.test.tsx`
- Modify: `native/warehouse-app/src/domains/outbound/OutboundQueueScreen.tsx`
- Modify: `native/warehouse-app/src/app/routes/OutboundRoute.tsx`
- Test (modify): `native/warehouse-app/src/domains/outbound/OutboundQueueScreen.test.tsx`

**Interfaces:**
- Consumes (Task 1·2·3): `printRaw`, `PrintRaw`, `readLabelPrinter`, `NO_PRINTER_MESSAGE`, `PRINTER_FAILURE_MESSAGE`, `fetchBatchWorkItems`, `fetchWaybillLabel`, `printableShipmentIds`, `runBatchLabelPrint`, `retryTargets`, `readBatchPrintedAt`, `writeBatchPrintedAt`, `BatchPrintResult`, `isStationDevice`; 기존 `ConfirmDialog` (`open,title,message,confirmLabel,onConfirm,onCancel`), `useUnsavedWork(pending: boolean)`, `errorMessage`, `useApiClient`
- Produces:
  - `BatchLabelPrintButton({ batchId: string; prefs?: DevicePrefs; print?: PrintRaw; now?: () => Date })`
  - `OutboundQueueScreen` 의 새 optional prop `labelPrinting?: boolean` (기본 `false`)

- [ ] **Step 1: 실패하는 컴포넌트 테스트 작성**

`native/warehouse-app/src/domains/outbound/BatchLabelPrintButton.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { LABEL_PRINTER_KEY, PrinterError } from '../../core/hardware/print/labelPrinter';
import { BatchLabelPrintButton } from './BatchLabelPrintButton';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const BATCH_KEY = 'almondwms.labelPrinter.batch.b-1';
const NOW = new Date('2026-09-27T01:00:00.000Z');

type Item = { id: string; shipmentId: string; status: string };

function mount(opts: {
  workItems?: Item[] | (() => Promise<Item[]>);
  label?: (shipmentId: string) => Promise<unknown>;
  print?: (target: string, text: string) => Promise<void>;
  prefs?: DevicePrefs;
}) {
  const paths: string[] = [];
  const client: ApiClient = {
    request: (async (o: { path: string }) => {
      paths.push(o.path);
      if (o.path === '/outbound-batches/b-1/work-items') {
        const w = opts.workItems ?? [];
        return typeof w === 'function' ? w() : w;
      }
      const m = /^\/shipments\/([^/]+)\/waybill\/label$/.exec(o.path);
      if (m) {
        return opts.label
          ? opts.label(m[1])
          : { waybillId: `w-${m[1]}`, trackingNo: `T-${m[1]}`, format: 'zpl', data: `^XA${m[1]}^XZ` };
      }
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const prefs = opts.prefs ?? createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://XP' });
  const print = vi.fn(opts.print ?? (async () => {}));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={new QueryClient()}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(
    <BatchLabelPrintButton batchId="b-1" prefs={prefs} print={print} now={() => NOW} />,
    { wrapper }
  );
  return { paths, print, prefs };
}

const items: Item[] = [
  { id: '1', shipmentId: 'a', status: 'queued' },
  { id: '2', shipmentId: 'b', status: 'completed' },
  { id: '3', shipmentId: 'c', status: 'picking' },
  { id: '4', shipmentId: 'd', status: 'excluded' },
];

describe('BatchLabelPrintButton', () => {
  it('출고·제외 박스를 빼고 확인 후 순서대로 찍고 기록한다', async () => {
    const { print, prefs } = mount({ workItems: items });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    const dialog = await screen.findByRole('dialog', { name: '라벨 2장을 인쇄할까요?' });
    await userEvent.click(within(dialog).getByRole('button', { name: '인쇄' }));
    expect(await screen.findByRole('status')).toHaveTextContent('인쇄 2 · 실패 0 · 미인쇄 0');
    expect(print.mock.calls).toEqual([
      ['spooler://XP', '^XAa^XZ'],
      ['spooler://XP', '^XAc^XZ'],
    ]);
    expect(prefs.get(BATCH_KEY)).toBe(NOW.toISOString());
  });

  it('이 기기에서 이미 인쇄한 배치면 확인창이 알린다', async () => {
    const prefs = createMemoryPrefs({
      [LABEL_PRINTER_KEY]: 'spooler://XP',
      [BATCH_KEY]: '2026-09-27T00:12:00.000Z',
    });
    mount({ workItems: items, prefs });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('이미 인쇄했어요');
  });

  it('취소하면 아무것도 찍지 않는다', async () => {
    const { print, prefs } = mount({ workItems: items });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(print).not.toHaveBeenCalled();
    expect(prefs.get(BATCH_KEY)).toBeNull();
  });

  it('거절 건은 사유별로 묶어 보이고, 「실패·미인쇄만 다시」는 그 건만 다시 부른다', async () => {
    let failB = true;
    const { paths } = mount({
      workItems: [
        { id: '1', shipmentId: 'a', status: 'queued' },
        { id: '2', shipmentId: 'b', status: 'queued' },
      ],
      label: async (id) => {
        if (id === 'b' && failB)
          throw new ConflictError('WAYBILL_STALE: waybill w-b changed', 'CONFLICT');
        return { waybillId: `w-${id}`, trackingNo: `T-${id}`, format: 'zpl', data: `^XA${id}^XZ` };
      },
    });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '인쇄' }));
    expect(await screen.findByRole('status')).toHaveTextContent('인쇄 1 · 실패 1 · 미인쇄 0');
    expect(screen.getByText(/재발급을 요청해 주세요/)).toHaveTextContent('1건');

    failB = false;
    paths.length = 0;
    await userEvent.click(screen.getByRole('button', { name: '실패·미인쇄만 다시' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: '라벨 1장을 인쇄할까요?' })).getByRole('button', { name: '인쇄' }));
    expect(await screen.findByRole('status')).toHaveTextContent('인쇄 1 · 실패 0 · 미인쇄 0');
    expect(paths).toEqual(['/shipments/b/waybill/label']);
  });

  it('프린터 실패면 멈추고 원문과 미인쇄 수를 보인다', async () => {
    mount({
      workItems: [
        { id: '1', shipmentId: 'a', status: 'queued' },
        { id: '2', shipmentId: 'b', status: 'queued' },
      ],
      print: async () => {
        throw new PrinterError('OpenPrinterW failed: 1801');
      },
    });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '인쇄' }));
    expect(await screen.findByRole('status')).toHaveTextContent('인쇄 0 · 실패 0 · 미인쇄 2');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('프린터로 보내지 못했어요');
    expect(alert).toHaveTextContent('OpenPrinterW failed: 1801');
  });

  it('한 장도 못 찍었으면 이 기기 인쇄 기록을 남기지 않는다', async () => {
    const { prefs } = mount({
      workItems: [{ id: '1', shipmentId: 'a', status: 'queued' }],
      label: async () => {
        throw new ConflictError('WAYBILL_NOT_DISPATCHABLE: shipment a', 'CONFLICT');
      },
    });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '인쇄' }));
    expect(await screen.findByRole('status')).toHaveTextContent('인쇄 0 · 실패 1');
    expect(prefs.get(BATCH_KEY)).toBeNull();
  });

  it('인쇄할 박스가 없으면 확인창 없이 알린다', async () => {
    mount({ workItems: [{ id: '1', shipmentId: 'a', status: 'completed' }] });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('인쇄할 박스가 없어요');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('프린터 미설정이면 조회도 하지 않고 안내한다', async () => {
    const { paths } = mount({ workItems: items, prefs: createMemoryPrefs() });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    expect(screen.getByRole('alert')).toHaveTextContent('설정에서 지정해 주세요');
    expect(paths).toEqual([]);
  });

  it('work-items 조회가 실패하면 확인창 없이 안내하고 기록하지 않는다', async () => {
    const { prefs } = mount({
      workItems: async () => {
        throw new Error('GET /outbound-batches/b-1/work-items → 500');
      },
    });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 문제가 있어요');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(prefs.get(BATCH_KEY)).toBeNull();
  });

  it('조회 중 연타해도 work-items 를 한 번만 부른다', async () => {
    let release: (v: Item[]) => void = () => {};
    const { paths } = mount({
      workItems: () => new Promise<Item[]>((resolve) => (release = resolve)),
    });
    const button = screen.getByRole('button', { name: '라벨 인쇄' });
    await userEvent.click(button);
    await userEvent.click(button);
    release(items);
    await screen.findByRole('dialog');
    expect(paths.filter((p) => p.endsWith('/work-items'))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/BatchLabelPrintButton.test.tsx`
Expected: FAIL — `Failed to resolve import "./BatchLabelPrintButton"`

- [ ] **Step 3: 구현**

`native/warehouse-app/src/domains/outbound/BatchLabelPrintButton.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Button } from '../../core/design/Button';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { useUnsavedWork } from '../../core/operations/useUnsavedWork';
import {
  NO_PRINTER_MESSAGE,
  PRINTER_FAILURE_MESSAGE,
  printRaw,
  readLabelPrinter,
  type PrintRaw,
} from '../../core/hardware/print/labelPrinter';
import {
  fetchBatchWorkItems,
  fetchWaybillLabel,
  printableShipmentIds,
  readBatchPrintedAt,
  retryTargets,
  runBatchLabelPrint,
  writeBatchPrintedAt,
  type BatchPrintResult,
} from './waybillLabel';

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm'; shipmentIds: string[]; last: BatchPrintResult | null }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; result: BatchPrintResult };

function formatPrintedAt(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 같은 사유를 한 줄로 — 실패한 박스의 shipmentId 는 현장이 읽을 수 있는 값이 아니다. */
function groupSkipped(result: BatchPrintResult): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const s of result.skipped) counts.set(s.message, (counts.get(s.message) ?? 0) + 1);
  return [...counts.entries()];
}

/**
 * 배치 일괄 인쇄(#913). 출고작업 진입점이 운송장 스캔이라 박스를 열기 전에 라벨이 붙어 있어야 한다.
 * 같은 배치를 두 번 찍으면 같은 번호 라벨이 두 장 생긴다 — 재출력이 정당한 사용이라 막지 않고 알린다.
 */
export function BatchLabelPrintButton({
  batchId,
  prefs = localStoragePrefs,
  print = printRaw,
  now = () => new Date(),
}: {
  batchId: string;
  prefs?: DevicePrefs;
  print?: PrintRaw;
  now?: () => Date;
}) {
  const api = useApiClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  // 조회·인쇄 중 연타 방지. state 는 다음 렌더에야 보이므로 ref 로 막는다.
  const busy = useRef(false);
  useUnsavedWork(phase.kind === 'running');

  const lastResult = phase.kind === 'done' ? phase.result : null;

  const prepare = async (retryIds?: string[]) => {
    if (busy.current) return;
    setNotice(null);
    if (!readLabelPrinter(prefs)) {
      setNotice(NO_PRINTER_MESSAGE);
      return;
    }
    if (retryIds) {
      setPhase({ kind: 'confirm', shipmentIds: retryIds, last: lastResult });
      return;
    }
    busy.current = true;
    try {
      const shipmentIds = printableShipmentIds(await fetchBatchWorkItems(api, batchId));
      if (shipmentIds.length === 0) {
        setNotice('인쇄할 박스가 없어요.');
        return;
      }
      setPhase({ kind: 'confirm', shipmentIds, last: lastResult });
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      busy.current = false;
    }
  };

  const start = async (shipmentIds: string[]) => {
    const target = readLabelPrinter(prefs);
    if (!target || busy.current) return;
    busy.current = true;
    setPhase({ kind: 'running', done: 0, total: shipmentIds.length });
    try {
      const result = await runBatchLabelPrint({
        shipmentIds,
        target,
        print,
        fetchLabel: (id) => fetchWaybillLabel(api, id),
        onProgress: (done, total) => setPhase({ kind: 'running', done, total }),
      });
      // 한 장도 안 나왔으면 기록하지 않는다 — 다음 확인창이 「이미 인쇄」라고 거짓말하게 된다.
      if (result.printed.length > 0) writeBatchPrintedAt(prefs, batchId, now().toISOString());
      setPhase({ kind: 'done', result });
    } finally {
      busy.current = false;
    }
  };

  const printedAt = readBatchPrintedAt(prefs, batchId);
  const retry = lastResult ? retryTargets(lastResult) : [];

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-2">
        <Button
          type="button"
          className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          disabled={phase.kind === 'running'}
          onClick={() => void prepare()}
        >
          {phase.kind === 'running' ? `인쇄 중 ${phase.done}/${phase.total}` : '라벨 인쇄'}
        </Button>
        {phase.kind === 'done' && retry.length > 0 && (
          <Button type="button" onClick={() => void prepare(retry)}>
            실패·미인쇄만 다시
          </Button>
        )}
      </div>

      {notice !== null && (
        <p role="alert" className="text-sm">
          {notice}
        </p>
      )}

      {phase.kind === 'done' && (
        <div className="space-y-1 text-sm">
          <p role="status">
            인쇄 {phase.result.printed.length} · 실패 {phase.result.skipped.length} · 미인쇄{' '}
            {phase.result.notAttempted.length}
          </p>
          {phase.result.printerError !== undefined && (
            <p role="alert">
              {PRINTER_FAILURE_MESSAGE}
              <span className="block text-xs text-gray-500">{phase.result.printerError}</span>
            </p>
          )}
          <ul>
            {groupSkipped(phase.result).map(([message, count]) => (
              <li key={message}>
                {message} ({count}건)
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={phase.kind === 'confirm'}
        title={phase.kind === 'confirm' ? `라벨 ${phase.shipmentIds.length}장을 인쇄할까요?` : ''}
        message={
          printedAt
            ? `이 기기에서 ${formatPrintedAt(printedAt)} 에 이미 인쇄했어요. 같은 번호의 라벨이 한 장씩 더 나와요.`
            : '인쇄가 끝날 때까지 이 화면을 떠나지 마세요.'
        }
        confirmLabel="인쇄"
        onCancel={() =>
          setPhase(
            phase.kind === 'confirm' && phase.last
              ? { kind: 'done', result: phase.last }
              : { kind: 'idle' }
          )
        }
        onConfirm={() => {
          if (phase.kind === 'confirm') void start(phase.shipmentIds);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/BatchLabelPrintButton.test.tsx`
Expected: PASS (10 tests)

- [ ] **Step 5: 큐 화면 배선 테스트 추가 (실패)**

`native/warehouse-app/src/domains/outbound/OutboundQueueScreen.test.tsx`:
- `renderScreen` 에 다섯째 매개변수 `labelPrinting = false` 를 추가하고 `<OutboundQueueScreen prefs={prefs} />` 를 `<OutboundQueueScreen prefs={prefs} labelPrinting={labelPrinting} />` 로 바꾼다.
- 파일 끝의 최상위 `describe` 안(또는 파일 끝)에 추가:

```tsx
  it('labelPrinting 이면 배치 행마다 라벨 인쇄 버튼이 있다', async () => {
    const requests: CapturedRequest[] = [];
    renderScreen(requests, undefined, undefined, 'w-1', true);
    await screen.findByText('OB-1');
    expect(screen.getByRole('button', { name: '라벨 인쇄' })).toBeInTheDocument();
  });

  it('기본(핸드헬드)에서는 라벨 인쇄 버튼이 없다', async () => {
    const requests: CapturedRequest[] = [];
    renderScreen(requests);
    await screen.findByText('OB-1');
    expect(screen.queryByRole('button', { name: '라벨 인쇄' })).toBeNull();
  });
```

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/OutboundQueueScreen.test.tsx`
Expected: FAIL — 첫 케이스가 `Unable to find role="button" and name "라벨 인쇄"`

- [ ] **Step 6: 큐 화면·라우트 배선 구현**

`OutboundQueueScreen.tsx`:
- `import { BatchLabelPrintButton } from './BatchLabelPrintButton';` 추가
- `OutboundQueueContent` props 를 다음으로 바꾼다:

```tsx
function OutboundQueueContent({
  prefs = localStoragePrefs,
  labelPrinting = false,
}: {
  prefs?: DevicePrefs;
  labelPrinting?: boolean;
}) {
```

- 배치 `<li>` 안, `{batch.totalItems}박스 · {batch.totalQty}개` `<p>` 바로 뒤에:

```tsx
              {labelPrinting && (
                <BatchLabelPrintButton batchId={batch.id} prefs={prefs} />
              )}
```

`OutboundRoute.tsx` 전체:

```tsx
import { OutboundQueueScreen } from '../../domains/outbound/OutboundQueueScreen';
import { isStationDevice } from '../station';

export function OutboundRoute() {
  return <OutboundQueueScreen labelPrinting={isStationDevice()} />;
}
```

- [ ] **Step 7: 통과 확인**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/OutboundQueueScreen.test.tsx`
Expected: PASS

- [ ] **Step 8: 앱 전체 게이트**

Run: `cd native/warehouse-app && npx vitest run && npx tsc -b && npx oxlint`
Expected:
- vitest: 실패 0 (기준 92 files / 704 tests + 이 계획이 더한 것)
- tsc: 출력 없음
- oxlint: exit 0, 경고 22건 그대로 — 이 계획이 만들거나 고친 파일 경로가 경고 목록에 하나도 없어야 한다 (`npx oxlint 2>&1 | grep -E "labelPrinter|LabelPrinterSettings|waybillLabel|ReprintLabelButton|BatchLabelPrintButton|station\.ts|OutboundRoute|SimpleOutboundRoute|SettingsRoute"` 출력 없음)

- [ ] **Step 9: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound/BatchLabelPrintButton.tsx native/warehouse-app/src/domains/outbound/BatchLabelPrintButton.test.tsx native/warehouse-app/src/domains/outbound/OutboundQueueScreen.tsx native/warehouse-app/src/domains/outbound/OutboundQueueScreen.test.tsx native/warehouse-app/src/app/routes/OutboundRoute.tsx
git commit -m "feat(warehouse-app): 출고작업 화면에서 배치 운송장 일괄 인쇄 (#913)

Claude-Session: https://claude.ai/code/session_0129KYz3jPdmFE2JPa8wXDTS"
```
