import 'fastify';
import { JwtPayload } from '@app/roles';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}
