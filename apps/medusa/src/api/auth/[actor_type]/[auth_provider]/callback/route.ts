import { ConfigModule, IAuthModuleService, AuthenticationInput } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils';
import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { generateJwtTokenForAuthIdentity } from '../../../../../utils/generate-jwt-token';
import { setAuthCookie } from '../../../../../utils/set-auth-cookie';

const normalizeRecord = (input: unknown): Record<string, string> | undefined => {
  if (!input || typeof input !== 'object') return undefined;
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const first = value.find((item) => item !== undefined && item !== null);
      if (first === undefined) continue;
      record[key] = String(first);
      continue;
    }
    if (typeof value === 'object') {
      record[key] = JSON.stringify(value);
      continue;
    }
    record[key] = String(value);
  }
  return Object.keys(record).length ? record : undefined;
};

const buildAuthData = (req: MedusaRequest): AuthenticationInput => ({
  url: req.url,
  headers: normalizeRecord(req.headers),
  query: normalizeRecord(req.query),
  body: normalizeRecord(req.body),
  protocol: req.protocol,
});

// OIDC redirect 콜백 — user-service-sso 등 redirect 기반 프로바이더의 callback 검증.
// 다른 프로바이더(emailpass 등)는 callback 단계가 없으므로 바로 authenticate 로 폴백한다.
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { actor_type, auth_provider } = req.params;
  const config: ConfigModule = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE);
  const service: IAuthModuleService = req.scope.resolve(Modules.AUTH);
  const authData = buildAuthData(req);

  const { success, error, authIdentity } =
    auth_provider === 'user-service-sso'
      ? await service.validateCallback(auth_provider, authData)
      : await service.authenticate(auth_provider, authData);

  if (success && authIdentity) {
    const actorType = (authIdentity?.app_metadata?.actor_type as string) || actor_type;
    const { http } = config.projectConfig;

    const token = generateJwtTokenForAuthIdentity(
      { authIdentity, actorType, authProvider: auth_provider },
      {
        secret: http.jwtSecret!,
        expiresIn: http.jwtExpiresIn,
        options: http.jwtOptions,
      },
    );

    setAuthCookie(res, token);

    // user-service-sso: storefront 가 단일 OIDC exchange 로 medusa JWT 와 user-service IdP 토큰을
    // 동시에 받을 수 있도록 provider_metadata 에 보관된 access/refresh 를 응답에 함께 노출한다.
    // 두 토큰 라이프사이클을 같은 origin (이 콜백 응답) 에 묶기 위함.
    if (auth_provider === 'user-service-sso') {
      // AuthIdentityDTO 는 provider_identities[].provider_metadata 에 우리가 update 한 값을 보관한다.
      const providerIdentity =
        authIdentity?.provider_identities?.find((pi) => pi.provider === 'user-service-sso') ??
        authIdentity?.provider_identities?.[0];
      const meta = (providerIdentity?.provider_metadata ?? {}) as Record<string, unknown>;
      const access_token = typeof meta.access_token === 'string' ? meta.access_token : undefined;
      const refresh_token = typeof meta.refresh_token === 'string' ? meta.refresh_token : undefined;
      const expires_at = typeof meta.access_token_expires_at === 'number' ? meta.access_token_expires_at : undefined;
      if (access_token && refresh_token) {
        return res.status(200).json({
          token,
          idp_tokens: {
            access_token,
            refresh_token,
            ...(expires_at ? { expires_at } : {}),
          },
        });
      }
    }

    return res.status(200).json({ token });
  }

  throw new MedusaError(MedusaError.Types.UNAUTHORIZED, error || 'Authentication failed');
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await GET(req, res);
};
