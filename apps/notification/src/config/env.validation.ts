import { z } from 'zod';
import { createECDH } from 'crypto';

export const notificationEnvSchema = z
  .object({
    APP_STAGE: z.string().optional(),
    DEMO_CONSOLE_ENABLED: z.enum(['true', 'false']).optional(),
    EXTERNAL_INTEGRATIONS_MODE: z.enum(['real', 'mock']).optional(),
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
    // 알림톡·SMS 웹훅이 같은 값을 쓴다. 비어 있으면 프로덕션에서 서명 검증이 통과만 하고 경고가 남는다.
    NHN_WEBHOOK_SIGNATURE: z.string().optional(),
    // 인증문자가 단말에 도달하지 못했을 때 대신 보내는 알림톡 템플릿 코드. 카카오 심사를 통과한 뒤
    // 채워야 구제 경로가 동작한다 — 비어 있으면 실패를 감지해도 재발송하지 않고 경고만 남긴다.
    NHN_VERIFICATION_TEMPLATE_CODE: z.string().optional(),
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

    // Optional as a group. When configured, reject partial or mismatched VAPID keys before startup.
    WEB_PUSH_PUBLIC_KEY: z
      .string()
      .regex(/^[A-Za-z0-9_-]{87}$/)
      .optional(),
    WEB_PUSH_PRIVATE_KEY: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
    WEB_PUSH_SUBJECT: z
      .string()
      .refine((value) => {
        if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
          return true;
        }

        try {
          return new URL(value).protocol === 'https:';
        } catch {
          return false;
        }
      }, 'Use a mailto contact or HTTPS URL')
      .optional(),
    NOTIFICATION_INTERNAL_KEY: z.string().min(32).optional(),

    // Firebase Provider (Legacy Config)
    FIREBASE_SERVICE_ACCOUNT: z.string().optional(),

    // 서비스 간 통신
    USER_SERVICE_URL: z.string().url().optional(),
    USER_SERVICE_INTERNAL_TOKEN: z.string().optional(),
    USER_SERVICE_INTERNAL_KEY: z.string().optional(),
    // 알림톡 대상 «멤버십 회원만» 의 명단. 없으면 그 선택지만 막힌다.
    MEMBERSHIP_SERVICE_URL: z.string().url().optional(),
    MEMBERSHIP_INTERNAL_KEY: z.string().optional(),

    // SMS Gate(안드로이드 발송폰 중계). 계정이 없으면 폰 발송 디스패처가 돌지 않는다.
    SMS_GATE_BASE_URL: z.string().url().optional(),
    SMS_GATE_USERNAME: z.string().optional(),
    SMS_GATE_PASSWORD: z.string().optional(),
    SMS_GATE_WEBHOOK_SIGNING_KEY: z.string().optional(),
    STOREFRONT_URL: z.string().url().optional(),
    // 크롤러 data lake(canonical_places). 없으면 수신자 그룹의 Supabase 가져오기만 막힌다.
    SUPABASE_PLACES_URL: z.union([z.string().url(), z.literal('')]).optional(),
    SUPABASE_PLACES_SERVICE_KEY: z.string().optional(),
    GOOGLE_CHAT_WEBHOOK_URL: z.union([z.string().url(), z.literal('')]).optional(),

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
  })
  .superRefine((config, context) => {
    const { WEB_PUSH_PUBLIC_KEY: publicKey, WEB_PUSH_PRIVATE_KEY: privateKey, WEB_PUSH_SUBJECT: subject } = config;
    const count = [publicKey, privateKey, subject].filter(Boolean).length;

    if (count === 0) {
      return;
    }

    if (count !== 3) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_PUSH_PUBLIC_KEY'],
        message: 'Configure WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY and WEB_PUSH_SUBJECT together',
      });

      return;
    }

    try {
      const ecdh = createECDH('prime256v1');

      ecdh.setPrivateKey(Buffer.from(privateKey!, 'base64url'));

      if (ecdh.getPublicKey().toString('base64url') !== publicKey) {
        context.addIssue({
          code: 'custom',
          path: ['WEB_PUSH_PUBLIC_KEY'],
          message: 'VAPID public and private keys must belong to the same pair',
        });
      }
    } catch {
      context.addIssue({ code: 'custom', path: ['WEB_PUSH_PRIVATE_KEY'], message: 'Invalid VAPID private key' });
    }
  });

export type NotificationEnvConfig = z.infer<typeof notificationEnvSchema>;

export function validateNotificationEnv(config: Record<string, unknown>) {
  // Swagger 문서 생성 모드에서는 검증 스킵
  if (process.env.GENERATE_SWAGGER === 'true') {
    return config as NotificationEnvConfig;
  }

  if (config.APP_STAGE === 'demo' && config.EXTERNAL_INTEGRATIONS_MODE !== 'mock') {
    throw new Error('Demo notification requires EXTERNAL_INTEGRATIONS_MODE=mock');
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
