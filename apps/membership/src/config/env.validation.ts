import { z } from 'zod';

export const membershipEnvSchema = z
  .object({
    // Database
    DATABASE_URL: z.string().url(),
    PORT: z.string().regex(/^\d+$/).optional(),
    NODE_ENV: z.enum(['development', 'production', 'test']).optional(),

    // Payment Service Integration
    PAYMENT_SERVER_URL: z.string().url().optional(),
    WALLET_API_URL: z.string().url().optional(),
    WALLET_API_KEY: z.string().min(1).optional(),
    // 서버 간(internal) 라우트 인증 키 (channel-adapter/medusa → membership)
    MEMBERSHIP_INTERNAL_KEY: z.string().min(1).optional(),
    // 갱신 사전 고지 크론이 수신자 이메일을 얻는 경로 (membership → user-service internal).
    USER_SERVICE_URL: z.string().url().optional(),
    USER_SERVICE_INTERNAL_KEY: z.string().min(1).optional(),
    // 'true' 면 신규 정기 가입이 인보이스(선적용) 경로를 탄다(기존 계약은 billing_path 고정).
    MEMBERSHIP_INVOICE_BILLING_ENABLED: z.enum(['true', 'false']).optional(),
    // 'true' 면 약관 동의 기록 없이 들어온 가입을 거절한다. 스토어프론트가 동의를 보내기 시작한 뒤에 켠다.
    MEMBERSHIP_TERMS_AGREEMENT_REQUIRED: z.enum(['true', 'false']).optional(),
    // 새 약관의 미납 요금 조항을 «기존» 계약에도 적용하기 시작하는 시각(ISO). 비우면 새 약관 동의 계약에만.
    // 이용약관 제3조 제6항(개정약관은 개정 후 체결 계약에만)과 부딪혀 법무 검토 없이 설정하지 않는다.
    MEMBERSHIP_TERMS_EXISTING_MEMBERS_EFFECTIVE_AT: z.string().optional(),
    // Auth — dual-mode: AUTH_SECRET (HS256 legacy) 또는 OIDC_ISSUER_URL (RS256/OIDC), 둘 중 하나 필수.
    AUTH_SECRET: z.string().min(1).optional(),
    OIDC_ISSUER_URL: z.string().url().optional(),
    ALLOWED_AUDIENCES: z.string().optional(),
    JWT_ISSUER: z.string().optional(),
  })
  .refine((data) => !!data.AUTH_SECRET || !!data.OIDC_ISSUER_URL, {
    message: 'Either AUTH_SECRET (HS256) or OIDC_ISSUER_URL (RS256) must be set',
    path: ['AUTH_SECRET'],
  })
  // reconciliation 크론이 wallet 권위 조회에 의존하므로, 운영에서 누락되면 조용히 죽는 대신 부팅을 막는다.
  .refine((data) => data.NODE_ENV !== 'production' || (!!data.WALLET_API_URL && !!data.WALLET_API_KEY), {
    message: 'WALLET_API_URL and WALLET_API_KEY are required in production',
    path: ['WALLET_API_URL'],
  })
  .refine((data) => data.NODE_ENV !== 'production' || !!data.MEMBERSHIP_INTERNAL_KEY, {
    message: 'MEMBERSHIP_INTERNAL_KEY is required in production',
    path: ['MEMBERSHIP_INTERNAL_KEY'],
  })
  // 갱신 사전 고지는 법정 고지라 조용히 안 나가면 안 된다 — 설정 누락은 부팅에서 잡는다.
  .refine((data) => data.NODE_ENV !== 'production' || (!!data.USER_SERVICE_URL && !!data.USER_SERVICE_INTERNAL_KEY), {
    message: 'USER_SERVICE_URL and USER_SERVICE_INTERNAL_KEY are required in production',
    path: ['USER_SERVICE_URL'],
  });

export type MembershipEnvConfig = z.infer<typeof membershipEnvSchema>;

export function validateMembershipEnv(config: Record<string, unknown>) {
  // 디버깅: 실제 환경 변수 확인
  console.log('🔍 [Membership] Environment variables check:');
  console.log('  - DATABASE_URL:', config.DATABASE_URL ? '✅ exists' : '❌ missing');
  console.log('  - AUTH_SECRET:', config.AUTH_SECRET ? '✅ exists' : '❌ missing');
  console.log('  - JWT_ISSUER:', config.JWT_ISSUER ? '✅ exists' : '❌ missing');
  console.log(
    '  - All env keys:',
    Object.keys(config).filter((k) => k.includes('AUTH') || k.includes('JWT')),
  );

  const parsed = membershipEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [Membership] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[Membership] Invalid environment variables');
  }

  return parsed.data;
}
