// apps/notification/src/provider/interfaces/notification-provider.interface.ts
export interface NotificationProvider {
  getName(): string;
  getProviderId(): string;
  isAvailable(): Promise<boolean>;
  send(message: NotificationMessage): Promise<NotificationResult>;
  sendBulk(messages: NotificationMessage[]): Promise<BulkNotificationResult>;
}

export interface NotificationMessage {
  to: string;
  content: string;
  subject?: string;
  metadata?: Record<string, any>;
}

export interface NotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
  providerResponse?: any;
}

export interface BulkNotificationResult {
  successCount: number;
  failureCount: number;
  results?: NotificationResult[];
  failures?: Array<{
    to: string;
    error: string;
  }>;
}
