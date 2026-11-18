/**
 * 비상 출고 실행 상태 — `<실행 폴더>/run.json` (#1249).
 *
 * 단계마다 다시 쓴다. 중간에 죽으면 같은 `--run` 이 이 파일로 이어 간다(배치를 두 번 만들지 않는다).
 * 토큰·이름·연락처는 싣지 않는다 — 상자 id·배치 id·송장번호·사유만.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Route, Skipped } from './select';

export interface RunBox {
  shipmentId: string;
  route: Route;
  batchId: string;
  trackingNo: string | null;
  printed: boolean;
  /** 주문번호 — 이어 돌릴 때 준비 목록에서 사라진 상자도 CSV·피킹 리스트에 싣는다. 옛 run.json 엔 없다. */
  orderNos?: string[];
}

export interface RunState {
  run: string;
  warehouseId: string;
  /** 이 실행이 만든 낱개 피킹 배치. 아직 안 만들었으면 null. */
  batchId: string | null;
  boxes: RunBox[];
  excluded: Skipped[];
}

const FILE = 'run.json';

export function readRun(dir: string): RunState | null {
  const path = join(dir, FILE);
  if (!existsSync(path)) return null;
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRunState(parsed))
    throw new Error(`${path}: run.json 모양이 아니다 — 손으로 고쳤다면 되돌리거나 새 --run 으로`);
  return parsed;
}

/** 임시 파일에 쓴 뒤 이름을 바꾼다 — 쓰다 죽어도 이전 run.json 은 온전하다. */
export function writeRun(dir: string, s: RunState): void {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, FILE);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isRunBox(v: unknown): v is RunBox {
  return (
    isRecord(v) &&
    typeof v.shipmentId === 'string' &&
    (v.route === 'location' || v.route === 'force') &&
    typeof v.batchId === 'string' &&
    (v.trackingNo === null || typeof v.trackingNo === 'string') &&
    typeof v.printed === 'boolean' &&
    (v.orderNos === undefined || (Array.isArray(v.orderNos) && v.orderNos.every((o) => typeof o === 'string')))
  );
}

function isSkipped(v: unknown): v is Skipped {
  return (
    isRecord(v) &&
    typeof v.shipmentId === 'string' &&
    typeof v.reason === 'string' &&
    (v.orderNos === undefined || (Array.isArray(v.orderNos) && v.orderNos.every((o) => typeof o === 'string')))
  );
}

function isRunState(v: unknown): v is RunState {
  return (
    isRecord(v) &&
    typeof v.run === 'string' &&
    typeof v.warehouseId === 'string' &&
    (v.batchId === null || typeof v.batchId === 'string') &&
    Array.isArray(v.boxes) &&
    v.boxes.every(isRunBox) &&
    Array.isArray(v.excluded) &&
    v.excluded.every(isSkipped)
  );
}
