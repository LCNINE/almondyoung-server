/**
 * 비상 출고 산출물 — 라벨·피킹 리스트·CSV (#1249, 스펙 «① 5»).
 *
 * 순수 함수(정렬·HTML·CSV)와, `prepare --apply` 끝에서 파일을 만드는 `produceOutputs` 로 이뤄진다.
 * 받는 분 이름은 core 가 이미 가린 `recipientSnapshot` 그대로 쓴다.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { CoreApi, CoreApiError } from './core-api';
import { RunState, writeRun } from './run-state';
import type { Route } from './select';

export interface PickBox {
  shipmentId: string;
  orderNos: string[];
  trackingNo: string;
  route: Route;
  recipientName: string;
  lines: { skuName: string; qty: number }[];
  sources: { locationCode: string; skuName: string; qty: number }[];
}

const SEP = ' / ';

/** 첫 위치 코드 오름차순. 위치가 없는 상자는 그 뒤, 이미 피킹된 force 상자는 맨 뒤. 같으면 들어온 순서. */
export function sortForPicking(boxes: PickBox[]): PickBox[] {
  const rank = (b: PickBox) => (b.route === 'force' ? 2 : b.sources.length === 0 ? 1 : 0);
  const first = (b: PickBox) => b.sources[0]?.locationCode ?? '';
  return boxes
    .map((box, i) => ({ box, i }))
    .sort((a, b) => {
      const r = rank(a.box) - rank(b.box);
      if (r !== 0) return r;
      const fa = first(a.box);
      const fb = first(b.box);
      if (fa !== fb) return fa < fb ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.box);
}

function esc(v: string | number): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderPickList(run: string, boxes: PickBox[]): string {
  const rows = boxes
    .map((b, i) => {
      const where =
        b.route === 'force'
          ? '이미 피킹됨'
          : b.sources.length === 0
            ? '위치 없음'
            : b.sources.map((s) => `${esc(s.locationCode)} · ${esc(s.skuName)} × ${esc(s.qty)}`).join('<br>');
      const items = b.lines.map((l) => `${esc(l.skuName)} × ${esc(l.qty)}`).join('<br>');
      return (
        `<tr><td>${i + 1}</td><td>${esc(b.orderNos.join(SEP))}</td><td>${esc(b.trackingNo)}</td>` +
        `<td>${esc(b.recipientName)}</td><td>${items}</td><td>${where}</td><td class="chk"></td></tr>`
      );
    })
    .join('\n');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>피킹 리스트 ${esc(run)}</title>
<style>
@page { size: A4; margin: 10mm; }
body { font-family: sans-serif; font-size: 11px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #444; padding: 3px 5px; vertical-align: top; text-align: left; }
tr { page-break-inside: avoid; }
.chk { width: 24px; }
</style></head><body>
<h1>피킹 리스트 ${esc(run)} — ${boxes.length}상자</h1>
<table>
<thead><tr><th>#</th><th>주문번호</th><th>송장번호</th><th>받는 분</th><th>상품</th><th>위치</th><th>확인</th></tr></thead>
<tbody>
${rows}
</tbody></table>
</body></html>
`;
}

export const CSV_HEADER = ['shipmentId', 'orderNo', 'trackingNo', 'route', 'batchId'] as const;

export interface CsvRow {
  shipmentId: string;
  orderNo: string;
  trackingNo: string;
  route: Route;
  batchId: string;
}

function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: CsvRow[]): string {
  const lines = [CSV_HEADER.join(','), ...rows.map((r) => CSV_HEADER.map((h) => csvField(r[h])).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

function splitCsv(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      records.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  return records.filter((r) => r.some((f) => f.trim() !== ''));
}

export function parseCsv(text: string): CsvRow[] {
  const records = splitCsv(text.replace(/^﻿/, ''));
  const header = records[0]?.map((h) => h.trim()) ?? [];
  const idx = new Map<string, number>();
  for (const name of CSV_HEADER) {
    const at = header.indexOf(name);
    if (at < 0) throw new Error(`CSV 헤더에 ${name} 열이 없다 — 받은 헤더: ${header.join(',') || '(비어 있음)'}`);
    idx.set(name, at);
  }
  const get = (r: string[], name: string) => (r[idx.get(name) ?? -1] ?? '').trim();
  return records.slice(1).map((r, n) => {
    const route = get(r, 'route');
    if (route !== 'location' && route !== 'force') {
      throw new Error(`CSV ${n + 2}번째 줄의 route 가 location·force 가 아니다: ${JSON.stringify(route)}`);
    }
    return {
      shipmentId: get(r, 'shipmentId'),
      orderNo: get(r, 'orderNo'),
      trackingNo: get(r, 'trackingNo'),
      route,
      batchId: get(r, 'batchId'),
    };
  });
}

// ── 파일 만들기 ──────────────────────────────────────────────────────

const LABEL_CONTENT_CHANGED = 'LABEL_CONTENT_CHANGED';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function recipientNameOf(snapshot: unknown): string {
  if (!isRecord(snapshot)) return '';
  const name = snapshot.recipientName ?? snapshot.name;
  return typeof name === 'string' ? name : '';
}

/**
 * `labels.zpl`·`pick-list.html`·`shipments.csv` 를 만든다. 매번 전체를 다시 쓴다(덮어쓰기).
 * 출력 확인 기록(`confirmLabelPrint`)은 아직 안 찍힌 상자만, 파일을 쓴 뒤에 남긴다 — 스펙상 위치 피킹이 그 기록을 요구한다.
 * 상자 하나를 확인할 때마다 run.json 의 `printed` 를 곧바로 저장한다.
 */
export async function produceOutputs(
  api: CoreApi,
  state: RunState,
  orderNos: Map<string, string[]>,
  dir: string,
  log: (l: string) => void,
): Promise<string[]> {
  const labels = new Map<string, { data: string; fingerprint: string }>();
  const picks: PickBox[] = [];
  const problems: string[] = [];

  for (const b of state.boxes) {
    const detail = await api.shipment(b.shipmentId);
    const skuNames = new Map(detail.lines.map((l) => [l.id, l.skuName ?? '']));
    const sources =
      b.route === 'location'
        ? (await api.locationState(b.shipmentId, state.warehouseId)).sources
            .map((s) => ({
              locationCode: s.sourceLocationCode,
              skuName: skuNames.get(s.shipmentLineId) ?? '',
              qty: s.remainingQty,
            }))
            .filter((s) => s.qty > 0)
        : [];
    let trackingNo = b.trackingNo ?? '';
    if (b.trackingNo != null) {
      const l = await api.label(b.shipmentId);
      labels.set(b.shipmentId, { data: l.data, fingerprint: l.fingerprint });
      trackingNo = l.trackingNo;
    } else {
      const problem = `상자 ${b.shipmentId} 송장번호가 없어 라벨을 못 만들었고 출력 확인도 못 남겼다 — 저녁 위치 강제 출고가 실패한다. 상자 보기에서 송장을 확인한다`;
      problems.push(problem);
      log(`오류: ${problem}`);
    }
    picks.push({
      shipmentId: b.shipmentId,
      orderNos: b.orderNos ?? orderNos.get(b.shipmentId) ?? [],
      trackingNo,
      route: b.route,
      recipientName: recipientNameOf(detail.recipientSnapshot),
      lines: detail.lines.map((l) => ({ skuName: l.skuName ?? '', qty: l.qty })),
      sources,
    });
  }

  const sorted = sortForPicking(picks);
  const writeLabels = () =>
    writeFileSync(join(dir, 'labels.zpl'), sorted.map((p) => labels.get(p.shipmentId)?.data ?? '').join(''), 'utf8');
  writeLabels();
  writeFileSync(join(dir, 'pick-list.html'), renderPickList(state.run, sorted), 'utf8');
  const byId = new Map(state.boxes.map((b) => [b.shipmentId, b]));
  writeFileSync(
    join(dir, 'shipments.csv'),
    toCsv(
      sorted.map((p) => ({
        shipmentId: p.shipmentId,
        orderNo: p.orderNos.join(SEP),
        trackingNo: p.trackingNo,
        route: p.route,
        batchId: byId.get(p.shipmentId)?.batchId ?? '',
      })),
    ),
    'utf8',
  );

  let relabeled = false;
  for (const p of sorted) {
    const box = byId.get(p.shipmentId);
    const label = labels.get(p.shipmentId);
    if (!box || !label || box.printed) continue;
    try {
      await api.confirmLabelPrint(p.shipmentId, label.fingerprint);
    } catch (error) {
      if (!(error instanceof CoreApiError) || error.code !== LABEL_CONTENT_CHANGED) throw error;
      const fresh = await api.label(p.shipmentId);
      labels.set(p.shipmentId, { data: fresh.data, fingerprint: fresh.fingerprint });
      relabeled = true;
      await api.confirmLabelPrint(p.shipmentId, fresh.fingerprint);
    }
    box.printed = true;
    writeRun(dir, state);
  }
  if (relabeled) writeLabels();
  log(`산출물 — labels.zpl·pick-list.html·shipments.csv (${sorted.length}상자). labels.zpl 을 반드시 찍는다`);
  return problems;
}
