import { createHash } from 'node:crypto';
import {
  BulkNotificationResult,
  NotificationMessage,
  NotificationProvider,
  NotificationResult,
} from '../../interfaces/notification-provider.interface';

/** The dispatcher persists providerResponse in the existing notification delivery record. */
export class DemoNotificationProvider implements NotificationProvider {
  constructor(
    private readonly providerId: string,
    private readonly name: string,
  ) {}

  getName(): string {
    return `Demo ${this.name}`;
  }
  getProviderId(): string {
    return this.providerId;
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    const digest = createHash('sha256')
      .update(
        JSON.stringify([
          this.providerId,
          message.to,
          message.subject ?? '',
          message.content,
          message.metadata?.notificationId ?? '',
        ]),
      )
      .digest('hex')
      .slice(0, 24);
    return {
      success: true,
      messageId: `demo-${digest}`,
      providerResponse: {
        simulated: true,
        stage: 'demo',
        provider: this.name,
        recipient: message.to,
        subject: message.subject ?? null,
        content: message.content,
      },
    };
  }

  async sendBulk(messages: NotificationMessage[]): Promise<BulkNotificationResult> {
    const results = await Promise.all(messages.map((message) => this.send(message)));
    return { successCount: results.length, failureCount: 0, results, failures: [] };
  }
}
