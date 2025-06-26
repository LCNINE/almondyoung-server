import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserSchema } from 'apps/user-service/database/drizzle/schema';
import { FastifyRequest } from 'fastify';

export const CurrentUser = createParamDecorator(
  (data: unknown, context: ExecutionContext) => {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user: UserSchema }>();
    return request.user;
  },
);
