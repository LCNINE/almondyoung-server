/**
 * 비상 출고 ② 저녁 — 작업자가 고친 `shipments.csv` 에 남은 상자만 core 에서 발송 처리한다 (#1249).
 *
 * 발송은 되돌릴 수 없다(재고가 SHIP 으로 원장을 떠나고 고객에게 송장번호가 간다). 그래서:
 * - 못 나간 상자는 작업자가 CSV 에서 줄을 지운다 — 지운 상자는 `missing` 으로만 보고하고 손대지 않는다.
 * - 이번 실행(run.json)의 상자가 아닌 줄은 거절한다 — 다른 실행의 CSV 를 잘못 넣어도 발송되지 않는다.
 * - 발송 방법(route)은 고칠 수 있는 CSV 가 아니라 core 에서 온 run.json 을 따른다.
 * - planned 가 아닌 상자(낮에 취소 등)는 거절한다.
 * - 인쇄한 송장(run.json)·CSV·core 의 현재 송장 셋이 다르거나 CSV 송장이 비면 «불일치» — `--apply` 여도 보내지 않는다.
 * - 이미 발송된 상자는 «이미» — 다시 돌려도 안전하다. 쓰기마다 같은 멱등 키 `emergency:<run>:dispatch:<상자>`.
 * 기본은 dry-run: 읽기(상자·송장·위치 진행)만 하고 쓰기는 하나도 부르지 않는다.
 */
import { CoreApi, CoreApiError, ForceItem, LocationOutboundState } from './core-api';
import { CsvRow, parseCsv } from './outputs';
import { idemKey } from './prepare';
import type { RunBox, RunState } from './run-state';
import type { Route } from './select';

export const FORCE_REASON = '앱 출고 경로 장애 — 비상 출고';

export type DispatchOutcome = 'dispatched' | 'already' | 'rejected' | 'mismatch' | 'would-dispatch';

export interface DispatchRow {
  shipmentId: string;
  route: Route;
  outcome: DispatchOutcome;
  detail?: string;
}

export interface DispatchReport {
  rows: DispatchRow[];
  /** run.json 에는 있는데 CSV 에서 지운 상자 — 비상 배치에 남는다. */
  missing: string[];
  /** CSV 에 두 번 이상 나온 상자 — 한 번만 처리했다. */
  duplicates: string[];
}

const SHIPPED: ReadonlySet<string> = new Set(['shipped', 'in_transit', 'delivered']);
const NOT_THIS_RUN = '이번 실행의 상자가 아니다';
const DETAIL_SEP = ' · ';

const LABEL: Record<DispatchOutcome, string> = {
  dispatched: '발송',
  'would-dispatch': '발송 예정',
  already: '이미 발송',
  rejected: '거절',
  mismatch: '불일치',
};

export async function runDispatch(
  api: CoreApi,
  opts: { csvText: string; state: RunState; apply: boolean; log: (l: string) => void },
): Promise<DispatchReport> {
  const { state, apply, log } = opts;
  const csv = parseCsv(opts.csvText);
  const boxes = new Map(state.boxes.map((b) => [b.shipmentId, b]));
  const seen = new Set<string>();
  const report: DispatchReport = { rows: [], missing: [], duplicates: [] };

  for (const line of csv) {
    if (seen.has(line.shipmentId)) {
      if (!report.duplicates.includes(line.shipmentId)) report.duplicates.push(line.shipmentId);
      log(`${line.shipmentId} — CSV 중복 줄, 한 번만 처리한다`);
      continue;
    }
    seen.add(line.shipmentId);
    let row: DispatchRow;
    try {
      row = await dispatchOne(api, state, boxes.get(line.shipmentId), line, apply);
    } catch (e) {
      // core 가 답하지 않은 오류(연결 끊김 등) — 쓰기가 커밋됐을 수도 있다. 다시 돌리면 «이미»로 이어진다.
      log('중단 — 같은 명령을 다시 돌리면 이어진다');
      throw e;
    }
    report.rows.push(row);
    log(`${row.shipmentId} ${row.route} ${LABEL[row.outcome]}${row.detail ? ` — ${row.detail}` : ''}`);
  }

  report.missing = state.boxes.filter((b) => !seen.has(b.shipmentId)).map((b) => b.shipmentId);
  for (const id of report.missing) log(`${id} — CSV 에서 빠짐, 보내지 않고 비상 배치에 남긴다`);

  const count = (...o: DispatchOutcome[]) => report.rows.filter((r) => o.includes(r.outcome)).length;
  if (!apply) log('dry-run — 아무것도 보내지 않았다. 보내려면 --apply');
  const sent = apply ? `발송 ${count('dispatched')}` : `발송 예정 ${count('would-dispatch')}`;
  log(
    `${sent} · 이미 ${count('already')} · ${rejectedSummary(report.rows)} · ` +
      `불일치 ${count('mismatch')} · 빠진 상자 ${report.missing.length}`,
  );
  return report;
}

/** `거절 n (사유 n · 사유 n)` — 사유는 detail 의 첫 조각(코드·상태·이번 실행 아님), 처음 나온 순서. */
function rejectedSummary(rows: DispatchRow[]): string {
  const byReason = new Map<string, number>();
  for (const r of rows) {
    if (r.outcome !== 'rejected') continue;
    const reason = (r.detail ?? '').split(DETAIL_SEP)[0] || '사유 없음';
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  const total = [...byReason.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return '거절 0';
  return `거절 ${total} (${[...byReason].map(([reason, n]) => `${reason} ${n}`).join(DETAIL_SEP)})`;
}

async function dispatchOne(
  api: CoreApi,
  state: RunState,
  box: RunBox | undefined,
  line: CsvRow,
  apply: boolean,
): Promise<DispatchRow> {
  const id = line.shipmentId;
  if (!box) return { shipmentId: id, route: line.route, outcome: 'rejected', detail: NOT_THIS_RUN };

  const route = box.route;
  const notes: string[] = [];
  if (line.route !== route) notes.push(`CSV route ${line.route} 대신 실행 기록의 ${route}`);
  const done = (outcome: DispatchOutcome, detail?: string): DispatchRow => {
    const all = detail ? [detail, ...notes] : notes;
    return all.length > 0
      ? { shipmentId: id, route, outcome, detail: all.join(DETAIL_SEP) }
      : { shipmentId: id, route, outcome };
  };

  try {
    const shipment = await api.shipment(id);
    if (SHIPPED.has(shipment.status)) return done('already', shipment.status);
    // 낮에 취소됐거나 복구 대기로 간 상자 — core 도 planned 만 발송한다. 송장보다 먼저 알린다.
    if (shipment.status !== 'planned') return done('rejected', `상태 ${shipment.status}`);

    // 인쇄한 송장(run.json) = CSV = core 의 현재 송장, 셋이 모두 같아야 보낸다.
    const waybill = await api.activeWaybill(id);
    const current = waybill?.trackingNo ?? null;
    if (line.trackingNo === '' || box.trackingNo !== line.trackingNo || current !== line.trackingNo) {
      const show = (v: string | null) => (v === null ? '없음' : v === '' ? '비어 있음' : v);
      return done(
        'mismatch',
        `송장 인쇄 ${show(box.trackingNo)} / CSV ${show(line.trackingNo)} / core ${show(current)}`,
      );
    }

    const key = idemKey(state.run, 'dispatch', id);
    if (route === 'location') {
      const progress = await api.locationState(id, state.warehouseId);
      if (progress.status === 'shipped') return done('already', 'shipped');
      const items = remainingItems(progress);
      if (!apply) return done('would-dispatch');
      await api.locationForce(id, state.warehouseId, FORCE_REASON, items, key);
      return done('dispatched');
    }
    if (!apply) return done('would-dispatch');
    await api.forceDispatch(id, FORCE_REASON, key);
    return done('dispatched');
  } catch (e) {
    if (e instanceof CoreApiError) return done('rejected', e.code);
    throw e;
  }
}

/**
 * 남은 원천 전부를 (라인, 위치)마다 하나씩, 남은 수량 그대로. core 는 이 집합이 정확히 맞아야 받고
 * 본문 해시가 항목 순서를 포함하므로 같은 키로 다시 보낼 때 같은 순서가 되게 정렬한다.
 */
function remainingItems(progress: LocationOutboundState): ForceItem[] {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return progress.sources
    .filter((s) => s.remainingQty > 0)
    .map((s) => ({ shipmentLineId: s.shipmentLineId, sourceLocationId: s.sourceLocationId, quantity: s.remainingQty }))
    .sort((a, b) => cmp(a.shipmentLineId, b.shipmentLineId) || cmp(a.sourceLocationId, b.sourceLocationId));
}
