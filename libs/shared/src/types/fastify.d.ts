// fastify.d.ts
import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    file(): Promise<{
      filename: string;
      file: NodeJS.ReadableStream;
      mimetype: string;
      encoding: string;
      fields: Record<string, any>;
    }>;
  }
}
