# 스테이션 UI — PR C (F1 출고 검수 + F2 배치 현황) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스테이션 F1 을 «송장 스캔 → 상품 스캔 → 자동 출고 → 다음 송장» 이 마우스 0회로 끝나는 출고 검수 화면으로, F2 를 배치 현황 화면으로 바꾼다. 결품(F9)·보충 대기·강제출고(F10)·박스 빼기(F11)·송장 재출력(F12)을 같은 화면 문법에 싣는다.

**Architecture:** 판정은 `src/domains/outbound/` 의 순수 함수(송장 상태 → 화면, 송장/상품 가르기, 품목 표, 결품 위치·요청, 배치 집계)로 두고 표 테스트한다. 스테이션 화면은 `src/station/outbound/`(F1)·`src/station/batches/`(F2)에 둔다. F1 은 부모(`InspectionScreen` — 조회·전환·내려놓기·대기)와 박스별 자식(`InspectWork`·`WithdrawWork` — `key` 로 박스마다 새로 마운트되어 스캔 큐가 박스에 묶인다)으로 나눈다. 스캔 큐·복구는 지금 것(`useWorkScanQueue`, 영속 오퍼레이션 실행기)을 그대로 쓴다. 핸드헬드 경로(`OutboundQueueScreen`·`LocationOutboundScreen`)는 손대지 않는다. core 변경은 배치 박스 목록 필드 추가 하나(추가형, 마이그 0).

**Tech Stack:** React 19, TanStack Router 1.x·Query 5, Tailwind 4, Vitest 4 + Testing Library(jsdom) + fake-indexeddb, NestJS + Drizzle(core), Jest(core).

**Spec:** `docs/superpowers/specs/2026-10-02-warehouse-station-ui-design.md` (§3 결정, §6 F1, §7 결품·보충 대기·강제출고, §8 F2, §10 테스트, §11 PR C 와 끝의 «PR A 가 남긴 C 의 계약 메모»). PR B 계획 끝의 «PR C 에 넘기는 계약 메모»(`docs/superpowers/plans/2026-10-02-warehouse-station-ui-pr-b-shell.md`)도 함께 읽는다. 목업: https://claude.ai/artifact/MFR8uWDxJHi8VurVuWsrya (① 송장 대기·보충 대기, ② 검수 중, ③ 박스에 없는 상품, ④ 송장 바뀜, ⑤ 배치 현황)

## 이 계획이 정한 것 (스펙이 «계획이 정함» 으로 남긴 것 + 코드에서 도출한 것)

| 항목 | 결정 | 근거 |
| --- | --- | --- |
| 핸드헬드 `/outbound` | **그대로** `OutboundQueueScreen`(위치 확인 출고). 스테이션만 새 화면. `LocationOutboundScreen`·`location-outbound-*` 클라이언트와 그 테스트는 남긴다 — 핸드헬드가 아직 쓴다 | §2-5. §10.1 «위치 계약 전용 테스트는 화면과 함께 지운다» 는 화면을 지우는 contract PR(§12)의 몫 |
| 검수 중 송장/상품 가르기 | 지금 송장번호(또는 그 숫자만)와 같으면 «같은 송장»(다시 조회). 숫자만이고 지금 송장번호의 숫자 길이(10 이상)와 같으면 «송장일 수 있음» → by-waybill 조회, 있으면 U13 전환·404 면 상품으로 넘긴다. 나머지는 상품 | 같은 배치의 송장은 같은 택배사 형식이다. 길이가 같은 상품 바코드(12자리 UPC)는 조회 한 번을 더 하고 상품으로 간다 |
| 전환·내려놓기 순서(U13) | 앞 상품 스캔이 다 보내진 뒤(`settle`)에 내려놓는다. 확인 못 한 스캔이 있으면 전환·Esc 를 거절(오류음, 박스 유지). 조회·전환 중에 들어온 스캔은 오류음 | «찍은 수량은 서버에 남는다»(§6.3)를 보장하고, 새 박스의 상품이 옛 박스 큐로 새지 않게 |
| 결품 위치(U11) | 서버의 송장 순서 귀속(core A1)을 앱이 재구성한다 — 배정 순서대로 `pickedQty` 를 채워 위치마다 «안 집은 몫» 을 구하고, 결품을 **마지막 위치부터** 그 몫만큼, 넘치면 앞 위치로 나눠 보낸다. 마지막 위치 몫 이하면 U11 그대로 한 위치 | **2026-10-02 사용자 결정.** 서버는 (줄, 위치)의 안 집은 몫을 넘는 결품을 409 `SHORT_PICK_EXCEEDS_UNPICKED` 로 거절한다(`box-allocation.manager.ts` `planShortages`) |
| F9 결품 창 조작 | 두 단계. ① 수량: ↑↓ 줄, 숫자 = 그 줄 덮어쓰기(줄을 고른 뒤 첫 숫자)·이어 치기, 상한 = 남은 수량, Backspace, Enter 다음 ② 사유: `1` 재고 부족(기본)·`2` 파손, Enter 보냄. Esc 는 한 단계 뒤로(①에서는 닫기) | §7.1 «숫자로 줄이기» 와 «숫자 2 → item_damaged» 가 같은 숫자 키를 쓴다 |
| 사람 키 채널 | `ScanProvider` 가 «사람이 친 키» 를 따로 낸다: 혼자 들어온 글자(다음 키가 50ms 넘게 늦거나 그만큼 지나면 확정)와 Enter·Backspace·↑↓·Esc. 스캐너 묶음과 그 끝 Enter 는 내지 않는다. 수량 입력·결품 창·송장 대기의 직접 입력이 이걸 쓴다 | PR B 메모 «입력칸 포커스 중엔 스캔이 죽는다». 스캐너 Enter 가 결품 창을 확정하면 안 된다 |
| §5.6 대기 중 숫자 → 직접 입력칸 | 송장 대기에서 사람이 숫자를 치면 입력칸이 그 숫자로 열린다. Enter 면 스캔 버스로 보낸다(명령이면 셸, 아니면 송장 조회). Esc 로 닫는다 | PR B 가 넘긴 항목 |
| F10·F11 «한 번 더 눌러 확정» | 첫 누름 = 무장(왼쪽 큰 칸이 «강제출고 · F10 한 번 더»), 같은 키(또는 같은 명령) = 실행, 스캔·다른 키·Esc = 해제 | §6.3·§7.4 |
| 박스 빼기(F11) 사유 | 고정 `station_withdraw_command` | 강제출고 고정 사유 `station_force_command`(§7.4)와 같은 꼴. 입력칸 없음(U2) |
| 채움(refilled) 뒤 | 새 송장 자동 출력 → 송장 대기 + 위 배너(송장번호 · 보충 대기 · `[C-07-1] 상품 ×1`). 출력이 실패하면 대기의 F12 가 그 박스 송장을 다시 뽑는다 | §7.2, 목업 ① «F12 직전 송장 재출력» |
| 옛 core(PR A 미배포) | A5 필드가 없으면 위치 열 «—», 배송메모 숨김, F9 안 그림. 권한 미리보기에 `shortPick`·`stationForceDispatch` 가 없으면 F9·F10 안 그림. 보충 대기 조회가 실패하면 패널을 안 그림. 배치 박스 목록 필드가 없으면 F2 는 건수만 | §11 «C 계획이 없는 필드에 대한 처리를 정한다» |
| F2 박스 목록 | core `GET outbound-batches/:id/waybill-label-states` 응답에 `workItemStatus`·`trackingNo`·`recipientMasked` 를 더한다(PR C 의 유일한 core 변경, 추가형). 목록은 미완료 박스(서버가 completed·excluded 를 이미 뺀다), 완료는 건수만 | **2026-10-02 사용자 결정.** 값은 DB 에 있고 배치 단위로 내려 주는 API 만 없었다 |
| 하던 박스 복구 | 박스를 열 때 `lastBox` 에 쓰고 출고·Esc·빠짐·채움에서 지운다. F1 이 그려질 때 남아 있으면 조용히 다시 연다(거절·실패면 지우고 대기) — 재시작·탭 이동 뒤에도 그 박스의 저장된 스캔이 재생된다 | §6.3 «스캔 큐·복구는 지금 것», §10.1 «재시작 재생». `main.tsx` 가 StrictMode 라 한 번만 돌게 ref 로 막는다 |
| 소리 | 박스 열림·상품 반영 = success, 출고·다 뺌 = complete, 거절·출력 실패 = error | §5.4 |
| 최근 스캔 | 화면 상태로만 8줄(탭을 옮기면 사라진다) | 목업 ② |
| 상태바 배치 진행 | F1 = 마지막으로 연 박스의 배치, F2 = 고른 배치. `outbound-batches/:id/work-items` 의 completed / (excluded 를 뺀 전체) | §5.5 |
| 보충 대기 갱신 | 30초 간격 + 출고·결품 뒤 무효화 | 다른 스테이션의 결품도 보여야 한다(U9) |

## Global Constraints

- 작업 디렉터리: 앱 태스크의 `Run:` 은 `native/warehouse-app` 기준, core 태스크(Task 1)와 Task 14 의 루트 게이트는 저장소 루트 기준이다
- 워크트리: `/home/pauseb/workspace/almondyoung-server/.claude/worktrees/station-ui-pr-b-shell`, 브랜치 `feat/station-ui-pr-c-outbound`(develop `801707f67` 에서 땄다). `node_modules`·`native/warehouse-app/node_modules` 심볼링크가 이미 있다. 서브에이전트는 **이 워크트리 경로 안에서만** 편집하고, 끝나면 `git -C /home/pauseb/workspace/almondyoung-server status --short` 가 비어 있는지 본다
- 핸드헬드(Android) 동작은 바뀌지 않는다(스펙 §2-5). `OutboundQueueScreen`·`SimpleOutboundScreen`·`LocationOutboundScreen`·`WithdrawBoxScreen` 은 수정하지 않는다. 그 화면들이 쓰는 도메인 모듈의 변경(Task 3 `fetchShipmentByWaybill` 추출, Task 5 `ScanAllowance` 선택 필드화·무효화 추가, Task 8 `excludeFromBatch` 추출)은 동작을 바꾸지 않는다 — Task 14 Step 7 이 핸드헬드 쪽 테스트로 확인한다
- 화면 문구는 U2: 작업자가 그 순간 행동하는 데 필요한 것만. 설명·캡션·범례를 새로 깔지 않는다. 정상 상태는 숨긴다. 작업자 문구는 「라벨」 대신 「송장」
- 색(목업 값 그대로): 셸 `#161A22`·`#EDEEF0`·`#15171C`·`#D5D8DE`, 초록 `#1E7A46`(배너 `#E3F4EA`/`#8CC8A4`/`#145232`), 오류 칸 `#FDE8EA` 바탕·`#C8202F` 테두리·`#9E1320` 글자, 노랑 `#FFF1C7`/`#D99A00`/`#5E3B00`, 수량 배지 `#7A4B00`, 파랑 `#1D5BD8`(연 `#E3ECFC`), 완료 줄 `#F1F2F4`/`#6B717D`, 흐린 숫자 `#A3A9B4`, 표 머리 `#F6F7F8`/`#535968`
- 레이아웃: F1 작업 영역 `grid-cols-[380px_minmax(0,1fr)] gap-3`(셸 `<main>` 이 이미 `p-3`), F2 `grid-cols-[minmax(0,1fr)_440px] gap-3`
- 새 의존성 0
- 타입: `any` 금지. 프로덕션 코드에서 `as` 캐스팅 금지(`as const`·`satisfies` 는 허용). 테스트·픽스처의 가짜 객체는 이 저장소 관례대로 `as`/`as never` 허용
- 사람 키를 흉내 내는 테스트는 **실제 시간**(키마다 70ms)을 쓴다 — `ScanProvider` 가 `performance.now()` 와 `setTimeout` 으로 판정하고, 가짜 타이머는 둘 다 일관되게 바꾸지 못한다
- 게이트(앱): `npx tsc -b` 에러 0 · `npx vitest run` 실패 0(develop 기준선 126 files / 1117 tests, 10-02 실측) · `npx oxlint` 경고가 develop 기준선 **22건**에서 늘지 않는다(⚠️ `tail` 로 자른 출력에서 세지 말 것 — `npx oxlint 2>&1 | grep -c warning`)
- 게이트(루트): `npm run type-check` 에러 0 · `npx jest --maxWorkers=2` 실패 0
- 커밋 메시지는 한국어, `feat(warehouse-app): …` / `feat(fulfillment): …` / `test(…)` 꼴

## Review Focus

1. **스캐너의 Enter 가 결품 창을 확정하지 않는다** — 결품 창이 열린 채 상품을 찍으면 오류음만 나고 창·수량이 그대로이며 결품이 나가지 않는다 → Task 10 «결품 창이 열린 채 상품을 찍으면…»
2. **상품을 연달아 찍다 다른 송장을 찍으면, 앞 상품이 옛 박스로 다 간 뒤 새 박스가 열린다** — 새 박스에 찍은 상품이 옛 박스로 가지 않는다 → Task 7 «검수 중 다른 송장을 찍으면…»
3. **응답을 잃은(확인 못 한) 스캔이 있는 박스에서 Esc·다른 송장** — 거절(오류음)하고 박스를 유지하며, 기다리다 매달리지 않는다(실행기의 불확실 결과는 약속이 풀리지 않는다). 내려놓으면 그 스캔이 재생될 길이 없다 → Task 5 «settle 은 확인 못 한 스캔이…»·«기다리던 settle 도…» + Task 7 «앞 스캔을 확인 못 한 채로는…»
4. **결품 창을 연 사이 박스가 바뀌었다**(다른 스테이션이 같은 줄을 더 찍음) — 보내기 직전 재조회에서 남은 수량이 줄었으면 보내지 않고 «다시 F9» 를 안내한다 → Task 4 `buildShortPickRequest` 표 + Task 10 «보내기 직전 다시 조회해…»
5. **같은 송장을 여러 번 찍는다** — 다시 조회만 하고 서버에 아무것도 쓰지 않으며, 방금 보낸 스캔까지 반영된 진행을 보인다 → Task 7 «같은 송장을 다시 찍으면…»

## 파일 지도

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `apps/core/src/modules/fulfillment/reader/recipient-snapshot.ts` | 받는 분 스냅샷 → 가린 이름·배송메모(순수) | 1 |
| `apps/core/src/modules/fulfillment/waybill/waybill-label-state.reader.ts` | `forBatch` 가 작업 상태·송장번호·받는 분을 싣는다 | 1 |
| `src/core/hardware/scan/humanKeys.ts` | 사람 키 판정(순수) | 2 |
| `src/core/hardware/scan/ScanProvider.tsx`·`useScanner.ts` | 버스의 사람 키 채널 `subscribeKeys`·`useHumanKeys` | 2 |
| `src/domains/outbound/inspection.ts` | F1 판정(송장 상태 → 화면, 송장/상품, 품목 표, 진행) | 3 |
| `src/domains/outbound/shortPick.ts` | 결품 초안·위치·요청·API·오류 문구 | 4 |
| `src/core/operations/WorkBoundary.tsx` | 단순출고 스캔도 «첫 전송 중» 허용 | 5 |
| `src/core/hardware/scan/useWorkScanQueue.ts` | `settle()` — 저장·전송이 다 끝날 때까지(실행기를 거치지 않는 큐용) | 5 |
| `src/station/outbound/useInspectionBox.ts` | 박스 하나의 스캔 큐·진행·입력 잠금·settle·강제출고 | 5 |
| `src/station/outbound/__fixtures__/outboundServer.ts`·`renderStation.tsx` | 가짜 core·스테이션 렌더 하네스 | 5·7·11 |
| `src/station/outbound/{model,recent,printWaybill,inspectionActions}.ts` | 상태 타입·최근 스캔·단건 출력·F1 액션 선언 | 6 |
| `src/domains/outbound/batchStatus.ts` | 배치 진행·건수·배치 합치기·박스 줄 | 6·12 |
| `src/station/outbound/panels.tsx` | F1 화면 부품(작업 영역·송장 카드·큰 칸·품목 표·최근 스캔·배너) | 7 |
| `src/station/outbound/InspectionScreen.tsx` | F1 부모 — 대기·조회·전환·내려놓기·새 송장·빠진 박스·결품 결과 | 7~11 |
| `src/station/outbound/InspectWork.tsx` | F1 검수 중 — 표·큰 칸·F7~F12·Esc | 7·8·10 |
| `src/domains/outbound/batchRemove.ts` | `excludeFromBatch` 추출 | 8 |
| `src/station/commandSheet.ts` | 명령 시트 「출고 검수」 절 | 8 |
| `src/station/outbound/WithdrawWork.tsx` | F1 뺄 상품 | 9 |
| `src/station/outbound/ShortPickDialog.tsx` | F9 결품 창 | 10 |
| `src/domains/outbound/refills.ts`·`src/station/outbound/RefillPanel.tsx` | 보충 대기 | 11 |
| `src/station/batches/BatchStatusScreen.tsx` | F2 | 12 |
| `src/app/routes/OutboundRoute.tsx`·`OutboundBatchesRoute.tsx`·`routeTree.tsx` | 스테이션만 새 화면 | 13 |

(`src/` 는 `native/warehouse-app/src/` 다.)

---

### Task 1: core — 배치 박스 송장 상태에 작업 상태·송장번호·받는 분을 싣는다

**Files:**
- Create: `apps/core/src/modules/fulfillment/reader/recipient-snapshot.ts`
- Modify: `apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.ts:60-95` (세 함수를 옮기고 같은 이름으로 다시 내보낸다)
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill-label-state.reader.ts` (`forBatch`)
- Test: `apps/core/src/modules/fulfillment/waybill/waybill-label-state.reader.integration.spec.ts`

**Interfaces:**
- Produces: `GET /outbound-batches/:batchId/waybill-label-states` 의 원소에 `workItemStatus: string`, `trackingNo: string | null`, `recipientMasked: string` 이 더해진다(기존 필드 `shipmentId·workItemId·state·changes·issue` 그대로). 타입 `BatchBoxLabelState`(`waybill-label-state.reader.ts`). 앱은 Task 12 에서 이 셋을 선택 필드로 읽는다
- Produces: `maskName`·`readRecipientName`·`readDeliveryNote` 의 정본이 `reader/recipient-snapshot.ts` 로 옮겨진다. `reader/shipment-waybill.reader.ts` 가 같은 이름을 다시 내보내므로 기존 import(`refill-pending.reader.ts`·`outbound-batch-orchestrator.service.ts`·`shipment-waybill.reader.spec.ts`)는 그대로다

왜 옮기나: `shipment-waybill.reader.ts` 는 `WaybillLabelStateReader` 를 생성자에서 주입받는다. 반대 방향 import 를 만들면 모듈 순환이 생기고, Nest 데코레이터 메타데이터가 덜 초기화된 클래스를 보게 될 수 있다.

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다**

`waybill-label-state.reader.integration.spec.ts` 의 import 를 바꾸고(`and`·`notInArray` 추가, 두 모듈 추가), 마지막 `it` 뒤에 테스트를 더한다.

```ts
import { randomUUID } from 'crypto';
import { and, eq, notInArray } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { maskName, readRecipientName } from '../reader/recipient-snapshot';
import { ambientDbService, inRollbackTx, makeDb, seedPickableShipment, startBatchFor } from '../services/__support__';
import { seedTwoBoxBatch } from '../services/__support__/simple-outbound-fixtures';
import { assembleLabels, promoteToCarrierWaybill } from './__support__/label-fixtures';
import { WAYBILL_TERMINAL_STATUSES } from './waybill.constants';
```

```ts
  it('forBatch 는 박스마다 작업 상태·지금 송장번호·가린 받는 분을 싣는다(배치 현황 박스 목록)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx);
      await promoteToCarrierWaybill(tx, first);
      await startBatchFor(tx, first);
      const labels = assembleLabels(ambientDbService(tx));
      const states = await labels.states.forBatch(first.batchId, tx);
      for (const box of [first, second]) {
        const [waybill] = await tx
          .select({ trackingNo: wmsTables.waybills.trackingNo })
          .from(wmsTables.waybills)
          .where(
            and(
              eq(wmsTables.waybills.shipmentId, box.shipmentId),
              notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
            ),
          );
        const [shipment] = await tx
          .select({ snapshot: wmsTables.shipments.recipientSnapshot })
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.id, box.shipmentId));
        const [item] = await tx
          .select({ status: wmsTables.outboundBatchWorkItems.status })
          .from(wmsTables.outboundBatchWorkItems)
          .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
        expect(states.find((s) => s.shipmentId === box.shipmentId)).toMatchObject({
          workItemStatus: item.status,
          trackingNo: waybill?.trackingNo ?? null,
          recipientMasked: maskName(readRecipientName(shipment.snapshot)),
        });
      }
      // 택배사 송장으로 올린 박스는 송장번호가 있다 — 비교가 null = null 로 헛돌지 않게
      expect(states.find((s) => s.shipmentId === first.shipmentId)?.trackingNo).toEqual(expect.any(String));
    });
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- waybill-label-state.reader`
Expected: FAIL — `Cannot find module '../reader/recipient-snapshot'`(또는 타입 에러). ⚠️ 워크트리에서는 `COMPOSE_PROJECT_NAME` 이 필수다(빠뜨리면 5432 에 두 번째 postgres 를 띄우려다 죽는다). DB 를 띄울 수 없는 환경이면 이 스텝과 Step 4 를 «skip» 으로 보고하고 Step 5 의 type-check·단위 jest 로 대신 판정하되, 리뷰어에게 통합 스펙을 못 돌렸다고 적는다

- [ ] **Step 3: 구현한다**

`apps/core/src/modules/fulfillment/reader/recipient-snapshot.ts` 를 만든다:

```ts
/**
 * 출고 박스의 받는 분 스냅샷(jsonb)에서 현장 화면에 띄울 값만 뽑는다 — 송장 스캔·보충 대기·배치 박스 목록이 같이 쓴다.
 * 의존이 없는 순수 함수라 리더끼리 서로 import 하지 않고 여기서 가져간다(`ShipmentWaybillReader` 는 `WaybillLabelStateReader` 를 주입받는다).
 */

function isRecipientRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 이름은 뒤 절반을 가린다 — 현장 화면에 개인정보를 통째로 띄우지 않는다. */
export function maskName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 1) return trimmed;
  const keep = Math.ceil(trimmed.length / 2);
  return `${trimmed.slice(0, keep)}${'*'.repeat(trimmed.length - keep)}`;
}

/** jsonb 스냅샷에서 이름만 안전하게 뽑는다 — `as` 캐스팅 없이 좁힌다. */
export function readRecipientName(snapshot: unknown): string {
  if (!isRecipientRecord(snapshot)) return '';
  const { recipientName } = snapshot;
  return typeof recipientName === 'string' ? recipientName : '';
}

/** 배송메모만 — 공동현관 비밀번호는 현장 화면에 띄우지 않는다(송장 템플릿만 섞는다). */
export function readDeliveryNote(snapshot: unknown): string | null {
  if (!isRecipientRecord(snapshot)) return null;
  const { deliveryNote } = snapshot;
  if (typeof deliveryNote !== 'string') return null;
  const trimmed = deliveryNote.trim();
  return trimmed ? trimmed : null;
}
```

`shipment-waybill.reader.ts` 에서 `maskName`·`isRecipientRecord`·`readRecipientName`·`readDeliveryNote` 네 정의(지금 60~95행 부근, 주석 포함)를 지우고, import 블록 끝에 다음을 더한다:

```ts
import { maskName, readDeliveryNote, readRecipientName } from './recipient-snapshot';

// 보충 대기·배치 오케스트레이터·스펙이 이 경로로 가져다 쓴다 — 정본을 옮긴 뒤에도 그대로 둔다
export { maskName, readDeliveryNote, readRecipientName } from './recipient-snapshot';
```

`waybill-label-state.reader.ts`:

```ts
import { and, asc, desc, eq, inArray, isNotNull, ne, notInArray } from 'drizzle-orm';
// …기존 import…
import { maskName, readRecipientName } from '../reader/recipient-snapshot';
import { WAYBILL_TERMINAL_STATUSES } from './waybill.constants';
```

클래스 위(`WITHDRAWING` 상수 아래)에 타입을 더한다:

```ts
/** 배치 현황(스테이션 F2) 박스 한 줄 — 송장 상태에 현장이 읽을 값을 붙인다 */
export type BatchBoxLabelState = LabelStateView & {
  shipmentId: string;
  workItemId: string;
  /** 작업 항목 상태 — «대기·검수 중·빠지는 중» */
  workItemStatus: string;
  /** 지금 쓰는 송장 번호(무효·종결 송장 제외). 없으면 null */
  trackingNo: string | null;
  recipientMasked: string;
};
```

`forBatch` 를 이렇게 바꾼다(배치 조회·`items` 조회는 그대로):

```ts
  async forBatch(batchId: string, tx?: DbTx): Promise<BatchBoxLabelState[]> {
    return this.dbService.run(async (trx) => {
      const [batch] = await trx
        .select({ startedAt: wmsTables.outboundBatches.startedAt })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
      const items = await trx
        .select({ id: WI.id, shipmentId: WI.shipmentId, status: WI.status, createdAt: WI.createdAt })
        .from(WI)
        .where(and(eq(WI.batchId, batchId), notInArray(WI.status, ['completed', 'excluded'])))
        .orderBy(asc(WI.shipmentId));
      const shipmentIds = items.map((item) => item.shipmentId);
      const trackingNos = await this.trackingNosOf(trx, shipmentIds);
      const recipients = await this.recipientsOf(trx, shipmentIds);
      const views: BatchBoxLabelState[] = [];
      for (const item of items) {
        views.push({
          shipmentId: item.shipmentId,
          workItemId: item.id,
          workItemStatus: item.status,
          trackingNo: trackingNos.get(item.shipmentId) ?? null,
          recipientMasked: recipients.get(item.shipmentId) ?? '',
          ...(item.status === 'withdrawing'
            ? WITHDRAWING
            : await this.stateOf(
                trx,
                item.shipmentId,
                batch.startedAt !== null,
                await this.discardedPaperCutoff(trx, item.shipmentId, item),
              )),
        });
      }
      return views;
    }, tx);
  }

  /** 박스마다 지금 쓰는 송장 번호 — 송장 스캔 조회(`ShipmentWaybillReader.byTrackingNo`)와 같은 기준(종결 송장 제외). */
  private async trackingNosOf(trx: DbTx, shipmentIds: string[]): Promise<Map<string, string>> {
    if (shipmentIds.length === 0) return new Map();
    const rows = await trx
      .select({ shipmentId: wmsTables.waybills.shipmentId, trackingNo: wmsTables.waybills.trackingNo })
      .from(wmsTables.waybills)
      .where(
        and(
          inArray(wmsTables.waybills.shipmentId, shipmentIds),
          notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
        ),
      );
    const byShipment = new Map<string, string>();
    for (const row of rows) {
      if (row.trackingNo && !byShipment.has(row.shipmentId)) byShipment.set(row.shipmentId, row.trackingNo);
    }
    return byShipment;
  }

  private async recipientsOf(trx: DbTx, shipmentIds: string[]): Promise<Map<string, string>> {
    if (shipmentIds.length === 0) return new Map();
    const rows = await trx
      .select({ id: wmsTables.shipments.id, snapshot: wmsTables.shipments.recipientSnapshot })
      .from(wmsTables.shipments)
      .where(inArray(wmsTables.shipments.id, shipmentIds));
    return new Map(rows.map((row) => [row.id, maskName(readRecipientName(row.snapshot))]));
  }
```

`waybill-label.service.ts` 의 `statesForBatch` 는 반환 타입을 추론하므로 손대지 않는다.

- [ ] **Step 4: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- waybill-label-state.reader`
Expected: PASS (기존 3 + 새 1)

- [ ] **Step 5: 타입·단위 테스트**

Run: `npm run type-check && npx jest apps/core/src/modules/fulfillment --maxWorkers=2`
Expected: 에러 0, 실패 0 (`shipment-waybill.reader.spec.ts` 의 `readDeliveryNote` 가 다시 내보낸 경로로 그대로 통과). ⚠️ tsc 증분 캐시가 가짜 에러를 내면 `rm -f tsconfig.tsbuildinfo` 후 다시

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/reader/recipient-snapshot.ts \
  apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.ts \
  apps/core/src/modules/fulfillment/waybill/waybill-label-state.reader.ts \
  apps/core/src/modules/fulfillment/waybill/waybill-label-state.reader.integration.spec.ts
git commit -m "feat(fulfillment): 배치 박스 송장 상태에 작업 상태·송장번호·받는 분을 싣는다"
```

---

### Task 2: 스캔 버스가 사람이 친 키를 따로 낸다

**Files:**
- Create: `native/warehouse-app/src/core/hardware/scan/humanKeys.ts`
- Test: `native/warehouse-app/src/core/hardware/scan/humanKeys.test.ts`
- Modify: `native/warehouse-app/src/core/hardware/scan/ScanProvider.tsx`
- Modify: `native/warehouse-app/src/core/hardware/scan/useScanner.ts`
- Test: `native/warehouse-app/src/core/hardware/scan/ScanProvider.test.tsx` (끝에 추가)

**Interfaces:**
- Produces: `createHumanKeyDetector(opts?: { maxInterKeyMs?: number }): { feed(key: string, at: number): string[]; flush(at: number): string[]; reset(): void }`, `HUMAN_CONTROL_KEYS: ReadonlySet<string>` (`Enter`·`Backspace`·`ArrowUp`·`ArrowDown`·`Escape`)
- Produces: 버스 `subscribeKeys(h: (key: string) => void): () => void`, 훅 `useHumanKeys(handler: ((key: string) => void) | null): void` — `null` 이면 구독하지 않는다. 핸들러는 렌더마다 새 함수여도 된다(마지막 것을 부른다). 입력칸·`isComposing`·`defaultPrevented`·`[inert]` 안의 키와 Ctrl/Alt/Meta 조합은 오지 않는다
- Consumes: 없음(스캔 경로 `createScanBuffer` 는 그대로 둔다 — 기존 스캔 동작을 바꾸지 않는다)

- [ ] **Step 1: 판정 표 테스트를 쓴다**

`humanKeys.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createHumanKeyDetector } from './humanKeys';

describe('createHumanKeyDetector', () => {
  it('혼자 들어온 글자는 다음 키가 늦게 오면 사람 것이다', () => {
    const d = createHumanKeyDetector();
    expect(d.feed('7', 0)).toEqual([]);
    expect(d.feed('3', 200)).toEqual(['7']);
    expect(d.flush(260)).toEqual(['3']);
  });

  it('미뤄 둔 글자는 묶음 간격이 지나야 낸다', () => {
    const d = createHumanKeyDetector();
    d.feed('5', 0);
    expect(d.flush(30)).toEqual([]);
    expect(d.flush(51)).toEqual(['5']);
    expect(d.flush(200)).toEqual([]);
  });

  it('스캐너 묶음과 그 끝의 Enter 는 사람 키가 아니다', () => {
    const d = createHumanKeyDetector();
    const out = [...'8801234'].flatMap((key, i) => d.feed(key, i * 5));
    expect([...out, ...d.feed('Enter', 40), ...d.flush(500)]).toEqual([]);
  });

  it('묶음이 끝나고 늦게 온 Enter 는 사람 것이다', () => {
    const d = createHumanKeyDetector();
    [...'8801'].forEach((key, i) => d.feed(key, i * 5));
    expect(d.feed('Enter', 300)).toEqual(['Enter']);
  });

  it('제어 키는 바로 내고, 미뤄 둔 글자를 먼저 낸다', () => {
    const d = createHumanKeyDetector();
    d.feed('2', 0);
    expect(d.feed('Enter', 10)).toEqual(['2', 'Enter']);
    expect(d.feed('ArrowDown', 500)).toEqual(['ArrowDown']);
    expect(d.feed('Backspace', 900)).toEqual(['Backspace']);
    expect(d.feed('Escape', 1300)).toEqual(['Escape']);
  });

  it('모르는 제어 키는 내지 않되 미뤄 둔 글자는 낸다', () => {
    const d = createHumanKeyDetector();
    d.feed('4', 0);
    expect(d.feed('Shift', 100)).toEqual(['4']);
    expect(d.feed('Tab', 300)).toEqual([]);
  });

  it('reset 은 미뤄 둔 글자를 버린다', () => {
    const d = createHumanKeyDetector();
    d.feed('9', 0);
    d.reset();
    expect(d.flush(500)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/core/hardware/scan/humanKeys.test.ts`
Expected: FAIL — `Failed to resolve import "./humanKeys"`

- [ ] **Step 3: 판정기를 구현한다**

`humanKeys.ts`:

```ts
/**
 * 사람이 친 키를 스캐너 묶음과 가른다(스테이션 UI 스펙 §5.6). 스캐너는 글자를 수 ms 간격으로 몰아 보내고 Enter 로 끝낸다 —
 * 글자 하나가 혼자 들어오고 다음 키가 늦게 오면(또는 그만큼 시간이 지나면) 사람이 친 것이다.
 *
 * - 글자는 사람 것으로 확정될 때까지 미룬다(최대 maxInterKeyMs). 바로 다음 글자가 붙어 오면 둘 다 스캔이다
 * - 제어 키(HUMAN_CONTROL_KEYS)는 바로 낸다. 미뤄 둔 글자가 있으면 그것부터 내서 순서를 지킨다
 * - 스캔 묶음 바로 뒤의 Enter 는 스캔의 끝이다 — 사람 Enter 로 내지 않는다(결품 창이 스캐너 Enter 로 확정되면 안 된다)
 */
export const HUMAN_CONTROL_KEYS: ReadonlySet<string> = new Set(['Enter', 'Backspace', 'ArrowUp', 'ArrowDown', 'Escape']);

export function createHumanKeyDetector(opts: { maxInterKeyMs?: number } = {}) {
  const maxInterKeyMs = opts.maxInterKeyMs ?? 50;
  let lastAt = -Infinity;
  let pending: { key: string; at: number } | null = null;
  let burst = false;

  function reset() {
    lastAt = -Infinity;
    pending = null;
    burst = false;
  }

  function feed(key: string, at: number): string[] {
    const out: string[] = [];
    const fast = at - lastAt <= maxInterKeyMs;
    if (key.length === 1) {
      if (fast) {
        // 앞 글자에 바로 붙어 왔다 — 둘 다 스캐너 묶음이다
        pending = null;
        burst = true;
      } else {
        if (pending) out.push(pending.key);
        pending = { key, at };
        burst = false;
      }
      lastAt = at;
      return out;
    }
    const scanEnd = key === 'Enter' && burst && fast;
    if (pending) out.push(pending.key);
    reset();
    if (!scanEnd && HUMAN_CONTROL_KEYS.has(key)) out.push(key);
    return out;
  }

  /** 미뤄 둔 글자가 확정될 만큼 시간이 지났으면 낸다 — 타이머가 부른다. */
  function flush(at: number): string[] {
    if (pending === null || at - pending.at <= maxInterKeyMs) return [];
    const { key } = pending;
    pending = null;
    return [key];
  }

  return { feed, flush, reset };
}
```

- [ ] **Step 4: 판정 테스트 통과를 확인한다**

Run: `npx vitest run src/core/hardware/scan/humanKeys.test.ts`
Expected: PASS (7)

- [ ] **Step 5: 버스 테스트를 쓴다**

`ScanProvider.test.tsx` 의 import 에 `useHumanKeys` 를 더하고(`import { useScanner, useScanEmit, useScanObserver, useCommandScans, useHumanKeys } from './useScanner';`), 파일 끝에 붙인다:

```tsx
function KeysProbe({ onKey }: { onKey: (key: string) => void }) {
  useHumanKeys(onKey);
  return null;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('사람 키 채널(스펙 §5.6)', () => {
  it('사람이 친 숫자와 Enter 는 사람 키로 오고 스캔으로 오지 않는다', async () => {
    const onKey = vi.fn();
    const onScan = vi.fn();
    render(
      <ScanProvider>
        <KeysProbe onKey={onKey} />
        <Probe onScan={onScan} />
      </ScanProvider>
    );
    fireKey('7');
    await wait(80);
    fireKey('Enter');
    expect(onKey.mock.calls).toEqual([['7'], ['Enter']]);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('스캐너 묶음은 사람 키를 내지 않는다', async () => {
    const onKey = vi.fn();
    const onScan = vi.fn();
    render(
      <ScanProvider>
        <KeysProbe onKey={onKey} />
        <Probe onScan={onScan} />
      </ScanProvider>
    );
    for (const key of [...'8801234', 'Enter']) fireKey(key);
    await wait(80);
    expect(onScan).toHaveBeenCalledWith('8801234');
    expect(onKey).not.toHaveBeenCalled();
  });

  it('입력칸에서 친 키는 입력칸이 받는다 — 사람 키로 오지 않는다', async () => {
    const onKey = vi.fn();
    render(
      <ScanProvider>
        <KeysProbe onKey={onKey} />
        <input aria-label="칸" />
      </ScanProvider>
    );
    const input = screen.getByLabelText('칸');
    input.focus();
    fireEvent.keyDown(input, { key: '7' });
    await wait(80);
    expect(onKey).not.toHaveBeenCalled();
  });

  it('null 을 주면 구독하지 않는다', async () => {
    const onKey = vi.fn();
    function Off() {
      useHumanKeys(null);
      return null;
    }
    render(
      <ScanProvider>
        <Off />
      </ScanProvider>
    );
    fireKey('7');
    await wait(80);
    expect(onKey).not.toHaveBeenCalled();
  });
});
```

(`describe` 가 import 에 없으면 `import { describe, it, expect, vi } from 'vitest';` 로 맞춘다.)

- [ ] **Step 6: 실패를 확인한다**

Run: `npx vitest run src/core/hardware/scan/ScanProvider.test.tsx`
Expected: FAIL — `useHumanKeys` 가 없다

- [ ] **Step 7: 버스에 채널을 단다**

`ScanProvider.tsx`:

```tsx
import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { createScanBuffer } from './scanBuffer';
import { createHumanKeyDetector } from './humanKeys';
import { isPreservedScanEnter } from './hidScanBoundary';
import { isCommandCode } from './commandPrefix';
```

```tsx
type Handler = (e: ScanEvent) => void;
type CommandHandler = (code: string) => void;
type KeyHandler = (key: string) => void;

interface ScanBus {
  subscribe(h: Handler): () => void;
  /** 일반 구독자보다 먼저 받는다 — «다음 스캔에서 지운다» 류(피드백 테두리)가 같은 스캔의 결과를 지우지 않게. */
  observe(h: Handler): () => void;
  /**
   * 명령 바코드(`%…`) 수신처. 하나뿐이다(스테이션 셸). 없으면 명령 스캔은 버린다 —
   * 일반 구독자(출고 화면은 모든 스캔을 송장으로 연다)에게는 어떤 경우에도 가지 않는다.
   */
  setCommandHandler(h: CommandHandler): () => void;
  /** 사람이 친 키(스펙 §5.6) — 수량 입력·결품 창·직접 입력. 스캐너 묶음과 그 끝 Enter 는 오지 않는다. */
  subscribeKeys(h: KeyHandler): () => void;
  emit(e: ScanEvent): void;
}
```

`ScanProvider` 본문:

```tsx
export function ScanProvider({ children }: { children: React.ReactNode }) {
  const handlers = useRef(new Set<Handler>());
  const observers = useRef(new Set<Handler>());
  const keyHandlers = useRef(new Set<KeyHandler>());
  const commandHandler = useRef<CommandHandler | null>(null);

  const bus = useMemo<ScanBus>(
    () => ({
      subscribe(h) {
        handlers.current.add(h);
        return () => handlers.current.delete(h);
      },
      observe(h) {
        observers.current.add(h);
        return () => observers.current.delete(h);
      },
      setCommandHandler(h) {
        commandHandler.current = h;
        return () => {
          if (commandHandler.current === h) commandHandler.current = null;
        };
      },
      subscribeKeys(h) {
        keyHandlers.current.add(h);
        return () => keyHandlers.current.delete(h);
      },
      emit(e) {
        if (isCommandCode(e.code)) {
          commandHandler.current?.(e.code);
          return;
        }
        observers.current.forEach((h) => h(e));
        handlers.current.forEach((h) => h(e));
      },
    }),
    []
  );

  useEffect(() => {
    const buffer = createScanBuffer();
    const human = createHumanKeyDetector();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const emitKeys = (keys: string[]) =>
      keys.forEach((key) => keyHandlers.current.forEach((h) => h(key)));
    const reset = () => {
      buffer.reset();
      human.reset();
    };
    function onKeyDown(ev: KeyboardEvent) {
      const target = ev.target;
      if (
        (ev.defaultPrevented && !isPreservedScanEnter(ev)) ||
        ev.isComposing ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest('input, textarea, select, [inert]')))
      ) {
        reset();
        return;
      }
      const at = performance.now();
      if (!ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        emitKeys(human.feed(ev.key, at));
        clearTimeout(flushTimer);
        // 미뤄 둔 글자는 묶음 간격이 지나면 사람 것으로 확정한다
        flushTimer = setTimeout(() => emitKeys(human.flush(performance.now())), 60);
      }
      const code = buffer.feed(ev.key, at);
      if (code) {
        ev.preventDefault();
        bus.emit({ code, source: 'hid', at: Date.now() });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('focusin', reset);
    window.addEventListener('focusout', reset);
    return () => {
      clearTimeout(flushTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('focusin', reset);
      window.removeEventListener('focusout', reset);
    };
  }, [bus]);

  return <ScanContext.Provider value={bus}>{children}</ScanContext.Provider>;
}
```

`useScanner.ts` 의 import 를 `import { useEffect, useRef } from 'react';` 로 바꾸고 끝에 더한다:

```ts
/**
 * 사람이 친 키(스펙 §5.6) — 스캐너 묶음과 그 끝 Enter 는 오지 않는다. 입력칸에 포커스가 있으면 입력칸이 받는다.
 * null 이면 구독하지 않는다. 핸들러는 렌더마다 새 함수여도 된다 — 다시 구독하지 않고 마지막 것을 부른다.
 */
export function useHumanKeys(handler: ((key: string) => void) | null): void {
  const bus = useScanBus();
  const latest = useRef(handler);
  latest.current = handler;
  const active = handler !== null;
  useEffect(() => {
    if (!active) return;
    return bus.subscribeKeys((key) => latest.current?.(key));
  }, [bus, active]);
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npx vitest run src/core/hardware/scan`
Expected: PASS — 기존 스캔 테스트 전부 + 새 4. 기존 `ScanProvider`·`BarcodeInput`·`useWorkScanQueue` 테스트가 하나라도 빨개지면 스캔 경로를 건드린 것이다 — `buffer.feed` 를 부르는 순서·조건이 위 코드와 같은지 본다

- [ ] **Step 9: 커밋**

```bash
git add native/warehouse-app/src/core/hardware/scan/humanKeys.ts native/warehouse-app/src/core/hardware/scan/humanKeys.test.ts \
  native/warehouse-app/src/core/hardware/scan/ScanProvider.tsx native/warehouse-app/src/core/hardware/scan/ScanProvider.test.tsx \
  native/warehouse-app/src/core/hardware/scan/useScanner.ts
git commit -m "feat(warehouse-app): 스캔 버스가 사람이 친 키를 스캐너 묶음과 갈라 따로 낸다"
```

---
### Task 3: F1 판정 — 송장 상태 → 화면, 송장/상품 가르기, 품목 표

**Files:**
- Modify: `native/warehouse-app/src/domains/outbound/types.ts`
- Modify: `native/warehouse-app/src/core/operations/OperationContext.tsx:9-11` (`WorkPermissions`)
- Modify: `native/warehouse-app/src/domains/outbound/queries.ts` (`fetchShipmentByWaybill` 추출)
- Create: `native/warehouse-app/src/domains/outbound/inspection.ts`
- Test: `native/warehouse-app/src/domains/outbound/inspection.test.ts`

**Interfaces:**
- Produces (types.ts): `ShipmentLineAllocation { sourceLocationId: string; locationCode: string; qty: number }`, `ShortPickContext { workItemLeaseVersion: number; sessionId: string; sessionVersion: number; manifestVersion: number }`. `ShipmentByWaybillLine` 에 선택 필드 `lineVersion?: number`·`allocations?: ShipmentLineAllocation[]`, `ShipmentByWaybill` 에 `deliveryNote?: string | null`·`shortPickContext?: ShortPickContext | null` — 옛 core 면 없다
- Produces (OperationContext): `WorkPermissions` 에 `stationForceDispatch?: boolean`(F10)·`shortPick?: boolean`(F9)
- Produces (queries.ts): `fetchShipmentByWaybill(api: ApiClient, trackingNo: string, warehouseId: string | null): Promise<ShipmentByWaybill>` — `useShipmentByWaybill` 도 이걸 쓴다(요청 경로 그대로)
- Produces (inspection.ts):
  - `type InspectionGate = { kind: 'inspect' } | { kind: 'reprint'; changes: LabelItemChange[] } | { kind: 'withdraw' } | { kind: 'withdrawn' } | { kind: 'reject'; message: string }`
  - `inspectionGateOf(found: ShipmentByWaybill, ctx: { warehouseId: string; canPrint: boolean }): InspectionGate`
  - `NOT_IN_TODAY_MESSAGE`, `PRINT_ELSEWHERE_MESSAGE`
  - `type InspectScanKind = 'same-waybill' | 'maybe-waybill' | 'product'`, `classifyInspectScan(code: string, trackingNo: string): InspectScanKind`, `isNotFound(error: unknown): boolean`
  - `progressOf(found: Pick<ShipmentByWaybill, 'lines'>): SimpleOutboundLineProgress[]`
  - `interface InspectionRow { shipmentLineId: string; name: string; locations: string; ordered: number; scanned: number; done: boolean }`, `inspectionRows(lines, progress): InspectionRow[]`, `inspectionTotals(rows): { scanned: number; ordered: number }`
  - `scannedLineOf(before, after): string | null`, `remainingOf(progress, shipmentLineId): number`, `formatTrackingNo(trackingNo: string): string`

- [ ] **Step 1: 판정 표 테스트를 쓴다**

`inspection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError, ConflictError } from '../../core/data/httpClient';
import { WAYBILL_STALE_MESSAGE } from '../../core/data/errorMessage';
import {
  NOT_IN_TODAY_MESSAGE,
  PRINT_ELSEWHERE_MESSAGE,
  classifyInspectScan,
  formatTrackingNo,
  inspectionGateOf,
  inspectionRows,
  inspectionTotals,
  isNotFound,
  progressOf,
  remainingOf,
  scannedLineOf,
} from './inspection';
import type { ShipmentByWaybill, ShipmentByWaybillLine } from './types';

const found = (patch: Partial<ShipmentByWaybill> = {}): ShipmentByWaybill => ({
  warehouseId: 'w-1',
  shipmentId: 's-1',
  trackingNo: '421033881907',
  carrier: 'HANJIN',
  waybillStatus: 'registered',
  shipmentStatus: 'planned',
  batchId: 'b-1',
  workItemId: 'wi-1',
  workItemStatus: 'queued',
  recipientMasked: '김*영',
  lines: [],
  labelState: 'current',
  labelChanges: [],
  labelIssue: null,
  removals: [],
  exitTo: null,
  ...patch,
});
const ctx = { warehouseId: 'w-1', canPrint: true };

describe('inspectionGateOf — 송장 스캔 결과 → 화면(스펙 §6.2)', () => {
  it.each([
    ['current', { kind: 'inspect' }],
    ['external', { kind: 'inspect' }],
    ['withdrawing', { kind: 'withdraw' }],
    ['not_started', { kind: 'reject', message: '배치 현황(F2)에서 「작업 시작」을 먼저 눌러 주세요.' }],
    ['unavailable', { kind: 'reject', message: '송장 상태를 확인할 수 없어요. 관리자에게 문의해 주세요.' }],
  ] as const)('%s → %o', (labelState, gate) => {
    expect(inspectionGateOf(found({ labelState }), ctx)).toEqual(gate);
  });

  it('송장이 바뀌었거나 아직 안 찍었으면 새 송장 출력 — 바뀐 줄을 함께', () => {
    const changes = [{ locationCode: 'B-11-1', skuId: 'k', name: '집게핀', printedQty: 3, currentQty: 2 }];
    expect(inspectionGateOf(found({ labelState: 'reprint_required', labelChanges: changes }), ctx)).toEqual({ kind: 'reprint', changes });
    expect(inspectionGateOf(found({ labelState: 'never_printed' }), ctx)).toEqual({ kind: 'reprint', changes: [] });
  });

  it('프린터가 없으면 새 송장 대신 «프린터 있는 자리»', () => {
    expect(inspectionGateOf(found({ labelState: 'reprint_required' }), { ...ctx, canPrint: false })).toEqual({
      kind: 'reject',
      message: PRINT_ELSEWHERE_MESSAGE,
    });
  });

  it('빠진 박스는 작업 항목이 없어도 «빠진 박스» 다 — 오늘 배치에 없다고 하지 않는다', () => {
    expect(inspectionGateOf(found({ labelState: 'withdrawn', workItemId: null }), ctx)).toEqual({ kind: 'withdrawn' });
  });

  it.each([
    ['다른 창고', { warehouseId: 'w-2' }, '송장의 창고와 선택 창고가 달라요. 창고를 확인해 주세요.'],
    ['이미 출고', { shipmentStatus: 'shipped' }, '이미 출고된 송장이에요'],
    ['오늘 배치에 없음', { workItemId: null, labelState: null }, NOT_IN_TODAY_MESSAGE],
    ['무효 송장', { labelState: 'unavailable', labelIssue: 'WAYBILL_STALE' }, WAYBILL_STALE_MESSAGE],
  ] as const)('거절: %s', (_name, patch, message) => {
    expect(inspectionGateOf(found(patch), ctx)).toEqual({ kind: 'reject', message });
  });
});

describe('classifyInspectScan — 검수 중 스캔이 송장인가 상품인가', () => {
  it.each([
    ['421033881907', 'same-waybill'],
    ['421033881915', 'maybe-waybill'],
    ['8801234567890', 'product'],
    ['8801002', 'product'],
    ['B-05-03', 'product'],
  ] as const)('%s → %s', (code, kind) => {
    expect(classifyInspectScan(code, '421033881907')).toBe(kind);
  });

  it('하이픈 없이 찍힌 같은 송장도 같은 송장이다', () => {
    expect(classifyInspectScan('421033881907', '4210-3388-1907')).toBe('same-waybill');
  });

  it('송장번호가 짧으면(10자리 미만) 숫자 상품을 송장으로 의심하지 않는다', () => {
    expect(classifyInspectScan('12345678', 'T-1')).toBe('product');
  });
});

describe('isNotFound', () => {
  it('404 만 참이다', () => {
    expect(isNotFound(new ApiError('GET /x → 404', 404, 'NOT_FOUND'))).toBe(true);
    expect(isNotFound(new ConflictError('x', 'LOCATION_OUTBOUND_WAREHOUSE_MISMATCH'))).toBe(false);
    expect(isNotFound(new Error('offline'))).toBe(false);
  });
});

const line = (patch: Partial<ShipmentByWaybillLine> & Pick<ShipmentByWaybillLine, 'shipmentLineId'>): ShipmentByWaybillLine => ({
  skuId: `sku-${patch.shipmentLineId}`,
  skuCode: 'C',
  skuName: `상품 ${patch.shipmentLineId}`,
  qty: 1,
  pickedQty: 0,
  inspectedQty: 0,
  ...patch,
});

describe('품목 표', () => {
  const lines = [
    line({ shipmentLineId: 'c', qty: 2, allocations: [{ sourceLocationId: 'lc', locationCode: 'C-02-4', qty: 2 }] }),
    line({ shipmentLineId: 'a', qty: 1, allocations: [{ sourceLocationId: 'la', locationCode: 'A-03-2', qty: 1 }] }),
    line({ shipmentLineId: 'x', qty: 1 }),
    line({
      shipmentLineId: 'b',
      qty: 3,
      allocations: [
        { sourceLocationId: 'lb1', locationCode: 'B-10', qty: 1 },
        { sourceLocationId: 'lb2', locationCode: 'B-11-1', qty: 2 },
      ],
    }),
  ];

  it('송장 순서(첫 위치의 코드 순)로, 위치 없는 줄(옛 core)은 뒤로', () => {
    const rows = inspectionRows(lines, progressOf({ lines }));
    expect(rows.map((r) => [r.shipmentLineId, r.locations])).toEqual([
      ['a', 'A-03-2'],
      ['b', 'B-10 · B-11-1'],
      ['c', 'C-02-4'],
      ['x', ''],
    ]);
  });

  it('스캔·완료는 진행에서, 합계는 주문을 넘지 않는다', () => {
    const progress = progressOf({ lines }).map((p) => (p.shipmentLineId === 'a' ? { ...p, pickedQty: 1 } : p));
    const rows = inspectionRows(lines, progress);
    expect(rows.find((r) => r.shipmentLineId === 'a')).toMatchObject({ scanned: 1, done: true });
    expect(inspectionTotals(rows)).toEqual({ scanned: 1, ordered: 7 });
  });

  it('진행 시작값은 pickedQty 와 inspectedQty 중 큰 쪽(내려놨다 다시 연 박스)', () => {
    expect(progressOf({ lines: [line({ shipmentLineId: 'a', qty: 2, pickedQty: 0, inspectedQty: 2 })] })[0].pickedQty).toBe(2);
  });

  it('scannedLineOf 는 오른 줄, remainingOf 는 «주문 − 스캔»', () => {
    const before = progressOf({ lines });
    const after = before.map((p) => (p.shipmentLineId === 'b' ? { ...p, pickedQty: 1 } : p));
    expect(scannedLineOf(before, after)).toBe('b');
    expect(scannedLineOf(after, after)).toBeNull();
    expect(remainingOf(after, 'b')).toBe(2);
    expect(remainingOf(after, 'none')).toBe(0);
  });

  it('12자리 송장번호는 4-4-4 로 끊어 보인다', () => {
    expect(formatTrackingNo('421033881907')).toBe('4210-3388-1907');
    expect(formatTrackingNo('T-1')).toBe('T-1');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/domains/outbound/inspection.test.ts`
Expected: FAIL — `Failed to resolve import "./inspection"`

- [ ] **Step 3: 타입을 넓힌다**

`types.ts` 의 `ShipmentByWaybillLine` 을 바꾸고 두 타입을 더한다:

```ts
/** 줄의 배정 위치 하나 — 송장 품목 줄과 같은 순서(로케이션 코드 순, core A5) */
export interface ShipmentLineAllocation {
  sourceLocationId: string;
  locationCode: string;
  qty: number;
}

export interface ShipmentByWaybillLine {
  shipmentLineId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  qty: number;
  pickedQty: number;
  inspectedQty: number;
  /** core A5(스테이션 UI PR A)부터 싣는다 — 옛 core 면 없다. 결품 보고의 줄 버전 */
  lineVersion?: number;
  /** core A5 부터. 시작 안 된 배치·작업 항목 없음이면 [] */
  allocations?: ShipmentLineAllocation[];
}

/** 결품 보고(POST shipments/:id/short-picks)에 보낼 버전들(core A5). 스캔마다 낡으므로 보내기 직전에 다시 조회한다 */
export interface ShortPickContext {
  workItemLeaseVersion: number;
  sessionId: string;
  sessionVersion: number;
  manifestVersion: number;
}
```

`ShipmentByWaybill` 의 `exitTo` 아래에 더한다:

```ts
  /** 배송메모(core A5). 없으면 null, 옛 core 면 필드가 없다 */
  deliveryNote?: string | null;
  /** 결품 보고 버전(core A5). 활성 작업 항목과 active 세션이 둘 다 있을 때만 값이 있다 */
  shortPickContext?: ShortPickContext | null;
```

`OperationContext.tsx`:

```ts
export interface WorkPermissions {
  forceDispatch?: boolean;
  /** 스테이션 강제출고(F10, core A3). 관리자 `forceDispatch` 와 다른 뜻이다 */
  stationForceDispatch?: boolean;
  /** 결품 보고(F9, core A2) */
  shortPick?: boolean;
}
```

`queries.ts` 의 import 와 `useShipmentByWaybill` 를 바꾼다(`useOutboundBatches` 는 그대로):

```ts
import { useMutation, useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { OutboundBatchSummary, ShipmentByWaybill } from './types';

/** GET /shipments/by-waybill — 조회 전용이라 몇 번을 불러도 서버가 바뀌지 않는다(#986 스펙 §10.5). */
export function fetchShipmentByWaybill(
  api: ApiClient,
  trackingNo: string,
  warehouseId: string | null
): Promise<ShipmentByWaybill> {
  const qs = new URLSearchParams({ trackingNo });
  if (warehouseId) qs.set('warehouseId', warehouseId);
  return api.request<ShipmentByWaybill>({ path: `/shipments/by-waybill?${qs.toString()}` });
}

/**
 * GET /shipments/by-waybill?trackingNo=…
 *
 * 스캔 시점에 딱 한 번 부르고 결과로 화면을 이동한다 — 캐시로 붙잡을 이유가
 * 없어서 useQuery 가 아니라 useMutation 이다.
 */
export function useShipmentByWaybill(warehouseId?: string | null) {
  const api = useApiClient();
  return useMutation({
    mutationFn: (trackingNo: string) => fetchShipmentByWaybill(api, trackingNo, warehouseId ?? null),
  });
}
```

- [ ] **Step 4: 판정을 구현한다**

`inspection.ts`:

```ts
import { WAYBILL_STALE_MESSAGE } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import type { ShipmentByWaybill, ShipmentByWaybillLine, SimpleOutboundLineProgress } from './types';
import type { LabelItemChange } from './waybillLabel';

/** 송장 스캔 결과 → 출고 검수(F1) 화면(스테이션 UI 스펙 §6.2) */
export type InspectionGate =
  | { kind: 'inspect' }
  | { kind: 'reprint'; changes: LabelItemChange[] }
  | { kind: 'withdraw' }
  | { kind: 'withdrawn' }
  | { kind: 'reject'; message: string };

export const NOT_IN_TODAY_MESSAGE = '이 송장은 오늘 배치에 없어요 — 관리자에게 문의해 주세요';
export const PRINT_ELSEWHERE_MESSAGE = '송장을 새로 출력해야 해요. 프린터 있는 자리에서 출력해 주세요.';

/**
 * 순서가 뜻을 가진다: 빠진 박스는 작업 항목이 없으므로 «오늘 배치에 없음» 보다 먼저 본다.
 * 서버의 전진 명령도 같은 조건으로 막는다(I5) — 이건 헛걸음 방지다.
 */
export function inspectionGateOf(found: ShipmentByWaybill, ctx: { warehouseId: string; canPrint: boolean }): InspectionGate {
  if (found.warehouseId && found.warehouseId !== ctx.warehouseId)
    return { kind: 'reject', message: '송장의 창고와 선택 창고가 달라요. 창고를 확인해 주세요.' };
  if (found.shipmentStatus === 'shipped') return { kind: 'reject', message: '이미 출고된 송장이에요' };
  if (found.labelState === 'withdrawn') return { kind: 'withdrawn' };
  if (found.labelState === 'withdrawing') return { kind: 'withdraw' };
  if (found.workItemId === null) return { kind: 'reject', message: NOT_IN_TODAY_MESSAGE };
  switch (found.labelState) {
    case 'not_started':
      return { kind: 'reject', message: '배치 현황(F2)에서 「작업 시작」을 먼저 눌러 주세요.' };
    case 'unavailable':
      return {
        kind: 'reject',
        message: found.labelIssue === 'WAYBILL_STALE' ? WAYBILL_STALE_MESSAGE : '송장 상태를 확인할 수 없어요. 관리자에게 문의해 주세요.',
      };
    case 'never_printed':
    case 'reprint_required':
      return ctx.canPrint ? { kind: 'reprint', changes: found.labelChanges } : { kind: 'reject', message: PRINT_ELSEWHERE_MESSAGE };
    default:
      return { kind: 'inspect' };
  }
}

export type InspectScanKind = 'same-waybill' | 'maybe-waybill' | 'product';

const digitsOf = (value: string) => value.replace(/\D/g, '');

/**
 * 검수 중 스캔이 송장인가 상품인가(계획이 정함). 같은 배치의 송장은 같은 택배사 형식이라, 숫자만이고 지금 송장번호와
 * 길이가 같으면 송장일 수 있다 — 화면이 조회해 보고 없으면(404) 상품으로 넘긴다. 짧은 송장번호(10자리 미만)로는 의심하지 않는다.
 */
export function classifyInspectScan(code: string, trackingNo: string): InspectScanKind {
  const own = digitsOf(trackingNo);
  if (code === trackingNo || (own.length > 0 && code === own)) return 'same-waybill';
  return own.length >= 10 && /^\d+$/.test(code) && code.length === own.length ? 'maybe-waybill' : 'product';
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** 조회 결과의 줄 진행. 전량 검수 전까지 inspectedQty 가 0 이라 pickedQty 를 우선한다(SimpleOutboundScreen 과 같은 규칙). */
export function progressOf(found: Pick<ShipmentByWaybill, 'lines'>): SimpleOutboundLineProgress[] {
  return found.lines.map((line) => ({
    shipmentLineId: line.shipmentLineId,
    skuId: line.skuId,
    qty: line.qty,
    pickedQty: Math.max(line.pickedQty, line.inspectedQty),
    inspectedQty: line.inspectedQty,
  }));
}

export interface InspectionRow {
  shipmentLineId: string;
  name: string;
  /** 배정 위치 코드(송장 순서) — 보여 주기만 한다(§6.4). 옛 core 면 '' */
  locations: string;
  ordered: number;
  scanned: number;
  done: boolean;
}

/** 송장 품목 줄 순서(로케이션 코드 순 — core 의 collate "C" 와 같은 코드 단위 비교). 위치 없는 줄은 뒤로, 같으면 원래 순서. */
function byLocation(a: InspectionRow, b: InspectionRow): number {
  if (a.locations === b.locations) return 0;
  if (!a.locations) return 1;
  if (!b.locations) return -1;
  return a.locations < b.locations ? -1 : 1;
}

export function inspectionRows(
  lines: readonly ShipmentByWaybillLine[],
  progress: readonly SimpleOutboundLineProgress[]
): InspectionRow[] {
  const scannedOf = new Map(progress.map((p) => [p.shipmentLineId, p.pickedQty]));
  return lines
    .map((line) => {
      const scanned = scannedOf.get(line.shipmentLineId) ?? 0;
      return {
        shipmentLineId: line.shipmentLineId,
        name: line.skuName,
        locations: (line.allocations ?? []).map((a) => a.locationCode).join(' · '),
        ordered: line.qty,
        scanned,
        done: scanned >= line.qty,
      };
    })
    .sort(byLocation);
}

export function inspectionTotals(rows: readonly InspectionRow[]): { scanned: number; ordered: number } {
  return rows.reduce(
    (total, row) => ({ scanned: total.scanned + Math.min(row.scanned, row.ordered), ordered: total.ordered + row.ordered }),
    { scanned: 0, ordered: 0 }
  );
}

/** 이번 스캔으로 오른 줄 — «이 상품 전량»(F8)과 표의 진행 줄이 쓴다 */
export function scannedLineOf(
  before: readonly SimpleOutboundLineProgress[],
  after: readonly SimpleOutboundLineProgress[]
): string | null {
  const previous = new Map(before.map((p) => [p.shipmentLineId, p.pickedQty]));
  return after.find((p) => p.pickedQty > (previous.get(p.shipmentLineId) ?? 0))?.shipmentLineId ?? null;
}

export function remainingOf(progress: readonly SimpleOutboundLineProgress[], shipmentLineId: string): number {
  const line = progress.find((p) => p.shipmentLineId === shipmentLineId);
  return line ? Math.max(0, line.qty - line.pickedQty) : 0;
}

export function formatTrackingNo(trackingNo: string): string {
  return /^\d{12}$/.test(trackingNo) ? trackingNo.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3') : trackingNo;
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run src/domains/outbound && npx tsc -b`
Expected: PASS (새 테스트 + 기존 outbound 테스트 전부 — `queries.test.tsx` 의 by-waybill 경로가 그대로다), tsc 에러 0

- [ ] **Step 6: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound/types.ts native/warehouse-app/src/domains/outbound/queries.ts \
  native/warehouse-app/src/domains/outbound/inspection.ts native/warehouse-app/src/domains/outbound/inspection.test.ts \
  native/warehouse-app/src/core/operations/OperationContext.tsx
git commit -m "feat(warehouse-app): 출고 검수 판정 — 송장 상태별 화면, 송장/상품 가르기, 송장 순서 품목 표"
```

---

### Task 4: 결품 — 초안·보고 위치·요청·오류 문구

**Files:**
- Create: `native/warehouse-app/src/domains/outbound/shortPick.ts`
- Test: `native/warehouse-app/src/domains/outbound/shortPick.test.ts`

**Interfaces:**
- Consumes: Task 3 의 `ShipmentByWaybill`·`ShipmentByWaybillLine`·`ShipmentLineAllocation`·`ShortPickContext`
- Produces:
  - `type ShortPickReason = 'inventory_shortage' | 'item_damaged'`, `SHORT_PICK_REASON_KEYS: ReadonlyArray<{ key: string; reason: ShortPickReason; label: string }>`(`1` 재고 부족, `2` 파손)
  - `interface ShortPickDraftLine { shipmentLineId: string; name: string; max: number; qty: number }`, `shortPickDraft(lines, progress): ShortPickDraftLine[]`
  - `shortPickSources(allocations: readonly ShipmentLineAllocation[], pickedQty: number, shortQty: number): Array<{ sourceLocationId: string; shortQty: number }> | null`
  - `interface ShortPickRequest`(core `ReportShipmentShortPickDto` 와 같은 모양), `buildShortPickRequest(fresh: ShipmentByWaybill, draft: ReadonlyArray<{ shipmentLineId: string; qty: number }>, reason: ShortPickReason): { ok: true; request: ShortPickRequest } | { ok: false; message: string }`
  - `SHORT_PICK_STALE_MESSAGE`, `SHORT_PICK_UNAVAILABLE_MESSAGE`
  - `interface ShortPickRefill { shipmentLineId: string; skuId: string; sourceLocationId: string; locationCode: string; qty: number }`, `interface ShortPickResult { operationId: string; shipmentId: string; workItemId: string; operationStatus: 'pending' | 'completed'; outcome: 'refilled' | 'withdrawing' | 'exited'; refills: ShortPickRefill[] }`
  - `reportShortPick(api: ApiClient, shipmentId: string, request: ShortPickRequest, idempotencyKey: string): Promise<ShortPickResult>`
  - `shortPickErrorMessage(error: unknown): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`shortPick.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ApiError, ConflictError } from '../../core/data/httpClient';
import {
  SHORT_PICK_STALE_MESSAGE,
  SHORT_PICK_UNAVAILABLE_MESSAGE,
  buildShortPickRequest,
  reportShortPick,
  shortPickDraft,
  shortPickErrorMessage,
  shortPickSources,
} from './shortPick';
import type { ShipmentByWaybill, ShipmentByWaybillLine } from './types';

const A = { sourceLocationId: 'la', locationCode: 'A-01', qty: 2 };
const B = { sourceLocationId: 'lb', locationCode: 'B-01', qty: 3 };

describe('shortPickSources — 송장 순서 귀속을 재구성해 마지막 위치부터(U11, 10-02 결정)', () => {
  it.each([
    ['위치 하나', [{ ...A, qty: 3 }], 1, 2, [{ sourceLocationId: 'la', shortQty: 2 }]],
    ['마지막 위치 몫 이하 — U11 그대로', [A, B], 0, 3, [{ sourceLocationId: 'lb', shortQty: 3 }]],
    ['넘치면 앞 위치로', [A, B], 1, 4, [{ sourceLocationId: 'la', shortQty: 1 }, { sourceLocationId: 'lb', shortQty: 3 }]],
    ['앞 위치를 다 집었으면 뒤에서만', [A, B], 3, 2, [{ sourceLocationId: 'lb', shortQty: 2 }]],
  ] as const)('%s', (_name, allocations, picked, short, expected) => {
    expect(shortPickSources(allocations, picked, short)).toEqual(expected);
  });

  it('안 집은 몫보다 많거나, 0 이거나, 배정이 없으면 null', () => {
    expect(shortPickSources([A, B], 1, 5)).toBeNull();
    expect(shortPickSources([A], 0, 0)).toBeNull();
    expect(shortPickSources([], 0, 1)).toBeNull();
  });
});

const line = (patch: Partial<ShipmentByWaybillLine>): ShipmentByWaybillLine => ({
  shipmentLineId: 'l-1',
  skuId: 'sku-1',
  skuCode: 'C',
  skuName: '퍼머넌트 1제',
  qty: 5,
  pickedQty: 1,
  inspectedQty: 0,
  lineVersion: 7,
  allocations: [A, B],
  ...patch,
});
const fresh = (patch: Partial<ShipmentByWaybill> = {}): ShipmentByWaybill => ({
  warehouseId: 'w-1',
  shipmentId: 's-1',
  trackingNo: '421033881907',
  carrier: 'HANJIN',
  waybillStatus: 'registered',
  shipmentStatus: 'planned',
  batchId: 'b-1',
  workItemId: 'wi-1',
  workItemStatus: 'picking',
  recipientMasked: '김*영',
  lines: [line({}), line({ shipmentLineId: 'l-2', qty: 1, pickedQty: 1, allocations: [A] })],
  labelState: 'current',
  labelChanges: [],
  labelIssue: null,
  removals: [],
  exitTo: null,
  deliveryNote: null,
  shortPickContext: { workItemLeaseVersion: 3, sessionId: 'ses-1', sessionVersion: 9, manifestVersion: 2 },
  ...patch,
});

describe('shortPickDraft', () => {
  it('덜 찍힌 줄만 «주문 − 스캔» 으로 미리 채운다(§7.1-1)', () => {
    const f = fresh();
    const progress = f.lines.map((l) => ({ shipmentLineId: l.shipmentLineId, skuId: l.skuId, qty: l.qty, pickedQty: l.pickedQty, inspectedQty: 0 }));
    expect(shortPickDraft(f.lines, progress)).toEqual([{ shipmentLineId: 'l-1', name: '퍼머넌트 1제', max: 4, qty: 4 }]);
  });
});

describe('buildShortPickRequest — 보내기 직전에 다시 조회한 박스로', () => {
  it('버전·위치를 채운 요청', () => {
    expect(buildShortPickRequest(fresh(), [{ shipmentLineId: 'l-1', qty: 4 }], 'item_damaged')).toEqual({
      ok: true,
      request: {
        workItemId: 'wi-1',
        expectedWorkItemLeaseVersion: 3,
        sessionId: 'ses-1',
        expectedSessionVersion: 9,
        expectedManifestVersion: 2,
        lines: [
          { shipmentLineId: 'l-1', sourceLocationId: 'la', expectedLineVersion: 7, shortQty: 1 },
          { shipmentLineId: 'l-1', sourceLocationId: 'lb', expectedLineVersion: 7, shortQty: 3 },
        ],
        reason: 'item_damaged',
      },
    });
  });

  it.each([
    ['빼는 중', { workItemStatus: 'withdrawing' }],
    ['다른 오퍼레이션 대기', { workItemStatus: 'short_pick_recovery' }],
    ['버전 없음(세션 없음)', { shortPickContext: null }],
    ['작업 항목 없음', { workItemId: null }],
  ] as const)('보고할 수 없는 상태: %s', (_name, patch) => {
    expect(buildShortPickRequest(fresh(patch), [{ shipmentLineId: 'l-1', qty: 1 }], 'inventory_shortage')).toEqual({
      ok: false,
      message: SHORT_PICK_UNAVAILABLE_MESSAGE,
    });
  });

  it('창을 연 사이 더 찍혀 남은 수량이 줄었으면 보내지 않는다', () => {
    const moved = fresh({ lines: [line({ pickedQty: 3 })] });
    expect(buildShortPickRequest(moved, [{ shipmentLineId: 'l-1', qty: 4 }], 'inventory_shortage')).toEqual({
      ok: false,
      message: SHORT_PICK_STALE_MESSAGE,
    });
  });

  it('줄 버전·배정이 없는 옛 core 면 보내지 않는다', () => {
    const legacy = fresh({ lines: [line({ lineVersion: undefined, allocations: undefined })] });
    expect(buildShortPickRequest(legacy, [{ shipmentLineId: 'l-1', qty: 1 }], 'inventory_shortage')).toEqual({
      ok: false,
      message: SHORT_PICK_STALE_MESSAGE,
    });
  });

  it('결품 수량이 모두 0 이면 보내지 않는다', () => {
    expect(buildShortPickRequest(fresh(), [{ shipmentLineId: 'l-1', qty: 0 }], 'inventory_shortage')).toEqual({
      ok: false,
      message: '결품 수량이 없어요.',
    });
  });
});

describe('reportShortPick', () => {
  it('POST /shipments/:id/short-picks 에 멱등 키와 함께 보낸다', async () => {
    const request = vi.fn(async () => ({ outcome: 'exited', refills: [] }));
    const built = buildShortPickRequest(fresh(), [{ shipmentLineId: 'l-1', qty: 1 }], 'inventory_shortage');
    if (!built.ok) throw new Error('fixture');
    await reportShortPick({ request } as never, 's-1', built.request, 'key-1');
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/shipments/s-1/short-picks', body: built.request, idempotencyKey: 'key-1' });
  });
});

describe('shortPickErrorMessage', () => {
  it.each([
    [new ConflictError('x', 'SHORT_PICK_EXCEEDS_UNPICKED'), SHORT_PICK_STALE_MESSAGE],
    [new ConflictError('x', 'SHORT_PICK_LINE_STALE'), SHORT_PICK_STALE_MESSAGE],
    [new ConflictError('x', 'SHORT_PICK_WORK_ITEM_WAITING'), SHORT_PICK_UNAVAILABLE_MESSAGE],
    [new ConflictError('x', 'SHORT_PICK_DISPATCH_EXISTS'), '이미 출고된 박스예요.'],
    [new ApiError('POST /shipments/s/short-picks → 403', 403, 'FORBIDDEN'), '결품 보고 권한이 없어요. 관리자에게 요청해 주세요.'],
  ])('%s', (error, message) => {
    expect(shortPickErrorMessage(error)).toBe(message);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/domains/outbound/shortPick.test.ts`
Expected: FAIL — `Failed to resolve import "./shortPick"`

- [ ] **Step 3: 구현한다**

`shortPick.ts`:

```ts
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError, type ApiClient } from '../../core/data/httpClient';
import type { ShipmentByWaybill, ShipmentByWaybillLine, ShipmentLineAllocation, SimpleOutboundLineProgress } from './types';

export type ShortPickReason = 'inventory_shortage' | 'item_damaged';

/** 결품 창 사유 키(스펙 §7.1-2, U10). 파손도 결품과 같은 경로, 사유만 다르다 */
export const SHORT_PICK_REASON_KEYS: ReadonlyArray<{ key: string; reason: ShortPickReason; label: string }> = [
  { key: '1', reason: 'inventory_shortage', label: '재고 부족' },
  { key: '2', reason: 'item_damaged', label: '파손' },
];

export interface ShortPickDraftLine {
  shipmentLineId: string;
  name: string;
  /** 남은 수량 — 줄일 수만 있다 */
  max: number;
  qty: number;
}

/** 덜 찍힌 줄을 «주문 − 스캔» 으로 미리 채운다(스펙 §7.1-1) */
export function shortPickDraft(
  lines: readonly ShipmentByWaybillLine[],
  progress: readonly SimpleOutboundLineProgress[]
): ShortPickDraftLine[] {
  const picked = new Map(progress.map((p) => [p.shipmentLineId, p.pickedQty]));
  return lines.flatMap((line) => {
    const max = line.qty - (picked.get(line.shipmentLineId) ?? 0);
    return max > 0 ? [{ shipmentLineId: line.shipmentLineId, name: line.skuName, max, qty: max }] : [];
  });
}

/**
 * 결품을 보고할 위치(스펙 §7.1-4·U11, 2026-10-02 결정). 서버는 스캔을 송장 순서(배정 순서)로 귀속한다(core A1) — 그 귀속을
 * 재구성해 위치마다 «안 집은 몫» 을 구하고, 결품을 마지막 위치부터 그 몫만큼 채워 앞으로 넘긴다. 마지막 위치 몫 이하면 U11
 * 그대로 마지막 위치 하나다. 서버는 (줄, 위치)의 안 집은 몫을 넘는 결품을 409 SHORT_PICK_EXCEEDS_UNPICKED 로 거절한다.
 * 다 담지 못하거나 결품이 0 이면 null.
 */
export function shortPickSources(
  allocations: readonly ShipmentLineAllocation[],
  pickedQty: number,
  shortQty: number
): Array<{ sourceLocationId: string; shortQty: number }> | null {
  let picked = pickedQty;
  const unpicked = allocations.map((allocation) => {
    const attributed = Math.min(allocation.qty, Math.max(0, picked));
    picked -= attributed;
    return { sourceLocationId: allocation.sourceLocationId, unpicked: allocation.qty - attributed };
  });
  let left = shortQty;
  const sources: Array<{ sourceLocationId: string; shortQty: number }> = [];
  for (let i = unpicked.length - 1; i >= 0 && left > 0; i--) {
    const take = Math.min(unpicked[i].unpicked, left);
    if (take > 0) {
      sources.unshift({ sourceLocationId: unpicked[i].sourceLocationId, shortQty: take });
      left -= take;
    }
  }
  return shortQty > 0 && left === 0 ? sources : null;
}

/** core `ReportShipmentShortPickDto` 와 같은 모양 */
export interface ShortPickRequest {
  workItemId: string;
  expectedWorkItemLeaseVersion: number;
  sessionId: string;
  expectedSessionVersion: number;
  expectedManifestVersion: number;
  lines: Array<{ shipmentLineId: string; sourceLocationId: string; expectedLineVersion: number; shortQty: number }>;
  reason: ShortPickReason;
}

export const SHORT_PICK_STALE_MESSAGE = '박스 상태가 바뀌었어요. 다시 F9 를 눌러 주세요.';
export const SHORT_PICK_UNAVAILABLE_MESSAGE = '이 박스는 지금 결품을 보고할 수 없어요. 송장을 다시 찍어 주세요.';

/** 결품은 대기·피킹 중일 때만(스펙 §11 PR A 계약 메모 — 빼는 중·다른 오퍼레이션 대기 중이면 서버가 409) */
const REPORTABLE_WORK_ITEM_STATUSES: readonly string[] = ['queued', 'picking'];

/** 보내기 직전에 다시 조회한 박스로 요청을 만든다 — 버전은 스캔마다 낡는다(PR A 계약 메모) */
export function buildShortPickRequest(
  fresh: ShipmentByWaybill,
  draft: ReadonlyArray<{ shipmentLineId: string; qty: number }>,
  reason: ShortPickReason
): { ok: true; request: ShortPickRequest } | { ok: false; message: string } {
  const context = fresh.shortPickContext;
  if (!fresh.workItemId || !context || !REPORTABLE_WORK_ITEM_STATUSES.includes(fresh.workItemStatus ?? ''))
    return { ok: false, message: SHORT_PICK_UNAVAILABLE_MESSAGE };
  const wanted = draft.filter((entry) => entry.qty > 0);
  if (wanted.length === 0) return { ok: false, message: '결품 수량이 없어요.' };
  const lines: ShortPickRequest['lines'] = [];
  for (const want of wanted) {
    const line = fresh.lines.find((l) => l.shipmentLineId === want.shipmentLineId);
    if (!line || line.lineVersion === undefined || !line.allocations) return { ok: false, message: SHORT_PICK_STALE_MESSAGE };
    if (want.qty > line.qty - line.pickedQty) return { ok: false, message: SHORT_PICK_STALE_MESSAGE };
    const sources = shortPickSources(line.allocations, line.pickedQty, want.qty);
    if (!sources) return { ok: false, message: SHORT_PICK_STALE_MESSAGE };
    for (const source of sources)
      lines.push({
        shipmentLineId: line.shipmentLineId,
        sourceLocationId: source.sourceLocationId,
        expectedLineVersion: line.lineVersion,
        shortQty: source.shortQty,
      });
  }
  return {
    ok: true,
    request: {
      workItemId: fresh.workItemId,
      expectedWorkItemLeaseVersion: context.workItemLeaseVersion,
      sessionId: context.sessionId,
      expectedSessionVersion: context.sessionVersion,
      expectedManifestVersion: context.manifestVersion,
      lines,
      reason,
    },
  };
}

/** 결품을 뺀 곳에서 다시 채운 몫 — 현장이 그 로케이션으로 가서 집는다(core `ShortPickRefillDto`) */
export interface ShortPickRefill {
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  locationCode: string;
  qty: number;
}

/** core `ShipmentShortPickResponseDto` 중 화면이 쓰는 것 */
export interface ShortPickResult {
  operationId: string;
  shipmentId: string;
  workItemId: string;
  operationStatus: 'pending' | 'completed';
  outcome: 'refilled' | 'withdrawing' | 'exited';
  refills: ShortPickRefill[];
}

export function reportShortPick(
  api: ApiClient,
  shipmentId: string,
  request: ShortPickRequest,
  idempotencyKey: string
): Promise<ShortPickResult> {
  return api.request<ShortPickResult>({
    method: 'POST',
    path: `/shipments/${shipmentId}/short-picks`,
    body: request,
    idempotencyKey,
  });
}

/** 버전·몫이 어긋난 거절 — 박스를 다시 보고 다시 보고하면 된다(`shipment-short-pick.service.ts`·`box-allocation.manager.ts`) */
const STALE_CODES: ReadonlySet<string> = new Set([
  'SHORT_PICK_SESSION_STALE',
  'SHIPMENT_STALE_MANIFEST_VERSION',
  'SHORT_PICK_LINE_STALE',
  'SHORT_PICK_WORK_ITEM_STALE',
  'SHORT_PICK_EXCEEDS_UNPICKED',
  'SHORT_PICK_ALLOCATION_MISMATCH',
  'SHORT_PICK_LINE_MISMATCH',
  'SHORT_PICK_WORK_ITEM_MISMATCH',
]);

const SHORT_PICK_MESSAGES: Record<string, string> = {
  SHORT_PICK_WORK_ITEM_STATE: SHORT_PICK_UNAVAILABLE_MESSAGE,
  SHORT_PICK_WORK_ITEM_WAITING: SHORT_PICK_UNAVAILABLE_MESSAGE,
  SHORT_PICK_DISPATCH_EXISTS: '이미 출고된 박스예요.',
  SHORT_PICK_SHIPMENT_NOT_PLANNED: '출고 계획이 바뀐 박스예요. 관리자에게 문의해 주세요.',
  SHORT_PICK_INVOICE_NOT_VOIDABLE: '송장을 지금 처리할 수 없어 결품을 보고하지 못했어요. 관리자에게 문의해 주세요.',
};

export function shortPickErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && STALE_CODES.has(error.code)) return SHORT_PICK_STALE_MESSAGE;
    if (error.code && SHORT_PICK_MESSAGES[error.code]) return SHORT_PICK_MESSAGES[error.code];
    // outbound 문맥의 403 문구는 강제출고 권한이다 — 결품에는 결품 문구를 쓴다
    if (error.status === 403) return '결품 보고 권한이 없어요. 관리자에게 요청해 주세요.';
  }
  return errorMessage(error, 'outbound');
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/domains/outbound/shortPick.test.ts && npx tsc -b`
Expected: PASS, tsc 에러 0

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound/shortPick.ts native/warehouse-app/src/domains/outbound/shortPick.test.ts
git commit -m "feat(warehouse-app): 결품 보고 — 송장 순서 귀속으로 위치를 정하고 직전 재조회 버전으로 요청을 만든다"
```

---

### Task 5: 박스 하나의 스캔 큐 — `useInspectionBox` (지금 복구 장치 그대로)

**Files:**
- Modify: `native/warehouse-app/src/core/operations/WorkBoundary.tsx:16-56` (`ScanAllowance` 선택 필드화, 단순출고 경로 허용)
- Test: `native/warehouse-app/src/core/operations/WorkBoundary.runtime.test.tsx` (끝에 추가)
- Modify: `native/warehouse-app/src/core/hardware/scan/useWorkScanQueue.ts` (`settle`)
- Test: `native/warehouse-app/src/core/hardware/scan/useWorkScanQueue.test.tsx` (끝에 추가)
- Modify: `native/warehouse-app/src/domains/outbound/mutations.ts` (무효화 2개 추가)
- Create: `native/warehouse-app/src/station/outbound/__fixtures__/outboundServer.ts`
- Create: `native/warehouse-app/src/station/outbound/useInspectionBox.ts`
- Test: `native/warehouse-app/src/station/outbound/useInspectionBox.test.tsx`

**Interfaces:**
- Consumes: Task 3 `progressOf`·`scannedLineOf`, `useSimpleOutboundScan`·`useForceSimpleOutbound`(mutations.ts), `useWorkScanQueue`, `useWorkAreaBlocked`
- Produces:
  - `ScanAllowance { path: string; operationId?: string; warehouseId?: string; sourceLocationId?: string }` — 단순출고 스캔(`/shipments/:id/simple-outbound-scans`)은 경로·id 만 맞으면 첫 전송 중 허용. 위치 확인 출고는 지금처럼 본문의 창고·위치까지 본다(`LocationOutboundScreen` 수정 없음)
  - `useWorkScanQueue(...).settle(): Promise<void>` — 저장 중·처리 중인 입력이 다 끝나면 풀리고, 머리가 실패하면 그 오류로 거절. 실행기를 거치지 않는 요청(뺄 상품의 `return-bin-removals`, Task 9)용이다 — 실행기의 불확실 결과는 약속이 풀리지 않아 drain 이 끝나지 않으므로 `useInspectionBox` 는 자기 `settle` 을 쓴다
  - `STATION_FORCE_REASON = 'station_force_command'`, `STATION_WITHDRAW_REASON = 'station_withdraw_command'`, `INTAKE_BLOCKED_MESSAGE`, `UNCERTAIN_SCAN_MESSAGE`
  - `interface InspectionBoxEvents { onAccepted(shipmentLineId: string | null, quantity: number): void; onShipped(): void; onRejected(message: string, barcode: string | null): void; onExcess(): void }`
  - `useInspectionBox(box: ShipmentByWaybill, events: InspectionBoxEvents): { progress: SimpleOutboundLineProgress[]; workItemStatus: string; lastScan: { barcode: string; shipmentLineId: string } | null; intakeBlocked: boolean; idle: boolean; forcing: boolean; queueError: unknown; storageError: unknown; accept(barcode: string, quantity: number): boolean; settle(): Promise<void>; retryHead(): Promise<void>; forceOut(): Promise<void> }`
  - 픽스처(테스트 전용): `createOutboundServer({ boxes: FakeBox[] })` → `OutboundServer`(`request`, `config`, `requests`, `scanCalls`, `scans`, `forces`, `shortPicks`, `excludes`, `confirmedPrints`, `holdSends()`, `loseResponses(v)`, `pick(trackingNo, lineId, qty)`, `box(trackingNo)`), `createTestRuntime(server, permissions?, store?)`, `batchSummary(patch)`, `WAREHOUSE_ID = 'w-1'`, 타입 `FakeBox`·`FakeLine`

- [ ] **Step 1: WorkBoundary — 실패하는 테스트를 쓴다**

`WorkBoundary.runtime.test.tsx` 끝에 붙인다(`ScanRequest` 바로 아래와 같은 꼴):

```tsx
function SimpleScanRequest() {
  const api = useApiClient();
  return (
    <WorkArea
      kind="outbound"
      scanAllowance={{ path: '/shipments/shipment-1/simple-outbound-scans', operationId: 'simple-1' }}
    >
      <button
        onClick={() => {
          void api.request({
            method: 'POST',
            path: '/shipments/shipment-1/simple-outbound-scans',
            idempotencyKey: 'simple-1',
            body: { barcode: '8801', quantity: 1 },
          });
        }}
      >
        단순 스캔
      </button>
    </WorkArea>
  );
}

it('단순출고 스캔도 첫 전송 중엔 막지 않고, 결과가 불확실해지면 막는다', async () => {
  let resolveScan!: (response: Response) => void;
  const scanResponse = new Promise<Response>((resolve) => {
    resolveScan = resolve;
  });
  const defaultHandler = fetchHandler;
  fetchHandler = async (...args) =>
    String(args[0]).endsWith('/shipments/shipment-1/simple-outbound-scans') ? scanResponse : defaultHandler(...args);
  authed = true;
  renderBoundary(<SimpleScanRequest />);
  await waitFor(() => expect(screen.getByText('단순 스캔').closest('[inert]')).toBeNull());

  await userEvent.click(screen.getByRole('button', { name: '단순 스캔' }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/shipments/shipment-1/simple-outbound-scans'))
    ).toBe(true)
  );
  expect(screen.getByText('단순 스캔').closest('[inert]')).toBeNull();

  resolveScan(Response.json({ error: 'Forbidden' }, { status: 403 }));

  await waitFor(() => expect(screen.getByText('단순 스캔').closest('[inert]')).not.toBeNull());
  expect(await createOperationStore().get('simple-1')).toMatchObject({ status: 'uncertain', attempts: 1 });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/core/operations/WorkBoundary.runtime.test.tsx`
Expected: FAIL — 타입 에러(`warehouseId`·`sourceLocationId` 누락) 또는 첫 전송 중 `[inert]` 가 붙어 `toBeNull` 실패

- [ ] **Step 3: 허용 규칙을 넓힌다**

`WorkBoundary.tsx`:

```ts
export interface ScanAllowance {
  path: string;
  operationId?: string;
  /** 위치 확인 출고(`location-outbound-scans`)만 — 본문의 창고·출발 위치가 지금 고른 것과 같아야 한다 */
  warehouseId?: string;
  sourceLocationId?: string;
}
```

`useWorkAreaBlocked` 위에 `const SCAN_PATH = /^\/shipments\/[^/]+\/(location|simple)-outbound-scans$/;` 를 두고, `every` 콜백의 경로 조건과 본문 검사를 바꾼다:

```ts
    return !state.operations.every((op) => {
      if (
        op.scope !== state.scope ||
        op.id !== scanAllowance.operationId ||
        op.path !== scanAllowance.path ||
        !SCAN_PATH.test(op.path) ||
        !['queued', 'sending'].includes(op.status) ||
        op.attempts > 1
      )
        return false;
      // 단순출고 스캔 본문(바코드·수량)엔 창고·위치가 없다 — 경로와 오퍼레이션 id 가 같으면 그 박스의 첫 전송이다
      if (op.path.endsWith('/simple-outbound-scans')) return true;
      try {
        const body = JSON.parse(op.bodyJson);
        return (
          body.warehouseId === scanAllowance.warehouseId &&
          body.sourceLocationId === scanAllowance.sourceLocationId
        );
      } catch {
        return false;
      }
    });
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/core/operations src/domains/outbound/LocationOutboundScreen.runtime.test.tsx`
Expected: PASS — 새 1 + 기존 WorkBoundary·위치 확인 출고 테스트 전부(위치 경로는 본문 검사가 그대로다)

- [ ] **Step 5: `settle` — 실패하는 테스트를 쓴다**

`useWorkScanQueue.test.tsx` 끝에 붙인다:

```tsx
it('settle 은 저장·처리가 다 끝난 뒤 풀리고, 머리가 실패하면 그 오류로 거절한다', async () => {
  const store = createOperationStore(crypto.randomUUID());
  const getScope = async () => 'local-test-worker';
  const runtime = { store, getScope, runner: createOperationRunner({ store, getScope, api: { request: vi.fn() } }) };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fail = false;
  const consumed: string[] = [];
  const { result } = renderHook(
    () =>
      useWorkScanQueue<string>(async (code) => {
        await gate;
        if (fail) throw new Error('lost');
        consumed.push(code);
      }, 'settle:s1'),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <OperationContext.Provider value={runtime}>{children}</OperationContext.Provider>
      ),
    }
  );
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => {
    result.current.enqueue('A');
    result.current.enqueue('B');
  });
  let settled = false;
  const done = result.current.settle().then(() => {
    settled = true;
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(settled).toBe(false);
  release();
  await act(async () => done);
  expect(consumed).toEqual(['A', 'B']);

  fail = true;
  act(() => result.current.enqueue('C'));
  await expect(result.current.settle()).rejects.toThrow('lost');
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx vitest run src/core/hardware/scan/useWorkScanQueue.test.tsx`
Expected: FAIL — `result.current.settle is not a function`

- [ ] **Step 7: `settle` 을 더한다**

`useWorkScanQueue.ts` 의 반환 객체에서 `retryHead` 바로 위에 더한다:

```ts
    /** 저장 중·처리 중인 입력이 다 끝날 때까지 기다린다. 머리가 실패했으면(결과를 모르는 입력) 그 오류로 거절한다 — 화면을 떠나기 전에 */
    async settle() {
      if (saveError) throw saveError;
      await savingQueue.drain();
      await queue.drain();
    },
```

Run: `npx vitest run src/core/hardware/scan/useWorkScanQueue.test.tsx`
Expected: PASS

- [ ] **Step 8: 출고 뒤 무효화를 넓힌다**

`mutations.ts` 의 두 `onSettled` 를 다음으로 바꾼다(주석 한 줄 추가):

```ts
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['outbound-batches'] });
      void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
      // 스테이션 상태바의 배치 진행과 보충 대기도 출고로 바뀐다
      void qc.invalidateQueries({ queryKey: ['batch-work-items'] });
      void qc.invalidateQueries({ queryKey: ['outbound-refills'] });
    },
```

- [ ] **Step 9: 가짜 core 픽스처를 만든다**

`src/station/outbound/__fixtures__/outboundServer.ts` — 실제 엔드포인트 모양 그대로, 상태는 메모리. Task 7~12 의 화면 테스트가 같이 쓴다:

```ts
/* 스테이션 출고 화면 테스트의 가짜 core — 엔드포인트 모양은 실제와 같고 상태는 메모리에 둔다. 테스트 전용 */
import 'fake-indexeddb/auto';
import { ApiError, ConflictError, type ApiClient } from '../../../core/data/httpClient';
import type { WorkPermissions, WorkRuntime } from '../../../core/operations/OperationContext';
import { createOperationRunner } from '../../../core/operations/operationRunner';
import { createOperationStore } from '../../../core/operations/operationStore';
import type {
  OutboundBatchSummary,
  ShipmentByWaybill,
  SimpleOutboundState,
  WithdrawalRemoval,
} from '../../../domains/outbound/types';
import type { LabelState } from '../../../domains/outbound/waybillLabel';

type Req = Parameters<ApiClient['request']>[0];

export const WAREHOUSE_ID = 'w-1';

export interface FakeLine {
  id: string;
  skuId: string;
  name: string;
  qty: number;
  barcode: string;
  /** 송장 순서 배정. 박스가 legacy 면 싣지 않는다 */
  locations?: Array<{ code: string; qty: number }>;
}

export interface FakeBox {
  shipmentId: string;
  trackingNo: string;
  batchId: string;
  recipient?: string;
  deliveryNote?: string | null;
  labelState?: LabelState;
  workItemStatus?: string;
  shipped?: boolean;
  /** PR A 이전 core — 배송메모·줄 버전·배정·결품 버전을 싣지 않는다 */
  legacy?: boolean;
  removals?: WithdrawalRemoval[];
  lines: FakeLine[];
}

interface LiveBox extends FakeBox {
  picked: Map<string, number>;
  labelState: LabelState;
  workItemStatus: string;
  shipped: boolean;
  withdrawn: boolean;
  removals: WithdrawalRemoval[];
  lineVersion: number;
}

export interface OutboundServerConfig {
  shortPickOutcome: 'refilled' | 'withdrawing' | 'exited';
  excludeOutcome: 'withdrawing' | 'removed';
  refills: unknown[];
  refillsFail: boolean;
  batches: { picking: OutboundBatchSummary[]; created: OutboundBatchSummary[] };
  /** 배치 박스 목록에 작업 상태·송장번호·받는 분을 싣지 않는 옛 core */
  legacyBatchStates: boolean;
}

export function batchSummary(
  patch: Partial<OutboundBatchSummary> & Pick<OutboundBatchSummary, 'id' | 'batchNumber'>
): OutboundBatchSummary {
  return {
    name: '오전',
    status: 'picking',
    totalItems: 2,
    totalQty: 5,
    startedAt: '2026-10-02T00:00:00.000Z',
    withdrawingItems: 0,
    ...patch,
  };
}

export function createOutboundServer(init: { boxes: FakeBox[] }) {
  const boxes: LiveBox[] = init.boxes.map((box) => ({
    ...box,
    picked: new Map<string, number>(),
    labelState: box.labelState ?? 'current',
    workItemStatus: box.workItemStatus ?? 'queued',
    shipped: box.shipped ?? false,
    withdrawn: false,
    removals: (box.removals ?? []).map((removal) => ({ ...removal })),
    lineVersion: 1,
  }));
  const config: OutboundServerConfig = {
    shortPickOutcome: 'refilled',
    excludeOutcome: 'withdrawing',
    refills: [],
    refillsFail: false,
    batches: { picking: [], created: [] },
    legacyBatchStates: false,
  };
  const requests: Req[] = [];
  const scanCalls: string[] = [];
  const scans: Array<{ key: string; shipmentId: string; barcode: string; quantity: number }> = [];
  const forces: Array<{ shipmentId: string; reason: string }> = [];
  const shortPicks: Array<{ shipmentId: string; body: unknown }> = [];
  const excludes: Array<{ batchId: string; shipmentId: string; reason: string }> = [];
  const confirmedPrints: string[] = [];
  const applied = new Map<string, SimpleOutboundState>();
  let sendGate: Promise<void> | null = null;
  let losing = false;

  const byTracking = (trackingNo: string) => boxes.find((b) => b.trackingNo === trackingNo);
  const byId = (shipmentId: string) => {
    const box = boxes.find((b) => b.shipmentId === shipmentId);
    if (!box) throw new Error(`unknown shipment ${shipmentId}`);
    return box;
  };
  const pickedOf = (box: LiveBox, lineId: string) => box.picked.get(lineId) ?? 0;
  const active = (box: LiveBox) => !box.shipped && !box.withdrawn;
  const workItemStatusOf = (box: LiveBox) =>
    box.shipped ? 'completed' : box.withdrawn ? 'excluded' : box.labelState === 'withdrawing' ? 'withdrawing' : box.workItemStatus;

  function outState(box: LiveBox): SimpleOutboundState {
    return {
      shipmentId: box.shipmentId,
      workItemStatus: workItemStatusOf(box),
      status: box.shipped ? 'shipped' : 'in_progress',
      dispatchAttemptId: box.shipped ? `d-${box.shipmentId}` : null,
      lines: box.lines.map((l) => ({
        shipmentLineId: l.id,
        skuId: l.skuId,
        qty: l.qty,
        pickedQty: pickedOf(box, l.id),
        inspectedQty: box.shipped ? l.qty : 0,
      })),
    };
  }

  function removalsOf(box: LiveBox): WithdrawalRemoval[] {
    return box.lines
      .filter((l) => pickedOf(box, l.id) > 0)
      .map((l) => {
        const code = l.locations?.[0]?.code ?? 'A-01-1';
        return {
          shipmentLineId: l.id,
          skuId: l.skuId,
          skuCode: l.skuId,
          skuName: l.name,
          sourceLocationId: `loc-${code}`,
          locationCode: code,
          boxQty: pickedOf(box, l.id),
          cartQty: 0,
        };
      });
  }

  function found(box: LiveBox): ShipmentByWaybill {
    return {
      warehouseId: WAREHOUSE_ID,
      shipmentId: box.shipmentId,
      trackingNo: box.trackingNo,
      carrier: 'HANJIN',
      waybillStatus: 'registered',
      shipmentStatus: box.shipped ? 'shipped' : 'planned',
      batchId: active(box) ? box.batchId : null,
      workItemId: active(box) ? `wi-${box.shipmentId}` : null,
      workItemStatus: active(box) ? workItemStatusOf(box) : null,
      recipientMasked: box.recipient ?? '김*영',
      lines: box.lines.map((l) => ({
        shipmentLineId: l.id,
        skuId: l.skuId,
        skuCode: l.skuId,
        skuName: l.name,
        qty: l.qty,
        pickedQty: pickedOf(box, l.id),
        inspectedQty: 0,
        ...(box.legacy
          ? {}
          : {
              lineVersion: box.lineVersion,
              allocations: (l.locations ?? []).map((loc) => ({
                sourceLocationId: `loc-${loc.code}`,
                locationCode: loc.code,
                qty: loc.qty,
              })),
            }),
      })),
      labelState: box.withdrawn ? 'withdrawn' : box.shipped ? null : box.labelState,
      labelChanges:
        box.labelState === 'reprint_required'
          ? [{ locationCode: 'B-11-1', skuId: box.lines[0].skuId, name: box.lines[0].name, printedQty: 3, currentQty: 2 }]
          : [],
      labelIssue: null,
      removals: active(box) && box.labelState === 'withdrawing' ? box.removals : [],
      exitTo: box.withdrawn ? 'draft' : null,
      ...(box.legacy
        ? {}
        : {
            deliveryNote: box.deliveryNote ?? null,
            shortPickContext: active(box)
              ? { workItemLeaseVersion: 3, sessionId: `ses-${box.batchId}`, sessionVersion: 5, manifestVersion: 2 }
              : null,
          }),
    };
  }

  async function scanBox(o: Req, shipmentId: string) {
    const key = o.idempotencyKey ?? '';
    const body = o.body as { barcode: string; quantity: number };
    scanCalls.push(key);
    if (sendGate) await sendGate;
    if (!applied.has(key)) {
      const box = byId(shipmentId);
      const line = box.lines.find((l) => l.barcode === body.barcode);
      if (!line) throw new ConflictError('not in shipment', 'SIMPLE_OUTBOUND_SKU_NOT_IN_SHIPMENT');
      if (pickedOf(box, line.id) + body.quantity > line.qty) throw new ConflictError('overscan', 'SIMPLE_OUTBOUND_OVERSCAN');
      box.picked.set(line.id, pickedOf(box, line.id) + body.quantity);
      box.workItemStatus = 'picking';
      box.lineVersion += 1;
      if (box.lines.every((l) => pickedOf(box, l.id) >= l.qty)) box.shipped = true;
      scans.push({ key, shipmentId, barcode: body.barcode, quantity: body.quantity });
      applied.set(key, outState(box));
    }
    // 서버는 반영했는데 응답을 잃었다 — 403 은 재시도하지 않는 불확실 결과다
    if (losing) throw new ApiError('응답 유실', 403);
    return applied.get(key);
  }

  function forceBox(o: Req, shipmentId: string) {
    const key = o.idempotencyKey ?? '';
    if (!applied.has(key)) {
      const box = byId(shipmentId);
      for (const l of box.lines) box.picked.set(l.id, l.qty);
      box.shipped = true;
      forces.push({ shipmentId, reason: (o.body as { reason: string }).reason });
      applied.set(key, outState(box));
    }
    return applied.get(key);
  }

  function shortPick(o: Req, shipmentId: string) {
    const box = byId(shipmentId);
    shortPicks.push({ shipmentId, body: o.body });
    const outcome = config.shortPickOutcome;
    const lines = (o.body as { lines: Array<{ shipmentLineId: string; shortQty: number }> }).lines;
    box.lineVersion += 1;
    if (outcome === 'refilled') box.labelState = 'reprint_required';
    if (outcome === 'withdrawing') {
      box.labelState = 'withdrawing';
      box.removals = removalsOf(box);
    }
    if (outcome === 'exited') box.withdrawn = true;
    return {
      operationId: 'op-short',
      shipmentId,
      workItemId: `wi-${shipmentId}`,
      operationStatus: outcome === 'withdrawing' ? 'pending' : 'completed',
      invoiceOperationId: null,
      outcome,
      refills:
        outcome === 'refilled'
          ? lines.map((l) => ({
              shipmentLineId: l.shipmentLineId,
              skuId: box.lines.find((x) => x.id === l.shipmentLineId)?.skuId ?? '',
              sourceLocationId: 'loc-C-07-1',
              locationCode: 'C-07-1',
              qty: l.shortQty,
            }))
          : [],
      shortages: [],
    };
  }

  function excludeBox(o: Req, batchId: string, shipmentId: string) {
    const box = byId(shipmentId);
    excludes.push({ batchId, shipmentId, reason: (o.body as { reason: string }).reason });
    if (config.excludeOutcome === 'withdrawing') {
      box.labelState = 'withdrawing';
      box.removals = removalsOf(box);
      return { operationId: 'op-exclude', workItem: { status: 'withdrawing' } };
    }
    box.withdrawn = true;
    return { operationId: 'op-exclude', workItem: { status: 'excluded' } };
  }

  function removeToBin(o: Req, shipmentId: string) {
    const box = byId(shipmentId);
    const line = box.lines.find((l) => l.barcode === (o.body as { barcode: string }).barcode);
    const removal = line && box.removals.find((r) => r.shipmentLineId === line.id && r.boxQty > 0);
    if (!removal) throw new ConflictError('not pending', 'REMOVAL_NOT_PENDING');
    removal.boxQty -= 1;
    box.removals = box.removals.filter((r) => r.boxQty > 0 || r.cartQty > 0);
    const exited = box.removals.length === 0;
    if (exited) box.withdrawn = true;
    return { removedQty: 1, exited, exitTo: exited ? 'draft' : null, removals: box.removals };
  }

  async function request<T>(o: Req): Promise<T> {
    requests.push(o);
    const method = o.method ?? 'GET';
    const [path, query = ''] = o.path.split('?');
    const params = new URLSearchParams(query);
    const reply = (value: unknown) => value as T;
    if (method === 'GET' && path === '/shipments/by-waybill') {
      const box = byTracking(params.get('trackingNo') ?? '');
      if (!box) throw new ApiError(`GET ${o.path} → 404`, 404, 'NOT_FOUND');
      return reply(found(box));
    }
    const scan = /^\/shipments\/([^/]+)\/simple-outbound-scans$/.exec(path);
    if (scan) return reply(await scanBox(o, scan[1]));
    const force = /^\/shipments\/([^/]+)\/simple-outbound-forces$/.exec(path);
    if (force) return reply(forceBox(o, force[1]));
    const short = /^\/shipments\/([^/]+)\/short-picks$/.exec(path);
    if (short) return reply(shortPick(o, short[1]));
    const exclude = /^\/outbound-batches\/([^/]+)\/shipments\/([^/]+)$/.exec(path);
    if (exclude && method === 'DELETE') return reply(excludeBox(o, exclude[1], exclude[2]));
    const label = /^\/shipments\/([^/]+)\/waybill\/label$/.exec(path);
    if (label) {
      const box = byId(label[1]);
      return reply({
        waybillId: `wb-${box.shipmentId}`,
        trackingNo: box.trackingNo,
        format: 'zpl',
        data: `^XA${box.trackingNo}^XZ`,
        pages: 1,
        fingerprint: `fp-${box.lineVersion}`,
        revision: 2,
      });
    }
    const labelPrint = /^\/shipments\/([^/]+)\/waybill\/label-prints$/.exec(path);
    if (labelPrint) {
      const box = byId(labelPrint[1]);
      box.labelState = 'current';
      confirmedPrints.push(box.shipmentId);
      return reply({ printedAt: '2026-10-02T05:00:00.000Z' });
    }
    const removal = /^\/shipments\/([^/]+)\/return-bin-removals$/.exec(path);
    if (removal) return reply(removeToBin(o, removal[1]));
    if (path === '/outbound-refills/pending') {
      if (config.refillsFail) throw new ApiError(`GET ${o.path} → 404`, 404, 'NOT_FOUND');
      return reply(config.refills);
    }
    if (path === '/outbound-batches/v2')
      return reply(params.get('status') === 'created' ? config.batches.created : config.batches.picking);
    const items = /^\/outbound-batches\/([^/]+)\/work-items$/.exec(path);
    if (items)
      return reply(
        boxes
          .filter((b) => b.batchId === items[1])
          .map((b) => ({ id: `wi-${b.shipmentId}`, shipmentId: b.shipmentId, status: workItemStatusOf(b) }))
      );
    const states = /^\/outbound-batches\/([^/]+)\/waybill-label-states$/.exec(path);
    if (states)
      return reply(
        boxes
          .filter((b) => b.batchId === states[1] && active(b))
          .map((b) => ({
            shipmentId: b.shipmentId,
            workItemId: `wi-${b.shipmentId}`,
            state: b.labelState,
            changes: [],
            issue: null,
            ...(config.legacyBatchStates
              ? {}
              : { workItemStatus: workItemStatusOf(b), trackingNo: b.trackingNo, recipientMasked: b.recipient ?? '김*영' }),
          }))
      );
    throw new Error(`Unexpected request ${method} ${o.path}`);
  }

  return {
    request,
    config,
    requests,
    scanCalls,
    scans,
    forces,
    shortPicks,
    excludes,
    confirmedPrints,
    /** 다음 스캔 응답을 붙잡는다 — 돌려받은 함수를 부르면 놓는다 */
    holdSends(): () => void {
      let release!: () => void;
      sendGate = new Promise<void>((resolve) => {
        release = () => {
          sendGate = null;
          resolve();
        };
      });
      return release;
    },
    loseResponses(value: boolean) {
      losing = value;
    },
    /** 다른 스테이션이 같은 박스를 찍은 것처럼 */
    pick(trackingNo: string, lineId: string, qty: number) {
      const box = byTracking(trackingNo);
      if (!box) throw new Error(`unknown tracking ${trackingNo}`);
      box.picked.set(lineId, pickedOf(box, lineId) + qty);
      box.lineVersion += 1;
    },
    box: byTracking,
  };
}

export type OutboundServer = ReturnType<typeof createOutboundServer>;

export function createTestRuntime(
  server: Pick<OutboundServer, 'request'>,
  permissions: WorkPermissions = { shortPick: true, stationForceDispatch: true },
  store = createOperationStore(crypto.randomUUID())
): WorkRuntime {
  const runner = createOperationRunner({
    api: { request: server.request },
    store,
    getScope: async () => 'scope',
    wait: async () => {},
  });
  return {
    store,
    runner,
    getScope: async () => 'scope',
    getCapabilities: async () => ({}),
    getPermissions: async () => permissions,
  };
}
```

- [ ] **Step 10: 훅의 실패하는 테스트를 쓴다**

`src/station/outbound/useInspectionBox.test.tsx` — `LocationOutboundScreen.runtime.test.tsx` 의 계약 무관 복구 시나리오(스펙 §10.1)를 이 훅으로 옮긴다:

```tsx
import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '../../app/session-context';
import type { Session } from '../../core/auth/session';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { OperationContext, type WorkRuntime } from '../../core/operations/OperationContext';
import { WorkBoundary } from '../../core/operations/WorkBoundary';
import type { ShipmentByWaybill } from '../../domains/outbound/types';
import { createOutboundServer, createTestRuntime, type FakeBox } from './__fixtures__/outboundServer';
import {
  STATION_FORCE_REASON,
  UNCERTAIN_SCAN_MESSAGE,
  useInspectionBox,
  type InspectionBoxEvents,
} from './useInspectionBox';

const session: Session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
};

const BOX: FakeBox = {
  shipmentId: 's-1',
  trackingNo: '421033881907',
  batchId: 'b-1',
  lines: [
    { id: 'l-1', skuId: 'sku-1', name: '컬러크림', qty: 2, barcode: 'A', locations: [{ code: 'A-03-2', qty: 2 }] },
    { id: 'l-2', skuId: 'sku-2', name: '집게핀', qty: 2, barcode: 'B', locations: [{ code: 'B-11-1', qty: 2 }] },
  ],
};

let box: ReturnType<typeof useInspectionBox>;
function Probe({ found, events }: { found: ShipmentByWaybill; events: InspectionBoxEvents }) {
  box = useInspectionBox(found, events);
  return <p data-testid="progress">{box.progress.map((p) => `${p.shipmentLineId}:${p.pickedQty}/${p.qty}`).join(',')}</p>;
}

function mount(runtime: WorkRuntime, found: ShipmentByWaybill, events: InspectionBoxEvents) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <SessionProvider session={session}>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={runtime.runner}>
          <OperationContext.Provider value={runtime}>
            <WorkBoundary>
              <Probe found={found} events={events} />
            </WorkBoundary>
          </OperationContext.Provider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

const newEvents = () => ({ onAccepted: vi.fn(), onShipped: vi.fn(), onRejected: vi.fn(), onExcess: vi.fn() });
const progress = () => screen.getByTestId('progress').textContent;

async function setup(fake: FakeBox = BOX) {
  const server = createOutboundServer({ boxes: [fake] });
  const runtime = createTestRuntime(server);
  const found = await server.request<ShipmentByWaybill>({ path: `/shipments/by-waybill?trackingNo=${fake.trackingNo}` });
  const events = newEvents();
  const view = mount(runtime, found, events);
  await waitFor(() => expect(box.intakeBlocked).toBe(false));
  const saved = () => runtime.store.draft<Array<{ id: string; data: { barcode: string } }>>(`scope:scan:outbound:${fake.shipmentId}`);
  return { server, runtime, found, events, view, saved };
}

describe('useInspectionBox — 박스 하나의 스캔 큐(스펙 §6.3·§10.1)', () => {
  it('A, A, B 를 찍은 순서와 수량 그대로 보낸다 — 응답이 늦어도', async () => {
    const { server, saved } = await setup();
    const release = server.holdSends();
    act(() => {
      box.accept('A', 1);
      box.accept('A', 1);
      box.accept('B', 1);
    });
    await waitFor(async () => expect(await saved()).toHaveLength(3));
    release();
    await waitFor(async () => expect(await saved()).toHaveLength(0));
    expect(server.scans.map((s) => s.barcode)).toEqual(['A', 'A', 'B']);
    expect(progress()).toBe('l-1:2/2,l-2:1/2');
  });

  it('수량을 실어 보낸다', async () => {
    const { server } = await setup();
    act(() => {
      box.accept('B', 2);
    });
    await waitFor(() => expect(server.scans).toEqual([expect.objectContaining({ barcode: 'B', quantity: 2 })]));
  });

  it('응답을 잃으면 입력을 막고, 다시 맞출 때 같은 키를 쓴다 — 두 번 반영하지 않는다', async () => {
    const { server, runtime, saved } = await setup();
    server.loseResponses(true);
    act(() => {
      box.accept('A', 1);
    });
    await waitFor(async () => expect((await runtime.store.pending('scope'))[0]?.status).toBe('uncertain'));
    await waitFor(() => expect(box.intakeBlocked).toBe(true));
    let accepted = true;
    act(() => {
      accepted = box.accept('B', 1);
    });
    expect(accepted).toBe(false);
    expect((await saved())?.map((e) => e.data.barcode)).toEqual(['A']);
    server.loseResponses(false);
    await act(async () => runtime.runner.retryPending());
    await waitFor(async () => expect(await saved()).toHaveLength(0));
    expect(server.scanCalls).toHaveLength(2);
    expect(new Set(server.scanCalls).size).toBe(1);
    expect(server.scans).toHaveLength(1);
    await waitFor(() => expect(box.intakeBlocked).toBe(false));
  });

  it('다시 열면 저장된 스캔을 원래 키로 다시 보낸다', async () => {
    const { server, runtime, found, events, view, saved } = await setup();
    server.loseResponses(true);
    act(() => {
      box.accept('A', 1);
      box.accept('B', 1);
    });
    await waitFor(async () => expect((await runtime.store.pending('scope'))[0]?.status).toBe('uncertain'));
    await waitFor(async () => expect(await saved()).toHaveLength(2));
    const before = (await saved()) ?? [];
    view.unmount();
    server.loseResponses(false);
    const reopened = createTestRuntime(server, undefined, runtime.store);
    mount(reopened, found, events);
    await act(async () => reopened.runner.retryPending());
    await waitFor(async () => expect(await saved()).toHaveLength(0));
    expect(server.scans.map((s) => s.key)).toEqual(before.map((e) => e.id));
    await waitFor(() => expect(progress()).toBe('l-1:1/2,l-2:1/2'));
  });

  it('스캔 저장에 실패하면 그 스캔을 지키고, 다음 입력을 막는다', async () => {
    const { server, runtime, saved } = await setup();
    const original = runtime.store.draft;
    let diskFull = true;
    vi.spyOn(runtime.store, 'draft').mockImplementation(async (id, update) => {
      if (id.includes(':scan:') && update && diskFull) throw new Error('disk full');
      return original(id, update);
    });
    act(() => {
      box.accept('A', 1);
    });
    await waitFor(() => expect(box.storageError).toBeTruthy());
    let accepted = true;
    act(() => {
      accepted = box.accept('B', 1);
    });
    expect(accepted).toBe(false);
    diskFull = false;
    await act(async () => box.retryHead());
    await waitFor(() => expect(server.scans.map((s) => s.barcode)).toEqual(['A']));
    await waitFor(async () => expect(await saved()).toHaveLength(0));
  });

  it('서버가 거절한 스캔은 반영 없이 알리고, 다음 스캔을 받는다', async () => {
    const { events, saved } = await setup();
    act(() => {
      box.accept('X', 1);
    });
    await waitFor(() => expect(events.onRejected).toHaveBeenCalledWith('이 송장에 없는 상품이에요', 'X'));
    await waitFor(async () => expect(await saved()).toHaveLength(0));
    act(() => {
      box.accept('A', 1);
    });
    await waitFor(() => expect(progress()).toBe('l-1:1/2,l-2:0/2'));
    expect(events.onAccepted).toHaveBeenCalledWith('l-1', 1);
    expect(box.lastScan).toEqual({ barcode: 'A', shipmentLineId: 'l-1' });
  });

  it('저장된 작업을 다 확인하기 전엔 입력을 받지 않는다', async () => {
    const server = createOutboundServer({ boxes: [BOX] });
    const runtime = createTestRuntime(server);
    const found = await server.request<ShipmentByWaybill>({ path: `/shipments/by-waybill?trackingNo=${BOX.trackingNo}` });
    const restore = runtime.runner.restore;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(runtime.runner, 'restore').mockImplementation(async () => {
      await gate;
      await restore();
    });
    mount(runtime, found, newEvents());
    await screen.findByTestId('progress');
    expect(box.intakeBlocked).toBe(true);
    expect(box.accept('A', 1)).toBe(false);
    release();
    await waitFor(() => expect(box.intakeBlocked).toBe(false));
    expect(server.scanCalls).toHaveLength(0);
  });

  it('출고 뒤에 줄 서 있던 스캔은 보내지 않고 알린다', async () => {
    const { server, events, saved } = await setup({ ...BOX, lines: [{ ...BOX.lines[0], qty: 1 }] });
    const release = server.holdSends();
    act(() => {
      box.accept('A', 1);
      box.accept('A', 1);
    });
    await waitFor(async () => expect(await saved()).toHaveLength(2));
    release();
    await waitFor(() => expect(events.onShipped).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(events.onExcess).toHaveBeenCalledTimes(1));
    expect(server.scans).toHaveLength(1);
  });

  it('settle 은 앞 스캔이 다 보내진 뒤에 풀린다', async () => {
    const { server } = await setup();
    const release = server.holdSends();
    act(() => {
      box.accept('A', 1);
    });
    let settled = false;
    const done = box.settle().then(() => {
      settled = true;
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(settled).toBe(false);
    release();
    await act(async () => done);
    expect(server.scans).toHaveLength(1);
  });

  it('settle 은 확인 못 한 스캔이 있으면 기다리지 않고 거절한다', async () => {
    const { server, runtime } = await setup();
    server.loseResponses(true);
    act(() => {
      box.accept('A', 1);
    });
    await waitFor(async () => expect((await runtime.store.pending('scope'))[0]?.status).toBe('uncertain'));
    await waitFor(() => expect(box.intakeBlocked).toBe(true));
    await expect(box.settle()).rejects.toThrow(UNCERTAIN_SCAN_MESSAGE);
  });

  it('기다리던 settle 도 그 사이 스캔이 불확실해지면 거절된다 — 매달리지 않는다', async () => {
    const { server } = await setup();
    const release = server.holdSends();
    server.loseResponses(true);
    let settling!: Promise<void>;
    act(() => {
      box.accept('A', 1);
      settling = box.settle();
    });
    release();
    await expect(settling).rejects.toThrow(UNCERTAIN_SCAN_MESSAGE);
  });

  it('다른 박스의 확인 못 한 스캔이 남아 있으면 입력을 막는다', async () => {
    const server = createOutboundServer({ boxes: [BOX] });
    const runtime = createTestRuntime(server);
    await runtime.store.begin({
      id: 'foreign',
      scope: 'scope',
      resource: '/shipments/other',
      path: '/shipments/other/simple-outbound-scans',
      method: 'POST',
      createdAt: Date.now(),
      bodyJson: JSON.stringify({ barcode: 'A', quantity: 1 }),
    });
    await runtime.store.finish('foreign', 'uncertain');
    const found = await server.request<ShipmentByWaybill>({ path: `/shipments/by-waybill?trackingNo=${BOX.trackingNo}` });
    mount(runtime, found, newEvents());
    await screen.findByTestId('progress');
    await act(async () => runtime.runner.restore());
    await waitFor(() => expect(box.intakeBlocked).toBe(true));
    expect(box.accept('A', 1)).toBe(false);
  });

  it('강제출고는 고정 사유로 보내고, 출고되면 알린다', async () => {
    const { server, events } = await setup();
    await act(async () => box.forceOut());
    expect(server.forces).toEqual([{ shipmentId: 's-1', reason: STATION_FORCE_REASON }]);
    expect(events.onShipped).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 11: 실패를 확인한다**

Run: `npx vitest run src/station/outbound/useInspectionBox.test.tsx`
Expected: FAIL — `Failed to resolve import "./useInspectionBox"`

- [ ] **Step 12: 훅을 구현한다**

`src/station/outbound/useInspectionBox.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { useWorkScanQueue } from '../../core/hardware/scan/useWorkScanQueue';
import { useWorkAreaBlocked } from '../../core/operations/WorkBoundary';
import { progressOf, scannedLineOf } from '../../domains/outbound/inspection';
import { useForceSimpleOutbound, useSimpleOutboundScan } from '../../domains/outbound/mutations';
import type { ShipmentByWaybill, SimpleOutboundLineProgress, SimpleOutboundState } from '../../domains/outbound/types';

/** 스테이션 강제출고의 고정 사유(스펙 §7.4) — 서버는 강제하지 않는다. 사후 점검이 이 문자열로 거른다 */
export const STATION_FORCE_REASON = 'station_force_command';
/** 스테이션 박스 빼기(F11)의 고정 사유 — 강제출고와 같은 꼴(계획이 정함) */
export const STATION_WITHDRAW_REASON = 'station_withdraw_command';
export const INTAKE_BLOCKED_MESSAGE = '앞 스캔을 확인하고 있어요. 확인이 끝난 뒤 다시 찍어 주세요.';
export const UNCERTAIN_SCAN_MESSAGE = '앞 스캔이 처리됐는지 확인하지 못했어요. 같은 상품을 다시 찍지 마세요.';

export interface InspectionBoxEvents {
  /** 서버가 반영한 스캔 — 오른 줄(못 찾으면 null)과 수량 */
  onAccepted(shipmentLineId: string | null, quantity: number): void;
  /** 마지막 스캔(또는 강제출고)으로 출고됐다 */
  onShipped(): void;
  /** 서버가 거절했거나 결과를 모른다 — 화면이 오류로 알린다 */
  onRejected(message: string, barcode: string | null): void;
  /** 출고 뒤에 줄 서 있던 스캔 — 보내지 않았다 */
  onExcess(): void;
}

/**
 * 박스 하나의 출고 검수(스펙 §6.3). 상품 스캔은 «저장 → 서버 한 트랜잭션(준비·피킹·검수·마지막이면 출고, §6.1)» 이고,
 * 지금의 복구 장치를 그대로 쓴다: 저장된 스캔은 다시 열면 원래 키로 재생되고(useWorkScanQueue), 결과를 모르는 스캔이 있으면
 * 입력을 막는다(WorkBoundary). 큐가 박스에 묶이도록 쓰는 쪽이 박스마다 컴포넌트를 새로 마운트한다(`key`).
 */
export function useInspectionBox(box: ShipmentByWaybill, events: InspectionBoxEvents) {
  const scan = useSimpleOutboundScan();
  const force = useForceSimpleOutbound();
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const [progress, setProgress] = useState<SimpleOutboundLineProgress[]>(() => progressOf(box));
  const progressRef = useRef(progress);
  const [workItemStatus, setWorkItemStatus] = useState(box.workItemStatus ?? 'queued');
  const [lastScan, setLastScan] = useState<{ barcode: string; shipmentLineId: string } | null>(null);
  const shipped = useRef(false);

  /** 서버 응답을 그린다. 출고됐으면 알리고 true */
  const apply = (state: SimpleOutboundState): boolean => {
    progressRef.current = state.lines;
    setProgress(state.lines);
    setWorkItemStatus(state.workItemStatus);
    if (state.status !== 'shipped') return false;
    shipped.current = true;
    eventsRef.current.onShipped();
    return true;
  };

  const queue = useWorkScanQueue<{ barcode: string; quantity: number }>(async (input, id) => {
    if (shipped.current) {
      eventsRef.current.onExcess();
      return;
    }
    try {
      const state = await scan.mutateAsync({ shipmentId: box.shipmentId, ...input, idempotencyKey: id });
      const line = scannedLineOf(progressRef.current, state.lines);
      if (line) setLastScan({ barcode: input.barcode, shipmentLineId: line });
      if (!apply(state)) eventsRef.current.onAccepted(line, input.quantity);
    } catch (error) {
      const rejected = error instanceof ApiError && error.outcome === 'rejected';
      eventsRef.current.onRejected(rejected ? errorMessage(error, 'outbound') : UNCERTAIN_SCAN_MESSAGE, input.barcode);
      // 확정된 거절만 큐에서 뺀다 — 결과를 모르는 스캔은 머리에 남겨 같은 키로 다시 맞춘다
      if (!rejected) throw error;
    }
  }, `outbound:${box.shipmentId}`);

  const areaBlocked = useWorkAreaBlocked('outbound', {
    path: `/shipments/${box.shipmentId}/simple-outbound-scans`,
    operationId: queue.head()?.id,
  });
  const intakeBlocked = !queue.ready || !!queue.error() || areaBlocked || force.isPending;

  // settle 을 기다리는 쪽(내려놓기·전환). 결과를 모르는 단순출고 스캔은 실행기의 약속이 풀리지 않은 채 머물러
  // 큐의 drain 이 끝나지 않는다 — 그래서 «비었다» 와 «확인 못 한 것이 생겼다» 를 렌더마다 직접 본다.
  const waiters = useRef<Array<{ resolve: () => void; reject: (error: Error) => void }>>([]);
  const unsettled = !queue.ready || !!queue.error() || areaBlocked;
  useEffect(() => {
    if (waiters.current.length === 0) return;
    if (unsettled) waiters.current.splice(0).forEach((w) => w.reject(new Error(UNCERTAIN_SCAN_MESSAGE)));
    else if (queue.size() === 0) waiters.current.splice(0).forEach((w) => w.resolve());
  });

  return {
    progress,
    workItemStatus,
    lastScan,
    intakeBlocked,
    /** 보낼 것이 없고 받을 수 있다 — 결품·전량·강제출고·박스 빼기는 이때만 */
    idle: !intakeBlocked && queue.size() === 0,
    forcing: force.isPending,
    queueError: queue.error(),
    storageError: queue.storageError(),
    /** 상품 하나(수량 n). 받을 수 없으면 false — 화면이 오류로 알린다 */
    accept(barcode: string, quantity: number): boolean {
      if (intakeBlocked || shipped.current) return false;
      queue.enqueue({ barcode, quantity });
      return true;
    },
    /**
     * 앞 스캔이 다 보내질 때까지 기다린다 — 내려놓기·전환 전에(U13). 확인 못 한 스캔이 있거나 기다리는 사이 생기면
     * 기다리지 않고 거절한다(UNCERTAIN_SCAN_MESSAGE). 크기는 렌더 값이 아니라 지금 값을 본다 — 같은 틱의 accept 뒤에도 맞게.
     */
    settle(): Promise<void> {
      if (!queue.ready || queue.error() || areaBlocked) return Promise.reject(new Error(UNCERTAIN_SCAN_MESSAGE));
      if (queue.size() === 0) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        waiters.current.push({ resolve, reject });
      });
    },
    retryHead: () => queue.retryHead(),
    /** 강제출고(F10, §7.4) — 남은 미피킹 수량을 배정 기준으로 채우고 출고 */
    async forceOut(): Promise<void> {
      try {
        apply(
          await force.mutateAsync({
            shipmentId: box.shipmentId,
            reason: STATION_FORCE_REASON,
            idempotencyKey: crypto.randomUUID(),
          })
        );
      } catch (error) {
        eventsRef.current.onRejected(errorMessage(error, 'outbound'), null);
      }
    },
  };
}
```

- [ ] **Step 13: 통과를 확인한다**

Run: `npx vitest run src/station/outbound/useInspectionBox.test.tsx src/core src/domains/outbound && npx tsc -b`
Expected: PASS (새 13 + 기존 전부), tsc 에러 0. 「다시 열면…」 이 `saved` 2건을 기다리다 시간이 넘으면: B 는 A 의 응답(불확실)을 기다리며 저장만 된 상태여야 한다 — 큐가 B 를 보내 버렸다면 `consume` 이 불확실 결과에서 예외를 던져 다음으로 넘어간 것이니 Step 12 의 `throw error` 를 확인한다

- [ ] **Step 14: 커밋**

```bash
git add native/warehouse-app/src/core/operations/WorkBoundary.tsx native/warehouse-app/src/core/operations/WorkBoundary.runtime.test.tsx \
  native/warehouse-app/src/core/hardware/scan/useWorkScanQueue.ts native/warehouse-app/src/core/hardware/scan/useWorkScanQueue.test.tsx \
  native/warehouse-app/src/domains/outbound/mutations.ts \
  native/warehouse-app/src/station/outbound/__fixtures__/outboundServer.ts \
  native/warehouse-app/src/station/outbound/useInspectionBox.ts native/warehouse-app/src/station/outbound/useInspectionBox.test.tsx
git commit -m "feat(warehouse-app): 출고 검수 박스 큐 — 단순출고 스캔을 지금 복구 장치 위에서, 위치 계약 복구 시나리오를 옮겨 고정"
```

---

### Task 6: 화면 받침 — 최근 스캔·단건 출력·배치 집계·F1 액션·상태 타입

**Files:**
- Create: `native/warehouse-app/src/station/outbound/recent.ts`, Test: `recent.test.ts`
- Create: `native/warehouse-app/src/station/outbound/printWaybill.ts`, Test: `printWaybill.test.ts`
- Create: `native/warehouse-app/src/domains/outbound/batchStatus.ts`, Test: `batchStatus.test.ts`
- Create: `native/warehouse-app/src/station/outbound/inspectionActions.ts`
- Create: `native/warehouse-app/src/station/outbound/model.ts`

**Interfaces:**
- Produces (recent.ts): `type RecentKind = 'waybill' | 'scan' | 'shipped' | 'printed' | 'error'`, `interface RecentEntry { id: number; at: number; kind: RecentKind; text: string; qty?: number }`, `RECENT_LIMIT = 8`, `pushRecent(list, entry: Omit<RecentEntry, 'id'>): RecentEntry[]`, `clockOf(at: number): string`
- Produces (printWaybill.ts): `type PrintOutcome = { ok: true } | { ok: false; message: string }`, `printWaybill(deps: { api: ApiClient; print: PrintRaw; prefs: DevicePrefs }, shipmentId: string): Promise<PrintOutcome>`
- Produces (batchStatus.ts): `useBatchWorkItems(batchId: string | null)`(query key `['batch-work-items', batchId]`), `batchProgressOf(batchNumber, items): { code: string; done: number; total: number }`, `interface BoxCounts { done: number; working: number; waiting: number; withdrawing: number }`, `boxCountsOf(items): BoxCounts`, `mergeBatches(picking, created): OutboundBatchSummary[]`
- Produces (inspectionActions.ts): `INSPECTION_ACTIONS` — `quantity`(F7 수량)·`all`(F8 이 상품 전량)·`shortPick`(F9 결품)·`force`(F10 강제출고)·`withdraw`(F11 박스 빼기)·`reprint`(F12 송장 재출력)·`putDown`(Esc 내려놓기), 각 `{ id, key, label }`(`ActionSpec`)
- Produces (model.ts): `interface Alert { message: string; detail?: string }`, `type PrintStatus = { kind: 'printing' } | { kind: 'printed' } | { kind: 'failed'; message: string }`, `interface RefillShown { locationCode: string; name: string; qty: number }`, `type LastBox = { kind: 'shipped'; trackingNo: string } | { kind: 'refilled'; trackingNo: string; shipmentId: string; items: RefillShown[]; print: PrintStatus }`

- [ ] **Step 1: 실패하는 테스트 셋을 쓴다**

`src/station/outbound/recent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RECENT_LIMIT, clockOf, pushRecent, type RecentEntry } from './recent';

describe('최근 스캔', () => {
  it('새것이 위, 8줄까지, id 는 겹치지 않는다', () => {
    let list: RecentEntry[] = [];
    for (let i = 0; i < 10; i++) list = pushRecent(list, { at: i, kind: 'scan', text: `#${i}` });
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0].text).toBe('#9');
    expect(list.at(-1)?.text).toBe('#2');
    expect(new Set(list.map((e) => e.id)).size).toBe(RECENT_LIMIT);
  });

  it('기기 시계 HH:MM:SS', () => {
    expect(clockOf(new Date(2026, 9, 2, 14, 2, 5).getTime())).toBe('14:02:05');
  });
});
```

`src/station/outbound/printWaybill.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import {
  LABEL_PRINTER_KEY,
  NO_PRINTER_MESSAGE,
  PRINTER_FAILURE_MESSAGE,
  PrinterError,
} from '../../core/hardware/print/labelPrinter';
import { printWaybill } from './printWaybill';

function fakeApi(calls: string[]) {
  return {
    request: vi.fn(async (o: { method?: string; path: string }) => {
      calls.push(`${o.method ?? 'GET'} ${o.path}`);
      if (o.path.endsWith('/waybill/label'))
        return { waybillId: 'wb', trackingNo: 'T', format: 'zpl', data: '^XA^XZ', fingerprint: 'fp', revision: 1 };
      return {};
    }),
  };
}
const withPrinter = () => createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://XP' });

describe('printWaybill — 지금의 단건 출력 경로(스펙 §6.2)', () => {
  it('프린터가 없으면 아무것도 보내지 않는다', async () => {
    const calls: string[] = [];
    const print = vi.fn();
    expect(await printWaybill({ api: fakeApi(calls) as never, print, prefs: createMemoryPrefs() }, 's-1')).toEqual({
      ok: false,
      message: NO_PRINTER_MESSAGE,
    });
    expect(calls).toEqual([]);
    expect(print).not.toHaveBeenCalled();
  });

  it('렌더 → 프린터 → 출력 확인', async () => {
    const calls: string[] = [];
    const print = vi.fn(async () => {});
    expect(await printWaybill({ api: fakeApi(calls) as never, print, prefs: withPrinter() }, 's-1')).toEqual({ ok: true });
    expect(print).toHaveBeenCalledWith('spooler://XP', '^XA^XZ');
    expect(calls).toEqual(['GET /shipments/s-1/waybill/label', 'POST /shipments/s-1/waybill/label-prints']);
  });

  it('프린터로 못 보내면 프린터 문구', async () => {
    const print = vi.fn(async () => {
      throw new PrinterError('offline');
    });
    expect(await printWaybill({ api: fakeApi([]) as never, print, prefs: withPrinter() }, 's-1')).toEqual({
      ok: false,
      message: PRINTER_FAILURE_MESSAGE,
    });
  });
});
```

`src/domains/outbound/batchStatus.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { batchProgressOf, boxCountsOf, mergeBatches } from './batchStatus';
import type { OutboundBatchSummary } from './types';

const item = (status: string, i = 0) => ({ id: `wi-${status}-${i}`, shipmentId: `s-${status}-${i}`, status });
const items = [
  item('completed', 1),
  item('completed', 2),
  item('picking'),
  item('packing'),
  item('short_pick_recovery'),
  item('queued'),
  item('withdrawing'),
  item('excluded'),
];

describe('배치 집계', () => {
  it('진행은 출고된 박스 / 빠진 박스를 뺀 전체(스펙 §5.5)', () => {
    expect(batchProgressOf('B-1002', items)).toEqual({ code: 'B-1002', done: 2, total: 7 });
  });

  it('완료·검수 중·대기·빠지는 중 — 빠진 박스는 세지 않는다', () => {
    expect(boxCountsOf(items)).toEqual({ done: 2, working: 3, waiting: 1, withdrawing: 1 });
  });

  it('진행 중 배치 먼저, 시작 전 다음 — 같은 배치는 한 번만', () => {
    const b = (id: string): OutboundBatchSummary => ({
      id,
      batchNumber: id,
      name: '',
      status: 'picking',
      totalItems: 1,
      totalQty: 1,
      startedAt: null,
      withdrawingItems: 0,
    });
    expect(mergeBatches([b('p1'), b('x')], [b('x'), b('c1')]).map((x) => x.id)).toEqual(['p1', 'x', 'c1']);
    expect(mergeBatches(undefined, undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/station/outbound/recent.test.ts src/station/outbound/printWaybill.test.ts src/domains/outbound/batchStatus.test.ts`
Expected: FAIL — 세 모듈 다 resolve 실패

- [ ] **Step 3: 구현한다**

`src/station/outbound/recent.ts`:

```ts
export type RecentKind = 'waybill' | 'scan' | 'shipped' | 'printed' | 'error';

export interface RecentEntry {
  id: number;
  at: number;
  kind: RecentKind;
  /** 송장번호(waybill·shipped·printed), 상품 이름(scan), 거절된 코드나 사유(error) */
  text: string;
  qty?: number;
}

/** 최근 스캔 줄 수(목업 ②) */
export const RECENT_LIMIT = 8;

let nextId = 0;

/** 새것이 위. 화면 상태로만 둔다 — 탭을 옮기면 사라진다(계획이 정함) */
export function pushRecent(list: readonly RecentEntry[], entry: Omit<RecentEntry, 'id'>): RecentEntry[] {
  nextId += 1;
  return [{ ...entry, id: nextId }, ...list].slice(0, RECENT_LIMIT);
}

/** 기기 시계 HH:MM:SS */
export function clockOf(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}
```

`src/station/outbound/printWaybill.ts`:

```ts
import type { DevicePrefs } from '../../core/data/devicePrefs';
import type { ApiClient } from '../../core/data/httpClient';
import { NO_PRINTER_MESSAGE, readLabelPrinter, type PrintRaw } from '../../core/hardware/print/labelPrinter';
import {
  confirmLabelPrinted,
  fetchWaybillLabel,
  labelErrorMessage,
  printOneLabel,
} from '../../domains/outbound/waybillLabel';

export type PrintOutcome = { ok: true } | { ok: false; message: string };

/**
 * 박스 한 장 — 지금의 단건 출력 경로(렌더 → 프린터 → 출력 확인, 스펙 §6.2). 송장 바뀜·결품 채움의 자동 출력과 F12 가 쓴다.
 * 프린터가 없으면 보내지 않는다. 프린터 실패는 printRaw 가 상태바에 알린다.
 */
export async function printWaybill(
  deps: { api: ApiClient; print: PrintRaw; prefs: DevicePrefs },
  shipmentId: string
): Promise<PrintOutcome> {
  const target = readLabelPrinter(deps.prefs);
  if (!target) return { ok: false, message: NO_PRINTER_MESSAGE };
  try {
    await printOneLabel(
      {
        fetchLabel: (id) => fetchWaybillLabel(deps.api, id),
        confirm: (id, fingerprint) => confirmLabelPrinted(deps.api, id, fingerprint),
        print: deps.print,
        target,
      },
      shipmentId
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, message: labelErrorMessage(error) };
  }
}
```

`src/domains/outbound/batchStatus.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { OutboundBatchSummary } from './types';
import { fetchBatchWorkItems, type BatchWorkItem } from './waybillLabel';

/** GET /outbound-batches/:id/work-items — 스테이션 상태바의 배치 진행·F2 건수. 출고 뒤 무효화된다(mutations.ts) */
export function useBatchWorkItems(batchId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['batch-work-items', batchId],
    enabled: batchId !== null,
    queryFn: () => fetchBatchWorkItems(api, batchId ?? ''),
  });
}

/** «B-1002 13/40»(스펙 §5.5) — 출고된 박스 / 빠진 박스를 뺀 전체 */
export function batchProgressOf(
  batchNumber: string,
  items: readonly BatchWorkItem[]
): { code: string; done: number; total: number } {
  const live = items.filter((item) => item.status !== 'excluded');
  return { code: batchNumber, done: live.filter((item) => item.status === 'completed').length, total: live.length };
}

export interface BoxCounts {
  done: number;
  working: number;
  waiting: number;
  withdrawing: number;
}

/** 작업 중으로 세는 작업 항목 상태 — 결품 처리 중(short_pick_recovery)도 손이 닿은 박스다 */
const WORKING_STATUSES: ReadonlySet<string> = new Set(['picking', 'ready_to_pack', 'packing', 'short_pick_recovery']);

/** 배치 현황의 «완료 · 검수 중 · 대기 · 빠지는 중»(목업 ⑤). 빠진 박스(excluded)는 세지 않는다 */
export function boxCountsOf(items: readonly BatchWorkItem[]): BoxCounts {
  const counts: BoxCounts = { done: 0, working: 0, waiting: 0, withdrawing: 0 };
  for (const item of items) {
    if (item.status === 'completed') counts.done += 1;
    else if (item.status === 'withdrawing') counts.withdrawing += 1;
    else if (item.status === 'queued') counts.waiting += 1;
    else if (WORKING_STATUSES.has(item.status)) counts.working += 1;
  }
  return counts;
}

/** 진행 중(picking) 먼저, 시작 전(created) 다음. 두 조회 사이에 상태가 바뀐 배치는 한 번만(OutboundQueueScreen 과 같은 규칙) */
export function mergeBatches(
  picking: readonly OutboundBatchSummary[] | undefined,
  created: readonly OutboundBatchSummary[] | undefined
): OutboundBatchSummary[] {
  const seen = new Set<string>();
  return [...(picking ?? []), ...(created ?? [])].filter((batch) => {
    if (seen.has(batch.id)) return false;
    seen.add(batch.id);
    return true;
  });
}
```

`src/station/outbound/inspectionActions.ts`:

```ts
import type { ActionSpec } from '../actions';

/**
 * 출고 검수(F1)의 액션(스펙 §6.3). 화면 선언과 명령 바코드 시트가 같은 값을 쓴다 — 시트의 「출고 검수」 절이 이것이다.
 * 화면은 상태에 따라 라벨만 바꿔 그린다(Esc 가 «수량 취소»·«취소», F10 이 «강제출고 확정» 이 되는 식). 시트에는 이 라벨이 실린다.
 */
export const INSPECTION_ACTIONS = {
  quantity: { id: 'inspect-quantity', key: 'F7', label: '수량' },
  all: { id: 'inspect-all', key: 'F8', label: '이 상품 전량' },
  shortPick: { id: 'inspect-short-pick', key: 'F9', label: '결품' },
  force: { id: 'inspect-force', key: 'F10', label: '강제출고' },
  withdraw: { id: 'inspect-withdraw', key: 'F11', label: '박스 빼기' },
  reprint: { id: 'inspect-reprint', key: 'F12', label: '송장 재출력' },
  putDown: { id: 'inspect-put-down', key: 'Escape', label: '내려놓기' },
} as const satisfies Record<string, ActionSpec>;
```

`src/station/outbound/model.ts`:

```ts
/** 출고 검수(F1) 화면이 주고받는 상태 — 부모(InspectionScreen)와 박스별 자식(InspectWork·WithdrawWork)이 같이 쓴다 */

/** 왼쪽 큰 칸의 빨간 오류(목업 ③). 다음 스캔에서 사라진다 */
export interface Alert {
  message: string;
  /** 거절된 바코드나 송장번호 */
  detail?: string;
}

export type PrintStatus = { kind: 'printing' } | { kind: 'printed' } | { kind: 'failed'; message: string };

/** 채움(refilled) 배너의 «가져올 것» 한 줄 — `[C-07-1] 퍼머넌트 1제 ×1` */
export interface RefillShown {
  locationCode: string;
  name: string;
  qty: number;
}

/** 송장 대기 화면 위의 직전 박스(목업 ①) */
export type LastBox =
  | { kind: 'shipped'; trackingNo: string }
  | { kind: 'refilled'; trackingNo: string; shipmentId: string; items: RefillShown[]; print: PrintStatus };
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/station/outbound/recent.test.ts src/station/outbound/printWaybill.test.ts src/domains/outbound/batchStatus.test.ts && npx tsc -b`
Expected: PASS (2 + 3 + 3), tsc 에러 0

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/station/outbound/recent.ts native/warehouse-app/src/station/outbound/recent.test.ts \
  native/warehouse-app/src/station/outbound/printWaybill.ts native/warehouse-app/src/station/outbound/printWaybill.test.ts \
  native/warehouse-app/src/domains/outbound/batchStatus.ts native/warehouse-app/src/domains/outbound/batchStatus.test.ts \
  native/warehouse-app/src/station/outbound/inspectionActions.ts native/warehouse-app/src/station/outbound/model.ts
git commit -m "feat(warehouse-app): 출고 검수 받침 — 최근 스캔·단건 출력·배치 집계·F1 액션 선언"
```

---

### Task 7: F1 출고 검수 화면 — 대기·검수 중·새 송장·빠진 박스, 전환(U13)·내려놓기·직접 입력·복구

**Files:**
- Create: `native/warehouse-app/src/station/outbound/panels.tsx`
- Create: `native/warehouse-app/src/station/outbound/InspectWork.tsx`
- Create: `native/warehouse-app/src/station/outbound/InspectionScreen.tsx`
- Create: `native/warehouse-app/src/station/outbound/__fixtures__/renderStation.tsx`
- Test: `native/warehouse-app/src/station/outbound/InspectionScreen.test.tsx`

**Interfaces:**
- Consumes: Task 2 `useHumanKeys`, Task 3 `inspectionGateOf`·`classifyInspectScan`·`isNotFound`·`inspectionRows`·`inspectionTotals`·`formatTrackingNo`·`fetchShipmentByWaybill`, Task 5 `useInspectionBox`·`INTAKE_BLOCKED_MESSAGE`·`UNCERTAIN_SCAN_MESSAGE`·픽스처, Task 6 전부, PR B 의 `useStationActions`·`useFeedback`·`useBatchProgress`·`modalOpen`
- Produces:
  - `InspectionScreen({ prefs?, print? })` — 창고 미설정이면 `WarehousePicker`
  - `InspectWork` props(이 태스크): `{ box: ShipmentByWaybill; handleRef: RefObject<BoxWorkHandle | null>; alert: Alert | null; recent: readonly RecentEntry[]; onAlert(message: string, detail?: string): void; onScanned(name: string, quantity: number): void; onShipped(box: ShipmentByWaybill): void; onExcess(): void; onPutDown(): void }` — Task 8·10 이 props 를 더한다
  - `interface BoxWorkHandle { accept(code: string): void; settle(): Promise<void> }` — Task 9 의 `WithdrawWork` 도 같은 손잡이를 단다
  - panels: `WorkGrid({ left, right, intake? })`(루트에 `data-intake="open|blocked"`), `BoxCard`(송장번호는 `<h2>`), `BigPanel({ content: BigPanelContent })`(`progress` 는 `role="status"` `aria-label="진행"`, `alert` 는 `role="alert"`), `BigPanelContent = { kind: 'progress'; scanned; ordered } | { kind: 'quantity'; value } | { kind: 'armed'; keyLabel; label } | { kind: 'alert'; message; detail? } | { kind: 'notice'; title; message? }`, `LineTable({ rows, currentLineId })`, `ChangeTable({ changes })`, `RecentList({ entries, grow? })`(`<ol aria-label="최근 스캔">`), `DoneBanner({ last })`, `WaitingPrompt({ children? })`, `ManualWaybillInput({ initial, onSubmit, onClose })`(`aria-label="송장번호"`), `QueueTrouble({ storage, onRetry })`
  - 테스트 하네스: `renderStation(Screen, { runtime, prefs, path? })`, `setupInspection({ boxes?, prefs?, permissions?, print?, picking? })`, `stationPrefs(extra?, printer = true)`, `BOX1`·`BOX2`, `scan(code)`, `press(key)`, `typeHuman(keys)`, `openBox(trackingNo)`, `sleep(ms)`, `flash()`

**화면 상태(스펙 §6.2)와 이 태스크의 동작:**

| 상태 | 왼쪽 | 오른쪽 | 스캔 | Esc |
| --- | --- | --- | --- | --- |
| 송장 대기 | 「송장 바코드」(오류가 있으면 빨간 칸), 숫자를 치면 직접 입력칸 | 직전 박스 배너 · 최근 스캔 | 송장 조회 | — |
| 검수 중 | 송장 카드 · 진행 `n / m`(오류면 빨간 칸) | 품목 표 · 최근 스캔 | 같은 송장 = 다시 조회, 송장일 수 있음 = 조회 후 전환/상품, 나머지 = 상품 | 내려놓기(앞 스캔을 다 보낸 뒤) |
| 새 송장 출력됨 | 송장 카드 · 노란 칸(출력 실패면 빨간 칸) | 바뀐 줄 표 · 최근 스캔 | 송장 조회 | 내려놓기 |
| 뺄 상품 | 송장 카드 · 노란 칸 «뺄 상품» (Task 9 가 작업을 붙인다) | 최근 스캔 | 같은 규칙(이 태스크에선 상품은 받지 않는다) | 내려놓기 |
| 빠진 박스 | 송장 카드 · «빠진 박스 / 송장은 버려 주세요» | 최근 스캔 | 송장 조회 | 내려놓기 |

- [ ] **Step 1: 테스트 하네스를 만든다**

`src/station/outbound/__fixtures__/renderStation.tsx`:

```tsx
/* oxlint-disable react/only-export-components -- 테스트 전용 하네스: 렌더 함수·상자 데이터·키 보조 함수를 한 파일에서 낸다 */
import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { expect, vi } from 'vitest';
import { SessionProvider } from '../../../app/session-context';
import { WarehouseProvider } from '../../../app/warehouse-context';
import type { Session } from '../../../core/auth/session';
import { ApiClientProvider } from '../../../core/data/ApiClientProvider';
import { createMemoryPrefs, type DevicePrefs } from '../../../core/data/devicePrefs';
import { LABEL_PRINTER_KEY, type PrintRaw } from '../../../core/hardware/print/labelPrinter';
import { ScanProvider } from '../../../core/hardware/scan/ScanProvider';
import { OperationContext, type WorkPermissions, type WorkRuntime } from '../../../core/operations/OperationContext';
import { WorkBoundary } from '../../../core/operations/WorkBoundary';
import type { OutboundBatchSummary } from '../../../domains/outbound/types';
import type { Beep, ToneSink } from '../../feedback/soundPlayer';
import { StationShell } from '../../StationShell';
import { InspectionScreen } from '../InspectionScreen';
import { WAREHOUSE_ID, createOutboundServer, createTestRuntime, type FakeBox } from './outboundServer';

const session: Session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
};

/** 목업 ②의 박스 — 위치 순서가 줄 순서와 다르다(표가 송장 순서로 정렬하는지 본다) */
export const BOX1: FakeBox = {
  shipmentId: 's-1',
  trackingNo: '421033881907',
  batchId: 'b-1',
  recipient: '김*영',
  deliveryNote: '문 앞에 놓아주세요',
  lines: [
    { id: 'l-2', skuId: 'sku-2', name: '헤어클립 집게핀', qty: 3, barcode: '8801002', locations: [{ code: 'B-11-1', qty: 3 }] },
    { id: 'l-1', skuId: 'sku-1', name: '컬러크림 6N', qty: 1, barcode: '8801001', locations: [{ code: 'A-03-2', qty: 1 }] },
  ],
};

export const BOX2: FakeBox = {
  shipmentId: 's-2',
  trackingNo: '421033881915',
  batchId: 'b-1',
  recipient: '이*진',
  lines: [{ id: 'l-3', skuId: 'sku-3', name: '샴푸 퍼퓸', qty: 1, barcode: '8801003', locations: [{ code: 'D-07-3', qty: 1 }] }],
};

export function stationPrefs(extra: Record<string, string> = {}, printer = true): DevicePrefs {
  return createMemoryPrefs({
    'almondwms.warehouse': JSON.stringify({ id: WAREHOUSE_ID, name: '부천 창고' }),
    ...(printer ? { [LABEL_PRINTER_KEY]: 'spooler://XP-DT108B' } : {}),
    ...extra,
  });
}

/** 스테이션 셸(키·명령·소리·상태바) 안에 화면 하나를 그린다 */
export function renderStation(Screen: () => ReactNode, opts: { runtime: WorkRuntime; prefs: DevicePrefs; path?: string }) {
  const beeps: Beep[] = [];
  const sink: ToneSink = { now: () => 0, beep: (b) => void beeps.push(b) };
  const path = opts.path ?? '/outbound';
  const root = createRootRoute({ component: () => <StationShell sink={sink} /> });
  const routes = ['/outbound', '/outbound/batches', '/inbound', '/settings'].map((p) =>
    createRoute({
      getParentRoute: () => root,
      path: p,
      component: p === path ? Screen : () => <p>{`page ${p}`}</p>,
    })
  );
  const router = createRouter({ routeTree: root.addChildren(routes), history: createMemoryHistory({ initialEntries: [path] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <SessionProvider session={session}>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={opts.runtime.runner}>
          <OperationContext.Provider value={opts.runtime}>
            <WarehouseProvider prefs={opts.prefs}>
              <ScanProvider>
                <WorkBoundary>
                  {/* 테스트 전용 라우터라 앱의 Register 타입과 다르다 */}
                  <RouterProvider router={router as never} />
                </WorkBoundary>
              </ScanProvider>
            </WarehouseProvider>
          </OperationContext.Provider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return { ...view, router, beeps, queryClient };
}

/** F1 출고 검수를 가짜 core 위에 그리고 «송장 바코드» 가 뜰 때까지 기다린다. 배치 목록은 그리기 전에 넣어야 첫 조회에 잡힌다 */
export async function setupInspection(
  opts: {
    boxes?: FakeBox[];
    prefs?: DevicePrefs;
    permissions?: WorkPermissions;
    print?: PrintRaw;
    picking?: OutboundBatchSummary[];
  } = {}
) {
  const server = createOutboundServer({ boxes: opts.boxes ?? [BOX1, BOX2] });
  server.config.batches.picking = opts.picking ?? [];
  const runtime = createTestRuntime(server, opts.permissions);
  const print = opts.print ?? vi.fn<PrintRaw>(async () => {});
  const prefs = opts.prefs ?? stationPrefs();
  const view = renderStation(() => <InspectionScreen prefs={prefs} print={print} />, { runtime, prefs });
  await screen.findByText('송장 바코드');
  return { server, runtime, print, prefs, ...view };
}

/** 스캐너처럼 한 번에 몰아 보낸다(묶음 + Enter) */
export function scan(code: string) {
  act(() => {
    for (const key of [...code, 'Enter']) window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  });
}

export function press(key: string) {
  act(() => {
    fireEvent.keyDown(window, { key });
  });
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 사람처럼 친다 — 키마다 묶음 간격(50ms)보다 오래 쉰다. 숫자는 그 뒤에야 사람 키로 확정된다 */
export async function typeHuman(keys: string[]) {
  for (const key of keys) {
    press(key);
    await act(async () => {
      await sleep(70);
    });
  }
}

/** 송장을 찍고 상품을 받을 수 있을 때까지 기다린다 */
export async function openBox(trackingNo: string) {
  scan(trackingNo);
  await waitFor(() => expect(document.querySelector('[data-intake="open"]')).not.toBeNull());
}

export const flash = () => document.querySelector('[data-flash]')?.getAttribute('data-flash') ?? null;
```

- [ ] **Step 2: 실패하는 화면 테스트를 쓴다**

`src/station/outbound/InspectionScreen.test.tsx`:

```tsx
import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { writeLastBox } from '../../domains/outbound/lastBox';
import type { ShipmentByWaybill } from '../../domains/outbound/types';
import { batchSummary, type FakeBox } from './__fixtures__/outboundServer';
import {
  BOX1,
  BOX2,
  flash,
  openBox,
  press,
  scan,
  setupInspection,
  sleep,
  stationPrefs,
  typeHuman,
} from './__fixtures__/renderStation';

const progress = () => screen.getByRole('status', { name: '진행' });
const heading = (trackingNo: string) => screen.getByRole('heading', { name: trackingNo });

describe('F1 출고 검수 — 송장 스캔 즉시 시작, 상품 스캔 = +1, 마지막 스캔 = 출고(스펙 §6)', () => {
  it('송장을 찍으면 박스가 열린다 — 송장번호·받는 분·배송메모, 송장 순서 품목 표', async () => {
    await setupInspection();
    await openBox('421033881907');
    expect(heading('4210-3388-1907')).toBeInTheDocument();
    expect(screen.getByText('김*영')).toBeInTheDocument();
    expect(screen.getByText('문 앞에 놓아주세요')).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1) as HTMLTableRowElement[];
    expect(rows.map((r) => r.cells[0].textContent)).toEqual(['A-03-2', 'B-11-1']);
    expect(progress()).toHaveTextContent('0 / 4');
  });

  it('상품을 찍으면 그 줄이 오르고, 마지막 상품이면 출고되어 송장 대기로 — 직전 박스 완료를 보인다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(progress()).toHaveTextContent('1 / 4'));
    for (const code of ['8801002', '8801002', '8801001']) scan(code);
    expect(await screen.findByText('출고 완료')).toBeInTheDocument();
    expect(screen.getByText('송장 바코드')).toBeInTheDocument();
    expect(flash()).toBe('complete');
    expect(server.box('421033881907')?.shipped).toBe(true);
  });

  it('박스에 없는 상품은 빨간 칸·오류로 알리고 진행은 그대로', async () => {
    await setupInspection();
    await openBox('421033881907');
    scan('8809999');
    expect(await screen.findByRole('alert')).toHaveTextContent('이 송장에 없는 상품이에요');
    expect(flash()).toBe('error');
    scan('8801001');
    await waitFor(() => expect(progress()).toHaveTextContent('1 / 4'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('같은 송장을 다시 찍으면 다시 조회만 한다 — 서버에 쓰지 않고, 방금 보낸 스캔까지 보인다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(server.scans).toHaveLength(1));
    const writes = () => server.requests.filter((r) => (r.method ?? 'GET') !== 'GET').length;
    const lookups = () => server.requests.filter((r) => r.path.startsWith('/shipments/by-waybill')).length;
    const before = writes();
    for (let i = 0; i < 2; i++) {
      const n = lookups();
      scan('421033881907');
      await waitFor(() => expect(lookups()).toBe(n + 1));
      await waitFor(() => expect(document.querySelector('[data-intake="open"]')).not.toBeNull());
    }
    expect(writes()).toBe(before);
    expect(progress()).toHaveTextContent('1 / 4');
  });

  it('검수 중 다른 송장을 찍으면 앞 상품이 옛 박스로 다 간 뒤 그 송장을 연다(U13) — 그 사이 상품은 받지 않는다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    const release = server.holdSends();
    scan('8801002');
    await waitFor(() => expect(server.scanCalls).toHaveLength(1));
    scan('421033881915');
    await act(async () => {
      await sleep(30);
    });
    expect(heading('4210-3388-1907')).toBeInTheDocument();
    scan('8801001');
    expect(await screen.findByRole('alert')).toHaveTextContent('송장을 확인하고 있어요');
    release();
    expect(await screen.findByRole('heading', { name: '4210-3388-1915' })).toBeInTheDocument();
    expect(server.scans).toEqual([expect.objectContaining({ shipmentId: 's-1', barcode: '8801002' })]);
    await waitFor(() => expect(document.querySelector('[data-intake="open"]')).not.toBeNull());
    scan('8801003');
    await waitFor(() => expect(server.scans.at(-1)).toMatchObject({ shipmentId: 's-2', barcode: '8801003' }));
  });

  it('앞 스캔을 확인 못 한 채로는 다른 송장·Esc 를 받지 않는다 — 박스를 그대로 든다', async () => {
    const { server, runtime } = await setupInspection();
    await openBox('421033881907');
    server.loseResponses(true);
    scan('8801002');
    await waitFor(async () => expect((await runtime.store.pending('scope'))[0]?.status).toBe('uncertain'));
    scan('421033881915');
    expect(await screen.findByRole('alert')).toHaveTextContent('앞 스캔이 처리됐는지 확인하지 못했어요');
    press('Escape');
    await act(async () => {
      await sleep(30);
    });
    expect(heading('4210-3388-1907')).toBeInTheDocument();
    expect(flash()).toBe('error');
  });

  it('송장과 길이가 같은 숫자 상품 바코드는 조회해 보고, 없으면 상품으로 찍는다', async () => {
    const box: FakeBox = {
      ...BOX2,
      lines: [
        { id: 'l-9', skuId: 'sku-9', name: '수입 샴푸', qty: 1, barcode: '012345678905', locations: [{ code: 'E-01-1', qty: 1 }] },
        { id: 'l-10', skuId: 'sku-10', name: '빗', qty: 1, barcode: '8801010', locations: [{ code: 'E-02-1', qty: 1 }] },
      ],
    };
    const { server } = await setupInspection({ boxes: [box] });
    await openBox('421033881915');
    scan('012345678905');
    await waitFor(() => expect(progress()).toHaveTextContent('1 / 2'));
    expect(server.requests.some((r) => r.path.includes('trackingNo=012345678905'))).toBe(true);
  });

  const rejections: Array<[string, FakeBox, string, string]> = [
    ['이미 출고된 송장', { ...BOX1, shipped: true }, '421033881907', '이미 출고된 송장이에요'],
    ['작업 시작 전', { ...BOX1, labelState: 'not_started' }, '421033881907', '배치 현황(F2)에서 「작업 시작」을 먼저 눌러 주세요.'],
    ['없는 송장', BOX1, '999999999999', '이 운송장을 찾을 수 없어요. 번호를 확인해 주세요.'],
  ];
  it.each(rejections)('거절: %s — 오류음과 사유 한 줄, 송장 대기 그대로', async (_name, box, code, message) => {
    await setupInspection({ boxes: [box] });
    scan(code);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(flash()).toBe('error');
    expect(screen.getByText('송장 바코드')).toBeInTheDocument();
  });

  it('송장이 바뀌었으면 새 송장을 자동 출력하고 바뀐 줄을 보인다 — 새 송장을 찍으면 검수로 간다', async () => {
    const { server, print } = await setupInspection({ boxes: [{ ...BOX1, labelState: 'reprint_required' }] });
    scan('421033881907');
    expect(await screen.findByText('새 송장 출력됨')).toBeInTheDocument();
    expect(print).toHaveBeenCalledWith('spooler://XP-DT108B', '^XA421033881907^XZ');
    expect(server.confirmedPrints).toEqual(['s-1']);
    expect(within(screen.getByRole('table')).getByText('B-11-1')).toBeInTheDocument();
    await openBox('421033881907');
    expect(progress()).toHaveTextContent('0 / 4');
  });

  it('프린터가 없으면 새 송장 대신 «프린터 있는 자리» 로 거절한다', async () => {
    await setupInspection({ boxes: [{ ...BOX1, labelState: 'never_printed' }], prefs: stationPrefs({}, false) });
    scan('421033881907');
    expect(await screen.findByRole('alert')).toHaveTextContent('프린터 있는 자리에서 출력해 주세요');
  });

  it('빠진 박스의 송장이면 «빠진 박스», Esc 로 송장 대기', async () => {
    const { server } = await setupInspection();
    const box = server.box('421033881907');
    if (!box) throw new Error('fixture');
    box.withdrawn = true;
    scan('421033881907');
    expect(await screen.findByText('빠진 박스')).toBeInTheDocument();
    press('Escape');
    expect(await screen.findByText('송장 바코드')).toBeInTheDocument();
  });

  it('Esc 는 박스를 내려놓는다 — 찍은 수량은 서버에 남아 다시 열면 이어진다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(server.scans).toHaveLength(1));
    press('Escape');
    expect(await screen.findByText('송장 바코드')).toBeInTheDocument();
    await openBox('421033881907');
    expect(progress()).toHaveTextContent('1 / 4');
  });

  it('송장 대기에서 숫자를 치면 직접 입력칸이 열리고, Enter 로 그 송장을 연다(§5.6)', async () => {
    await setupInspection();
    await typeHuman(['4']);
    const input = await screen.findByLabelText('송장번호');
    expect(input).toHaveValue('4');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '421033881907' } });
    const form = input.closest('form');
    if (!form) throw new Error('form');
    fireEvent.submit(form);
    expect(await screen.findByRole('heading', { name: '4210-3388-1907' })).toBeInTheDocument();
  });

  it('하던 박스는 다시 그려질 때 다시 연다(재시작·탭 이동)', async () => {
    const prefs = stationPrefs();
    writeLastBox(prefs, { trackingNo: '421033881907', shipmentId: 's-1', batchId: 'b-1' } as ShipmentByWaybill);
    await setupInspection({ prefs });
    expect(await screen.findByRole('heading', { name: '4210-3388-1907' })).toBeInTheDocument();
  });

  it('상태바에 그 박스 배치의 진행이 뜬다', async () => {
    await setupInspection({ picking: [batchSummary({ id: 'b-1', batchNumber: 'B-1002' })] });
    await openBox('421033881915');
    expect(await screen.findByText('B-1002 0/2')).toBeInTheDocument();
    scan('8801003');
    expect(await screen.findByText('B-1002 1/2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run src/station/outbound/InspectionScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "../InspectionScreen"`(하네스) 또는 `"./InspectionScreen"`

- [ ] **Step 4: 화면 부품을 만든다**

`src/station/outbound/panels.tsx`:

```tsx
import { useState, type ReactNode } from 'react';
import { Check, Package, Printer, ScanLine, X } from 'lucide-react';
import { Button } from '../../core/design/Button';
import { cn } from '../../core/design/cn';
import { SCAN_STORAGE_MESSAGE } from '../../core/hardware/scan/useWorkScanQueue';
import { formatTrackingNo, type InspectionRow } from '../../domains/outbound/inspection';
import type { LabelItemChange } from '../../domains/outbound/waybillLabel';
import { Kbd } from '../Kbd';
import type { LastBox } from './model';
import { clockOf, type RecentEntry, type RecentKind } from './recent';

const CARD = 'rounded-[10px] border border-[#D5D8DE] bg-white';

/** 출고 검수 작업 영역 — 왼쪽 380px(송장·큰 칸), 오른쪽 나머지(표·최근). 셸 <main> 이 이미 p-3 이다 */
export function WorkGrid({ left, right, intake }: { left: ReactNode; right: ReactNode; intake?: 'open' | 'blocked' }) {
  return (
    <div data-intake={intake} className="grid h-full min-h-0 grid-cols-[380px_minmax(0,1fr)] gap-3">
      <section className="flex min-h-0 flex-col gap-3">{left}</section>
      <section className="flex min-h-0 flex-col gap-3">{right}</section>
    </div>
  );
}

export function BoxCard({
  trackingNo,
  recipient,
  deliveryNote,
}: {
  trackingNo: string;
  recipient: string;
  deliveryNote?: string | null;
}) {
  return (
    <div className={cn(CARD, 'flex shrink-0 flex-col gap-2.5 p-[18px]')}>
      <h2 className="font-mono text-[30px] font-semibold">{formatTrackingNo(trackingNo)}</h2>
      <div className="text-lg font-medium">{recipient}</div>
      {deliveryNote ? (
        <div className="rounded-md bg-[#FFF1C7] px-3 py-2.5 text-base font-semibold text-[#5E3B00]">{deliveryNote}</div>
      ) : null}
    </div>
  );
}

export type BigPanelContent =
  | { kind: 'progress'; scanned: number; ordered: number }
  | { kind: 'quantity'; value: string }
  | { kind: 'armed'; keyLabel: string; label: string }
  | { kind: 'alert'; message: string; detail?: string }
  | { kind: 'notice'; title: string; message?: string };

/** 왼쪽 아래 큰 칸 — 지금 찍을 것과 진행(거대), 또는 오류·안내 하나(스펙 §6.4) */
export function BigPanel({ content }: { content: BigPanelContent }) {
  const base = 'flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-[10px] p-6 text-center';
  switch (content.kind) {
    case 'progress':
      return (
        <div role="status" aria-label="진행" className={cn(base, 'border border-[#D5D8DE] bg-white')}>
          <div className="text-[30px] font-bold text-[#1D5BD8]">상품 바코드</div>
          <div className="font-mono text-[120px] font-semibold leading-none tracking-tight">
            {content.scanned}
            <span className="text-[#A3A9B4]"> / {content.ordered}</span>
          </div>
        </div>
      );
    case 'quantity':
      return (
        <div role="status" aria-label="수량" className={cn(base, 'border-2 border-[#1D5BD8] bg-white')}>
          <div className="text-[30px] font-bold text-[#1D5BD8]">수량</div>
          <div className="font-mono text-[120px] font-semibold leading-none">{content.value || '_'}</div>
        </div>
      );
    case 'armed':
      return (
        <div role="status" className={cn(base, 'border-2 border-[#D99A00] bg-[#FFF1C7] text-[#5E3B00]')}>
          <div className="text-[32px] font-bold">{content.label}</div>
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Kbd>{content.keyLabel}</Kbd> 한 번 더
          </div>
        </div>
      );
    case 'alert':
      return (
        <div role="alert" className={cn(base, 'border-2 border-[#C8202F] bg-[#FDE8EA]')}>
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#C8202F] text-white">
            <X className="h-11 w-11" aria-hidden />
          </div>
          <div className="text-[28px] font-bold text-[#9E1320]">{content.message}</div>
          {content.detail ? <div className="font-mono text-xl font-semibold">{content.detail}</div> : null}
        </div>
      );
    case 'notice':
      return (
        <div role="status" className={cn(base, 'border-2 border-[#D99A00] bg-[#FFF1C7] text-[#5E3B00]')}>
          <div className="text-[32px] font-bold">{content.title}</div>
          {content.message ? <div className="text-lg font-semibold">{content.message}</div> : null}
        </div>
      );
  }
}

const TH = 'border-b border-[#D5D8DE] bg-[#F6F7F8] px-4 py-2.5 text-left text-[13px] font-semibold text-[#535968]';

/** 품목 표 `위치 | 상품 | 주문 | 스캔` — 완료 줄 회색, 방금 찍은 줄 노랑, 수량 2 이상은 ×N(스펙 §6.4). 위치는 보여 주기만 */
export function LineTable({ rows, currentLineId }: { rows: readonly InspectionRow[]; currentLineId: string | null }) {
  return (
    <div className={cn(CARD, 'min-h-0 flex-1 overflow-auto')}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={cn(TH, 'w-[120px]')}>위치</th>
            <th className={TH}>상품</th>
            <th className={cn(TH, 'w-[90px] text-right')}>주문</th>
            <th className={cn(TH, 'w-[140px] text-right')}>스캔</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const current = !row.done && row.shipmentLineId === currentLineId;
            return (
              <tr
                key={row.shipmentLineId}
                data-state={row.done ? 'done' : current ? 'current' : 'todo'}
                className={cn(
                  'h-[72px] border-b border-[#E4E6EA] text-[17px]',
                  row.done && 'bg-[#F1F2F4] text-[#6B717D]',
                  current && 'bg-[#FFF1C7]'
                )}
              >
                <td className="px-4 font-mono font-semibold">{row.locations || '—'}</td>
                <td className={cn('px-4', !row.done && 'font-semibold')}>{row.name}</td>
                <td className="px-4 text-right font-mono">
                  {row.ordered >= 2 ? (
                    <span className="rounded bg-[#7A4B00] px-2 py-0.5 font-semibold text-white">×{row.ordered}</span>
                  ) : (
                    row.ordered
                  )}
                </td>
                <td className="px-4 text-right font-mono">
                  {row.done ? (
                    <span className="inline-flex items-center gap-2 font-semibold text-[#1E7A46]">
                      <Check className="h-5 w-5" aria-hidden />
                      {row.scanned}
                    </span>
                  ) : (
                    <span className={cn('text-2xl font-semibold', row.scanned > 0 ? 'text-[#1D5BD8]' : 'text-[#A3A9B4]')}>
                      {row.scanned}
                      <span className="text-[17px] text-[#7C828E]"> / {row.ordered}</span>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 송장이 바뀐 줄 `위치 | 상품 | 송장 → 지금`(목업 ④) */
export function ChangeTable({ changes }: { changes: readonly LabelItemChange[] }) {
  return (
    <div className={cn(CARD, 'min-h-0 flex-1 overflow-auto')}>
      <table className="w-full border-collapse text-[#535968]">
        <thead>
          <tr>
            <th className={cn(TH, 'w-[120px]')}>위치</th>
            <th className={TH}>상품</th>
            <th className={cn(TH, 'w-[180px] text-right')}>송장 → 지금</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={`${change.locationCode}-${change.skuId}`} className="h-[72px] border-b border-[#E4E6EA] text-[17px]">
              <td className="px-4 font-mono font-semibold text-[#15171C]">{change.locationCode}</td>
              <td className="px-4 font-semibold text-[#15171C]">{change.name}</td>
              <td className="px-4 text-right font-mono text-xl">
                <span className="line-through">{change.printedQty}</span> → <strong className="text-[#15171C]">{change.currentQty}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RECENT_ICON: Record<RecentKind, typeof Check> = {
  waybill: ScanLine,
  scan: Check,
  shipped: Package,
  printed: Printer,
  error: X,
};
const RECENT_TONE: Record<RecentKind, string> = {
  waybill: 'text-[#1D5BD8]',
  scan: 'text-[#1E7A46]',
  shipped: 'text-[#1E7A46]',
  printed: 'text-[#7A4B00]',
  error: 'text-[#9E1320]',
};

function recentText(entry: RecentEntry): string {
  if (entry.kind === 'shipped') return `${formatTrackingNo(entry.text)} 출고 완료`;
  if (entry.kind === 'printed') return `${formatTrackingNo(entry.text)} 새 송장 출력`;
  if (entry.kind === 'waybill') return formatTrackingNo(entry.text);
  return entry.text;
}

/** 최근 스캔(목업 ②) — 비었으면 그리지 않는다(U2) */
export function RecentList({ entries, grow = false }: { entries: readonly RecentEntry[]; grow?: boolean }) {
  if (entries.length === 0) return null;
  return (
    <ol
      aria-label="최근 스캔"
      className={cn(CARD, 'list-none overflow-hidden px-4 py-1.5 text-[15px]', grow ? 'min-h-0 flex-1' : 'h-[172px] shrink-0')}
    >
      {entries.map((entry) => {
        const Icon = RECENT_ICON[entry.kind];
        return (
          <li
            key={entry.id}
            className={cn(
              'grid h-10 grid-cols-[84px_28px_minmax(0,1fr)_auto] items-center border-b border-[#EEF0F2] last:border-b-0',
              entry.kind === 'error' && 'bg-[#FDE8EA] font-semibold text-[#9E1320]'
            )}
          >
            <span className="font-mono text-[#535968]">{clockOf(entry.at)}</span>
            <Icon className={cn('h-4 w-4', RECENT_TONE[entry.kind])} aria-hidden />
            <span className="truncate">{recentText(entry)}</span>
            <span className="font-mono font-semibold">{entry.qty ? `+${entry.qty}` : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** 송장 대기 위의 직전 박스(목업 ①) — 출고 완료, 또는 보충 대기로 간 박스와 가져올 것 */
export function DoneBanner({ last }: { last: LastBox }) {
  if (last.kind === 'shipped')
    return (
      <div className="flex shrink-0 items-center gap-[18px] rounded-[10px] border border-[#8CC8A4] bg-[#E3F4EA] px-[22px] py-5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#1E7A46] text-white">
          <Check className="h-8 w-8" aria-hidden />
        </span>
        <span className="font-mono text-[28px] font-semibold">{formatTrackingNo(last.trackingNo)}</span>
        <span className="text-xl font-semibold text-[#145232]">출고 완료</span>
      </div>
    );
  return (
    <div className="shrink-0 overflow-hidden rounded-[10px] border-2 border-[#D99A00] bg-white">
      <div className="flex h-10 items-center gap-2.5 bg-[#FFF1C7] px-4 text-[15px] font-bold text-[#5E3B00]">
        <span className="font-mono">{formatTrackingNo(last.trackingNo)}</span> 보충 대기
      </div>
      <ul className="px-4 py-2 text-base">
        {last.items.map((item) => (
          <li key={`${item.locationCode}-${item.name}`} className="py-1">
            <span className="font-mono font-semibold">[{item.locationCode}]</span> {item.name}{' '}
            <span className="font-mono font-semibold">×{item.qty}</span>
          </li>
        ))}
      </ul>
      {last.print.kind === 'failed' ? (
        <p role="alert" className="border-t border-[#EEF0F2] px-4 py-2 font-semibold text-[#9E1320]">
          {last.print.message}
        </p>
      ) : null}
    </div>
  );
}

/** 송장 대기(목업 ①) — 직접 입력칸이 열리면 그 안에 그린다 */
export function WaitingPrompt({ children }: { children?: ReactNode }) {
  return (
    <div className={cn(CARD, 'flex min-h-0 flex-1 flex-col items-center justify-center gap-5')}>
      <div className="flex h-[120px] w-[120px] items-center justify-center rounded-3xl bg-[#E3ECFC] text-[#1D5BD8]">
        <ScanLine className="h-[68px] w-[68px]" strokeWidth={1.6} aria-hidden />
      </div>
      <div className="text-4xl font-bold">송장 바코드</div>
      {children}
    </div>
  );
}

/** §5.6 — 송장 바코드가 훼손됐을 때 사람이 친다. Enter 로 보내고 Esc 로 닫는다 */
export function ManualWaybillInput({
  initial,
  onSubmit,
  onClose,
}: {
  initial: string;
  onSubmit(code: string): void;
  onClose(): void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="w-[300px]"
      onSubmit={(e) => {
        e.preventDefault();
        const code = value.trim();
        if (code) onSubmit(code);
      }}
    >
      <input
        aria-label="송장번호"
        autoFocus
        autoComplete="off"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        className="w-full rounded-md border border-[#D5D8DE] px-3 py-2 font-mono text-2xl"
      />
    </form>
  );
}

/** 스캔을 저장하지 못했거나 결과를 모를 때 — 같은 상품을 다시 찍지 않게 하고 확인 단추를 준다 */
export function QueueTrouble({ storage, onRetry }: { storage: boolean; onRetry(): void }) {
  return (
    <div role="alert" className="shrink-0 space-y-2 rounded-[10px] border-2 border-[#C8202F] bg-[#FDE8EA] p-3 text-[#9E1320]">
      <p className="font-semibold">
        {storage ? SCAN_STORAGE_MESSAGE : '앞 스캔이 처리됐는지 확인하지 못했어요. 같은 상품을 다시 찍지 마세요.'}
      </p>
      <Button onClick={onRetry}>처리 내역 확인</Button>
    </div>
  );
}
```

- [ ] **Step 5: 검수 중 화면을 만든다**

`src/station/outbound/InspectWork.tsx`:

```tsx
import { useEffect, type RefObject } from 'react';
import { inspectionRows, inspectionTotals } from '../../domains/outbound/inspection';
import type { ShipmentByWaybill } from '../../domains/outbound/types';
import { useStationActions } from '../ActionRegistry';
import { INSPECTION_ACTIONS } from './inspectionActions';
import type { Alert } from './model';
import { BigPanel, BoxCard, LineTable, QueueTrouble, RecentList, WorkGrid } from './panels';
import type { RecentEntry } from './recent';
import { INTAKE_BLOCKED_MESSAGE, useInspectionBox } from './useInspectionBox';

/** 부모(출고 검수 화면)가 송장인지 상품인지 가른 뒤 상품을 넘기는 곳. 내려놓기·전환 전에 앞 스캔을 다 보낸다 */
export interface BoxWorkHandle {
  accept(code: string): void;
  settle(): Promise<void>;
}

/** 검수 중(스펙 §6.3·§6.4, 목업 ②) — 박스마다 새로 마운트된다(key) */
export function InspectWork({
  box,
  handleRef,
  alert,
  recent,
  onAlert,
  onScanned,
  onShipped,
  onExcess,
  onPutDown,
}: {
  box: ShipmentByWaybill;
  handleRef: RefObject<BoxWorkHandle | null>;
  alert: Alert | null;
  recent: readonly RecentEntry[];
  onAlert(message: string, detail?: string): void;
  onScanned(name: string, quantity: number): void;
  onShipped(box: ShipmentByWaybill): void;
  onExcess(): void;
  onPutDown(): void;
}) {
  const nameOf = (lineId: string | null) => box.lines.find((line) => line.shipmentLineId === lineId)?.skuName ?? '';
  const work = useInspectionBox(box, {
    onAccepted: (lineId, quantity) => onScanned(nameOf(lineId), quantity),
    onShipped: () => onShipped(box),
    onRejected: (message, barcode) => onAlert(message, barcode ?? undefined),
    onExcess,
  });

  // 부모가 상품 스캔·내려놓기에 쓰는 손잡이. 렌더가 아니라 커밋 뒤에 건다 — 박스가 바뀌는 같은 커밋에서
  // 옛 박스의 정리가 새 박스의 손잡이를 지우지 않게(React 는 정리를 등록보다 먼저 돌린다)
  useEffect(() => {
    const own: BoxWorkHandle = {
      accept(code) {
        if (!work.accept(code, 1)) onAlert(INTAKE_BLOCKED_MESSAGE, code);
      },
      settle: work.settle,
    };
    handleRef.current = own;
    return () => {
      if (handleRef.current === own) handleRef.current = null;
    };
  });

  useStationActions([{ ...INSPECTION_ACTIONS.putDown, enabled: true, run: onPutDown }]);

  const rows = inspectionRows(box.lines, work.progress);
  const totals = inspectionTotals(rows);
  return (
    <WorkGrid
      intake={work.intakeBlocked ? 'blocked' : 'open'}
      left={
        <>
          <BoxCard trackingNo={box.trackingNo} recipient={box.recipientMasked} deliveryNote={box.deliveryNote} />
          <BigPanel content={alert ? { kind: 'alert', ...alert } : { kind: 'progress', ...totals }} />
          {work.queueError ? (
            <QueueTrouble storage={!!work.storageError} onRetry={() => void work.retryHead().catch(() => {})} />
          ) : null}
        </>
      }
      right={
        <>
          <LineTable rows={rows} currentLineId={work.lastScan?.shipmentLineId ?? null} />
          <RecentList entries={recent} />
        </>
      }
    />
  );
}
```

- [ ] **Step 6: 출고 검수 화면을 만든다**

`src/station/outbound/InspectionScreen.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { printRaw, readLabelPrinter, type PrintRaw } from '../../core/hardware/print/labelPrinter';
import { useHumanKeys, useScanEmit, useScanner } from '../../core/hardware/scan/useScanner';
import { batchProgressOf, useBatchWorkItems } from '../../domains/outbound/batchStatus';
import { classifyInspectScan, inspectionGateOf, isNotFound } from '../../domains/outbound/inspection';
import { clearLastBox, readLastBox, writeLastBox } from '../../domains/outbound/lastBox';
import { fetchShipmentByWaybill, useOutboundBatches } from '../../domains/outbound/queries';
import type { ShipmentByWaybill } from '../../domains/outbound/types';
import type { LabelItemChange } from '../../domains/outbound/waybillLabel';
import { WarehousePicker } from '../../domains/warehouse/WarehousePicker';
import { useStationActions } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { useFeedback } from '../feedback/FeedbackProvider';
import { useBatchProgress } from '../status/batchProgress';
import { modalOpen } from '../useStationKeys';
import { INSPECTION_ACTIONS } from './inspectionActions';
import { InspectWork, type BoxWorkHandle } from './InspectWork';
import type { Alert, LastBox, PrintStatus } from './model';
import {
  BigPanel,
  BoxCard,
  ChangeTable,
  DoneBanner,
  ManualWaybillInput,
  RecentList,
  WaitingPrompt,
  WorkGrid,
} from './panels';
import { printWaybill } from './printWaybill';
import { pushRecent, type RecentEntry } from './recent';
import { INTAKE_BLOCKED_MESSAGE, UNCERTAIN_SCAN_MESSAGE } from './useInspectionBox';

type View =
  | { kind: 'waiting' }
  | { kind: 'inspect'; box: ShipmentByWaybill; seq: number }
  | { kind: 'reprint'; box: ShipmentByWaybill; changes: LabelItemChange[]; print: PrintStatus }
  | { kind: 'withdraw'; box: ShipmentByWaybill; seq: number }
  | { kind: 'withdrawn'; box: ShipmentByWaybill };

/** 화면이 스스로 거절한 것 — 문구를 그대로 보인다(서버 오류 문구 변환을 거치지 않는다) */
class Refusal extends Error {}

const LOOKING_UP_MESSAGE = '송장을 확인하고 있어요. 다시 찍어 주세요.';
const EXCESS_MESSAGE = '출고가 끝난 박스에 찍은 상품은 반영되지 않았어요. 상품을 확인해 주세요.';

/** 스테이션 F1 출고 검수(스펙 §6) — 송장 스캔 즉시 시작, 상품 스캔 = +1, 마지막 스캔 = 출고, 다음 송장 */
export function InspectionScreen({ prefs = localStoragePrefs, print = printRaw }: { prefs?: DevicePrefs; print?: PrintRaw }) {
  const { warehouseId } = useWarehouse();
  if (!warehouseId) return <WarehousePicker />;
  return <Inspection key={warehouseId} warehouseId={warehouseId} prefs={prefs} print={print} />;
}

function Inspection({ warehouseId, prefs, print }: { warehouseId: string; prefs: DevicePrefs; print: PrintRaw }) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { signal } = useFeedback();
  const emit = useScanEmit();
  const [view, setView] = useState<View>({ kind: 'waiting' });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [alert, setAlert] = useState<Alert | null>(null);
  const [last, setLast] = useState<LastBox | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [manual, setManual] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(() => readLastBox(prefs)?.batchId ?? null);
  const work = useRef<BoxWorkHandle | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const canPrint = readLabelPrinter(prefs) !== null;

  // 상태바의 배치 진행(스펙 §5.5) — 마지막으로 연 박스의 배치
  const batches = useOutboundBatches(warehouseId, 'picking');
  const batchItems = useBatchWorkItems(batchId);
  const batch = batches.data?.find((b) => b.id === batchId);
  useBatchProgress(batch && batchItems.data ? batchProgressOf(batch.batchNumber, batchItems.data) : null);

  const note = useCallback(
    (entry: Omit<RecentEntry, 'id' | 'at'>) => setRecent((list) => pushRecent(list, { ...entry, at: Date.now() })),
    []
  );
  const reject = useCallback(
    (message: string, detail?: string) => {
      setAlert({ message, detail });
      signal('error');
      note({ kind: 'error', text: detail ?? message });
    },
    [signal, note]
  );

  const lookup = (code: string) => fetchShipmentByWaybill(api, code, warehouseId);
  const printFor = async (shipmentId: string): Promise<PrintStatus> => {
    const outcome = await printWaybill({ api, print, prefs }, shipmentId);
    void queryClient.invalidateQueries({ queryKey: ['waybill-label-states'] });
    return outcome.ok ? { kind: 'printed' } : { kind: 'failed', message: outcome.message };
  };

  /** 한 번에 하나 — 조회·전환·내려놓기가 겹치면 뒤의 것을 거절한다 */
  const run = async (task: () => Promise<void>) => {
    if (busy.current) {
      reject(LOOKING_UP_MESSAGE);
      return;
    }
    busy.current = true;
    try {
      await task();
    } catch (error) {
      reject(error instanceof Refusal ? error.message : errorMessage(error, 'outbound'));
    } finally {
      busy.current = false;
    }
  };

  /** 든 박스의 앞 스캔을 다 보낸다. 확인 못 한 스캔이 있으면 거절 — 내려놓으면 그 스캔이 재생될 길이 없다 */
  const settleWork = async () => {
    try {
      await work.current?.settle();
    } catch {
      throw new Refusal(UNCERTAIN_SCAN_MESSAGE);
    }
  };

  /** 조회 결과로 화면을 정한다(스펙 §6.2). quiet 는 하던 박스 복구 — 거절이면 조용히 대기로 */
  const show = async (found: ShipmentByWaybill, quiet = false) => {
    const gate = inspectionGateOf(found, { warehouseId, canPrint });
    if (gate.kind === 'reject') {
      if (quiet) clearLastBox(prefs);
      else reject(gate.message, found.trackingNo);
      return;
    }
    setAlert(null);
    setLast(null);
    if (found.batchId) setBatchId(found.batchId);
    note({ kind: 'waybill', text: found.trackingNo });
    signal('success');
    if (gate.kind === 'withdrawn') {
      clearLastBox(prefs);
      setView({ kind: 'withdrawn', box: found });
      return;
    }
    if (gate.kind === 'withdraw') {
      writeLastBox(prefs, found);
      setView({ kind: 'withdraw', box: found, seq: ++seq.current });
      return;
    }
    if (gate.kind === 'reprint') {
      clearLastBox(prefs);
      setView({ kind: 'reprint', box: found, changes: gate.changes, print: { kind: 'printing' } });
      const status = await printFor(found.shipmentId);
      setView((v) => (v.kind === 'reprint' && v.box.shipmentId === found.shipmentId ? { ...v, print: status } : v));
      if (status.kind === 'printed') note({ kind: 'printed', text: found.trackingNo });
      else signal('error');
      return;
    }
    writeLastBox(prefs, found);
    setView({ kind: 'inspect', box: found, seq: ++seq.current });
  };

  const open = (code: string) => run(async () => show(await lookup(code)));

  const giveProduct = (code: string) => {
    if (!work.current) {
      reject(INTAKE_BLOCKED_MESSAGE, code);
      return;
    }
    setAlert(null);
    work.current.accept(code);
  };

  /** 박스를 든 채 찍은 송장(U13) — 앞 상품 스캔을 다 보낸 뒤 내려놓고 연다. 송장이 아니었으면(404) 상품으로 넘긴다 */
  const switchTo = (code: string, kind: 'same-waybill' | 'maybe-waybill', current: ShipmentByWaybill) =>
    run(async () => {
      let found: ShipmentByWaybill | null = null;
      if (kind === 'maybe-waybill') {
        try {
          found = await lookup(code);
        } catch (error) {
          if (!isNotFound(error)) throw error;
          giveProduct(code);
          return;
        }
      }
      await settleWork();
      // 같은 박스면 방금 보낸 스캔까지 반영된 진행으로 다시 연다 — 몇 번을 찍어도 서버는 바뀌지 않는다(§6.2)
      if (found === null || found.shipmentId === current.shipmentId) found = await lookup(code);
      await show(found);
    });

  /** Esc 내려놓기 — «아무것도 작업 중이 아닌 초기 상태»(U13). 찍은 수량은 서버에 남는다 */
  const putDown = () =>
    run(async () => {
      await settleWork();
      clearLastBox(prefs);
      setAlert(null);
      setView({ kind: 'waiting' });
    });

  const onScan = (code: string) => {
    // 결품 창이 열려 있다 — 창의 키만 받는다. 스캐너의 Enter 가 창을 확정하지 않는다(사람 키 채널이 거른다)
    if (modalOpen()) {
      signal('error');
      return;
    }
    setManual(null);
    const current = viewRef.current;
    if (current.kind !== 'inspect' && current.kind !== 'withdraw') {
      void open(code);
      return;
    }
    const kind = classifyInspectScan(code, current.box.trackingNo);
    if (kind !== 'product') {
      void switchTo(code, kind, current.box);
      return;
    }
    if (busy.current) {
      reject(LOOKING_UP_MESSAGE, code);
      return;
    }
    giveProduct(code);
  };
  const scanRef = useRef(onScan);
  scanRef.current = onScan;
  useScanner(useCallback((event: { code: string }) => scanRef.current(event.code), []));

  // §5.6 — 송장 대기에서 사람이 숫자를 치면 직접 입력칸이 열린다(송장 바코드가 훼손됐을 때).
  // 오류가 떠 있으면 빨간 칸이 입력칸 자리를 차지하므로 함께 지운다
  useHumanKeys(
    view.kind === 'waiting' && manual === null
      ? (key: string) => {
          if (!/^\d$/.test(key)) return;
          setAlert(null);
          setManual(key);
        }
      : null
  );

  // 하던 박스는 다시 그려질 때 다시 연다(재시작·탭 이동) — 그 박스의 저장된 스캔이 이어서 재생된다.
  // main.tsx 가 StrictMode 라 effect 가 두 번 돈다 — 한 번만 돌게 꺼내 쓰고 비운다
  const restoreOnce = useRef<(() => void) | null>(() => {
    const saved = readLastBox(prefs);
    if (!saved) return;
    void run(async () => {
      try {
        await show(await lookup(saved.trackingNo), true);
      } catch {
        clearLastBox(prefs);
      }
    });
  });
  useEffect(() => {
    const restore = restoreOnce.current;
    restoreOnce.current = null;
    restore?.();
  }, []);

  const onShipped = (box: ShipmentByWaybill) => {
    clearLastBox(prefs);
    signal('complete');
    note({ kind: 'shipped', text: box.trackingNo });
    setLast({ kind: 'shipped', trackingNo: box.trackingNo });
    setAlert(null);
    setView({ kind: 'waiting' });
  };

  const reprintView = () =>
    run(async () => {
      const current = viewRef.current;
      if (current.kind !== 'reprint') return;
      setView({ ...current, print: { kind: 'printing' } });
      const status = await printFor(current.box.shipmentId);
      setView((v) => (v.kind === 'reprint' && v.box.shipmentId === current.box.shipmentId ? { ...v, print: status } : v));
      if (status.kind === 'printed') note({ kind: 'printed', text: current.box.trackingNo });
      else signal('error');
    });

  const putDownAction: StationAction = { ...INSPECTION_ACTIONS.putDown, enabled: true, run: () => void putDown() };
  const actions: StationAction[] =
    view.kind === 'reprint'
      ? [
          {
            ...INSPECTION_ACTIONS.reprint,
            label: '다시 출력',
            enabled: canPrint && view.print.kind !== 'printing',
            run: () => void reprintView(),
          },
          putDownAction,
        ]
      : view.kind === 'withdraw' || view.kind === 'withdrawn'
        ? [putDownAction]
        : [];
  useStationActions(actions);

  switch (view.kind) {
    case 'inspect':
      return (
        <InspectWork
          key={`${view.box.shipmentId}:${view.seq}`}
          box={view.box}
          handleRef={work}
          alert={alert}
          recent={recent}
          onAlert={reject}
          onScanned={(name, quantity) => {
            setAlert(null);
            signal('success');
            note({ kind: 'scan', text: name, qty: quantity });
          }}
          onShipped={onShipped}
          onExcess={() => reject(EXCESS_MESSAGE)}
          onPutDown={() => void putDown()}
        />
      );
    case 'reprint':
      return (
        <WorkGrid
          left={
            <>
              <BoxCard trackingNo={view.box.trackingNo} recipient={view.box.recipientMasked} />
              {view.print.kind === 'failed' ? (
                <BigPanel content={{ kind: 'alert', message: view.print.message }} />
              ) : (
                <BigPanel
                  content={{
                    kind: 'notice',
                    title: view.print.kind === 'printing' ? '새 송장 출력 중' : '새 송장 출력됨',
                    message: '옛 송장은 버리고 새 송장을 찍으세요',
                  }}
                />
              )}
            </>
          }
          right={
            <>
              {view.changes.length > 0 ? <ChangeTable changes={view.changes} /> : null}
              <RecentList entries={recent} grow={view.changes.length === 0} />
            </>
          }
        />
      );
    case 'withdraw':
      return (
        <WorkGrid
          left={
            <>
              <BoxCard trackingNo={view.box.trackingNo} recipient={view.box.recipientMasked} />
              <BigPanel content={alert ? { kind: 'alert', ...alert } : { kind: 'notice', title: '뺄 상품' }} />
            </>
          }
          right={<RecentList entries={recent} grow />}
        />
      );
    case 'withdrawn':
      return (
        <WorkGrid
          left={
            <>
              <BoxCard trackingNo={view.box.trackingNo} recipient={view.box.recipientMasked} />
              <BigPanel content={{ kind: 'notice', title: '빠진 박스', message: '송장은 버려 주세요' }} />
            </>
          }
          right={<RecentList entries={recent} grow />}
        />
      );
    default:
      return (
        <WorkGrid
          left={
            <>
              {alert ? (
                <BigPanel content={{ kind: 'alert', ...alert }} />
              ) : (
                <WaitingPrompt>
                  {manual !== null ? (
                    <ManualWaybillInput
                      initial={manual}
                      onClose={() => setManual(null)}
                      onSubmit={(code) => {
                        setManual(null);
                        // 버스로 보낸다 — 명령 바코드면 셸이, 아니면 위 onScan 이 송장으로 연다
                        emit({ code, source: 'hid', at: Date.now() });
                      }}
                    />
                  ) : null}
                </WaitingPrompt>
              )}
            </>
          }
          right={
            <>
              {last ? <DoneBanner last={last} /> : null}
              <RecentList entries={recent} grow />
            </>
          }
        />
      );
  }
}
```

- [ ] **Step 7: 통과를 확인한다**

Run: `npx vitest run src/station/outbound && npx tsc -b`
Expected: PASS (새 화면 테스트 16 + 앞 태스크 테스트), tsc 에러 0. 흔한 실패와 원인:
  - «U13» 테스트가 옛 박스에서 안 넘어간다 → `switchTo` 가 `settleWork` 를 기다리는데 `useInspectionBox.settle` 의 대기자가 안 풀린다. 큐가 비었을 때 다시 그려지는지(`useWorkScanQueue` 구독) 확인
  - «하던 박스» 테스트가 대기에 머문다 → `restoreOnce` 가 `run`·`show`·`lookup` 선언보다 위에 있어 첫 렌더 클로저가 비었다. 위 순서대로 선언 뒤에 둔다
  - «직접 입력칸» 이 안 열린다 → Task 2 의 사람 키는 60ms 뒤에 확정된다. `typeHuman` 이 70ms 쉬는지 본다

- [ ] **Step 8: 린트**

Run: `npx oxlint 2>&1 | grep -c warning`
Expected: `22`(develop 기준선과 같다). 새 경고가 `exhaustive-deps` 면 effect 의존성을 ref 로 옮긴다 — 경고를 끄지 않는다

- [ ] **Step 9: 커밋**

```bash
git add native/warehouse-app/src/station/outbound/panels.tsx native/warehouse-app/src/station/outbound/InspectWork.tsx \
  native/warehouse-app/src/station/outbound/InspectionScreen.tsx native/warehouse-app/src/station/outbound/InspectionScreen.test.tsx \
  native/warehouse-app/src/station/outbound/__fixtures__/renderStation.tsx
git commit -m "feat(warehouse-app): 스테이션 출고 검수 화면 — 송장 스캔 즉시 시작, 마지막 스캔에 출고, 다른 송장은 내려놓고 열기"
```

---

### Task 8: 검수 중 기능키 — F7 수량·F8 이 상품 전량·F10 강제출고·F11 박스 빼기·F12 송장 재출력, 명령 시트 절

**Files:**
- Modify: `native/warehouse-app/src/domains/outbound/batchRemove.ts` (`excludeFromBatch` 추출)
- Test: `native/warehouse-app/src/domains/outbound/batchRemove.test.ts` (추가)
- Modify: `native/warehouse-app/src/station/outbound/InspectWork.tsx` (전체 교체)
- Modify: `native/warehouse-app/src/station/outbound/InspectionScreen.tsx` (`reopen`·`reprintBox` 와 props 3개)
- Modify: `native/warehouse-app/src/station/commandSheet.ts`, Test: `native/warehouse-app/src/station/commandSheet.test.ts`
- Test: `native/warehouse-app/src/station/outbound/InspectKeys.test.tsx`

**Interfaces:**
- Consumes: Task 5 `forceOut`·`idle`·`lastScan`·`STATION_WITHDRAW_REASON`, Task 3 `remainingOf`, Task 6 `INSPECTION_ACTIONS`, PR B `useDigitCommands`, Task 2 `useHumanKeys`
- Produces:
  - `excludeFromBatch(api: ApiClient, input: { batchId: string; shipmentId: string; reason: string; idempotencyKey: string }): Promise<{ workItem?: { status?: string } }>` — `removeBoxFromBatch` 도 이걸 쓴다
  - `InspectWork` 에 props `canPrint: boolean`, `onReopen(box: ShipmentByWaybill): void`(박스 빼기 뒤 다시 조회), `onReprint(box: ShipmentByWaybill): void`(F12)
  - `COMMAND_SHEET_SECTIONS[1] = { title: '출고 검수', actions: Object.values(INSPECTION_ACTIONS) }`

**검수 중 키(스펙 §6.3 표)와 이 태스크의 규칙:**

| 키 | 액션 | 켜지는 조건 | 동작 |
| --- | --- | --- | --- |
| F7 | 수량 | 입력을 받을 수 있음 | 큰 칸이 «수량 _». 사람 숫자·숫자 명령이 들어가고 Backspace 로 지운다(3자리까지). 다음 상품 스캔 한 번에 그 수량, 그 뒤 1 |
| F8 | 이 상품 전량 | 보낼 것 없음(idle) + 직전 스캔 줄에 남은 수량 | 그 바코드로 «주문 − 스캔» 수량을 한 번 더 스캔(서버엔 일반 스캔) |
| F10 | 강제출고 | `stationForceDispatch` 권한 + idle | 첫 누름 = 무장(«강제출고 · F10 한 번 더»), 다시 F10 = 고정 사유로 강제출고 |
| F11 | 박스 빼기 | idle + 배치 있음 | 무장 → 다시 F11 = 고정 사유로 빼기 → 다시 조회(뺄 상품 / 빠진 박스) |
| F12 | 송장 재출력 | 프린터 설정 | 단건 출력 |
| Esc | 수량 취소 / 취소 / 내려놓기 | 늘 | 수량 입력 중이면 그것만, 무장 중이면 그것만, 아니면 내려놓기 |

무장은 스캔·다른 기능키·Esc 로 풀린다. 권한 없는 F10 은 바에 그리지 않는다(U2).

- [ ] **Step 1: `excludeFromBatch` — 실패하는 테스트를 쓴다**

`batchRemove.test.ts` 의 import 를 `import { describe, expect, it, vi } from 'vitest';`·`import { excludeFromBatch, removeBoxFromBatch } from './batchRemove';` 로 바꾸고 끝에 붙인다:

```ts
describe('excludeFromBatch', () => {
  it('사유를 다듬어 DELETE 로 보낸다 — 멱등 키와 함께', async () => {
    const request = vi.fn(async () => ({ workItem: { status: 'withdrawing' } }));
    await excludeFromBatch({ request } as never, {
      batchId: 'b-1',
      shipmentId: 's-1',
      reason: ' station_withdraw_command ',
      idempotencyKey: 'k-1',
    });
    expect(request).toHaveBeenCalledWith({
      method: 'DELETE',
      path: '/outbound-batches/b-1/shipments/s-1',
      body: { reason: 'station_withdraw_command' },
      idempotencyKey: 'k-1',
    });
  });
});
```

Run: `npx vitest run src/domains/outbound/batchRemove.test.ts`
Expected: FAIL — `excludeFromBatch` 가 없다

- [ ] **Step 2: 추출한다**

`batchRemove.ts` 에 더하고, `removeBoxFromBatch` 안의 `deps.api.request<{ workItem?… }>({ method: 'DELETE', … })` 호출을 이것으로 바꾼다:

```ts
/** DELETE /outbound-batches/:batchId/shipments/:shipmentId — 시작된 배치에서 박스를 뺀다. 담은 상품이 있으면 서버가 «빼는 중» 으로 둔다(스펙 §8) */
export function excludeFromBatch(
  api: ApiClient,
  input: { batchId: string; shipmentId: string; reason: string; idempotencyKey: string }
): Promise<{ workItem?: { status?: string } }> {
  return api.request<{ workItem?: { status?: string } }>({
    method: 'DELETE',
    path: `/outbound-batches/${input.batchId}/shipments/${input.shipmentId}`,
    body: { reason: input.reason.trim() },
    idempotencyKey: input.idempotencyKey,
  });
}
```

```ts
    const result = await excludeFromBatch(deps.api, {
      batchId: input.batchId,
      shipmentId: found.shipmentId,
      reason: input.reason,
      idempotencyKey: deps.newKey(),
    });
```

Run: `npx vitest run src/domains/outbound/batchRemove.test.ts src/domains/outbound/RemoveBoxPanel.test.tsx`
Expected: PASS (기존 «박스 빼기» 패널 테스트 그대로)

- [ ] **Step 3: 기능키 화면 테스트를 쓴다**

`src/station/outbound/InspectKeys.test.tsx`:

```tsx
import 'fake-indexeddb/auto';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STATION_FORCE_REASON, STATION_WITHDRAW_REASON } from './useInspectionBox';
import { openBox, press, scan, setupInspection, stationPrefs, typeHuman } from './__fixtures__/renderStation';

const bar = () => within(screen.getByRole('toolbar', { name: '기능키' }));
const big = (name: string) => screen.getByRole('status', { name });

describe('검수 중 기능키(스펙 §6.3)', () => {
  it('F7 수량 → 키보드 숫자 → 다음 스캔 한 번에 그 수량, 그 뒤엔 1', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    press('F7');
    await typeHuman(['2']);
    expect(big('수량')).toHaveTextContent('2');
    scan('8801002');
    await waitFor(() => expect(server.scans).toEqual([expect.objectContaining({ barcode: '8801002', quantity: 2 })]));
    scan('8801002');
    await waitFor(() => expect(server.scans[1]).toMatchObject({ barcode: '8801002', quantity: 1 }));
  });

  it('F7 수량은 숫자 명령(%91%N)으로도 넣고 Backspace 로 지운다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    press('F7');
    scan('%91%3');
    scan('%91%1');
    expect(big('수량')).toHaveTextContent('31');
    await typeHuman(['Backspace']);
    expect(big('수량')).toHaveTextContent('3');
    scan('8801002');
    await waitFor(() => expect(server.scans[0]).toMatchObject({ quantity: 3 }));
  });

  it('Esc 는 수량 입력만 먼저 취소한다 — 박스는 그대로', async () => {
    await setupInspection();
    await openBox('421033881907');
    press('F7');
    expect(bar().getByRole('button', { name: /수량 취소/ })).toBeInTheDocument();
    press('Escape');
    expect(big('진행')).toHaveTextContent('0 / 4');
    expect(screen.getByRole('heading', { name: '4210-3388-1907' })).toBeInTheDocument();
  });

  it('F8 이 상품 전량 — 직전에 찍은 줄의 남은 수량을 그 바코드로 한 번에(직전 스캔이 없으면 꺼짐)', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    expect(bar().queryByRole('button', { name: /이 상품 전량/ })).toBeNull();
    scan('8801002');
    await waitFor(() => expect(bar().getByRole('button', { name: /이 상품 전량/ })).toBeInTheDocument());
    press('F8');
    await waitFor(() => expect(server.scans[1]).toMatchObject({ barcode: '8801002', quantity: 2 }));
    await waitFor(() => expect(big('진행')).toHaveTextContent('3 / 4'));
  });

  it('F10 강제출고는 한 번 더 눌러야 나간다 — 고정 사유', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    // 권한 미리보기(work-context)가 도착해야 F10 이 선언된다
    await waitFor(() => expect(bar().getByRole('button', { name: /강제출고/ })).toBeInTheDocument());
    press('F10');
    expect(screen.getByText('강제출고')).toBeInTheDocument();
    expect(server.forces).toEqual([]);
    press('F10');
    expect(await screen.findByText('출고 완료')).toBeInTheDocument();
    expect(server.forces).toEqual([{ shipmentId: 's-1', reason: STATION_FORCE_REASON }]);
  });

  it('무장은 스캔·다른 키로 풀린다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    await waitFor(() => expect(bar().getByRole('button', { name: /강제출고/ })).toBeInTheDocument());
    press('F10');
    scan('8801001');
    await waitFor(() => expect(big('진행')).toHaveTextContent('1 / 4'));
    press('F10');
    press('F7');
    press('F10');
    expect(server.forces).toEqual([]);
  });

  it('강제출고 권한이 없으면 F10 을 그리지 않는다', async () => {
    await setupInspection({ permissions: { shortPick: true } });
    await openBox('421033881907');
    await waitFor(() => expect(bar().getByRole('button', { name: /박스 빼기/ })).toBeInTheDocument());
    expect(bar().queryByRole('button', { name: /강제출고/ })).toBeNull();
  });

  it('F11 박스 빼기 — 한 번 더 누르면 고정 사유로 빼고, 담은 상품이 있으면 뺄 상품으로', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(server.scans).toHaveLength(1));
    await waitFor(() => expect(bar().getByRole('button', { name: /박스 빼기/ })).toBeInTheDocument());
    press('F11');
    expect(server.excludes).toEqual([]);
    press('F11');
    expect(await screen.findByText('뺄 상품')).toBeInTheDocument();
    expect(server.excludes).toEqual([{ batchId: 'b-1', shipmentId: 's-1', reason: STATION_WITHDRAW_REASON }]);
  });

  it('F11 — 담은 상품이 없으면 바로 빠진 박스', async () => {
    const { server } = await setupInspection();
    server.config.excludeOutcome = 'removed';
    await openBox('421033881907');
    press('F11');
    press('F11');
    expect(await screen.findByText('빠진 박스')).toBeInTheDocument();
  });

  it('F12 송장 재출력 — 프린터로 다시 보낸다', async () => {
    const { print } = await setupInspection();
    await openBox('421033881907');
    press('F12');
    await waitFor(() => expect(print).toHaveBeenCalledWith('spooler://XP-DT108B', '^XA421033881907^XZ'));
  });

  it('프린터가 없으면 F12 를 그리지 않는다', async () => {
    await setupInspection({ prefs: stationPrefs({}, false) });
    await openBox('421033881907');
    expect(bar().queryByRole('button', { name: /송장 재출력/ })).toBeNull();
  });
});
```

- [ ] **Step 4: 실패를 확인한다**

Run: `npx vitest run src/station/outbound/InspectKeys.test.tsx`
Expected: FAIL — F7·F8·F10·F11·F12 버튼이 없다

- [ ] **Step 5: `InspectWork.tsx` 를 이것으로 바꾼다**

```tsx
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { useHumanKeys } from '../../core/hardware/scan/useScanner';
import { useWorkPermissions } from '../../core/operations/useWorkCapabilities';
import { excludeFromBatch } from '../../domains/outbound/batchRemove';
import { inspectionRows, inspectionTotals, remainingOf } from '../../domains/outbound/inspection';
import type { ShipmentByWaybill } from '../../domains/outbound/types';
import { useDigitCommands, useStationActions } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { INSPECTION_ACTIONS } from './inspectionActions';
import type { Alert } from './model';
import { BigPanel, BoxCard, LineTable, QueueTrouble, RecentList, WorkGrid, type BigPanelContent } from './panels';
import type { RecentEntry } from './recent';
import { INTAKE_BLOCKED_MESSAGE, STATION_WITHDRAW_REASON, useInspectionBox } from './useInspectionBox';

/** 부모(출고 검수 화면)가 송장인지 상품인지 가른 뒤 상품을 넘기는 곳. 내려놓기·전환 전에 앞 스캔을 다 보낸다 */
export interface BoxWorkHandle {
  accept(code: string): void;
  settle(): Promise<void>;
}

/** 수량은 세 자리까지 — 그보다 많은 줄은 F8(이 상품 전량)이 맡는다 */
const MAX_QUANTITY_DIGITS = 3;

/** «한 번 더 눌러 확정» 대기 중인 키(§6.3 F10·F11) */
type Armed = 'force' | 'withdraw' | null;

/** 검수 중(스펙 §6.3·§6.4, 목업 ②) — 박스마다 새로 마운트된다(key) */
export function InspectWork({
  box,
  handleRef,
  alert,
  recent,
  canPrint,
  onAlert,
  onScanned,
  onShipped,
  onExcess,
  onPutDown,
  onReopen,
  onReprint,
}: {
  box: ShipmentByWaybill;
  handleRef: RefObject<BoxWorkHandle | null>;
  alert: Alert | null;
  recent: readonly RecentEntry[];
  canPrint: boolean;
  onAlert(message: string, detail?: string): void;
  onScanned(name: string, quantity: number): void;
  onShipped(box: ShipmentByWaybill): void;
  onExcess(): void;
  onPutDown(): void;
  /** 박스 빼기 뒤 — 송장을 다시 조회해 화면을 정한다(뺄 상품·빠진 박스) */
  onReopen(box: ShipmentByWaybill): void;
  onReprint(box: ShipmentByWaybill): void;
}) {
  const api = useApiClient();
  const permissions = useWorkPermissions();
  const nameOf = (lineId: string | null) => box.lines.find((line) => line.shipmentLineId === lineId)?.skuName ?? '';
  const work = useInspectionBox(box, {
    onAccepted: (lineId, quantity) => onScanned(nameOf(lineId), quantity),
    onShipped: () => onShipped(box),
    onRejected: (message, barcode) => onAlert(message, barcode ?? undefined),
    onExcess,
  });
  const [quantity, setQuantity] = useState<string | null>(null);
  const quantityRef = useRef(quantity);
  quantityRef.current = quantity;
  const [armed, setArmed] = useState<Armed>(null);

  // 부모가 상품 스캔·내려놓기에 쓰는 손잡이. 렌더가 아니라 커밋 뒤에 건다 — 박스가 바뀌는 같은 커밋에서
  // 옛 박스의 정리가 새 박스의 손잡이를 지우지 않게(React 는 정리를 등록보다 먼저 돌린다)
  useEffect(() => {
    const own: BoxWorkHandle = {
      accept(code) {
        // 스캔은 무장을 푼다. 수량은 이 스캔 한 번에 쓰고 1 로 돌아간다(§6.3)
        setArmed(null);
        const typed = quantityRef.current;
        if (typed !== null) setQuantity(null);
        const count = typed ? Math.max(1, Number(typed)) : 1;
        if (!work.accept(code, count)) onAlert(INTAKE_BLOCKED_MESSAGE, code);
      },
      settle: work.settle,
    };
    handleRef.current = own;
    return () => {
      if (handleRef.current === own) handleRef.current = null;
    };
  });

  // F7 수량 — 키보드 숫자(사람 키)와 숫자 명령(%91%N)이 같은 칸에 들어간다(§5.3). 입력칸을 쓰지 않는다:
  // 입력칸에 포커스가 가면 스캔 버퍼가 아무것도 받지 않는다(PR B 계약 메모)
  const typeDigit = useCallback(
    (digit: number) =>
      setQuantity((q) => (q === null ? q : `${q}${digit}`.replace(/^0+(?=\d)/, '').slice(0, MAX_QUANTITY_DIGITS))),
    []
  );
  useDigitCommands(quantity !== null ? typeDigit : null);
  useHumanKeys(
    quantity !== null
      ? (key: string) => {
          if (/^\d$/.test(key)) typeDigit(Number(key));
          else if (key === 'Backspace') setQuantity((q) => (q === null ? q : q.slice(0, -1)));
        }
      : null
  );

  const remaining = work.lastScan ? remainingOf(work.progress, work.lastScan.shipmentLineId) : 0;
  const canForce = permissions.data?.stationForceDispatch === true;

  /** 첫 누름은 무장, 같은 키를 한 번 더 누르면 실행(§6.3 F10·F11, §7.4) */
  const arm = (kind: 'force' | 'withdraw', act: () => void) => {
    setQuantity(null);
    if (armed === kind) {
      setArmed(null);
      act();
    } else setArmed(kind);
  };

  const withdrawBox = async () => {
    if (!box.batchId) return;
    try {
      await excludeFromBatch(api, {
        batchId: box.batchId,
        shipmentId: box.shipmentId,
        reason: STATION_WITHDRAW_REASON,
        idempotencyKey: crypto.randomUUID(),
      });
      onReopen(box);
    } catch (error) {
      onAlert(errorMessage(error, 'outbound'));
    }
  };

  const actions: StationAction[] = [
    {
      ...INSPECTION_ACTIONS.quantity,
      enabled: !work.intakeBlocked,
      run: () => {
        setArmed(null);
        setQuantity('');
      },
    },
    {
      ...INSPECTION_ACTIONS.all,
      enabled: work.idle && remaining > 0,
      run: () => {
        setArmed(null);
        setQuantity(null);
        // 직전에 찍은 줄의 «주문 − 스캔» 을 그 바코드로 한 번 더 — 서버에는 일반 스캔이다(§6.3)
        if (work.lastScan && !work.accept(work.lastScan.barcode, remaining)) onAlert(INTAKE_BLOCKED_MESSAGE);
      },
    },
    ...(canForce
      ? [
          {
            ...INSPECTION_ACTIONS.force,
            label: armed === 'force' ? '강제출고 확정' : INSPECTION_ACTIONS.force.label,
            enabled: work.idle,
            run: () => arm('force', () => void work.forceOut()),
          },
        ]
      : []),
    {
      ...INSPECTION_ACTIONS.withdraw,
      label: armed === 'withdraw' ? '박스 빼기 확정' : INSPECTION_ACTIONS.withdraw.label,
      enabled: work.idle && box.batchId !== null,
      run: () => arm('withdraw', () => void withdrawBox()),
    },
    {
      ...INSPECTION_ACTIONS.reprint,
      enabled: canPrint,
      run: () => {
        setArmed(null);
        onReprint(box);
      },
    },
    {
      ...INSPECTION_ACTIONS.putDown,
      label: quantity !== null ? '수량 취소' : armed ? '취소' : INSPECTION_ACTIONS.putDown.label,
      enabled: true,
      run: () => {
        if (quantity !== null) setQuantity(null);
        else if (armed) setArmed(null);
        else onPutDown();
      },
    },
  ];
  useStationActions(actions);

  const rows = inspectionRows(box.lines, work.progress);
  const totals = inspectionTotals(rows);
  const big: BigPanelContent = armed
    ? { kind: 'armed', keyLabel: armed === 'force' ? 'F10' : 'F11', label: armed === 'force' ? '강제출고' : '박스 빼기' }
    : quantity !== null
      ? { kind: 'quantity', value: quantity }
      : alert
        ? { kind: 'alert', ...alert }
        : { kind: 'progress', ...totals };
  return (
    <WorkGrid
      intake={work.intakeBlocked ? 'blocked' : 'open'}
      left={
        <>
          <BoxCard trackingNo={box.trackingNo} recipient={box.recipientMasked} deliveryNote={box.deliveryNote} />
          <BigPanel content={big} />
          {work.queueError ? (
            <QueueTrouble storage={!!work.storageError} onRetry={() => void work.retryHead().catch(() => {})} />
          ) : null}
        </>
      }
      right={
        <>
          <LineTable rows={rows} currentLineId={work.lastScan?.shipmentLineId ?? null} />
          <RecentList entries={recent} />
        </>
      }
    />
  );
}
```

- [ ] **Step 6: 부모에 다시 조회·재출력을 단다**

`InspectionScreen.tsx` 의 `onShipped` 아래에 더한다:

```tsx
  /** 박스 빼기(F11) 뒤 — 송장을 다시 조회해 화면을 정한다(뺄 상품·빠진 박스) */
  const reopen = (box: ShipmentByWaybill) =>
    run(async () => {
      await settleWork();
      await show(await lookup(box.trackingNo));
    });

  /** F12 — 든 박스의 송장을 다시 뽑는다 */
  const reprintBox = (box: ShipmentByWaybill) =>
    run(async () => {
      const status = await printFor(box.shipmentId);
      if (status.kind === 'failed') {
        reject(status.message);
        return;
      }
      note({ kind: 'printed', text: box.trackingNo });
      signal('success');
    });
```

`<InspectWork … />` 에 세 prop 을 더한다(`onPutDown` 아래):

```tsx
          canPrint={canPrint}
          onReopen={(box) => void reopen(box)}
          onReprint={(box) => void reprintBox(box)}
```

- [ ] **Step 7: 명령 시트에 「출고 검수」 절을 싣는다 — 테스트 먼저**

`commandSheet.test.ts` 의 `describe` 안에 더한다:

```ts
  it('둘째 절은 출고 검수 — 화면이 선언하는 액션과 같은 값(F7~F12, Esc)', () => {
    expect(COMMAND_SHEET_SECTIONS[1].title).toBe('출고 검수');
    expect(COMMAND_SHEET_SECTIONS[1].actions.map((a) => a.key)).toEqual(['F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Escape']);
    expect(COMMAND_SHEET_SECTIONS[1].actions).toContainEqual(expect.objectContaining({ key: 'F10', label: '강제출고' }));
  });
```

`commandSheet.ts`:

```ts
import type { ActionSpec } from './actions';
import { encodeCode128B } from './code128';
import { commandCodeOfDigit, commandCodeOfKey } from './commandCode';
import { INSPECTION_ACTIONS } from './outbound/inspectionActions';
import { STATION_TABS } from './tabs';
```

```ts
export const COMMAND_SHEET_SECTIONS: readonly CommandSheetSection[] = [
  { title: '탭', actions: STATION_TABS.map((tab) => ({ key: tab.key, label: tab.label })) },
  // 화면 선언과 같은 상수 — 시트와 기능키 바가 갈리지 않는다(PR B 계약 메모)
  { title: '출고 검수', actions: Object.values(INSPECTION_ACTIONS) },
];
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npx vitest run src/station && npx tsc -b`
Expected: PASS — 새 기능키 테스트 11 + 시트 1, 기존 `CommandSheetScreen` 테스트는 절·바코드 수를 상수에서 세므로 그대로 통과. tsc 에러 0

- [ ] **Step 9: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound/batchRemove.ts native/warehouse-app/src/domains/outbound/batchRemove.test.ts \
  native/warehouse-app/src/station/outbound/InspectWork.tsx native/warehouse-app/src/station/outbound/InspectionScreen.tsx \
  native/warehouse-app/src/station/outbound/InspectKeys.test.tsx \
  native/warehouse-app/src/station/commandSheet.ts native/warehouse-app/src/station/commandSheet.test.ts
git commit -m "feat(warehouse-app): 검수 중 기능키 — 수량·이 상품 전량·강제출고·박스 빼기(한 번 더 확정)·송장 재출력, 명령 시트 절"
```

---

### Task 9: 뺄 상품 — 담은 상품을 되돌림 바구니로, 다 빼면 «빠진 박스»

**Files:**
- Create: `native/warehouse-app/src/station/outbound/WithdrawWork.tsx`
- Modify: `native/warehouse-app/src/station/outbound/InspectionScreen.tsx` (`case 'withdraw'` 를 `WithdrawWork` 로)
- Test: `native/warehouse-app/src/station/outbound/Withdraw.test.tsx`

**Interfaces:**
- Consumes: `removeToReturnBin`·`withdrawalRows`(domains/outbound/withdraw.ts — 지금 `WithdrawBoxScreen` 이 쓰는 서버 경로 그대로), `readReturnBin`·`isReturnBinCode`, Task 5 `useWorkScanQueue(...).settle`, Task 7 `BoxWorkHandle`·panels
- Produces: `WithdrawWork({ box, handleRef, prefs, warehouseId, alert, recent, onAlert(message, detail?), onRemoved(barcode), onDone(box) })`. 송장/상품 가르기·전환·Esc 는 부모(Task 7)가 검수 중과 똑같이 한다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/station/outbound/Withdraw.test.tsx`:

```tsx
import 'fake-indexeddb/auto';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RETURN_BIN_KEY } from '../../domains/returns/returnBin';
import type { FakeBox } from './__fixtures__/outboundServer';
import { BOX1, flash, openBox, press, scan, setupInspection, stationPrefs } from './__fixtures__/renderStation';

const withBin = () => stationPrefs({ [RETURN_BIN_KEY]: JSON.stringify({ warehouseId: 'w-1', barcode: 'RB-01' }) });
const WITHDRAWING: FakeBox = {
  ...BOX1,
  labelState: 'withdrawing',
  removals: [
    {
      shipmentLineId: 'l-2',
      skuId: 'sku-2',
      skuCode: 'sku-2',
      skuName: '헤어클립 집게핀',
      sourceLocationId: 'loc-B-11-1',
      locationCode: 'B-11-1',
      boxQty: 2,
      cartQty: 0,
    },
  ],
};
const list = () => screen.getByRole('list', { name: '뺄 상품' });

describe('뺄 상품(스펙 §6.2 withdrawing)', () => {
  it('빼는 중인 박스 송장이면 뺄 목록 — 상품을 찍으면 바구니로, 다 빼면 «빠진 박스»', async () => {
    const { server } = await setupInspection({ boxes: [WITHDRAWING], prefs: withBin() });
    scan('421033881907');
    expect(await screen.findByText('뺄 상품')).toBeInTheDocument();
    expect(within(list()).getByText('[B-11-1] 헤어클립 집게핀')).toBeInTheDocument();
    expect(within(list()).getByText('2')).toBeInTheDocument();
    scan('8801002');
    await waitFor(() => expect(within(list()).getByText('1')).toBeInTheDocument());
    scan('8801002');
    expect(await screen.findByText('빠진 박스')).toBeInTheDocument();
    expect(flash()).toBe('complete');
    expect(server.box('421033881907')?.withdrawn).toBe(true);
  });

  it('되돌림 바구니가 없으면 알리고 상품을 받지 않는다', async () => {
    const { server } = await setupInspection({ boxes: [WITHDRAWING] });
    scan('421033881907');
    expect(await screen.findByText('설정에서 이 기기의 되돌림 바구니를 먼저 지정해 주세요.')).toBeInTheDocument();
    scan('8801002');
    expect(flash()).toBe('error');
    expect(server.requests.some((r) => r.path.endsWith('/return-bin-removals'))).toBe(false);
  });

  it('바구니 바코드를 찍으면 «뺄 상품을 찍어 주세요»', async () => {
    await setupInspection({ boxes: [WITHDRAWING], prefs: withBin() });
    scan('421033881907');
    await screen.findByText('뺄 상품');
    scan('RB-01');
    expect(await screen.findByRole('alert')).toHaveTextContent('바구니 바코드예요');
  });

  it('F11 로 뺀 박스는 그 자리에서 뺄 상품으로 이어 간다', async () => {
    const { server } = await setupInspection({ prefs: withBin() });
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(server.scans).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /박스 빼기/ })).toBeInTheDocument());
    press('F11');
    press('F11');
    await screen.findByText('뺄 상품');
    scan('8801002');
    expect(await screen.findByText('빠진 박스')).toBeInTheDocument();
  });

  it('Esc 는 뺄 상품을 내려놓는다', async () => {
    await setupInspection({ boxes: [WITHDRAWING], prefs: withBin() });
    scan('421033881907');
    await screen.findByText('뺄 상품');
    press('Escape');
    expect(await screen.findByText('송장 바코드')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/station/outbound/Withdraw.test.tsx`
Expected: FAIL — 뺄 목록(`list` 이름 «뺄 상품»)이 없다

- [ ] **Step 3: 뺄 상품 화면을 만든다**

`src/station/outbound/WithdrawWork.tsx`:

```tsx
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { cn } from '../../core/design/cn';
import { useWorkScanQueue } from '../../core/hardware/scan/useWorkScanQueue';
import type { ShipmentByWaybill, WithdrawalRemoval } from '../../domains/outbound/types';
import { removeToReturnBin, withdrawalRows } from '../../domains/outbound/withdraw';
import { isReturnBinCode, readReturnBin } from '../../domains/returns/returnBin';
import type { BoxWorkHandle } from './InspectWork';
import type { Alert } from './model';
import { BigPanel, BoxCard, QueueTrouble, RecentList, WorkGrid } from './panels';
import type { RecentEntry } from './recent';
import { INTAKE_BLOCKED_MESSAGE } from './useInspectionBox';

const ALREADY_EXITED_MESSAGE = '이미 다 뺀 박스예요 — 이 상품은 바구니에 넣지 마세요.';
const NO_BIN_MESSAGE = '설정에서 이 기기의 되돌림 바구니를 먼저 지정해 주세요.';

/**
 * 뺄 상품(스펙 §6.2 withdrawing) — 담은 상품을 찍어 되돌림 바구니로. 다 빼면 «빠진 박스».
 * 서버 경로·스캔 한 번 = 하나·멱등 키는 지금의 WithdrawBoxScreen 과 같다. 박스마다 새로 마운트된다(key).
 */
export function WithdrawWork({
  box,
  handleRef,
  prefs,
  warehouseId,
  alert,
  recent,
  onAlert,
  onRemoved,
  onDone,
}: {
  box: ShipmentByWaybill;
  handleRef: RefObject<BoxWorkHandle | null>;
  prefs: DevicePrefs;
  warehouseId: string;
  alert: Alert | null;
  recent: readonly RecentEntry[];
  onAlert(message: string, detail?: string): void;
  onRemoved(barcode: string): void;
  onDone(box: ShipmentByWaybill): void;
}) {
  const api = useApiClient();
  const bin = readReturnBin(prefs, warehouseId);
  const [removals, setRemovals] = useState<WithdrawalRemoval[]>(box.removals);
  const done = useRef(false);
  const queue = useWorkScanQueue<{ barcode: string; returnBinBarcode: string }>(async (input, id) => {
    // 박스를 다 뺀 스캔 뒤에 줄 서 있던 스캔 — 보내지 않되, 손에 든 상품을 바구니에 넣지 않게 알린다
    if (done.current) {
      onAlert(ALREADY_EXITED_MESSAGE, input.barcode);
      return;
    }
    try {
      const result = await removeToReturnBin(api, { shipmentId: box.shipmentId, ...input, idempotencyKey: id });
      setRemovals(result.removals);
      onRemoved(input.barcode);
      if (result.exited) {
        done.current = true;
        onDone(box);
      }
    } catch (error) {
      onAlert(errorMessage(error, 'outbound'), input.barcode);
      if (!(error instanceof ApiError && error.outcome === 'rejected')) throw error;
    }
  }, `withdraw:${box.shipmentId}`);
  const rows = withdrawalRows(removals);
  const cartOnly = rows.length > 0 && rows.every((row) => row.onCart);

  // 부모가 상품 스캔·내려놓기에 쓰는 손잡이(InspectWork 와 같은 규칙 — 커밋 뒤에 건다)
  useEffect(() => {
    const own: BoxWorkHandle = {
      accept(code) {
        if (!bin) return onAlert(NO_BIN_MESSAGE);
        if (done.current) return onAlert(ALREADY_EXITED_MESSAGE, code);
        // 앞 스캔의 결과를 모르는 채 같은 상품을 또 찍으면 한 개가 두 번 빠진다
        if (!queue.ready || queue.error()) return onAlert(INTAKE_BLOCKED_MESSAGE, code);
        if (isReturnBinCode(code)) return onAlert('바구니 바코드예요 — 뺄 상품을 찍어 주세요.', code);
        if (cartOnly) return onAlert('박스에서 뺄 상품은 없어요. 카트 몫은 분류대에서 빠져요.', code);
        queue.enqueue({ barcode: code, returnBinBarcode: bin });
      },
      settle: () => queue.settle(),
    };
    handleRef.current = own;
    return () => {
      if (handleRef.current === own) handleRef.current = null;
    };
  });

  return (
    <WorkGrid
      intake={queue.ready && !queue.error() ? 'open' : 'blocked'}
      left={
        <>
          <BoxCard trackingNo={box.trackingNo} recipient={box.recipientMasked} deliveryNote={box.deliveryNote} />
          <BigPanel
            content={alert ? { kind: 'alert', ...alert } : { kind: 'notice', title: '뺄 상품', message: bin ? `바구니 ${bin}` : undefined }}
          />
          {!bin ? (
            <p role="alert" className="shrink-0 rounded-[10px] border-2 border-[#C8202F] bg-[#FDE8EA] p-3 font-semibold text-[#9E1320]">
              {NO_BIN_MESSAGE}
            </p>
          ) : null}
          {queue.error() ? (
            <QueueTrouble storage={!!queue.storageError()} onRetry={() => void queue.retryHead().catch(() => {})} />
          ) : null}
        </>
      }
      right={
        <>
          <ul aria-label="뺄 상품" className="min-h-0 flex-1 overflow-auto rounded-[10px] border border-[#D5D8DE] bg-white">
            {rows.map((row) => (
              <li
                key={row.key}
                className={cn(
                  'flex h-[72px] items-center justify-between border-b border-[#E4E6EA] px-4 text-[17px]',
                  row.onCart && 'text-[#6B717D]'
                )}
              >
                <span className="font-semibold">
                  {row.label}
                  {row.onCart ? <span className="ml-2 rounded bg-[#E2E4E8] px-2 py-0.5 text-sm font-medium">카트</span> : null}
                </span>
                <span className="font-mono text-2xl font-semibold">{row.qty}</span>
              </li>
            ))}
          </ul>
          <RecentList entries={recent} />
        </>
      }
    />
  );
}
```

`InspectionScreen.tsx` — import 에 `import { WithdrawWork } from './WithdrawWork';` 를 더하고, `case 'withdraw':` 블록 전체를 이것으로 바꾼다:

```tsx
    case 'withdraw':
      return (
        <WithdrawWork
          key={`${view.box.shipmentId}:${view.seq}`}
          box={view.box}
          handleRef={work}
          prefs={prefs}
          warehouseId={warehouseId}
          alert={alert}
          recent={recent}
          onAlert={reject}
          onRemoved={(barcode) => {
            setAlert(null);
            signal('success');
            note({ kind: 'scan', text: barcode, qty: 1 });
          }}
          onDone={(box) => {
            clearLastBox(prefs);
            signal('complete');
            setAlert(null);
            setView({ kind: 'withdrawn', box });
          }}
        />
      );
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/station/outbound && npx tsc -b`
Expected: PASS — 새 5 + Task 7·8 (Task 8 의 «F11 … 뺄 상품으로» 는 큰 칸 제목 «뺄 상품» 을 그대로 본다)

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/station/outbound/WithdrawWork.tsx native/warehouse-app/src/station/outbound/InspectionScreen.tsx \
  native/warehouse-app/src/station/outbound/Withdraw.test.tsx
git commit -m "feat(warehouse-app): 출고 검수의 뺄 상품 — 담은 상품을 되돌림 바구니로, 다 빼면 빠진 박스"
```

---

### Task 10: F9 결품 — 창, 보내기 직전 재조회, 결과별 화면

**Files:**
- Create: `native/warehouse-app/src/station/outbound/ShortPickDialog.tsx`
- Modify: `native/warehouse-app/src/station/outbound/InspectWork.tsx`
- Modify: `native/warehouse-app/src/station/outbound/InspectionScreen.tsx`
- Test: `native/warehouse-app/src/station/outbound/ShortPick.test.tsx`

**Interfaces:**
- Consumes: Task 4 `shortPickDraft`·`buildShortPickRequest`·`reportShortPick`·`shortPickErrorMessage`·`SHORT_PICK_REASON_KEYS`, Task 3 `fetchShipmentByWaybill`, Task 2 `useHumanKeys`, PR B `useDigitCommands`
- Produces:
  - `ShortPickDialog({ lines: readonly ShortPickDraftLine[]; busy: boolean; onConfirm(lines: Array<{ shipmentLineId: string; qty: number }>, reason: ShortPickReason): void; onCancel(): void })` — `role="dialog" aria-modal="true" aria-label="결품"`, 줄 결품 칸은 `aria-label="{상품명} 결품"`, 고른 줄·사유는 `data-selected="true"`
  - `InspectWork` 에 props `warehouseId: string`, `onShortPicked(box: ShipmentByWaybill, result: ShortPickResult): void`
  - 부모: 채움이면 자동 출력 + 송장 대기(배너 `LastBox.refilled`), 아니면 다시 조회. 송장 대기의 F12 가 채운 박스 송장을 다시 뽑는다

**F9 이 켜지는 조건(PR A 계약 메모):** 권한 미리보기 `shortPick === true` · by-waybill 에 `shortPickContext` 필드가 있음(옛 core 가 아님) · 작업 항목이 `queued`·`picking` · 덜 찍힌 줄이 있음 · 보낼 것 없음(idle).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/station/outbound/ShortPick.test.tsx`:

```tsx
import 'fake-indexeddb/auto';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PRINTER_FAILURE_MESSAGE, PrinterError, type PrintRaw } from '../../core/hardware/print/labelPrinter';
import type { WorkPermissions } from '../../core/operations/OperationContext';
import type { FakeBox } from './__fixtures__/outboundServer';
import { BOX1, flash, openBox, press, scan, setupInspection, typeHuman } from './__fixtures__/renderStation';

const bar = () => within(screen.getByRole('toolbar', { name: '기능키' }));
const dialog = () => screen.getByRole('dialog', { name: '결품' });
const cell = (name: string) => within(dialog()).getByLabelText(`${name} 결품`);

/** 박스를 열고 한 개(집게핀)를 찍은 뒤 F9 — 남은 수량: 집게핀 2, 컬러크림 1 */
async function openShortPick(opts: Parameters<typeof setupInspection>[0] = {}) {
  const setup = await setupInspection(opts);
  await openBox('421033881907');
  scan('8801002');
  await waitFor(() => expect(setup.server.scans).toHaveLength(1));
  await waitFor(() => expect(bar().getByRole('button', { name: /결품/ })).toBeInTheDocument());
  press('F9');
  await screen.findByRole('dialog', { name: '결품' });
  return setup;
}

describe('F9 결품(스펙 §7.1·§7.2)', () => {
  it('덜 찍힌 줄을 남은 수량으로 채워 열고, Enter·Enter 로 재고 부족 결품을 보낸다 — 버전은 보내기 직전 조회 값', async () => {
    const { server } = await openShortPick();
    expect(cell('헤어클립 집게핀')).toHaveTextContent('2');
    expect(cell('컬러크림 6N')).toHaveTextContent('1');
    await typeHuman(['Enter', 'Enter']);
    await waitFor(() => expect(server.shortPicks).toHaveLength(1));
    expect(server.shortPicks[0].body).toEqual({
      workItemId: 'wi-s-1',
      expectedWorkItemLeaseVersion: 3,
      sessionId: 'ses-b-1',
      expectedSessionVersion: 5,
      expectedManifestVersion: 2,
      lines: [
        { shipmentLineId: 'l-2', sourceLocationId: 'loc-B-11-1', expectedLineVersion: 2, shortQty: 2 },
        { shipmentLineId: 'l-1', sourceLocationId: 'loc-A-03-2', expectedLineVersion: 2, shortQty: 1 },
      ],
      reason: 'inventory_shortage',
    });
  });

  it('숫자로 줄이고(상한 = 남은 수량), 사유 2 를 고르면 파손으로 보낸다', async () => {
    const { server } = await openShortPick();
    await typeHuman(['9']);
    expect(cell('헤어클립 집게핀')).toHaveTextContent('2');
    await typeHuman(['Backspace', '1', 'ArrowDown', '0']);
    expect(cell('헤어클립 집게핀')).toHaveTextContent('1');
    expect(cell('컬러크림 6N')).toHaveTextContent('0');
    await typeHuman(['Enter', '2', 'Enter']);
    await waitFor(() => expect(server.shortPicks).toHaveLength(1));
    expect(server.shortPicks[0].body).toMatchObject({
      lines: [{ shipmentLineId: 'l-2', sourceLocationId: 'loc-B-11-1', shortQty: 1 }],
      reason: 'item_damaged',
    });
  });

  it('Esc 는 한 단계 뒤로 — 사유에서 수량으로, 수량에서 닫기(박스는 그대로)', async () => {
    await openShortPick();
    await typeHuman(['Enter']);
    expect(within(dialog()).getByRole('list', { name: '사유' })).toBeInTheDocument();
    await typeHuman(['Escape']);
    expect(cell('헤어클립 집게핀')).toBeInTheDocument();
    await typeHuman(['Escape']);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: '4210-3388-1907' })).toBeInTheDocument();
  });

  it('결품 창이 열린 채 상품을 찍으면 오류음만 — 창·수량이 그대로이고 스캐너 Enter 로 확정되지 않는다', async () => {
    const { server } = await openShortPick();
    scan('8801002');
    expect(flash()).toBe('error');
    expect(dialog()).toBeInTheDocument();
    expect(cell('헤어클립 집게핀')).toHaveTextContent('2');
    expect(server.shortPicks).toHaveLength(0);
    expect(server.scans).toHaveLength(1);
  });

  it('보내기 직전 다시 조회해 남은 수량이 줄었으면 보내지 않는다(다른 스테이션이 더 찍음)', async () => {
    const { server } = await openShortPick();
    server.pick('421033881907', 'l-2', 1);
    await typeHuman(['Enter', 'Enter']);
    expect(await screen.findByRole('alert')).toHaveTextContent('박스 상태가 바뀌었어요');
    expect(server.shortPicks).toHaveLength(0);
  });

  it('채움(refilled) — 새 송장을 자동 출력하고 송장 대기에 가져올 것을 보인다', async () => {
    const { server, print } = await openShortPick();
    await typeHuman(['Enter', 'Enter']);
    expect(await screen.findByText('보충 대기')).toBeInTheDocument();
    expect(screen.getByText('송장 바코드')).toBeInTheDocument();
    expect(screen.getAllByText('[C-07-1]').length).toBeGreaterThan(0);
    await waitFor(() => expect(print).toHaveBeenCalledWith('spooler://XP-DT108B', '^XA421033881907^XZ'));
    expect(server.confirmedPrints).toEqual(['s-1']);
  });

  it('채움 뒤 자동 출력이 실패하면 송장 대기의 F12 가 그 송장을 다시 뽑는다', async () => {
    const print = vi
      .fn<PrintRaw>()
      .mockRejectedValueOnce(new PrinterError('offline'))
      .mockResolvedValue(undefined);
    await openShortPick({ print });
    await typeHuman(['Enter', 'Enter']);
    expect(await screen.findByText(PRINTER_FAILURE_MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(bar().getByRole('button', { name: /송장 재출력/ })).toBeInTheDocument());
    press('F12');
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(PRINTER_FAILURE_MESSAGE)).toBeNull());
  });

  it('빼는 중(withdrawing) — 다시 조회해 뺄 상품으로', async () => {
    const { server } = await openShortPick();
    server.config.shortPickOutcome = 'withdrawing';
    await typeHuman(['Enter', 'Enter']);
    expect(await screen.findByText('뺄 상품')).toBeInTheDocument();
  });

  it('빠짐(exited) — 빠진 박스', async () => {
    const { server } = await openShortPick();
    server.config.shortPickOutcome = 'exited';
    await typeHuman(['Enter', 'Enter']);
    expect(await screen.findByText('빠진 박스')).toBeInTheDocument();
  });

  const hidden: Array<[string, { permissions?: WorkPermissions; boxes?: FakeBox[] }]> = [
    ['결품 권한 없음', { permissions: { stationForceDispatch: true } }],
    ['옛 core(버전 없음)', { boxes: [{ ...BOX1, legacy: true }] }],
  ];
  it.each(hidden)('%s 이면 F9 를 그리지 않는다', async (_name, opts) => {
    await setupInspection(opts);
    await openBox('421033881907');
    await waitFor(() => expect(bar().getByRole('button', { name: /박스 빼기/ })).toBeInTheDocument());
    expect(bar().queryByRole('button', { name: /결품/ })).toBeNull();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/station/outbound/ShortPick.test.tsx`
Expected: FAIL — F9 버튼이 없다(«결품» 대기 시간 초과)

- [ ] **Step 3: 결품 창을 만든다**

`src/station/outbound/ShortPickDialog.tsx`:

```tsx
import { useCallback, useRef, useState } from 'react';
import { cn } from '../../core/design/cn';
import { useHumanKeys } from '../../core/hardware/scan/useScanner';
import { SHORT_PICK_REASON_KEYS, type ShortPickDraftLine, type ShortPickReason } from '../../domains/outbound/shortPick';
import { useDigitCommands } from '../ActionRegistry';
import { Kbd } from '../Kbd';

/**
 * F9 결품(스펙 §7.1). 두 단계(계획이 정함): ① 수량 — ↑↓ 줄, 숫자 덮어쓰기(줄을 고른 뒤 첫 숫자)·이어 치기(상한 = 남은 수량),
 * Backspace, Enter 다음 ② 사유 — 1 재고 부족(기본)·2 파손, Enter 보냄. Esc 는 한 단계 뒤로(①에서는 닫기).
 * 키는 사람 키 채널로만 받는다 — 스캐너의 Enter 가 창을 확정하지 않는다. aria-modal 이라 셸이 기능키·키 명령을 막는다.
 */
export function ShortPickDialog({
  lines,
  busy,
  onConfirm,
  onCancel,
}: {
  lines: readonly ShortPickDraftLine[];
  busy: boolean;
  onConfirm(lines: Array<{ shipmentLineId: string; qty: number }>, reason: ShortPickReason): void;
  onCancel(): void;
}) {
  const [rows, setRows] = useState(() => lines.map((line) => ({ ...line })));
  const [selected, setSelected] = useState(0);
  const [fresh, setFresh] = useState(true);
  const [step, setStep] = useState<'qty' | 'reason'>('qty');
  const [reason, setReason] = useState<ShortPickReason>('inventory_shortage');
  const total = rows.reduce((sum, row) => sum + row.qty, 0);

  const typeDigit = (digit: number) => {
    if (busy) return;
    if (step === 'reason') {
      const picked = SHORT_PICK_REASON_KEYS.find((option) => option.key === String(digit));
      if (picked) setReason(picked.reason);
      return;
    }
    setRows((list) =>
      list.map((row, i) => (i === selected ? { ...row, qty: Math.min(row.max, fresh ? digit : row.qty * 10 + digit) } : row))
    );
    setFresh(false);
  };
  const next = () => {
    if (busy) return;
    if (step === 'qty') {
      if (total > 0) setStep('reason');
      return;
    }
    onConfirm(
      rows.map((row) => ({ shipmentLineId: row.shipmentLineId, qty: row.qty })),
      reason
    );
  };
  const back = () => {
    if (busy) return;
    if (step === 'reason') setStep('qty');
    else onCancel();
  };
  useHumanKeys((key: string) => {
    if (/^\d$/.test(key)) typeDigit(Number(key));
    else if (key === 'Enter') next();
    else if (key === 'Escape') back();
    else if (step === 'qty' && !busy && (key === 'ArrowUp' || key === 'ArrowDown')) {
      setSelected((i) => Math.max(0, Math.min(rows.length - 1, i + (key === 'ArrowUp' ? -1 : 1))));
      setFresh(true);
    } else if (step === 'qty' && !busy && key === 'Backspace') {
      setRows((list) => list.map((row, i) => (i === selected ? { ...row, qty: Math.floor(row.qty / 10) } : row)));
      setFresh(false);
    }
  });
  // 숫자 명령(%91%N)도 같은 칸에 — 등록은 한 번, 실행은 늘 마지막 렌더의 것
  const typeRef = useRef(typeDigit);
  typeRef.current = typeDigit;
  useDigitCommands(useCallback((digit: number) => typeRef.current(digit), []));

  const keepFocus = (e: React.MouseEvent) => e.preventDefault(); // 마우스로 눌러도 단추에 포커스가 남아 Enter 가 두 번 돌지 않게
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <section role="dialog" aria-modal="true" aria-label="결품" className="w-[640px] space-y-4 rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-2xl font-bold">결품</h2>
        {step === 'qty' ? (
          <table className="w-full border-collapse text-lg">
            <thead>
              <tr className="text-left text-[13px] font-semibold text-[#535968]">
                <th className="py-2">상품</th>
                <th className="w-24 py-2 text-right">남은</th>
                <th className="w-24 py-2 text-right">결품</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.shipmentLineId}
                  data-selected={String(i === selected)}
                  className={cn('h-14 border-t border-[#E4E6EA]', i === selected && 'bg-[#FFF1C7]')}
                >
                  <td className="font-semibold">{row.name}</td>
                  <td className="text-right font-mono text-[#535968]">{row.max}</td>
                  <td aria-label={`${row.name} 결품`} className="text-right font-mono text-2xl font-semibold">
                    {row.qty}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ul aria-label="사유" className="space-y-2">
            {SHORT_PICK_REASON_KEYS.map((option) => (
              <li
                key={option.reason}
                data-selected={String(option.reason === reason)}
                className={cn(
                  'flex h-14 items-center gap-3 rounded-md border px-4 text-lg',
                  option.reason === reason ? 'border-[#1D5BD8] bg-[#E3ECFC] font-semibold' : 'border-[#D5D8DE]'
                )}
              >
                <Kbd>{option.key}</Kbd>
                {option.label}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={back}
            disabled={busy}
            className="flex h-10 items-center gap-2 rounded-md border border-[#D5D8DE] bg-white pl-2 pr-3.5 text-sm font-medium"
          >
            <Kbd tone="light">Esc</Kbd>
            {step === 'qty' ? '닫기' : '뒤로'}
          </button>
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={next}
            disabled={busy || total === 0}
            className="flex h-10 items-center gap-2 rounded-md bg-[#15171C] pl-2 pr-3.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Kbd tone="light">Enter</Kbd>
            {step === 'qty' ? '다음' : '보내기'}
          </button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: 검수 중 화면에 F9 를 단다**

`InspectWork.tsx`:

import 에 더한다:

```tsx
import { fetchShipmentByWaybill } from '../../domains/outbound/queries';
import {
  buildShortPickRequest,
  reportShortPick,
  shortPickDraft,
  shortPickErrorMessage,
  type ShortPickReason,
  type ShortPickResult,
} from '../../domains/outbound/shortPick';
import { ShortPickDialog } from './ShortPickDialog';
```

props 구조 분해에 `warehouseId,`·`onShortPicked,` 를, 타입에 다음을 더한다:

```tsx
  warehouseId: string;
  /** 결품 결과 — 부모가 채움이면 자동 출력·송장 대기, 아니면 다시 조회한다(§7.2) */
  onShortPicked(box: ShipmentByWaybill, result: ShortPickResult): void;
```

`const [armed, setArmed] = useState<Armed>(null);` 아래에:

```tsx
  const [shortOpen, setShortOpen] = useState(false);
  const [shortBusy, setShortBusy] = useState(false);
```

`const canForce = …` 아래에:

```tsx
  // F9 — 권한 미리보기의 shortPick(PR A 계약 메모), 옛 core 가 아님(버전 필드), 대기·피킹 중일 때만(빼는 중·다른 오퍼레이션 대기면 서버가 409)
  const draft = shortPickDraft(box.lines, work.progress);
  const canShortPick =
    permissions.data?.shortPick === true &&
    box.shortPickContext !== undefined &&
    (work.workItemStatus === 'queued' || work.workItemStatus === 'picking');

  const confirmShortPick = async (lines: ReadonlyArray<{ shipmentLineId: string; qty: number }>, reason: ShortPickReason) => {
    setShortBusy(true);
    try {
      // 버전은 스캔마다 낡는다 — 보내기 직전에 다시 조회한 값으로 보낸다(PR A 계약 메모)
      const fresh = await fetchShipmentByWaybill(api, box.trackingNo, warehouseId);
      const built = buildShortPickRequest(fresh, lines, reason);
      if (!built.ok) {
        setShortOpen(false);
        onAlert(built.message);
        return;
      }
      const result = await reportShortPick(api, box.shipmentId, built.request, crypto.randomUUID());
      setShortOpen(false);
      onShortPicked(box, result);
    } catch (error) {
      setShortOpen(false);
      onAlert(shortPickErrorMessage(error));
    } finally {
      setShortBusy(false);
    }
  };
```

`actions` 배열에서 `INSPECTION_ACTIONS.all` 항목 바로 뒤에:

```tsx
    ...(canShortPick
      ? [
          {
            ...INSPECTION_ACTIONS.shortPick,
            enabled: work.idle && draft.length > 0 && !shortBusy,
            run: () => {
              setArmed(null);
              setQuantity(null);
              setShortOpen(true);
            },
          },
        ]
      : []),
```

`return ( <WorkGrid … /> );` 를 결품 창과 함께 그리게 바꾼다:

```tsx
  return (
    <>
      <WorkGrid
        intake={work.intakeBlocked ? 'blocked' : 'open'}
        left={
          <>
            <BoxCard trackingNo={box.trackingNo} recipient={box.recipientMasked} deliveryNote={box.deliveryNote} />
            <BigPanel content={big} />
            {work.queueError ? (
              <QueueTrouble storage={!!work.storageError} onRetry={() => void work.retryHead().catch(() => {})} />
            ) : null}
          </>
        }
        right={
          <>
            <LineTable rows={rows} currentLineId={work.lastScan?.shipmentLineId ?? null} />
            <RecentList entries={recent} />
          </>
        }
      />
      {shortOpen ? (
        <ShortPickDialog
          lines={draft}
          busy={shortBusy}
          onCancel={() => setShortOpen(false)}
          onConfirm={(lines, reason) => void confirmShortPick(lines, reason)}
        />
      ) : null}
    </>
  );
```

- [ ] **Step 5: 부모가 결과를 받는다**

`InspectionScreen.tsx` — import 에 `import type { ShortPickResult } from '../../domains/outbound/shortPick';` 를 더하고, `reprintBox` 아래에:

```tsx
  /** 결품 결과(스펙 §7.2) — 채움이면 새 송장 자동 출력 + 송장 대기(박스는 보충 대기), 아니면 다시 조회해 뺄 상품·빠진 박스로 */
  const onShortPicked = (box: ShipmentByWaybill, result: ShortPickResult) =>
    run(async () => {
      void queryClient.invalidateQueries({ queryKey: ['outbound-refills'] });
      void queryClient.invalidateQueries({ queryKey: ['batch-work-items'] });
      if (result.outcome !== 'refilled') {
        await show(await lookup(box.trackingNo));
        return;
      }
      clearLastBox(prefs);
      const nameOf = (skuId: string) => box.lines.find((line) => line.skuId === skuId)?.skuName ?? skuId;
      const items = result.refills.map((refill) => ({ locationCode: refill.locationCode, name: nameOf(refill.skuId), qty: refill.qty }));
      setAlert(null);
      setView({ kind: 'waiting' });
      setLast({ kind: 'refilled', trackingNo: box.trackingNo, shipmentId: box.shipmentId, items, print: { kind: 'printing' } });
      signal('success');
      const status = await printFor(box.shipmentId);
      setLast((current) =>
        current?.kind === 'refilled' && current.shipmentId === box.shipmentId ? { ...current, print: status } : current
      );
      if (status.kind === 'printed') note({ kind: 'printed', text: box.trackingNo });
      else signal('error');
    });

  /** 송장 대기의 F12 — 방금 채운 박스의 송장을 다시 뽑는다(자동 출력이 실패했을 때, 목업 ①) */
  const reprintLast = () =>
    run(async () => {
      if (last?.kind !== 'refilled') return;
      const target = last;
      setLast({ ...target, print: { kind: 'printing' } });
      const status = await printFor(target.shipmentId);
      setLast((current) =>
        current?.kind === 'refilled' && current.shipmentId === target.shipmentId ? { ...current, print: status } : current
      );
      if (status.kind === 'printed') note({ kind: 'printed', text: target.trackingNo });
      else signal('error');
    });
```

`actions` 를 송장 대기 F12 까지 넣어 바꾼다:

```tsx
  const actions: StationAction[] =
    view.kind === 'reprint'
      ? [
          {
            ...INSPECTION_ACTIONS.reprint,
            label: '다시 출력',
            enabled: canPrint && view.print.kind !== 'printing',
            run: () => void reprintView(),
          },
          putDownAction,
        ]
      : view.kind === 'withdraw' || view.kind === 'withdrawn'
        ? [putDownAction]
        : view.kind === 'waiting' && last?.kind === 'refilled'
          ? [
              {
                ...INSPECTION_ACTIONS.reprint,
                enabled: canPrint && last.print.kind !== 'printing',
                run: () => void reprintLast(),
              },
            ]
          : [];
```

`<InspectWork … />` 에 두 prop 을 더한다:

```tsx
          warehouseId={warehouseId}
          onShortPicked={(box, result) => void onShortPicked(box, result)}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `npx vitest run src/station/outbound && npx tsc -b`
Expected: PASS — 새 11 + 앞 태스크 전부. «결품 창이 열린 채 상품을…» 이 빨가면 두 곳을 본다: 부모 `onScan` 첫 줄의 `modalOpen()`(스캔을 오류로 막는다)과 Task 2 판정기의 «묶음 끝 Enter 는 사람 키가 아니다»

- [ ] **Step 7: 커밋**

```bash
git add native/warehouse-app/src/station/outbound/ShortPickDialog.tsx native/warehouse-app/src/station/outbound/InspectWork.tsx \
  native/warehouse-app/src/station/outbound/InspectionScreen.tsx native/warehouse-app/src/station/outbound/ShortPick.test.tsx
git commit -m "feat(warehouse-app): F9 결품 — 남은 수량 창, 보내기 직전 재조회, 채움이면 새 송장 자동 출력"
```

---

### Task 11: 보충 대기 — 송장 대기 화면의 창고 단위 목록

**Files:**
- Create: `native/warehouse-app/src/domains/outbound/refills.ts`
- Create: `native/warehouse-app/src/station/outbound/RefillPanel.tsx`
- Modify: `native/warehouse-app/src/station/outbound/InspectionScreen.tsx` (송장 대기 오른쪽)
- Modify: `native/warehouse-app/src/station/outbound/__fixtures__/renderStation.tsx` (`setupInspection` 에 `refills` 옵션)
- Test: `native/warehouse-app/src/station/outbound/RefillPanel.test.tsx`

**Interfaces:**
- Consumes: core `GET /outbound-refills/pending?warehouseId=`(PR A A6, `RefillPendingBox`)
- Produces: `interface RefillPendingItem { shipmentLineId; skuId; skuName; sourceLocationId; locationCode; qty }`, `interface RefillPendingBox { shipmentId: string; trackingNo: string | null; recipientMasked: string; items: RefillPendingItem[] }`, `fetchPendingRefills(api, warehouseId)`, `usePendingRefills(warehouseId: string | null)`(key `['outbound-refills', warehouseId]`, 30초 간격, 재시도 없음), `REFILLS_REFRESH_MS = 30_000`, `RefillPanel({ warehouseId })`(`<section aria-label="보충 대기">`, 비었거나 실패면 `null`)

- [ ] **Step 1: 하네스에 옵션을 더한다**

`renderStation.tsx` 의 `setupInspection` 옵션 타입에 `refills?: unknown[] | 'fail';` 를 더하고, `server.config.batches.picking = …` 아래에 둔다(첫 조회 전에 넣어야 잡힌다):

```tsx
  if (opts.refills === 'fail') server.config.refillsFail = true;
  else server.config.refills = opts.refills ?? [];
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`src/station/outbound/RefillPanel.test.tsx`:

```tsx
import 'fake-indexeddb/auto';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { openBox, press, scan, setupInspection, typeHuman } from './__fixtures__/renderStation';

const PENDING = [
  {
    shipmentId: 's-9',
    trackingNo: '421033881931',
    recipientMasked: '최*아',
    items: [
      { shipmentLineId: 'l-9', skuId: 'k-9', skuName: '퍼머넌트 1제 웨이브', sourceLocationId: 'loc-C-07-1', locationCode: 'C-07-1', qty: 1 },
    ],
  },
];

describe('보충 대기(스펙 §7.3)', () => {
  it('송장 대기에 창고의 보충 대기 박스를 보인다 — 송장번호·받는 분·가져올 것', async () => {
    await setupInspection({ refills: PENDING });
    const panel = await screen.findByRole('region', { name: '보충 대기' });
    expect(within(panel).getByText('4210-3388-1931')).toBeInTheDocument();
    expect(within(panel).getByText('최*아')).toBeInTheDocument();
    expect(within(panel).getByText('[C-07-1]')).toBeInTheDocument();
    expect(within(panel).getByText('퍼머넌트 1제 웨이브')).toBeInTheDocument();
  });

  it('비었으면 그리지 않는다', async () => {
    const { server } = await setupInspection();
    await waitFor(() => expect(server.requests.some((r) => r.path.startsWith('/outbound-refills/pending'))).toBe(true));
    expect(screen.queryByRole('region', { name: '보충 대기' })).toBeNull();
  });

  it('조회가 실패하면(PR A 이전 core) 그리지 않는다', async () => {
    const { server } = await setupInspection({ refills: 'fail' });
    await waitFor(() => expect(server.requests.some((r) => r.path.startsWith('/outbound-refills/pending'))).toBe(true));
    expect(screen.queryByRole('region', { name: '보충 대기' })).toBeNull();
    expect(screen.getByText('송장 바코드')).toBeInTheDocument();
  });

  it('결품으로 채우면 바로 다시 조회한다 — 30초를 기다리지 않는다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(server.scans).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /결품/ })).toBeInTheDocument());
    server.config.refills = PENDING;
    press('F9');
    await screen.findByRole('dialog', { name: '결품' });
    await typeHuman(['Enter', 'Enter']);
    expect(await screen.findByRole('region', { name: '보충 대기' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run src/station/outbound/RefillPanel.test.tsx`
Expected: FAIL — `region` «보충 대기» 가 없다

- [ ] **Step 4: 구현한다**

`src/domains/outbound/refills.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';

/** core `RefillPendingItem` — 채운 줄 중 아직 안 집은 몫 */
export interface RefillPendingItem {
  shipmentLineId: string;
  skuId: string;
  skuName: string;
  sourceLocationId: string;
  locationCode: string;
  qty: number;
}

/** core `RefillPendingBox`(PR A A6) */
export interface RefillPendingBox {
  shipmentId: string;
  trackingNo: string | null;
  recipientMasked: string;
  items: RefillPendingItem[];
}

export function fetchPendingRefills(api: ApiClient, warehouseId: string): Promise<RefillPendingBox[]> {
  return api.request<RefillPendingBox[]>({ path: `/outbound-refills/pending?${new URLSearchParams({ warehouseId }).toString()}` });
}

/** 다른 스테이션의 결품도 보이게 30초마다(U9). 출고·결품 뒤에는 무효화로 바로 갱신된다 */
export const REFILLS_REFRESH_MS = 30_000;

export function usePendingRefills(warehouseId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['outbound-refills', warehouseId],
    enabled: warehouseId !== null,
    queryFn: () => fetchPendingRefills(api, warehouseId ?? ''),
    refetchInterval: REFILLS_REFRESH_MS,
    retry: false,
  });
}
```

`src/station/outbound/RefillPanel.tsx`:

```tsx
import { formatTrackingNo } from '../../domains/outbound/inspection';
import { usePendingRefills } from '../../domains/outbound/refills';

/**
 * 보충 대기(스펙 §7.3) — 결품을 다른 위치에서 채웠고 그 몫을 아직 안 집은 박스. 창고 단위 서버 조회라 어느 스테이션에서 봐도 같다.
 * 비었거나 조회가 실패하면(PR A 이전 core) 그리지 않는다. 이어 하기 = 새 송장 스캔 — 따로 누를 것이 없다.
 */
export function RefillPanel({ warehouseId }: { warehouseId: string }) {
  const refills = usePendingRefills(warehouseId);
  const boxes = refills.data ?? [];
  if (boxes.length === 0) return null;
  return (
    <section aria-label="보충 대기" className="shrink-0 overflow-hidden rounded-[10px] border-2 border-[#D99A00] bg-white">
      <div className="flex h-10 items-center gap-2.5 bg-[#FFF1C7] px-4 text-[15px] font-bold text-[#5E3B00]">
        보충 대기 <span className="font-mono">{boxes.length}</span>
      </div>
      <ol className="px-4 text-base">
        {boxes.map((box) => (
          <li
            key={box.shipmentId}
            className="grid min-h-12 grid-cols-[170px_80px_minmax(0,1fr)] items-center border-b border-[#EEF0F2] last:border-b-0"
          >
            <span className="font-mono">{box.trackingNo ? formatTrackingNo(box.trackingNo) : '—'}</span>
            <span>{box.recipientMasked}</span>
            <span>
              {box.items.map((item) => (
                <span key={`${item.shipmentLineId}-${item.sourceLocationId}`} className="mr-3 inline-block">
                  <span className="font-mono font-semibold">[{item.locationCode}]</span> <span>{item.skuName}</span>{' '}
                  <span className="font-mono font-semibold">×{item.qty}</span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

`InspectionScreen.tsx` — import 에 `import { RefillPanel } from './RefillPanel';` 를 더하고, 송장 대기(`default:`)의 `right` 를 바꾼다(스펙 §7.3: 최근 스캔 위):

```tsx
          right={
            <>
              {last ? <DoneBanner last={last} /> : null}
              <RefillPanel warehouseId={warehouseId} />
              <RecentList entries={recent} grow />
            </>
          }
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run src/station/outbound && npx tsc -b`
Expected: PASS — 새 4 + 앞 태스크 전부(Task 10 의 «채움» 테스트는 `refills` 가 비어 패널이 없다 — `findByText('보충 대기')` 는 배너 하나만 잡는다)

- [ ] **Step 6: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound/refills.ts native/warehouse-app/src/station/outbound/RefillPanel.tsx \
  native/warehouse-app/src/station/outbound/RefillPanel.test.tsx native/warehouse-app/src/station/outbound/InspectionScreen.tsx \
  native/warehouse-app/src/station/outbound/__fixtures__/renderStation.tsx
git commit -m "feat(warehouse-app): 송장 대기의 보충 대기 — 창고 단위 조회, 30초 간격과 결품 뒤 즉시 갱신"
```

---

### Task 12: F2 배치 현황

**Files:**
- Modify: `native/warehouse-app/src/domains/outbound/waybillLabel.ts` (`BatchLabelState` 선택 필드 3개)
- Modify: `native/warehouse-app/src/domains/outbound/batchStatus.ts` (`boxRowOf`·`sortBoxRows`), Test: `batchStatus.test.ts` (추가)
- Create: `native/warehouse-app/src/station/batches/BatchStatusScreen.tsx`
- Test: `native/warehouse-app/src/station/batches/BatchStatusScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1 의 배치 박스 필드, Task 6 `useBatchWorkItems`·`batchProgressOf`·`boxCountsOf`·`mergeBatches`, 지금 부품 `StartBatchButton`·`BatchLabelPrintButton`·`JoinBoxPanel`·`RemoveBoxPanel`(수정 없음), PR B `useBatchProgress`
- Produces:
  - `BatchLabelState` 에 `workItemStatus?: string; trackingNo?: string | null; recipientMasked?: string`
  - `interface BoxRow { shipmentId: string; trackingNo: string; recipient: string; status: string; tone: 'alert' | 'warn' | 'work' | 'idle' }`, `boxRowOf(state: BatchLabelState): BoxRow | null`(송장번호가 없으면 null — 옛 core), `sortBoxRows(rows): BoxRow[]`
  - `BatchStatusScreen({ prefs?, print? })` — 왼쪽: 고른 배치의 도구(시작 전 = 「작업 시작」, 시작됨 = 「송장 인쇄」·「박스 넣기」·「박스 빼기」)와 배치 표 `배치 | 상태 | 진행 | 빠지는 중`, 오른쪽 440px `<section aria-label="배치 상세">`: 배치 번호(`<h2>`)·건수 넷(`aria-label` 완료·검수 중·대기·빠지는 중)·미완료 박스 목록(`<ol aria-label="박스">`)

- [ ] **Step 1: 박스 줄 — 실패하는 테스트를 쓴다**

`batchStatus.test.ts` import 를 `import { batchProgressOf, boxCountsOf, boxRowOf, mergeBatches, sortBoxRows } from './batchStatus';` 로 바꾸고 끝에 더한다:

```ts
describe('배치 현황 박스 줄(스펙 §8 F2)', () => {
  const state = (patch: Record<string, unknown>) => ({
    shipmentId: 's',
    workItemId: 'wi',
    state: 'current' as const,
    changes: [],
    issue: null,
    workItemStatus: 'queued',
    trackingNo: '421033881907',
    recipientMasked: '김*영',
    ...patch,
  });

  it.each([
    [{ state: 'withdrawing', workItemStatus: 'withdrawing' }, '빠지는 중', 'warn'],
    [{ state: 'never_printed' }, '미출력', 'alert'],
    [{ state: 'reprint_required', workItemStatus: 'picking' }, '재출력', 'alert'],
    [{ state: 'unavailable' }, '송장 확인', 'alert'],
    [{ workItemStatus: 'short_pick_recovery' }, '결품 처리 중', 'warn'],
    [{ workItemStatus: 'picking' }, '검수 중', 'work'],
    [{ workItemStatus: 'queued' }, '대기', 'idle'],
  ] as const)('%o → %s', (patch, status, tone) => {
    expect(boxRowOf(state(patch))).toEqual({ shipmentId: 's', trackingNo: '421033881907', recipient: '김*영', status, tone });
  });

  it('송장번호가 없으면(옛 core) 줄을 만들지 않는다 — 현장이 읽을 수 없는 id 를 그리지 않는다', () => {
    expect(boxRowOf(state({ trackingNo: undefined }))).toBeNull();
    expect(boxRowOf(state({ trackingNo: null }))).toBeNull();
  });

  it('손이 가야 하는 박스(송장·빠지는 중)가 위로, 같은 무리 안에서는 송장번호 순', () => {
    const rows = [
      { shipmentId: 'a', trackingNo: '3', recipient: '', status: '대기', tone: 'idle' as const },
      { shipmentId: 'b', trackingNo: '2', recipient: '', status: '재출력', tone: 'alert' as const },
      { shipmentId: 'c', trackingNo: '1', recipient: '', status: '대기', tone: 'idle' as const },
      { shipmentId: 'd', trackingNo: '9', recipient: '', status: '빠지는 중', tone: 'warn' as const },
    ];
    expect(sortBoxRows(rows).map((r) => r.shipmentId)).toEqual(['b', 'd', 'c', 'a']);
  });
});
```

Run: `npx vitest run src/domains/outbound/batchStatus.test.ts`
Expected: FAIL — `boxRowOf` 가 없다

- [ ] **Step 2: 타입과 박스 줄을 구현한다**

`waybillLabel.ts` 의 `BatchLabelState`:

```ts
export interface BatchLabelState {
  shipmentId: string;
  workItemId: string;
  state: LabelState;
  changes: LabelItemChange[];
  issue: string | null;
  /** 배치 현황(스테이션 F2) 박스 목록용 — core 가 PR C 부터 싣는다. 옛 core 면 없다 */
  workItemStatus?: string;
  trackingNo?: string | null;
  recipientMasked?: string;
}
```

`batchStatus.ts` 의 import 를 `import { fetchBatchWorkItems, type BatchLabelState, type BatchWorkItem } from './waybillLabel';` 로 바꾸고 끝에 더한다:

```ts
export interface BoxRow {
  shipmentId: string;
  trackingNo: string;
  recipient: string;
  status: string;
  /** alert = 송장 손볼 것, warn = 빠지는 중·결품 처리, work = 검수 중, idle = 대기 */
  tone: 'alert' | 'warn' | 'work' | 'idle';
}

const IN_WORK_STATUSES: ReadonlySet<string> = new Set(['picking', 'ready_to_pack', 'packing']);

/** 배치 현황 박스 한 줄(스펙 §8 F2, 목업 ⑤). 송장번호가 없으면(옛 core) null — 현장이 읽을 수 없는 id 를 그리지 않는다 */
export function boxRowOf(state: BatchLabelState): BoxRow | null {
  if (!state.trackingNo) return null;
  const base = { shipmentId: state.shipmentId, trackingNo: state.trackingNo, recipient: state.recipientMasked ?? '' };
  if (state.state === 'withdrawing' || state.workItemStatus === 'withdrawing') return { ...base, status: '빠지는 중', tone: 'warn' };
  if (state.state === 'never_printed') return { ...base, status: '미출력', tone: 'alert' };
  if (state.state === 'reprint_required') return { ...base, status: '재출력', tone: 'alert' };
  if (state.state === 'unavailable') return { ...base, status: '송장 확인', tone: 'alert' };
  if (state.workItemStatus === 'short_pick_recovery') return { ...base, status: '결품 처리 중', tone: 'warn' };
  if (state.workItemStatus && IN_WORK_STATUSES.has(state.workItemStatus)) return { ...base, status: '검수 중', tone: 'work' };
  return { ...base, status: '대기', tone: 'idle' };
}

const TONE_ORDER: Record<BoxRow['tone'], number> = { alert: 0, warn: 1, work: 2, idle: 3 };

/** 손이 가야 하는 박스가 위로 — 같은 무리 안에서는 송장번호 순 */
export function sortBoxRows(rows: readonly BoxRow[]): BoxRow[] {
  return [...rows].sort(
    (a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || (a.trackingNo < b.trackingNo ? -1 : a.trackingNo > b.trackingNo ? 1 : 0)
  );
}
```

Run: `npx vitest run src/domains/outbound/batchStatus.test.ts`
Expected: PASS

- [ ] **Step 3: 화면 테스트를 쓴다**

`src/station/batches/BatchStatusScreen.test.tsx`:

```tsx
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PrintRaw } from '../../core/hardware/print/labelPrinter';
import type { OutboundBatchSummary } from '../../domains/outbound/types';
import { batchSummary, createOutboundServer, createTestRuntime, type FakeBox } from '../outbound/__fixtures__/outboundServer';
import { BOX1, BOX2, renderStation, stationPrefs } from '../outbound/__fixtures__/renderStation';
import { BatchStatusScreen } from './BatchStatusScreen';

const BOX3: FakeBox = {
  shipmentId: 's-3',
  trackingNo: '421033881923',
  batchId: 'b-3',
  recipient: '정*호',
  lines: [{ id: 'l-30', skuId: 'sku-30', name: '빗', qty: 1, barcode: '8801030' }],
};

function setupBatches(
  opts: { boxes?: FakeBox[]; picking?: OutboundBatchSummary[]; created?: OutboundBatchSummary[]; legacy?: boolean } = {}
) {
  const server = createOutboundServer({ boxes: opts.boxes ?? [BOX1, { ...BOX2, shipped: true }, BOX3] });
  server.config.batches.picking = opts.picking ?? [batchSummary({ id: 'b-1', batchNumber: 'B-1002' })];
  server.config.batches.created = opts.created ?? [
    batchSummary({ id: 'b-3', batchNumber: 'B-1004', status: 'created', startedAt: null, totalItems: 1 }),
  ];
  server.config.legacyBatchStates = opts.legacy ?? false;
  const runtime = createTestRuntime(server);
  const prefs = stationPrefs();
  const print = vi.fn<PrintRaw>(async () => {});
  const view = renderStation(() => <BatchStatusScreen prefs={prefs} print={print} />, { runtime, prefs, path: '/outbound/batches' });
  return { server, ...view };
}

const detail = () => screen.getByRole('region', { name: '배치 상세' });

describe('F2 배치 현황(스펙 §8, 목업 ⑤)', () => {
  it('배치 표 — 진행 중 먼저, 시작 전 다음, 진행 완료/전체', async () => {
    setupBatches();
    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));
    const [first, second] = within(table).getAllByRole('row').slice(1);
    expect(first).toHaveTextContent('B-1002');
    expect(first).toHaveTextContent('진행 중');
    await waitFor(() => expect(first).toHaveTextContent('1/2'));
    expect(second).toHaveTextContent('B-1004');
    expect(second).toHaveTextContent('시작 전');
  });

  it('고른 배치의 건수와 미완료 박스 — 송장번호·받는 분·상태', async () => {
    setupBatches();
    await waitFor(() => expect(within(detail()).getByLabelText('완료')).toHaveTextContent('1'));
    expect(within(detail()).getByLabelText('대기')).toHaveTextContent('1');
    const boxes = await screen.findByRole('list', { name: '박스' });
    expect(within(boxes).getAllByRole('listitem')).toHaveLength(1);
    expect(boxes).toHaveTextContent('4210-3388-1907');
    expect(boxes).toHaveTextContent('김*영');
    expect(boxes).toHaveTextContent('대기');
  });

  it('송장을 손볼 박스가 위로 — «재출력»', async () => {
    setupBatches({ boxes: [BOX2, { ...BOX1, labelState: 'reprint_required' }, BOX3] });
    const boxes = await screen.findByRole('list', { name: '박스' });
    await waitFor(() => expect(within(boxes).getAllByRole('listitem')).toHaveLength(2));
    const [first, second] = within(boxes).getAllByRole('listitem');
    expect(first).toHaveTextContent('4210-3388-1907');
    expect(first).toHaveTextContent('재출력');
    expect(second).toHaveTextContent('4210-3388-1915');
  });

  it('배치를 누르면 그 배치를 본다 — 시작 전 배치엔 「작업 시작」만', async () => {
    setupBatches();
    fireEvent.click(await screen.findByRole('button', { name: 'B-1004' }));
    await waitFor(() => expect(within(detail()).getByRole('heading', { name: 'B-1004' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '작업 시작' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '박스 넣기' })).toBeNull();
  });

  it('시작된 배치엔 송장 인쇄·박스 넣기·박스 빼기 — 박스 빼기 패널이 열린다', async () => {
    setupBatches();
    expect(await screen.findByRole('button', { name: '송장 인쇄' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '박스 넣기' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '박스 빼기' }));
    expect(await screen.findByText('이 배치에서 박스 빼기')).toBeInTheDocument();
  });

  it('옛 core(송장번호 없음)면 박스 목록 없이 건수만', async () => {
    setupBatches({ legacy: true });
    await waitFor(() => expect(within(detail()).getByLabelText('완료')).toHaveTextContent('1'));
    expect(within(detail()).queryByRole('list', { name: '박스' })).toBeNull();
  });

  it('상태바에 고른 배치의 진행', async () => {
    setupBatches();
    expect(await screen.findByText('B-1002 1/2')).toBeInTheDocument();
  });

  it('배치가 없으면 한 줄', async () => {
    setupBatches({ picking: [], created: [] });
    expect(await screen.findByText('진행 중인 배치가 없어요.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: 실패를 확인한다**

Run: `npx vitest run src/station/batches/BatchStatusScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./BatchStatusScreen"`

- [ ] **Step 5: 배치 현황 화면을 만든다**

`src/station/batches/BatchStatusScreen.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { Button } from '../../core/design/Button';
import { cn } from '../../core/design/cn';
import { printRaw, type PrintRaw } from '../../core/hardware/print/labelPrinter';
import { BatchLabelPrintButton } from '../../domains/outbound/BatchLabelPrintButton';
import {
  batchProgressOf,
  boxCountsOf,
  boxRowOf,
  mergeBatches,
  sortBoxRows,
  useBatchWorkItems,
  type BoxCounts,
  type BoxRow,
} from '../../domains/outbound/batchStatus';
import { formatTrackingNo } from '../../domains/outbound/inspection';
import { JoinBoxPanel } from '../../domains/outbound/JoinBoxPanel';
import { useOutboundBatches } from '../../domains/outbound/queries';
import { RemoveBoxPanel } from '../../domains/outbound/RemoveBoxPanel';
import { StartBatchButton } from '../../domains/outbound/StartBatchButton';
import type { OutboundBatchSummary } from '../../domains/outbound/types';
import { fetchBatchLabelStates, type BatchWorkItem } from '../../domains/outbound/waybillLabel';
import { WarehousePicker } from '../../domains/warehouse/WarehousePicker';
import { useBatchProgress } from '../status/batchProgress';

const TH = 'border-b border-[#D5D8DE] bg-[#F6F7F8] px-4 py-2.5 text-left text-[13px] font-semibold text-[#535968]';

/** 스테이션 F2 배치 현황(스펙 §8, 목업 ⑤) — 관리자 작업, 마우스 허용. 시작·일괄 인쇄·넣기·빼기는 지금 부품 그대로 쓴다 */
export function BatchStatusScreen({ prefs = localStoragePrefs, print = printRaw }: { prefs?: DevicePrefs; print?: PrintRaw }) {
  const { warehouseId } = useWarehouse();
  if (!warehouseId) return <WarehousePicker />;
  return <BatchStatus warehouseId={warehouseId} prefs={prefs} print={print} />;
}

function BatchStatus({ warehouseId, prefs, print }: { warehouseId: string; prefs: DevicePrefs; print: PrintRaw }) {
  const picking = useOutboundBatches(warehouseId, 'picking');
  const created = useOutboundBatches(warehouseId, 'created');
  const batches = mergeBatches(picking.data, created.data);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'join' | 'remove' | null>(null);
  const [printing, setPrinting] = useState(false);
  const selected = batches.find((batch) => batch.id === selectedId) ?? batches[0] ?? null;
  const items = useBatchWorkItems(selected?.id ?? null);
  useBatchProgress(selected && items.data ? batchProgressOf(selected.batchNumber, items.data) : null);

  if (picking.isSuccess && created.isSuccess && batches.length === 0)
    return <p className="p-6 text-lg text-[#535968]">진행 중인 배치가 없어요.</p>;

  const select = (id: string) => {
    // 인쇄 중엔 바꾸지 않는다 — 인쇄 단추가 고른 배치에 매여 있다(프린터는 한 대)
    if (printing) return;
    setSelectedId(id);
    setPanel(null);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_440px] gap-3">
      <section className="flex min-h-0 flex-col gap-3">
        {selected ? (
          <div className="flex shrink-0 flex-wrap items-start gap-2">
            {selected.startedAt === null ? (
              <StartBatchButton key={selected.id} batchId={selected.id} />
            ) : (
              <>
                <BatchLabelPrintButton key={selected.id} batchId={selected.id} prefs={prefs} print={print} onRunningChange={setPrinting} />
                <Button type="button" className="mt-2" onClick={() => setPanel(panel === 'join' ? null : 'join')}>
                  박스 넣기
                </Button>
                <Button type="button" className="mt-2" onClick={() => setPanel(panel === 'remove' ? null : 'remove')}>
                  박스 빼기
                </Button>
              </>
            )}
          </div>
        ) : null}
        {selected && panel === 'join' ? (
          <JoinBoxPanel batchId={selected.id} prefs={prefs} print={print} labelPrinting onClose={() => setPanel(null)} />
        ) : null}
        {selected && panel === 'remove' ? <RemoveBoxPanel batchId={selected.id} onClose={() => setPanel(null)} /> : null}
        <div className="min-h-0 flex-1 overflow-auto rounded-[10px] border border-[#D5D8DE] bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>배치</th>
                <th className={cn(TH, 'w-28')}>상태</th>
                <th className={TH}>진행</th>
                <th className={cn(TH, 'w-28 text-right')}>빠지는 중</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <BatchRow key={batch.id} batch={batch} selected={batch.id === selected?.id} onSelect={() => select(batch.id)} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {selected ? <BatchDetail batch={selected} items={items.data} /> : null}
    </div>
  );
}

function BatchRow({ batch, selected, onSelect }: { batch: OutboundBatchSummary; selected: boolean; onSelect(): void }) {
  const items = useBatchWorkItems(batch.id);
  const progress = items.data ? batchProgressOf(batch.batchNumber, items.data) : null;
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <tr className={cn('h-14 border-b border-[#E4E6EA] text-base', selected && 'bg-[#E3ECFC]')}>
      <td className="px-4">
        <button type="button" onClick={onSelect} className="font-mono font-semibold">
          {batch.batchNumber}
        </button>
      </td>
      <td className="px-4">{batch.startedAt === null ? '시작 전' : '진행 중'}</td>
      <td className="px-4">
        <span className="flex items-center gap-3">
          <span className="h-2 flex-1 rounded bg-[#C9D8F5]">
            <span className="block h-2 rounded bg-[#1D5BD8]" style={{ width: `${percent}%` }} />
          </span>
          <span className="font-mono">{progress ? `${progress.done}/${progress.total}` : `0/${batch.totalItems}`}</span>
        </span>
      </td>
      <td className="px-4 text-right font-mono">{batch.withdrawingItems > 0 ? batch.withdrawingItems : ''}</td>
    </tr>
  );
}

const COUNT_CELLS: ReadonlyArray<{ key: keyof BoxCounts; label: string; tone: string }> = [
  { key: 'done', label: '완료', tone: 'bg-[#E3F4EA] text-[#145232]' },
  { key: 'working', label: '검수 중', tone: 'bg-[#E3ECFC] text-[#123E99]' },
  { key: 'waiting', label: '대기', tone: 'bg-[#F1F2F4] text-[#3F4450]' },
  { key: 'withdrawing', label: '빠지는 중', tone: 'bg-[#FFF1C7] text-[#5E3B00]' },
];

const ROW_TONE: Record<BoxRow['tone'], string> = {
  alert: 'text-[#9E1320]',
  warn: 'text-[#7A4B00]',
  work: 'text-[#123E99]',
  idle: 'text-[#535968]',
};

function BatchDetail({ batch, items }: { batch: OutboundBatchSummary; items: BatchWorkItem[] | undefined }) {
  const api = useApiClient();
  // 일괄 인쇄 단추와 같은 키 — 인쇄·넣기·빼기 뒤의 무효화가 여기에도 닿는다
  const states = useQuery({
    queryKey: ['waybill-label-states', batch.id],
    queryFn: () => fetchBatchLabelStates(api, batch.id),
  });
  const counts = items ? boxCountsOf(items) : null;
  const rows = sortBoxRows(
    (states.data ?? []).flatMap((state) => {
      const row = boxRowOf(state);
      return row ? [row] : [];
    })
  );
  return (
    <section aria-label="배치 상세" className="flex min-h-0 flex-col gap-3 rounded-[10px] border border-[#D5D8DE] bg-white p-4">
      <h2 className="font-mono text-2xl font-semibold">{batch.batchNumber}</h2>
      {counts ? (
        <div className="grid shrink-0 grid-cols-4 gap-2 text-center text-sm">
          {COUNT_CELLS.map((cell) => (
            <div key={cell.key} aria-label={cell.label} className={cn('rounded-md py-1.5', cell.tone)}>
              <div className="font-mono text-xl font-semibold">{counts[cell.key]}</div>
              {cell.label}
            </div>
          ))}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <ol aria-label="박스" className="min-h-0 flex-1 overflow-auto">
          {rows.map((row) => (
            <li
              key={row.shipmentId}
              className="grid h-[46px] grid-cols-[160px_minmax(0,1fr)_96px] items-center border-b border-[#EEF0F2] text-[15px]"
            >
              <span className="font-mono">{formatTrackingNo(row.trackingNo)}</span>
              <span>{row.recipient}</span>
              <span className={cn('text-right font-semibold', ROW_TONE[row.tone])}>{row.status}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `npx vitest run src/station/batches src/domains/outbound && npx tsc -b`
Expected: PASS — 새 8 + 박스 줄 9, tsc 에러 0

- [ ] **Step 7: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound/waybillLabel.ts native/warehouse-app/src/domains/outbound/batchStatus.ts \
  native/warehouse-app/src/domains/outbound/batchStatus.test.ts \
  native/warehouse-app/src/station/batches/BatchStatusScreen.tsx native/warehouse-app/src/station/batches/BatchStatusScreen.test.tsx
git commit -m "feat(warehouse-app): 스테이션 배치 현황 — 배치 표·건수·미완료 박스, 시작·인쇄·넣기·빼기는 지금 부품"
```

---

### Task 13: 연결 — 스테이션만 F1·F2 새 화면, 핸드헬드는 그대로

**Files:**
- Modify: `native/warehouse-app/src/app/routes/OutboundRoute.tsx`
- Create: `native/warehouse-app/src/app/routes/OutboundBatchesRoute.tsx`
- Modify: `native/warehouse-app/src/app/routeTree.tsx:187-192`
- Modify: `native/warehouse-app/src/station/tabs.ts:16-21` (주석)
- Test: `native/warehouse-app/src/app/router.test.tsx`, `native/warehouse-app/src/app/router.handheld.test.tsx`

**Interfaces:**
- Consumes: Task 7 `InspectionScreen`, Task 12 `BatchStatusScreen`, `isStationDevice()`
- Produces: `/outbound` = 스테이션 `InspectionScreen` · 핸드헬드 `OutboundQueueScreen`(지금 그대로). `/outbound/batches` = 스테이션 `BatchStatusScreen` · 핸드헬드 `OutboundQueueScreen`(핸드헬드엔 이 탭이 없다). `/outbound/simple/$shipmentId`·`/outbound/withdraw/$shipmentId` 는 그대로 둔다(핸드헬드 경로)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`router.test.tsx` — import 에 `import { createMemoryPrefs, type DevicePrefs } from '../core/data/devicePrefs';` 로 바꾸고, `renderAppRouter` 를 창고·클라이언트를 받게 바꾼다:

```tsx
function renderAppRouter(
  initialEntries: string[],
  session: Session,
  prefs: DevicePrefs = createMemoryPrefs(),
  api: ApiClient = client
) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries }),
    context: { session },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={api}>
          <WarehouseProvider prefs={prefs}>
            <ScanProvider>
              <RouterProvider router={router} />
            </ScanProvider>
          </WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return router;
}
```

파일 끝에 더한다:

```tsx
it('스테이션의 F1 은 출고 검수, F2 는 배치 현황 화면이다', async () => {
  const { session, setAuthed } = makeStub();
  setAuthed(true);
  const prefs = createMemoryPrefs({ 'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '부천 창고' }) });
  const stationClient: ApiClient = {
    request: (async (opts: { path: string }) =>
      opts.path.startsWith('/outbound-batches') || opts.path.startsWith('/outbound-refills')
        ? []
        : { data: [], total: 0 }) as unknown as ApiClient['request'],
  };
  const router = renderAppRouter(['/outbound'], session, prefs, stationClient);
  expect(await screen.findByText('송장 바코드')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'F2' });
  await waitFor(() => expect(router.state.location.pathname).toBe('/outbound/batches'));
  expect(await screen.findByText('진행 중인 배치가 없어요.')).toBeInTheDocument();
});
```

`router.handheld.test.tsx` 의 `describe('handheld hub navigation', …)` 안에 더한다:

```tsx
  it('출고작업 타일은 지금 출고작업 화면 그대로다 — 스테이션 출고 검수가 아니다', async () => {
    const session = stub();
    const user = userEvent.setup();
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path === '/inventory/warehouses') return [];
        return { data: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>
            <WarehouseProvider prefs={createMemoryPrefs()}>
              <ScanProvider>
                <RouterProvider router={createAppRouter(session)} />
              </ScanProvider>
            </WarehouseProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
    await act(async () => {
      await user.click(await screen.findByRole('link', { name: /출고작업/ }));
    });
    expect(await screen.findByRole('heading', { name: '출고작업' })).toBeInTheDocument();
    expect(screen.queryByText('송장 바코드')).toBeNull();
  });
```

Run: `npx vitest run src/app/router.test.tsx src/app/router.handheld.test.tsx`
Expected: 스테이션 테스트 FAIL — `/outbound` 가 아직 옛 출고작업 화면이다(«송장 바코드» 없음). 핸드헬드 테스트는 PASS(지금 동작을 고정한다)

- [ ] **Step 2: 연결한다**

`OutboundRoute.tsx`:

```tsx
import { OutboundQueueScreen } from '../../domains/outbound/OutboundQueueScreen';
import { InspectionScreen } from '../../station/outbound/InspectionScreen';
import { isStationDevice } from '../station';

/** 스테이션 F1 은 출고 검수(스펙 §6). 핸드헬드는 지금 출고작업 그대로다(§2-5) */
export function OutboundRoute() {
  return isStationDevice() ? <InspectionScreen /> : <OutboundQueueScreen />;
}
```

`OutboundBatchesRoute.tsx`:

```tsx
import { OutboundQueueScreen } from '../../domains/outbound/OutboundQueueScreen';
import { BatchStatusScreen } from '../../station/batches/BatchStatusScreen';
import { isStationDevice } from '../station';

/** 스테이션 F2 배치 현황(스펙 §8). 핸드헬드엔 이 탭이 없다 — 경로로 들어오면 지금 출고작업을 그린다 */
export function OutboundBatchesRoute() {
  return isStationDevice() ? <BatchStatusScreen /> : <OutboundQueueScreen />;
}
```

`routeTree.tsx` — import 에 `import { OutboundBatchesRoute } from './routes/OutboundBatchesRoute';` 를 더하고:

```tsx
// 스테이션 F2 배치 현황(스펙 §8). 핸드헬드는 지금 출고작업을 그린다
const outboundBatchesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/outbound/batches',
  component: OutboundBatchesRoute,
});
```

`tabs.ts` 의 `STATION_TABS` 주석에서 «F2 는 PR C 전까지 출고 화면(배치 카드가 거기 있다)을 같이 그린다» 줄을 «F1·F2 는 출고 검수·배치 현황 화면이다(PR C)» 로 바꾼다.

- [ ] **Step 3: 통과를 확인한다**

Run: `npx vitest run src/app && npx tsc -b`
Expected: PASS — 새 2 + 기존 라우터 테스트 전부(«U3 도달성» 은 창고 미설정이라 두 탭 모두 창고 선택을 그린다)

- [ ] **Step 4: 커밋**

```bash
git add native/warehouse-app/src/app/routes/OutboundRoute.tsx native/warehouse-app/src/app/routes/OutboundBatchesRoute.tsx \
  native/warehouse-app/src/app/routeTree.tsx native/warehouse-app/src/station/tabs.ts \
  native/warehouse-app/src/app/router.test.tsx native/warehouse-app/src/app/router.handheld.test.tsx
git commit -m "feat(warehouse-app): 스테이션 F1·F2 를 출고 검수·배치 현황으로 — 핸드헬드 출고작업은 그대로"
```

---

### Task 14: 게이트와 PR

**Files:** 없음(검증·PR 본문만)

- [ ] **Step 1: 앱 타입 검사** — Run: `npx tsc -b` · Expected: 에러 0
- [ ] **Step 2: 앱 테스트 전체** — Run: `npx vitest run` · Expected: 실패 0 (develop 기준선 126 files / 1117 tests 에서 새 파일만큼 늘어난다)
- [ ] **Step 3: 앱 린트** — Run: `npx oxlint 2>&1 | grep -c warning` · Expected: `22`(develop 기준선과 같다)
- [ ] **Step 4: 앱 빌드** — Run: `npm run build` · Expected: 성공(`tsc -b && vite build`)
- [ ] **Step 5: 루트 게이트** — Run: `cd ../.. && npm run type-check && npx jest --maxWorkers=2` · Expected: 에러 0 · 실패 0 (⚠️ tsc 증분 캐시가 가짜 에러를 내면 `rm -f tsconfig.tsbuildinfo` 후 다시)
- [ ] **Step 6: core 통합 스펙** — Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- waybill-label-state.reader` · Expected: PASS. DB 를 못 띄우면 PR 본문에 «통합 스펙 미실행» 으로 적는다
- [ ] **Step 7: 핸드헬드 회귀 확인** — Run: `npx vitest run src/domains/outbound src/app/router.handheld.test.tsx` · Expected: PASS — 핸드헬드가 쓰는 출고작업·위치 확인 출고·박스 빼기 화면 테스트가 손대지 않은 채 통과
- [ ] **Step 8: PR 생성** — base `develop`, 제목 `feat(warehouse-app): 스테이션 UI PR C — F1 출고 검수·F2 배치 현황·결품·보충 대기·강제출고`. 본문에 다음을 적는다:
  - **배포 순서:** ① PR A(#1010)가 라이브인지 먼저 확인 — `GET /outbound-refills/pending?warehouseId=` 가 작업자 토큰으로 200, `GET /inventory/work-context` 에 `permissions.stationForceDispatch`·`shortPick` (확인 전이면 앱을 내지 않는다: F9·F10·보충 대기가 안 보일 뿐 깨지진 않지만 이 PR 의 목적이 빠진다) ② 이 PR 의 core 변경(배치 박스 송장 상태 필드 3개, 추가형·마이그 0) 배포 ③ 앱 릴리스. 핸드헬드는 바뀌지 않는다
  - **계획이 정한 것**(이 계획 문서의 표) 중 사용자 결정 두 건: 결품을 마지막 위치부터 나눠 보낸다(U11 일반화), F2 박스 목록을 위해 core 응답에 필드를 더한다
  - **알고 남기는 틈:** 검수 중 «송장일 수 있음» 판정은 지금 송장번호와 숫자 길이가 같은지로 본다(같은 길이의 상품 바코드는 조회 한 번 뒤 상품으로 간다) · 확인 못 한 스캔의 복구는 지금처럼 화면 아래 «처리 내역 확인»(마우스) · 최근 스캔은 탭을 옮기면 사라진다
  - **실기 확인(Windows 스테이션, 릴리스 빌드) — 모의 테스트로 대체하지 않는다(스펙 §10.3)**
    - [ ] 송장 → 상품 스캔 → 마지막 상품에서 완료음과 함께 송장 대기로, 마우스 0회(§2-1)
    - [ ] 한글 IME 켠 상태에서 송장·상품 바코드와 명령 바코드(「출고 검수」 절 F7 수량, 숫자 %91%N)가 읽힌다
    - [ ] 성공·오류·완료음이 들린다(WebView2 자동재생)
    - [ ] 송장이 바뀐 박스를 찍으면 새 송장이 자동으로 나온다. 새 송장을 찍으면 검수로 간다
    - [ ] 결품(F9 → Enter → Enter) → 채움: 새 송장 자동 출력 + 보충 대기 목록. 다른 스테이션에서 새 송장을 찍어 이어서 완료된다
    - [ ] 결품 → 뺄 상품 → 되돌림 바구니 → 빠진 박스
    - [ ] 결품 창이 열린 채 상품을 찍으면 오류음만 나고 창이 확정되지 않는다
    - [ ] 강제출고(F10 두 번) — 감사 로그에 `fulfillment.dispatch.station_force` 스코프·사유 `station_force_command`
    - [ ] 박스 빼기(F11 두 번) — 담은 상품이 있으면 뺄 상품으로
    - [ ] 송장 대기에서 숫자를 치면 입력칸이 열리고 Enter 로 그 송장이 열린다
    - [ ] 검수 중 앱을 닫았다 열면(또는 F2 갔다 F1) 그 박스가 다시 열린다
    - [ ] F2: 배치 표·건수·미완료 박스(송장번호·받는 분), 작업 시작·송장 인쇄·박스 넣기·빼기
    - [ ] 설정 → 명령 바코드 시트를 다시 뽑으면 「출고 검수」 절이 있고 스캔된다

---

## PR D~G 에 넘기는 계약 메모

- **사람 키:** 입력칸 없이 숫자·Enter·↑↓·Backspace·Esc 를 받으려면 `useHumanKeys(handler | null)` 을 쓴다(입력칸에 포커스가 가면 스캔이 죽는다). 스캐너 묶음과 그 끝 Enter 는 오지 않는다. 키마다 70ms 를 쉬는 `typeHuman` 으로 테스트한다(`src/station/outbound/__fixtures__/renderStation.tsx`)
- **명령 시트:** 탭 화면의 액션을 `INSPECTION_ACTIONS` 처럼 모듈 상수로 두고 `COMMAND_SHEET_SECTIONS` 에 절로 더한다
- **박스·세션별 큐:** 스캔 큐를 대상(박스·세션)에 묶으려면 대상마다 컴포넌트를 `key` 로 새로 마운트한다. 손잡이(`BoxWorkHandle`)는 렌더가 아니라 effect 에서 건다. 실행기(ledger 경로)를 거치는 큐의 «다 보냈나» 는 drain 으로 기다리지 말고 `useInspectionBox.settle` 처럼 렌더마다 크기·불확실을 본다 — 불확실 결과는 약속이 풀리지 않는다
- **가짜 core:** `createOutboundServer` 는 출고 엔드포인트만 안다. 다른 탭은 같은 꼴(엔드포인트 모양 그대로·상태는 메모리·`requests` 로 검사)로 자기 픽스처를 둔다
- **화면 부품:** `panels.tsx` 는 F1 모양(380px 왼쪽)이다. F3~F6 이 같은 문법(큰 칸·표·최근)을 쓰면 일반화는 그때 한다 — 지금 미리 일반화하지 않았다
