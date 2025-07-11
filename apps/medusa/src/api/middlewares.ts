import {
  defineMiddlewares,
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from '@medusajs/framework/http';
import { USER_MODULE } from '../modules/user';
import type UserModuleService from '../modules/user/service';

export default defineMiddlewares({
  routes: [
    {
      matcher: '/store/cart*',
      middlewares: [
        async (
          req: MedusaRequest,
          res: MedusaResponse,
          next: MedusaNextFunction,
        ) => {
          try {
            const authHeader = req.headers.authorization;

            if (!authHeader?.startsWith('Bearer ')) {
              console.log('No Bearer token found');
              return next();
            }

            const token = authHeader.split(' ')[1];

            if (!token) {
              console.log('Token is empty');
              return next();
            }

            try {
              const userService =
                req.scope.resolve<UserModuleService>(USER_MODULE);

              const user = await userService.verifyToken(token);

              if (user) {
                req.user = {
                  customer_id: user.id,
                  userId: user.id,
                };
              }
            } catch (error) {
              console.error('Token verification failed:', error);
              return res.status(401).json({
                message: '토큰 검증에 실패했습니다.',
                error:
                  error instanceof Error
                    ? error.message
                    : '알 수 없는 오류가 발생했습니다.',
              });
            }

            return next();
          } catch (error) {
            console.error('Authentication error:', error);
            return res.status(500).json({
              message: '인증 처리 중 오류가 발생했습니다.',
              error:
                error instanceof Error
                  ? error.message
                  : '알 수 없는 오류가 발생했습니다.',
            });
          }
        },
      ],
    },
  ],
});
