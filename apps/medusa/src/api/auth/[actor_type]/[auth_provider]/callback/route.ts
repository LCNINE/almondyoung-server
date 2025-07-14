import {
  AuthenticationInput,
  ConfigModule,
  IAuthModuleService,
} from '@medusajs/framework/types';
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from '@medusajs/framework/utils';
import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { generateJwtTokenForAuthIdentity } from '../../../../../utils/generate-jwt-token';

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { actor_type, auth_provider } = req.params;
  const { redirect_to = process.env.FRONTEND_URL, token } = req.query;

  const config: ConfigModule = req.scope.resolve(
    ContainerRegistrationKeys.CONFIG_MODULE,
  );

  const service: IAuthModuleService = req.scope.resolve(Modules.AUTH);

  const authData = {
    url: req.url,
    headers: req.headers,
    query: req.query,
    body: req.body,
    protocol: req.protocol,
  } as AuthenticationInput;

  const { success, error, authIdentity } = await service.authenticate(
    auth_provider,
    authData,
  );

  console.log('authIdentity detail:', JSON.stringify(authIdentity, null, 2));

  if (success && authIdentity) {
    const { http } = config.projectConfig;

    const token = generateJwtTokenForAuthIdentity(
      { authIdentity, actorType: actor_type },
      {
        secret: http.jwtSecret!,
        expiresIn: http.jwtExpiresIn,
        options: http.jwtOptions,
      },
    );

    console.log('token:', token);
    // 세션 쿠키 설정
    res.cookie('connect.sid', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000, // 15분
    });

    // 프론트엔드로 리다이렉트
    return res.redirect(`${redirect_to}`);
  }

  throw new MedusaError(
    MedusaError.Types.UNAUTHORIZED,
    error || 'Authentication failed',
  );
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await GET(req, res);
};
