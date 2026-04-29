import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  PendingApprovalDto,
  ApprovalHistoryItemDto,
} from '@/lib/types/dto/products';
import { client } from '../../client';

export const approvalClient = {
  submitApproval: async (masterId: string): Promise<void> => {
    await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${masterId}/submit-approval`,
      {}
    );
  },

  approve: async (masterId: string, comment?: string): Promise<void> => {
    await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${masterId}/approve`,
      { comment }
    );
  },

  reject: async (masterId: string, reason: string): Promise<void> => {
    await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${masterId}/reject`,
      { reason }
    );
  },

  getPending: async (): Promise<PendingApprovalDto[]> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/masters/pending-approval`
    );
    return response.data;
  },

  getApprovalHistory: async (
    masterId: string
  ): Promise<ApprovalHistoryItemDto[]> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${masterId}/approval-history`
    );
    return response.data;
  },
};
