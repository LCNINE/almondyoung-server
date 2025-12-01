import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { FastifyRequest } from 'fastify';

/**
 * @description
 * VAP-FIX: Changed by Gemini
 * This interceptor solves the "Maximum call stack size exceeded" (RangeError)
 * that occurs when using NestJS's ValidationPipe with Fastify's multipart file uploads.
 *
 * It intercepts multipart/form-data requests *before* the ValidationPipe runs.
 * It manually processes the multipart stream, extracts all fields and the file,
 * and attaches them to the `request.body`. This presents a stable, parsed object
 * to the ValidationPipe, preventing the crash.
 */
@Injectable()
export class FileTransformInterceptor implements NestInterceptor {
  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    if (!request.isMultipart()) {
      // If not a multipart request, do nothing.
      return next.handle();
    }

    const body = {};
    const files = [];

    try {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.file) {
          // It's a file part
          // To keep memory usage low, we pass the stream object itself.
          // The service layer will be responsible for processing the stream.
          files.push(part);
        } else {
          // It's a field part
          body[part.fieldname] = (part as any).value;
        }
      }
    } catch (error) {
      // This can happen if the client aborts the request, etc.
      throw new BadRequestException(`Failed to process multipart form: ${error.message}`);
    }

    // --- Critical Step ---
    // Manually parse metadata if it's a JSON string
    if (body['metadata'] && typeof body['metadata'] === 'string') {
      try {
        body['metadata'] = JSON.parse(body['metadata']);
      } catch {
        throw new BadRequestException('Invalid metadata format. Must be a valid JSON string.');
      }
    }

    // Attach the parsed body and the file parts to the request body
    // This allows `@Body()` and `ValidationPipe` to work correctly.
    // For single file upload, we expect one file. For batch, multiple.
    request.body = { ...body, files };

    return next.handle();
  }
}
