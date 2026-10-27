import type { ServerReach } from '../../core/data/serverStatus';
import type { StoredOperation } from '../../core/operations/operationStore';
import type { TabKey } from '../keys';

export type StatusTone = 'ok' | 'bad' | 'warn' | 'idle';

export interface StatusItem {
  id: 'printer' | 'server' | 'unsent' | 'batch';
  label: string;
  tone: StatusTone;
}

export interface BatchProgress {
  code: string;
  done: number;
  total: number;
}

export interface StatusInput {
  printer: { configured: boolean; lastFailed: boolean };
  server: ServerReach;
  unsent: number;
  batch: BatchProgress | null;
  tab: TabKey | null;
}

/** 보내는 중인 오퍼레이션은 이 시간이 지나거나 불확실해져야 «미전송» 이다 — 정상 전송의 깜빡임을 막는다(workStatus 와 같은 1.5초). */
export const UNSENT_AFTER_MS = 1500;

export function unsentCount(operations: readonly StoredOperation[], now: number): number {
  return operations.filter((o) => o.status === 'uncertain' || now - o.createdAt >= UNSENT_AFTER_MS).length;
}

/**
 * 상태바 칸(스펙 §5.5). 프린터·서버는 늘 점으로, 미전송은 1 이상일 때만, 배치 진행은 F1·F2 에서만.
 * 스캐너 칸은 없다 — HID 리더기는 키보드라 연결 여부를 앱이 알 수 없고, 모르는 상태를 초록으로 그리지 않는다.
 */
export function statusBarItems(input: StatusInput): StatusItem[] {
  const items: StatusItem[] = [
    {
      id: 'printer',
      label: '프린터',
      tone: input.printer.configured && !input.printer.lastFailed ? 'ok' : 'bad',
    },
    {
      id: 'server',
      label: '서버',
      tone: input.server === 'up' ? 'ok' : input.server === 'down' ? 'bad' : 'idle',
    },
  ];
  if (input.unsent > 0) items.push({ id: 'unsent', label: `미전송 ${input.unsent}`, tone: 'warn' });
  if (input.batch && (input.tab === 'F1' || input.tab === 'F2'))
    items.push({ id: 'batch', label: `${input.batch.code} ${input.batch.done}/${input.batch.total}`, tone: 'idle' });
  return items;
}
