import { AuthenticationInput, ConfigModule, IAuthModuleService } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils';
import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { generateJwtTokenForAuthIdentity } from '../../../../../utils/generate-jwt-token';
import { setAuthCookie } from '../../../../../utils/set-auth-cookie';
import { jwtVerify } from '../../../../../utils/jwt-verify';
import { registerCustomerWorkflow } from '../../../../../workflows/auth/workflows/register-customer-workflow';
import { registerUserWorkflow } from '../../../../../workflows/auth/workflows/register-user-workflow';

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

const buildAuthData = (req: MedusaRequest): AuthenticationInput => ({
  url: req.url,
  headers: normalizeRecord(req.headers),
  query: normalizeRecord(req.query),
  body: normalizeRecord(req.body),
  protocol: req.protocol,
});

const extractUserServiceToken = (req: MedusaRequest): string | undefined => {
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

// 구글(Google) 같은 서드파티(Third-Party) 인증 서비스에서 인증이 끝난 후,
// 해당 서비스가 사용자를 다시 프론트엔드(스토어프론트)로 리디렉션할 때 전달받은 쿼리 파라미터(예: code, state 등)를
// Medusa 백엔드에 전달해서 인증을 최종적으로 검증(Validate)하는 API입니다.

// 하지만 우리는 이 API를 user-service와의 통합을 위해 커스터마이즈해서 사용합니다:
// 1. user-service에서 먼저 인증 (비밀번호 검증)
// 2. user-service가 발급한 토큰을 이 API로 전달
// 3. 해당 토큰을 검증하고 Medusa 인증 토큰 발급
//
// 이렇게 하는 이유:
// - 비밀번호는 user-service에서만 관리 (보안상 분리)
// - Medusa는 사용자 정보만 동기화하고 비밀번호는 저장하지 않음
// - user-service를 신뢰할 수 있는 인증 제공자(auth provider)로 취급
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { actor_type, auth_provider } = req.params;
  const { redirect_to = process.env.FRONTEND_URL } = req.query;

  const config: ConfigModule = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE);

  const service: IAuthModuleService = req.scope.resolve(Modules.AUTH);

  const authData = buildAuthData(req);

  let { success, error, authIdentity } = await service.authenticate(auth_provider, authData);

  if (success && authIdentity) {
    const actorType = authIdentity?.app_metadata?.actor_type || actor_type;

    const { http } = config.projectConfig;

    const token = generateJwtTokenForAuthIdentity(
      { authIdentity, actorType: actorType as string },
      {
        secret: http.jwtSecret!,
        expiresIn: http.jwtExpiresIn,
        options: http.jwtOptions,
      },
    );

    // 쿠키 설정
    setAuthCookie(res, token);

    return res.status(200).json({ token });
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

    ({ success, error, authIdentity } = await service.authenticate(auth_provider, authData));

    if (success && authIdentity) {
      const actorType = authIdentity?.app_metadata?.actor_type || actor_type;
      const { http } = config.projectConfig;

      const token = generateJwtTokenForAuthIdentity(
        { authIdentity, actorType: actorType as string },
        {
          secret: http.jwtSecret!,
          expiresIn: http.jwtExpiresIn,
          options: http.jwtOptions,
        },
      );

      setAuthCookie(res, token);

      return res.status(200).json({ token });
    }
  }

  throw new MedusaError(MedusaError.Types.UNAUTHORIZED, error || 'Authentication failed');
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await GET(req, res);
};
