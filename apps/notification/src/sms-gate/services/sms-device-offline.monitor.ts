import { Injectable } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { GoogleChatClient } from '../clients/google-chat.client';
import { SmsGateClient } from '../clients/sms-gate.client';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { diffOfflineAlerts, offlineMessage, recoveredMessage } from '../utils/offline-alert';

@Injectable()
export class SmsDeviceOfflineMonitor {
  constructor(
    private readonly repository: SmsGateRepository,
    private readonly client: SmsGateClient,
    private readonly googleChat: GoogleChatClient,
  ) {}

  @CronOnce('*/10 * * * *', { name: 'sms-gate-device-offline-alert' })
  async check(): Promise<void> {
    if (!this.client.isConfigured() || !this.googleChat.isConfigured()) return;
    const now = new Date();
    const [devices, gatewayDevices] = await Promise.all([this.repository.listDevices(), this.client.listDevices()]);
    const lastSeenById = new Map(gatewayDevices.map((d) => [d.id, d.lastSeen ? new Date(d.lastSeen) : null]));
    const { wentOffline, recovered } = diffOfflineAlerts(
      devices.map((d) => ({ ...d, lastSeen: lastSeenById.get(d.deviceId) ?? null })),
      now,
    );

    if (wentOffline.length > 0) {
      await this.googleChat.send(offlineMessage(wentOffline, now));
      await this.repository.setOfflineAlertedAt(
        wentOffline.map((d) => d.id),
        now,
      );
    }
    if (recovered.length > 0) {
      await this.googleChat.send(recoveredMessage(recovered));
      await this.repository.setOfflineAlertedAt(
        recovered.map((d) => d.id),
        null,
      );
    }
  }
}
