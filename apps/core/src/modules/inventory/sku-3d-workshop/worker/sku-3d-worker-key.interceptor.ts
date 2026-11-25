import { CallHandler, ExecutionContext, Injectable, NestInterceptor, UnauthorizedException } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { AuthenticatedWorker, Sku3dWorkerManager } from './sku-3d-worker.manager';

export type WorkerRequest = { headers: Record<string, string | undefined>; sku3dWorker?: AuthenticatedWorker };

// 가드가 아니라 인터셉터다 — 테넌트 맥락은 전역 인터셉터가 세우므로 가드 단계에선 테넌트 DB 를 못 읽는다
@Injectable()
export class Sku3dWorkerKeyInterceptor implements NestInterceptor {
  constructor(private readonly manager: Sku3dWorkerManager) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<WorkerRequest>();
    const key = request.headers.authorization?.replace(/^Bearer\s+/i, '').trim() ?? '';

    if (key.length < 32) {
      throw new UnauthorizedException('워커 키가 필요해요');
    }

    request.sku3dWorker = await this.manager.authenticate(key);

    return next.handle();
  }
}
