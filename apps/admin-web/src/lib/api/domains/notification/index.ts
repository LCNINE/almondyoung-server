'use client';

import { NOTIFICATION_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';

export type MessageChannel = 'SMS' | 'KAKAO';

export type NotificationStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED'
  | 'RETRYING';

export interface UserMessageHistoryItem {
  notificationId: string;
  sendType: 'AUTO' | 'MANUAL';
  route: 'NHN' | 'SMS_GATE';
  deviceName: string | null;
  phoneNumber: string | null;
  subject: string | null;
  body: string;
  status: NotificationStatus;
  sentAt: string;
}

export interface UserMessageHistoryPage {
  items: UserMessageHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

export interface UserMessageHistoryQuery {
  channel: MessageChannel;
  from: string;
  to: string;
  page: number;
  limit: number;
}

export const notificationApi = {
  getUserMessages: async (
    userId: string,
    params: UserMessageHistoryQuery
  ): Promise<UserMessageHistoryPage> => {
    const response = await client.get<UserMessageHistoryPage>(
      `${NOTIFICATION_SERVICE_BASE_URL}/notifications/users/${userId}`,
      { params }
    );
    return response.data;
  },
};

export type NotificationChannel = 'EMAIL' | 'SMS' | 'KAKAO' | 'PUSH';

export interface NotificationEvent {
  eventKey: string;
  name: string;
  description: string;
  templateKey: string;
  defaultChannels: NotificationChannel[];
  isActive: boolean;
  updatedAt: string;
}

export interface ChannelBody {
  subject?: string;
  body: string;
}

export type TemplateContents = Record<string, Record<string, ChannelBody | undefined> | undefined>;

export interface NotificationTemplate {
  templateId: string;
  templateKey: string;
  name: string;
  contents: TemplateContents;
  variablesSchema: Record<string, { type: string; required?: boolean; description?: string }>;
  updatedAt: string;
  kakaoTemplateConfig?: { templateCode: string; status: string };
}

export const notificationAdminApi = {
  getEvents: async (): Promise<NotificationEvent[]> => {
    const response = await client.get<NotificationEvent[]>(`${NOTIFICATION_SERVICE_BASE_URL}/events`);
    return response.data;
  },

  updateEvent: async (
    eventKey: string,
    values: Partial<Pick<NotificationEvent, 'isActive' | 'defaultChannels'>>
  ): Promise<void> => {
    await client.put(`${NOTIFICATION_SERVICE_BASE_URL}/events/${eventKey}`, values);
  },

  getTemplates: async (): Promise<NotificationTemplate[]> => {
    const response = await client.get<NotificationTemplate[]>(`${NOTIFICATION_SERVICE_BASE_URL}/templates`);
    return response.data;
  },

  updateTemplateContents: async (templateId: string, contents: TemplateContents): Promise<void> => {
    await client.put(`${NOTIFICATION_SERVICE_BASE_URL}/templates/by-id/${templateId}`, { contents });
  },
};
