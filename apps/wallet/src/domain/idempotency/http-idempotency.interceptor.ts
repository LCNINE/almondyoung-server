import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { IdempotencyService } from './idempotency.service';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 응답은 replay 를 위해 그대로 보관되므로, 보관해서는 안 될 값이 섞인 자리는 지우고 넣는다.
 * 실시간 계좌조회는 예금주 실명을 돌려준다 — 조회 결과를 우리 DB 에 남기지 않는다는 게
 * 이 API 의 전제다.
 */
const REDACTED_RESPONSE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'POST /v1/billing-methods/cms/check-account': ['payerName'],
};

function redactForStorage(operation: string, body: unknown): unknown {
  const fields = REDACTED_RESPONSE_FIELDS[operation];
  if (!fields || body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const copy: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const field of fields) {
    if (field in copy) copy[field] = null;
  }
  return copy;
}

@Injectable()
export class HttpIdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotencyService: IdempotencyService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType<'http'>() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest & { user?: Record<string, unknown> }>();
    const reply = http.getResponse<FastifyReply>();

    const method = request.method.toUpperCase();
    if (!WRITE_METHODS.has(method)) {
      return next.handle();
    }

    const requestPath = normalizeRequestPath(request.url);
    if (requestPath.startsWith('/v1/webhooks/')) {
      return next.handle();
    }

    const idempotencyKey = readHeaderValue(request, 'idempotency-key');
    if (!idempotencyKey) {
      throw new BadRequestException({
        error: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key header is required for write APIs',
      });
    }

    const actorId = resolveActorId(request);
    const operation = `${method} ${requestPath}`;
    const decision = await this.idempotencyService.beginHttpRequest({
      idempotencyKey,
      operation,
      actorId,
      requestMethod: method,
      requestPath,
      requestBody: request.body ?? null,
    });

    if (decision.kind === 'REPLAY') {
      reply.code(decision.responseCode);
      return of(decision.responseBody);
    }

    return next.handle().pipe(
      mergeMap((responseBody) =>
        from(
          Promise.resolve(
            this.idempotencyService.completeSuccess(
              decision.recordId,
              reply.statusCode || 200,
              redactForStorage(operation, responseBody),
            ),
          ),
        ).pipe(mergeMap(() => of(responseBody))),
      ),
      catchError((error) =>
        from(
          Promise.resolve(
            this.idempotencyService.completeFailure(
              decision.recordId,
              resolveErrorStatusCode(error),
              resolveErrorResponseBody(error),
            ),
          ),
        ).pipe(
          catchError(() => of(undefined)),
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }
}

function readHeaderValue(request: FastifyRequest, header: string): string | undefined {
  const value = request.headers[header];
  if (Array.isArray(value)) {
    return value[0];
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function resolveActorId(request: FastifyRequest & { user?: Record<string, unknown> }): string {
  const user = request.user;
  const userActor = toStringIfSet(user?.sub) ?? toStringIfSet(user?.userId) ?? toStringIfSet(user?.id);
  if (userActor) {
    return userActor;
  }

  const body = request.body as Record<string, unknown> | undefined;
  const bodyActor = toStringIfSet(body?.userId);
  if (bodyActor) {
    return bodyActor;
  }

  const headerActor = readHeaderValue(request, 'x-actor-id');
  if (headerActor) {
    return headerActor;
  }

  return 'anonymous';
}

function toStringIfSet(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRequestPath(url: string): string {
  const path = url.split('?')[0];
  return path || '/';
}

function resolveErrorStatusCode(error: unknown): number {
  if (error instanceof HttpException) {
    return error.getStatus();
  }
  return 500;
}

function resolveErrorResponseBody(error: unknown): unknown {
  if (error instanceof HttpException) {
    return error.getResponse();
  }

  if (error instanceof Error) {
    return {
      error: 'INTERNAL_SERVER_ERROR',
      message: error.message,
    };
  }

  return {
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Unhandled exception',
  };
}
