// apps/notification/src/provider/providers/email/resend-webhook.dto.ts
export interface ResendWebhookEvent {
  type:
    | 'email.sent'
    | 'email.delivered'
    | 'email.delivery_delayed'
    | 'email.complained'
    | 'email.bounced'
    | 'email.opened'
    | 'email.clicked'
    | 'email.failed';
  created_at: string;
  data: ResendWebhookData;
}

export interface ResendWebhookData {
  email_id: string;
  from: string;
  to: string[];
  subject: string;
  created_at: string;
  broadcast_id?: string;
  tags?: Record<string, string>;
  bounce?: {
    message: string;
    type: 'Permanent' | 'Temporary';
    subType: string;
  };
  click?: {
    ipAddress: string;
    link: string;
    timestamp: string;
    userAgent: string;
  };
}
