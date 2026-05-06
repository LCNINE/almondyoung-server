import { z } from 'zod';

export const notificationEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  PORT: z.string().regex(/^\d+$/).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  ALLOWED_ORIGINS: z.string().optional(),

  // Redis Configuration
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.string().regex(/^\d+$/).optional(),
  REDIS_PASSWORD: z.string().optional(),

  // Email Provider - Resend
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().email().optional(),
  RESEND_FROM_NAME: z.string().optional(),
  RESEND_BASE_URL: z.string().url().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),

  // Email Provider - SendGrid (Legacy)
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM_EMAIL: z.string().email().optional(),
  SENDGRID_FROM_NAME: z.string().optional(),

  // SMS Provider - Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  TWILIO_STATUS_CALLBACK_URL: z.string().url().optional(),

  // Kakao/Alimtalk Provider - NHN Cloud
  NHN_API_URL: z.string().url().optional(),
  NHN_APP_KEY: z.string().optional(),
  NHN_SECRET_KEY: z.string().optional(),
  NHN_SENDER_KEY: z.string().optional(),
  NHN_PLUS_FRIEND_ID: z.string().optional(),
  NHN_SMS_APP_KEY: z.string().optional(),
  NHN_WEBHOOK_SIGNATURE: z.string().optional(), // NHN KakaoTalk 웹훅 서명
  DEFAULT_SMS_NUMBER: z.string().optional(),

  // Kakao Provider (Legacy Config)
  KAKAO_API_KEY: z.string().optional(),
  KAKAO_SENDER_KEY: z.string().optional(),
  KAKAO_PLUS_FRIEND_ID: z.string().optional(),

  // Push Notification - Firebase FCM
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
  FIREBASE_CLIENT_ID: z.string().optional(),

  // Firebase Provider (Legacy Config)
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),

  // 서비스 간 통신
  USER_SERVICE_URL: z.string().url().optional(),
  USER_SERVICE_INTERNAL_TOKEN: z.string().optional(),

  // FCM 토큰 등록 엔드포인트 JWT 검증용 (user-service와 동일한 AUTH_SECRET)
  JWT_ACCESS_SECRET: z.string().optional(),
});

export type NotificationEnvConfig = z.infer<typeof notificationEnvSchema>;

export function validateNotificationEnv(config: Record<string, unknown>) {
  // Swagger 문서 생성 모드에서는 검증 스킵
  if (process.env.GENERATE_SWAGGER === 'true') {
    return config as NotificationEnvConfig;
  }

  const parsed = notificationEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [Notification] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[Notification] Invalid environment variables');
  }

  return parsed.data;
}
