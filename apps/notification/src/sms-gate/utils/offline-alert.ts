import { isOnline } from './device-picker';

export interface OfflineCheckDevice {
  id: string;
  name: string;
  enabled: boolean;
  lastSeen: Date | null;
  offlineAlertedAt: Date | null;
}

export function diffOfflineAlerts<T extends OfflineCheckDevice>(
  devices: T[],
  now: Date,
): { wentOffline: T[]; recovered: T[] } {
  const enabled = devices.filter((d) => d.enabled);
  return {
    wentOffline: enabled.filter((d) => !isOnline(d.lastSeen, now) && !d.offlineAlertedAt),
    recovered: enabled.filter((d) => isOnline(d.lastSeen, now) && d.offlineAlertedAt),
  };
}

export function formatElapsed(from: Date | null, now: Date): string {
  if (!from) return '연결 기록 없음';
  const minutes = Math.floor((now.getTime() - from.getTime()) / 60_000);
  return minutes < 60 ? `${minutes}분째 연결 없음` : `${Math.floor(minutes / 60)}시간째 연결 없음`;
}

export function offlineMessage(devices: OfflineCheckDevice[], now: Date): string {
  return [
    '⚠️ 발송폰이 응답하지 않습니다.',
    ...devices.map((d) => `• ${d.name} — ${formatElapsed(d.lastSeen, now)}`),
    '',
    '폰에서 SMS Gate 앱을 열어 서버 연결을 확인하세요. 그동안 문자는 발송 대기로 쌓입니다.',
  ].join('\n');
}

export function recoveredMessage(devices: OfflineCheckDevice[]): string {
  return ['✅ 발송폰이 다시 연결됐습니다.', ...devices.map((d) => `• ${d.name}`)].join('\n');
}
