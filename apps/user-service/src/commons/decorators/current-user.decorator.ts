import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from 'apps/user-service/database/drizzle/schema';
import { FastifyRequest } from 'fastify';
import { JwtPayload } from '@app/roles';

export const CurrentUser = createParamDecorator(
  (data: unknown, context: ExecutionContext) => {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user: JwtPayload }>();
    console.log('request.user:', request.user);
    return request.user;
  },
);
