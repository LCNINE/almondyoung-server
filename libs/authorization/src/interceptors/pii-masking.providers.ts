import type { Provider, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { OwnerService } from '../permissions/permission.types';
import { PiiAccessRecorder } from '../services/pii-access-recorder';
import { PII_MASKING_OPTIONS, PiiMaskingInterceptor, type PiiMaskingOptions } from './pii-masking.interceptor';

export interface PiiMaskingSetup {
  readonly service: OwnerService;
  readonly recorder: Type<PiiAccessRecorder>;
  readonly envelope?: PiiMaskingOptions['envelope'];
}

/**
 * 앱 루트 모듈의 providers 에서 다른 전역 인터셉터보다 앞에 펼친다 — 다른 응답 인터셉터(감싸기·멱등 재생)보다
 * 바깥에서 최종 본문을 보게(`scripts/security/permission-wiring.spec.ts`).
 */
export function piiMaskingProviders(setup: PiiMaskingSetup): Provider[] {
  return [
    {
      provide: PII_MASKING_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PiiMaskingOptions => ({
        service: setup.service,
        revealRequired: config.get<string>('PII_REVEAL_REQUIRED') === 'true',
        envelope: setup.envelope ?? 'none',
      }),
    },
    { provide: PiiAccessRecorder, useClass: setup.recorder },
    { provide: APP_INTERCEPTOR, useClass: PiiMaskingInterceptor },
  ];
}
