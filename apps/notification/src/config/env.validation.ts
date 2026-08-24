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

  // Kakao/Alimtalk Provider - NHN Cloud
  NHN_API_URL: z.string().url().optional(),
  NHN_APP_KEY: z.string().optional(),
  NHN_SECRET_KEY: z.string().optional(),
  NHN_SENDER_KEY: z.string().optional(),
  NHN_PLUS_FRIEND_ID: z.string().optional(),
  NHN_SMS_APP_KEY: z.string().optional(),
  // NHN Cloud SMS(알림톡과 별개 상품이라 앱키·시크릿이 따로다). 셋이 다 있어야 SMS 프로바이더가
  // 등록되고, 비어 있으면 SMS 채널이 비어 발송이 503 으로 멈춘다.
  NHN_SMS_SECRET_KEY: z.string().optional(),
  NHN_SMS_SEND_NO: z.string().optional(),
  NHN_SMS_API_URL: z.string().url().optional(),
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

  // 전역 JwtAuthGuard/AdminRealmGuard 용. core 등 다른 서비스와 같은 dual-mode:
  //   - HS256 legacy: AUTH_SECRET
  //   - RS256/OIDC:   OIDC_ISSUER_URL
  // 여기서 둘 다 optional 인 이유는 AuthorizationModule 의 AUTH_CONFIG 팩토리가 "둘 중 하나는
  // 필수" 를 이미 강제하며 부팅을 세우기 때문이다. 검증을 두 곳에 두지 않는다.
  AUTH_SECRET: z.string().min(1).optional(),
  OIDC_ISSUER_URL: z.string().url().optional(),
  ALLOWED_AUDIENCES: z.string().optional(),
  JWT_ISSUER: z.string().optional(),
  JWT_AUDIENCE: z.string().optional(),
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
