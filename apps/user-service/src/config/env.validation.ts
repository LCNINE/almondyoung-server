import { z } from 'zod';

// PEM 은 multiline 이라 ECS env 등 일부 transport 에서 newline 이 손상되기 쉽다.
// 안전하게 받기 위해 세 가지 입력을 모두 허용한다:
//   1) 진짜 newline 을 포함한 PEM (로컬 .env / sst secret set < file 등)
//   2) `\n` literal 로 escape 된 PEM (단일 줄 .env)
//   3) base64-encoded PEM (newline-free 이라 transport 안전. 권장 방식)
const pemString = z
  .string()
  .min(1)
  .transform((s) => {
    if (s.includes('-----BEGIN')) {
      // 1) or 2): literal `\n` 만 진짜 newline 으로 복원.
      return s.replace(/\\n/g, '\n');
    }
    // 3): base64. 디코드 후 BEGIN 이 보이면 PEM 으로 인정.
    try {
      const decoded = Buffer.from(s, 'base64').toString('utf-8');
      if (decoded.includes('-----BEGIN')) return decoded;
    } catch {
      // fallthrough — refine 에서 fail.
    }
    return s;
  })
  .refine((s) => s.includes('-----BEGIN'), { message: 'must be a PEM-encoded key (raw or base64)' });

export const userServiceEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  USER_SERVICE_PORT: z.string().regex(/^\d+$/).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),

  // CORS Configuration
  CORS_ORIGIN_DOMAIN: z.string().optional(),
  CORS_ORIGIN_DOMAINS: z.string().optional(),
  COOKIE_DOMAIN: z.string().optional(),

  // JWT Configuration
  AUTH_SECRET: z.string(),
  JWT_VERIFICATION_TOKEN_SECRET: z.string(),
  JWT_ACCESS_TOKEN_EXPIRATION: z.string().optional(),
  JWT_REFRESH_SECRET: z.string(),

  // Social Login - Kakao (optional: disabled when not set)
  KAKAO_CLIENT_ID: z.string().optional(),
  KAKAO_CLIENT_SECRET: z.string().optional(),
  KAKAO_CALLBACK_URL: z.string().url().optional(),

  // AWS S3 Configuration
  // Access keys are optional — when omitted, AWS SDK falls back to the default
  // credential provider chain (ECS task role on Fargate).
  AWS_REGION: z.string(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET: z.string(),

  // 국세청 사업자등록정보 상태조회 (data.go.kr). 없으면 조회는 lookup_failed 로 처리되고 등록은 계속 가능.
  DATA_GO_KR_SERVICE_KEY: z.string().optional(),

  // Cafe24 Link (optional: disabled when not set)
  CAFE24_SERVICE_KEY: z.string().optional(),
  CAFE24_API_VERSION: z.string().optional(),

  // Cafe24 OAuth (optional: disabled when not set)
  CAFE24_CLIENT_ID: z.string().optional(),
  CAFE24_CLIENT_SECRET: z.string().optional(),
  CAFE24_TOKEN_URL: z.string().url().optional(),

  // OAuth IdP (Authorization Code + PKCE for cross-domain SSO)
  // 클라이언트 등록 정보(clientId/secret/redirectUris/scopes)는 oauth_clients 테이블이 SoT.
  // Shared secret for auth-web → user-service /oauth/internal/issue-code
  OAUTH_INTERNAL_SECRET: z.string().optional(),

  // OAuth access token signing (RS256). Internal user-service tokens still use AUTH_SECRET (HS256).
  OAUTH_JWT_PRIVATE_KEY: pemString,
  OAUTH_JWT_PUBLIC_KEY: pemString,
  OAUTH_JWT_KID: z.string().min(1),
  OAUTH_ISSUER_URL: z.string().url(),

  // auth-web origin — OIDC discovery 의 authorization_endpoint 광고에 사용.
  // user-service 자체에는 /oauth/authorize 엔드포인트가 없고 auth-web 이 호스팅한다.
  AUTH_WEB_ORIGIN: z.string().url(),
});

export type UserServiceEnvConfig = z.infer<typeof userServiceEnvSchema>;

export function validateUserServiceEnv(config: Record<string, unknown>) {
  const parsed = userServiceEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [User Service] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[User Service] Invalid environment variables');
  }

  return parsed.data;
}
