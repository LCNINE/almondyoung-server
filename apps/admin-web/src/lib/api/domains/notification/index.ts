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
