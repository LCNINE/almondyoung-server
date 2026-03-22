import 'fastify';
import { JwtPayload } from '@app/authorization';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}
