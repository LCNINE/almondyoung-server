import { SMS_GATE_OFFLINE_AFTER_MS } from './sms-gate.constants';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function startOfKstDay(now: Date): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - KST_OFFSET_MS);
}

export interface DeviceCandidate {
  deviceId: string;
  enabled: boolean;
  dailyLimit: number;
  sentToday: number;
  lastSeen: Date | null;
}

export function isOnline(lastSeen: Date | null, now: Date): boolean {
  return lastSeen !== null && now.getTime() - lastSeen.getTime() <= SMS_GATE_OFFLINE_AFTER_MS;
}

export function isSendable(device: DeviceCandidate, now: Date): boolean {
  return device.enabled && device.sentToday < device.dailyLimit && isOnline(device.lastSeen, now);
}

export function pickDevice(
  devices: DeviceCandidate[],
  now: Date,
  requestedDeviceId?: string | null,
): DeviceCandidate | null {
  if (requestedDeviceId) {
    const requested = devices.find((d) => d.deviceId === requestedDeviceId);
    return requested && isSendable(requested, now) ? requested : null;
  }
  return devices
    .filter((d) => isSendable(d, now))
    .sort((a, b) => a.dailyLimit - a.sentToday - (b.dailyLimit - b.sentToday))
    .pop() ?? null;
}
