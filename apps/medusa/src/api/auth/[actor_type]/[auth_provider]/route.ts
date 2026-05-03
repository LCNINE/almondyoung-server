import { AuthenticationInput, ConfigModule, IAuthModuleService } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils';
import { AuthenticatedMedusaRequest, MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { generateJwtTokenForAuthIdentity } from '../../../../utils/generate-jwt-token';
import { setAuthCookie } from '../../../../utils/set-auth-cookie';

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

const buildAuthData = (req: MedusaRequest | AuthenticatedMedusaRequest): AuthenticationInput => ({
  url: req.url,
  headers: normalizeRecord(req.headers),
  query: normalizeRecord(req.query),
  body: normalizeRecord(req.body),
  protocol: req.protocol,
});

// 인증 시작점.
// - user-service-sso: authorize URL 을 location 으로 반환 → storefront 가 redirect.
// - emailpass / my-auth: 자격증명 검증 후 medusa JWT 발급.
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const { actor_type, auth_provider } = req.params;
    const config: ConfigModule = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE);
    const service: IAuthModuleService = req.scope.resolve(Modules.AUTH);
    const authData = buildAuthData(req);

    const { success, error, authIdentity, location } = await service.authenticate(auth_provider, authData);

    if (location) {
      return res.status(200).json({ location });
    }

    if (success && authIdentity) {
      const { http } = config.projectConfig;

      if (!http?.jwtSecret || (typeof http.jwtSecret === 'string' && http.jwtSecret.trim() === '')) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, 'JWT secret is not configured');
      }

      const token = generateJwtTokenForAuthIdentity(
        { authIdentity, actorType: actor_type, authProvider: auth_provider },
        {
          secret: http.jwtSecret,
          expiresIn: http.jwtExpiresIn,
          options: http.jwtOptions,
        },
      );

      setAuthCookie(res, token);
      return res.status(200).json({ token });
    }

    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, error || 'Authentication failed');
  } catch (error) {
    console.error(`/auth/[actor_type]/[auth_provider] 에러`, error);
    if (error instanceof MedusaError) {
      return res.status(error.type === MedusaError.Types.UNAUTHORIZED ? 401 : 500).json({
        error: error.message,
        type: error.type,
      });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  await GET(req, res);
};
