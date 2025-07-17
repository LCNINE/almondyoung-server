import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

export const Files = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Record<string, any[]> | null => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    return (req as any).storedFiles || null;
  },
);
