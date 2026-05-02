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
      { authIdentity, actorType },
      {
        secret: http.jwtSecret!,
        expiresIn: http.jwtExpiresIn,
        options: http.jwtOptions,
      },
    );

    setAuthCookie(res, token);
    return res.status(200).json({ token });
  }

  throw new MedusaError(MedusaError.Types.UNAUTHORIZED, error || 'Authentication failed');
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await GET(req, res);
};
