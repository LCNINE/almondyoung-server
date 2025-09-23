import {
  createParamDecorator,
  ExecutionContext,
  UseInterceptors,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';

export const FastifyFile = createParamDecorator(
  async (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const file = await request.file();
    return file;
  },
);

export function FastifyFileInterceptor(fieldName: string) {
  return UseInterceptors();
}
