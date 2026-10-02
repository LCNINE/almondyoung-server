'use client';

import { NOTIFICATION_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';

/** TSC01 요청 · TSC02 검수 중 · TSC03 승인 · TSC04 반려 */
export type AlimtalkTemplateStatus = 'TSC01' | 'TSC02' | 'TSC03' | 'TSC04';

export interface AlimtalkButton {
  ordering: number;
  type: string;
  name: string;
  linkMo?: string | null;
  linkPc?: string | null;
}

export interface AlimtalkTemplateComment {
  id: number;
  content: string;
  userName: string | null;
  createdAt: string;
  /** INQ 문의 · APR 승인 · REJ 반려 · REP 답변 · REQ 검수 중 */
  status: string;
}

export interface AlimtalkTemplate {
  templateCode: string;
  templateName: string;
  templateContent: string;
  categoryCode: string | null;
  buttons: AlimtalkButton[];
  comments: AlimtalkTemplateComment[];
  status: AlimtalkTemplateStatus;
  statusName: string;
  createDate: string | null;
  updateDate: string | null;
  variables: string[];
  linkedEvents: { eventKey: string; name: string; isActive: boolean }[];
}

export interface AlimtalkCategory {
  code: string;
  name: string;
  groupName: string;
  inclusion: string | null;
  exclusion: string | null;
}

export interface AlimtalkButtonInput {
  name: string;
  linkMo: string;
  linkPc?: string;
}

export interface AlimtalkTemplateInput {
  templateName: string;
  templateContent: string;
  categoryCode: string;
  buttons: AlimtalkButtonInput[];
}

/** 사건이 생겨 자동으로 나간 알림톡 한 건 (관리자 캠페인과 별개) */
export interface AlimtalkAutoSend {
  notificationId: string;
  eventKey: string | null;
  eventName: string | null;
  templateCode: string | null;
  recipientName: string;
  phone: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
  scheduledFor: string | null;
  requestId: string | null;
  error: string | null;
}

export interface AlimtalkAutoSendPage {
  items: AlimtalkAutoSend[];
  nextBefore: string | null;
}

export interface AlimtalkAutoSendResult {
  notificationId: string;
  outcome: 'kakao' | 'sms' | 'failed' | 'inProgress' | 'NOT_ACCEPTED';
  detail: string | null;
}

/** 멤버십 요금 안내 한 건의 발송 기록(우리 쪽 접수 상태). 카카오 도착 여부는 getAutoSendResult 로 따로 묻는다 */
export interface MembershipNoticeStatus {
  /** 'attempt:<invoiceId>:<회차>' | 'terminated:<contractId>' */
  ref: string;
  found: boolean;
  notificationId: string | null;
  status: string | null;
  sentAt: string | null;
  scheduledFor: string | null;
  error: string | null;
}

export interface MembershipNoticeLookup {
  attempts: Array<{ invoiceId: string; attemptNo: number }>;
  terminations: Array<{ contractId: string }>;
}

export type AlimtalkMemberAudience = 'NONE' | 'ALL' | 'MEMBERSHIP' | 'ARREARS';

export type AlimtalkVariableBinding =
  | { name: string; source: 'RECIPIENT_NAME' }
  | { name: string; source: 'FIXED'; value: string };

export interface AlimtalkCampaignTarget {
  templateCode: string;
  members: AlimtalkMemberAudience;
  groupIds: string[];
  manual: { phone: string; name?: string }[];
  variables: AlimtalkVariableBinding[];
}

export interface CreateAlimtalkCampaignDto extends AlimtalkCampaignTarget {
  campaignId: string;
  name: string;
  sendAt?: string;
  confirmInformational: true;
}

export interface AlimtalkCampaignPreview {
  templateCode: string;
  templateName: string;
  recipients: number;
  invalid: number;
  duplicates: number;
  missingVariables: string[];
  sample: { name: string; body: string } | null;
  batches: number;
}

export interface AlimtalkRecipientGroup {
  id: string;
  name: string;
  source: string | null;
  recipients: number;
  allowed: boolean;
}

export type AlimtalkCampaignState =
  | 'SCHEDULED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'CANCELLED';

export interface AlimtalkCampaign {
  campaignId: string;
  name: string;
  templateCode: string;
  templateName: string;
  sendAt: string | null;
  state: AlimtalkCampaignState;
  createdByName: string | null;
  createdAt: string;
  counts: {
    total: number;
    pending: number;
    accepted: number;
    failed: number;
    cancelled: number;
  };
}

export interface AlimtalkCampaignResults {
  checkedAt: string;
  kakao: number;
  sms: number;
  failed: number;
  inProgress: number;
  unknown: number;
  notAccepted: { message: string; count: number }[];
  failures: { name: string; phone: string; reason: string }[];
}

const BASE = `${NOTIFICATION_SERVICE_BASE_URL}/alimtalk`;

export const alimtalkApi = {
  getTemplates: async (): Promise<AlimtalkTemplate[]> => {
    const response = await client.get<AlimtalkTemplate[]>(`${BASE}/templates`);
    return response.data;
  },

  getCategories: async (): Promise<AlimtalkCategory[]> => {
    const response = await client.get<AlimtalkCategory[]>(
      `${BASE}/templates/categories`
    );
    return response.data;
  },

  createTemplate: async (
    templateCode: string,
    values: AlimtalkTemplateInput
  ): Promise<AlimtalkTemplate> => {
    const response = await client.post<AlimtalkTemplate>(`${BASE}/templates`, {
      templateCode,
      ...values,
    });
    return response.data;
  },

  updateTemplate: async (
    templateCode: string,
    values: AlimtalkTemplateInput & { acknowledgeReReview?: boolean }
  ): Promise<AlimtalkTemplate> => {
    const response = await client.put<AlimtalkTemplate>(
      `${BASE}/templates/${encodeURIComponent(templateCode)}`,
      values
    );
    return response.data;
  },

  addComment: async (
    templateCode: string,
    comment: string
  ): Promise<AlimtalkTemplate> => {
    const response = await client.post<AlimtalkTemplate>(
      `${BASE}/templates/${encodeURIComponent(templateCode)}/comments`,
      { comment }
    );
    return response.data;
  },

  testSend: async (
    templateCode: string,
    variables: { name: string; value: string }[]
  ): Promise<{ sentTo: string; requestId: string }> => {
    const response = await client.post<{ sentTo: string; requestId: string }>(
      `${BASE}/templates/${encodeURIComponent(templateCode)}/test-send`,
      { variables }
    );
    return response.data;
  },

  getRecipientGroups: async (): Promise<AlimtalkRecipientGroup[]> => {
    const response = await client.get<AlimtalkRecipientGroup[]>(
      `${BASE}/campaigns/recipient-groups`
    );
    return response.data;
  },

  previewCampaign: async (
    dto: AlimtalkCampaignTarget
  ): Promise<AlimtalkCampaignPreview> => {
    const response = await client.post<AlimtalkCampaignPreview>(
      `${BASE}/campaigns/preview`,
      dto
    );
    return response.data;
  },

  createCampaign: async (
    dto: CreateAlimtalkCampaignDto
  ): Promise<{ campaignId: string; recipients: number; created: boolean }> => {
    const response = await client.post<{
      campaignId: string;
      recipients: number;
      created: boolean;
    }>(`${BASE}/campaigns`, dto);
    return response.data;
  },

  getCampaigns: async (): Promise<AlimtalkCampaign[]> => {
    const response = await client.get<AlimtalkCampaign[]>(`${BASE}/campaigns`);
    return response.data;
  },

  getAutoSends: async (before?: string): Promise<AlimtalkAutoSendPage> => {
    const response = await client.get<AlimtalkAutoSendPage>(
      `${BASE}/auto-sends`,
      {
        params: before ? { before } : {},
      }
    );
    return response.data;
  },

  lookupMembershipNotices: async (
    refs: MembershipNoticeLookup
  ): Promise<MembershipNoticeStatus[]> => {
    const response = await client.post<MembershipNoticeStatus[]>(
      `${BASE}/auto-sends/membership-notices/lookup`,
      refs
    );
    return response.data;
  },

  getAutoSendResult: async (
    notificationId: string
  ): Promise<AlimtalkAutoSendResult> => {
    const response = await client.get<AlimtalkAutoSendResult>(
      `${BASE}/auto-sends/${notificationId}/result`
    );
    return response.data;
  },

  getCampaignResults: async (
    campaignId: string
  ): Promise<AlimtalkCampaignResults> => {
    const response = await client.get<AlimtalkCampaignResults>(
      `${BASE}/campaigns/${campaignId}/results`
    );
    return response.data;
  },

  stopCampaign: async (campaignId: string): Promise<{ cancelled: number }> => {
    const response = await client.post<{ cancelled: number }>(
      `${BASE}/campaigns/${campaignId}/stop`
    );
    return response.data;
  },
};
