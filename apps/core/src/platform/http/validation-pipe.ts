import { ValidationPipe, type ArgumentMetadata, type ValidationPipeOptions } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

/**
 * main.ts 가 실제로 설치하는 전역 ValidationPipe 설정 — 배포 설정의 단일 진실 공급원.
 *
 * `whitelist: true` 는 DTO 에 선언되지 않은 필드를 요청 body 에서 제거한다. 즉 위조된
 * `operatorId` / `performedBy` 같은 actor 필드가 컨트롤러까지 도달하지 못하게 막는 보안 경계다.
 * 이 설정을 테스트에서 손으로 복사하면 main.ts 가 회귀해도 테스트가 초록으로 남으므로,
 * 프로덕션 부팅 경로와 스펙 모두 이 모듈만 사용한다.
 */
export const GLOBAL_VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: false,
  disableErrorMessages: false,
  validationError: { target: false, value: false },
};

// Zod DTO를 class-validator의 whitelist로 처리하면 필드가 지워진다.
// DTO 종류에 따라 한 검증기만 실행하고, 기존 DTO/원시값의 처리는 그대로 유지한다.
class CoreValidationPipe extends ValidationPipe {
  private readonly zodPipe = new ZodValidationPipe();

  override async transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.metatype && 'isZodDto' in metadata.metatype && metadata.metatype.isZodDto === true) {
      return this.zodPipe.transform(value, metadata);
    }
    return super.transform(value, metadata);
  }
}

/** 배포와 동일하게 구성된 전역 ValidationPipe 인스턴스를 만든다. */
export function createGlobalValidationPipe(): ValidationPipe {
  return new CoreValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
}
