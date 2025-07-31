// apps/notification/src/provider/providers/email/resend-webhook.dto.ts
export interface ResendWebhookEvent {
    type: 'email.sent' | 'email.delivered' | 'email.delivery_delayed' |
    'email.bounced' | 'email.opened' | 'email.clicked' | 'email.complained';
    created_at: string;
    data: {
        id: string;
        from: string;
        to: string[];
        subject: string;
        created_at: string;
        tags?: Array<{
            name: string;
            value: string;
        }>;
        // Event specific data
        email_id?: string;
        bounce?: {
            type: string;
            message: string;
        };
        click?: {
            link: string;
            timestamp: string;
        };
    };
}