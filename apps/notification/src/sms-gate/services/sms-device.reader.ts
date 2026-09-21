import { Injectable } from '@nestjs/common';
import { SmsDevice } from '../../../database/schemas/notification-schema';
import { DeviceCandidate, isOnline, startOfKstDay } from '../utils/device-picker';
import { SmsGateClient } from '../clients/sms-gate.client';
import { SmsGateRepository } from '../repositories/sms-gate.repository';

export interface SmsDeviceStatus extends DeviceCandidate {
  id: string;
  lastSentAt: Date | null;
  name: string;
  online: boolean;
}

@Injectable()
export class SmsDeviceReader {
  constructor(
    private readonly repository: SmsGateRepository,
    private readonly client: SmsGateClient,
  ) {}

  async loadStatuses(now: Date): Promise<SmsDeviceStatus[]> {
    const [devices, sent, lastSent, gatewayDevices] = await Promise.all([
      this.repository.listDevices(),
      this.repository.countSentSince(startOfKstDay(now)),
      this.repository.lastSentAtByDevice(),
      this.client.listDevices(),
    ]);
    const lastSeenById = new Map(gatewayDevices.map((d) => [d.id, d.lastSeen ? new Date(d.lastSeen) : null]));
    return devices.map((device) =>
      this.toStatus(
        device,
        sent.get(device.deviceId) ?? 0,
        lastSeenById.get(device.deviceId) ?? null,
        lastSent.get(device.deviceId) ?? null,
        now,
      ),
    );
  }

  private toStatus(
    device: SmsDevice,
    sentToday: number,
    lastSeen: Date | null,
    lastSentAt: Date | null,
    now: Date,
  ): SmsDeviceStatus {
    return {
      id: device.id,
      deviceId: device.deviceId,
      name: device.name,
      enabled: device.enabled,
      dailyLimit: device.dailyLimit,
      sentToday,
      lastSeen,
      lastSentAt,
      online: isOnline(lastSeen, now),
    };
  }
}
