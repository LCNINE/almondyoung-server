import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConflictError } from '@app/shared';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AdminIdempotencyService } from './admin-idempotency.service';
import { ADMIN_IDEMPOTENT_OP } from './idempotent-admin-op.decorator';

/**
 * @IdempotentAdminOp 가 붙은 핸들러에 대해 Idempotency-Key 기반 중복 실행을 흡수한다.
 * 키가 없으면 (하위호환) 그대로 진행 — 보호받으려면 클라이언트가 키를 보내야 한다.
 */
@Injectable()
export class AdminIdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdminIdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: AdminIdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const operation = this.reflector.get<string>(ADMIN_IDEMPOTENT_OP, context.getHandler());
    if (!operation) return next.handle();

    const req = context.switchToHttp().getRequest();
    const headers = (req?.headers ?? {}) as Record<string, string | undefined>;
    const key = headers['idempotency-key'] ?? headers['Idempotency-Key'];
    if (!key) return next.handle();

    const requestHash = this.idempotency.hashRequest({
      method: req?.method,
      path: req?.route?.path ?? req?.path ?? req?.url,
      params: req?.params ?? {},
      body: req?.body ?? {},
    });

    return from(this.idempotency.begin(operation, key, requestHash)).pipe(
      switchMap((res) => {
        if (res.kind === 'replay') {
          this.logger.log(`[idempotency] replay ${operation} key=${key}`);
          return of(res.response);
        }
        if (res.kind === 'conflict') {
          throw new ConflictError(res.reason);
        }
        return next.handle().pipe(
          switchMap((result) =>
            from(this.idempotency.complete(operation, key, requestHash, res.lockedUntil, result)).pipe(
              switchMap(() => of(result)),
            ),
          ),
          catchError((err) =>
            from(this.idempotency.fail(operation, key, requestHash, res.lockedUntil, err)).pipe(
              switchMap(() => throwError(() => err)),
            ),
          ),
        );
      }),
    );
  }
}
