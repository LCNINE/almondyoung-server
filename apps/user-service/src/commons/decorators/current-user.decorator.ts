import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from 'apps/user-service/database/drizzle/schema';
import { FastifyRequest } from 'fastify';

export const CurrentUser = createParamDecorator(
  (data: unknown, context: ExecutionContext) => {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user: User }>();

    return request.user;
  },
);
