import {
  applyDecorators,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  SetMetadata,
  UseInterceptors,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, defer, Observable } from 'rxjs';
import { OutboundScanRejectionManager } from './outbound-scan-rejection.manager';
import { recordableRejection } from './scan-rejection-reasons';

const OUTBOUND_REJECTION_COMMAND = 'fulfillment:outbound-rejection-command';

type RequestLike = {
  params?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  body?: unknown;
  user?: { userId?: string; id?: string; sub?: string } | null;
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 출고 저장 경로가 관리자 손이 필요한 사유로 거절되면, 거절된 명령이 되돌려진 뒤 따로 기록을 남긴다.
 * 성공 응답에는 손대지 않고, 거절은 남겼든 못 남겼든 같은 예외 그대로 다시 던진다.
 */
@Injectable()
export class OutboundRejectionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly rejections: OutboundScanRejectionManager,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const commandType = this.reflector.get<string | undefined>(OUTBOUND_REJECTION_COMMAND, context.getHandler());
    if (!commandType || context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<RequestLike>();
    const startedAt = new Date();
    return next.handle().pipe(
      catchError((error: unknown) =>
        defer(async () => {
          await this.record(commandType, request, error, startedAt);
          throw error;
        }),
      ),
    );
  }

  private async record(commandType: string, request: RequestLike, error: unknown, startedAt: Date): Promise<void> {
    const rejection = recordableRejection(error);
    const shipmentId = text(request.params?.shipmentId);
    const idempotencyKey = text(request.headers?.['idempotency-key']);
    const actorId = text(request.user?.userId) ?? text(request.user?.id) ?? text(request.user?.sub);
    if (!rejection || !shipmentId || !idempotencyKey || !actorId) return;
    const body = isRecord(request.body) ? request.body : {};
    const recorded = await this.rejections.record({
      commandType,
      shipmentId,
      idempotencyKey,
      actorId,
      barcode: text(body.barcode),
      quantity: typeof body.quantity === 'number' && Number.isSafeInteger(body.quantity) ? body.quantity : null,
      rejection,
      rejectedAt: startedAt,
    });
    // 물류앱이 «관리자 화면에 표시됐어요»라고 말해도 되는지 알 수 있게 응답 본문에 싣는다.
    if (recorded && error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'object') Object.assign(response, { rejectionRecorded: true });
    }
  }
}

/** 이 출고 저장 경로의 거절을 관리자 화면에 남긴다. `commandType` 은 그 경로가 쓰는 명령 이름이다. */
export const RecordsOutboundRejection = (commandType: string) =>
  applyDecorators(SetMetadata(OUTBOUND_REJECTION_COMMAND, commandType), UseInterceptors(OutboundRejectionInterceptor));
