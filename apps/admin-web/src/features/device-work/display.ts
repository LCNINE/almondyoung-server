// 기기 확인할 일 화면의 표시 규칙. React·axios 를 import 하지 않는다 — 화면에 나가는 문장은 여기서 만들고 여기서 검증한다.

import { formatDwell } from '@/lib/utils/format-dwell';
import type {
  DeviceWorkAction,
  DeviceWorkItem,
  DeviceWorkVerdict,
} from '@/lib/api/domains/device-work';

export interface VerdictView {
  label: string;
  tone: 'ok' | 'warn' | 'muted';
  /** 관리자가 할 일 — 현장 말로 */
  next: string;
  action: { kind: DeviceWorkAction; label: string } | null;
}

export const VERDICT_VIEW: Record<DeviceWorkVerdict, VerdictView> = {
  not_applied: {
    label: '반영 안 됨',
    tone: 'warn',
    next: '서버에 이 작업이 없어요. 버리면 그 기기가 나중에 다시 보내도 반영되지 않으니, 필요하면 현장에서 새로 하게 해 주세요.',
    action: { kind: 'abandon', label: '버리기' },
  },
  applied: {
    label: '반영됨',
    tone: 'ok',
    next: '이미 반영됐어요. 현장에서 다시 하지 마세요. 그 기기가 연결되면 저절로 정리돼요.',
    action: { kind: 'dismiss', label: '목록에서 빼기' },
  },
  rejected: {
    label: '반영되지 않고 닫힘',
    tone: 'muted',
    next: '서버가 받았지만 반영하지 않았어요. 필요하면 현장에서 새로 하게 해 주세요.',
    action: { kind: 'dismiss', label: '목록에서 빼기' },
  },
  abandoned: {
    label: '버림',
    tone: 'muted',
    next: '버린 작업이에요. 그 기기가 연결되면 «버린 작업»으로 정리돼요.',
    action: { kind: 'dismiss', label: '목록에서 빼기' },
  },
  in_progress: {
    label: '서버가 처리 중',
    tone: 'muted',
    next: '서버가 아직 처리하고 있어요. 잠시 뒤 다시 확인해 주세요.',
    action: null,
  },
  expired: {
    label: '확인할 수 없음',
    tone: 'warn',
    next: '30일이 지나 서버 기록으로 확인할 수 없어요. 재고 화면에서 직접 확인한 뒤 목록에서 빼 주세요. 빼면 그 기기가 다시 보내도 반영되지 않아요.',
    action: { kind: 'dismiss', label: '확인하고 빼기' },
  },
};

/** 기기가 이만큼 보고하지 않으면 꺼졌거나 연결이 끊긴 것으로 본다(기기는 남은 것이 있으면 10분마다 올린다) */
export const SILENT_AFTER_MS = 30 * 60_000;

export interface DeviceGroup {
  deviceId: string;
  title: string;
  lastReportedAt: string;
  items: DeviceWorkItem[];
}

const kindName = (kind: DeviceWorkItem['deviceKind']) =>
  kind === 'station' ? '스테이션' : '핸드헬드';

/** 기기마다 묶는다 — 가장 오래 남은 작업이 있는 기기부터 */
export function groupByDevice(items: readonly DeviceWorkItem[]): DeviceGroup[] {
  const groups = new Map<string, DeviceWorkItem[]>();
  for (const item of items)
    groups.set(item.deviceId, [...(groups.get(item.deviceId) ?? []), item]);
  return [...groups]
    .map(([deviceId, list]) => {
      const sorted = [...list].sort((a, b) =>
        a.recordedAt.localeCompare(b.recordedAt)
      );
      const latest = [...list].sort((a, b) =>
        b.lastReportedAt.localeCompare(a.lastReportedAt)
      )[0];
      const workers = [
        ...new Set(
          list.map((i) => i.workerName).filter((n): n is string => !!n)
        ),
      ];
      return {
        deviceId,
        title: `${kindName(latest.deviceKind)} · 기기 ${deviceId.slice(-4).toUpperCase()}${
          workers.length ? ` · ${workers.join(', ')}` : ''
        }`,
        lastReportedAt: latest.lastReportedAt,
        items: sorted,
      };
    })
    .sort((a, b) => a.items[0].recordedAt.localeCompare(b.items[0].recordedAt));
}

const ago = (ms: number) => (ms < 60_000 ? '방금' : `${formatDwell(ms)} 전`);

/** «마지막 보고 3분 전», 오래 조용하면 그 사실을 붙인다 */
export function lastReportText(iso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  const text = `마지막 보고 ${ago(ms)}`;
  return ms >= SILENT_AFTER_MS
    ? `${text} — 기기가 꺼졌거나 연결되지 않았어요`
    : text;
}

export function workText(item: DeviceWorkItem): string {
  return item.summary ? `${item.workName} · ${item.summary}` : item.workName;
}

/** 그 작업을 기기가 처음 기록한 때부터 지금까지 — «기기에 남은 지 5분째» */
export function waitingText(item: DeviceWorkItem, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(item.recordedAt).getTime());
  return ms < 60_000
    ? '방금 기기에 남았어요'
    : `기기에 남은 지 ${formatDwell(ms)}째`;
}

export function confirmText(
  item: DeviceWorkItem,
  action: DeviceWorkAction
): { title: string; body: string } {
  if (action === 'abandon')
    return {
      title: `‘${workText(item)}’ 작업을 버릴까요?`,
      body: '버리면 서버가 이 작업을 다시 받지 않아요. 물건을 실제로 옮겼거나 입고했다면 현장에서 새로 해야 재고가 맞아요.',
    };
  return {
    title: `‘${workText(item)}’ 작업을 목록에서 뺄까요?`,
    body: VERDICT_VIEW[item.verdict].next,
  };
}

export function resolvedText(action: DeviceWorkAction): string {
  return action === 'abandon'
    ? '버렸어요. 필요하면 현장에서 새로 하게 해 주세요.'
    : '목록에서 뺐어요.';
}

/** 서버가 보낸 현장 문구를 그대로 쓴다(«그사이 상태가 바뀌었어요» 등) */
export function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : '요청이 실패했어요. 잠시 뒤 다시 해 주세요.';
}
