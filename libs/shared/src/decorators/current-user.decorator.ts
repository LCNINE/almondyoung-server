import { JwtPayload } from '@app/authorization';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

export const CurrentUser = createParamDecorator((data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<FastifyRequest & { user: JwtPayload }>();

  return request.user;
});
