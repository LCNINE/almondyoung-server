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
import { setAuthCookie } from '../../../../../utils/set-auth-cookie';

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

    // 테스트용도임
    return res.status(200).json({ token });

    // 프론트엔드로 리다이렉트
    // return res.redirect(`${redirect_to}`);
  }

  throw new MedusaError(
    MedusaError.Types.UNAUTHORIZED,
    error || 'Authentication failed',
  );
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await GET(req, res);
};
