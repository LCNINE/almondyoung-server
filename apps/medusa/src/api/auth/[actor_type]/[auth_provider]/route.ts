import { AuthenticationInput, ConfigModule, IAuthModuleService } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils';
import { AuthenticatedMedusaRequest, MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { generateJwtTokenForAuthIdentity } from '../../../../utils/generate-jwt-token';
import { setAuthCookie } from '../../../../utils/set-auth-cookie';
import { jwtVerify } from '../../../../utils/jwt-verify';
import { registerCustomerWorkflow } from '../../../../workflows/auth/workflows/register-customer-workflow';
import { registerUserWorkflow } from '../../../../workflows/auth/workflows/register-user-workflow';

const normalizeRecord = (input: unknown): Record<string, string> | undefined => {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const record: Record<string, string> = {};

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      const first = value.find((item) => item !== undefined && item !== null);
      if (first === undefined) {
        continue;
      }
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

const extractUserServiceToken = (req: MedusaRequest | AuthenticatedMedusaRequest): string | undefined => {
  const authHeader = req.headers?.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }

  const cookies = req.headers?.cookie;
  if (cookies) {
    const tokenCookie = cookies.split(';').find((cookie) => cookie.trim().startsWith('accessToken='));
    if (tokenCookie) {
      return tokenCookie.split('=')[1];
    }
  }

  const token = (req.query as Record<string, unknown> | undefined)?.token;
  if (typeof token === 'string') {
    return token;
  }
  if (Array.isArray(token)) {
    return token.length ? String(token[0]) : undefined;
  }
  if (token !== undefined && token !== null) {
    return String(token);
  }

  return undefined;
};

const shouldAutoRegister = (error?: string) => typeof error === 'string' && error.toLowerCase().includes('not found');

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const { actor_type, auth_provider } = req.params;

    const config: ConfigModule = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE);

    const service: IAuthModuleService = req.scope.resolve(Modules.AUTH);

    const authData = buildAuthData(req);

    let { success, error, authIdentity, location } = await service.authenticate(auth_provider, authData);

    if (location) {
      return res.status(200).json({ location });
    }

    if (success && authIdentity) {
      const { http } = config.projectConfig;

      if (!http?.jwtSecret || (typeof http.jwtSecret === 'string' && http.jwtSecret.trim() === '')) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, 'JWT secret is not configured');
      }

      const token = generateJwtTokenForAuthIdentity(
        {
          authIdentity,
          actorType: actor_type,
        },
        {
          secret: http.jwtSecret,
          expiresIn: http.jwtExpiresIn,
          options: http.jwtOptions,
        },
      );

      // 쿠키 설정
      setAuthCookie(res, token);

      return res.status(200).json({
        token,
      });
    }

    if (shouldAutoRegister(error)) {
      const userServiceToken = extractUserServiceToken(req);

      if (!userServiceToken) {
        throw new MedusaError(MedusaError.Types.UNAUTHORIZED, error || 'Authentication failed');
      }

      if (!process.env.AUTH_SECRET) {
        throw new MedusaError(MedusaError.Types.UNAUTHORIZED, 'AUTH_SECRET is not defined');
      }

      const payload = jwtVerify(userServiceToken, process.env.AUTH_SECRET);
      const almondUserId = payload.sub;
      const almondLoginId = payload.login_id ?? '';
      const email = payload.email;

      const registerAuthData = {
        ...authData,
        body: {
          email,
          almond_user_id: almondUserId,
          almond_login_id: almondLoginId,
        },
      } as AuthenticationInput;

      try {
        if (actor_type === 'customer') {
          await registerCustomerWorkflow(req.scope).run({
            input: {
              authProvider: auth_provider,
              authData: registerAuthData,
              customerData: {
                email,
                first_name: '',
                last_name: '',
                metadata: {
                  almond_user_id: almondUserId,
                  almond_login_id: almondLoginId,
                },
              },
            },
          });
        } else {
          await registerUserWorkflow(req.scope).run({
            input: {
              authProvider: auth_provider,
              authData: registerAuthData,
              userData: {
                email,
                first_name: '',
                last_name: '',
              },
            },
          });
        }
      } catch (registerError: any) {
        const message = registerError?.message || '';
        if (!message.toLowerCase().includes('already exists')) {
          throw registerError;
        }
      }

      ({ success, error, authIdentity, location } = await service.authenticate(auth_provider, authData));

      if (location) {
        return res.status(200).json({ location });
      }

      if (success && authIdentity) {
        const { http } = config.projectConfig;

        if (!http?.jwtSecret || (typeof http.jwtSecret === 'string' && http.jwtSecret.trim() === '')) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, 'JWT secret is not configured');
        }

        const token = generateJwtTokenForAuthIdentity(
          {
            authIdentity,
            actorType: actor_type,
          },
          {
            secret: http.jwtSecret,
            expiresIn: http.jwtExpiresIn,
            options: http.jwtOptions,
          },
        );

        setAuthCookie(res, token);

        return res.status(200).json({
          token,
        });
      }
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
