import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { IdempotencyService, IdempotencyRecord } from '../services/idempotency.service';
import {
  IdempotencyConflictException,
  IdempotencyPayloadMismatchException,
  InvalidIdempotencyKeyException,
  IdempotencyRateLimitException,
} from '../exceptions/idempotency.exceptions';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);
  private readonly MAX_USER_KEYS = 100; // 사용자당 최대 멱등키 개수

  constructor(
    private readonly idempotencyService: IdempotencyService
  ) { }

  async intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const idempotencyKey = request.headers['idempotency-key'];
    const requestPath = request.url || request.route?.path || '';

    this.logger.log(`🔄 [IdempotencyInterceptor] 인터셉터 실행됨 - 경로: ${requestPath}, 멱등키: ${idempotencyKey || 'null'}`);

    // 결제 API가 아니면 멱등성 처리 건너뛰기
    if (!requestPath.startsWith('/payments')) {
      this.logger.log(`🔄 [IdempotencyInterceptor] 결제 API가 아님, 건너뛰기: ${requestPath}`);
      return next.handle();
    }

    // 멱등키가 없으면 일반 처리
    if (!idempotencyKey) {
      this.logger.log('🔄 [IdempotencyInterceptor] 멱등키 없음, 일반 처리 진행');
      return next.handle();
    }

    this.logger.log(`🔄 [IdempotencyInterceptor] 멱등성 처리 시작: ${idempotencyKey}`);

    try {
      // 1. 멱등키 형식 검증
      this.logger.log(`🔄 [IdempotencyInterceptor] 멱등키 형식 검증: ${idempotencyKey}`);
      this.validateIdempotencyKey(idempotencyKey);

      // 2. 기존 멱등키 확인
      this.logger.log(`🔄 [IdempotencyInterceptor] 기존 멱등키 확인 중: ${idempotencyKey}`);
      const existingRecord = await this.idempotencyService.findIdempotencyKey(idempotencyKey);

      if (existingRecord) {
        return this.handleExistingKey(existingRecord, request);
      }

      // 3. 사용자 정보 추출 및 Rate Limiting 확인
      const userId = this.extractUserId(request);
      await this.checkRateLimit(userId);

      // 4. 새로운 멱등키 생성
      const currentRequestPath = this.getRequestPath(request);

      await this.idempotencyService.createIdempotencyKey(
        idempotencyKey,
        userId,
        currentRequestPath,
        request.body
      );

      // 5. 요청 처리 및 결과 저장
      return next.handle().pipe(
        tap(async (data) => {
          // 성공 시 응답 저장
          await this.idempotencyService.completeIdempotencyKey(
            idempotencyKey,
            response.statusCode,
            data
          );
          this.logger.log(`🔄 [IdempotencyInterceptor] 멱등성 처리 완료: ${idempotencyKey} (성공 - ${response.statusCode})`);
        }),
        catchError(async (error) => {
          // 실패 시에도 응답 저장 (멱등성 보장을 위해)
          const errorStatusCode = error.status || error.statusCode || 500;
          const errorResponse = {
            statusCode: errorStatusCode,
            message: error.message || 'Internal Server Error',
            error: error.name || 'Error'
          };

          await this.idempotencyService.completeIdempotencyKey(
            idempotencyKey,
            errorStatusCode,
            errorResponse
          );

          this.logger.log(`🔄 [IdempotencyInterceptor] 멱등성 처리 완료: ${idempotencyKey} (실패 - ${errorStatusCode})`);
          throw error;
        })
      );

    } catch (error) {
      this.logger.error(`🚨 [IdempotencyInterceptor] 멱등성 처리 실패: ${idempotencyKey}`, error);
      this.logger.error(`🚨 [IdempotencyInterceptor] 에러 스택:`, error.stack);

      // 멱등성 처리 실패 시에도 일반 처리를 진행하도록 할 수 있음 (선택사항)
      if (error instanceof InvalidIdempotencyKeyException ||
        error instanceof IdempotencyConflictException ||
        error instanceof IdempotencyPayloadMismatchException ||
        error instanceof IdempotencyRateLimitException) {
        // 멱등성 관련 예외는 그대로 던짐
        throw error;
      }

      // 기타 예외는 로그만 남기고 일반 처리 진행 (개발 단계에서는 디버깅을 위해)
      this.logger.warn(`🚨 [IdempotencyInterceptor] 멱등성 처리 실패, 일반 처리로 진행: ${error.message}`);
      return next.handle();
    }
  }

  /**
   * 기존 멱등키 처리 로직
   */
  private handleExistingKey(record: IdempotencyRecord, request: any): Observable<any> {
    const { id: key, status, requestHash, responseBody, responseCode } = record;

    this.logger.log(`🔍 [IdempotencyInterceptor] 기존 멱등키 처리: ${key}, 상태: ${status}, 응답코드: ${responseCode}`);

    // 처리 중인 요청
    if (status === 'PROCESSING') {
      this.logger.warn(`🚨 [IdempotencyInterceptor] 처리 중인 멱등키 중복 요청: ${key}`);
      throw new IdempotencyConflictException();
    }

    // 페이로드 검증
    this.logger.log(`🔍 [IdempotencyInterceptor] 페이로드 검증 시작: ${key}`);
    this.logger.log(`🔍 [IdempotencyInterceptor] 저장된 해시: ${requestHash}`);
    this.logger.log(`🔍 [IdempotencyInterceptor] 요청 본문: ${JSON.stringify(request.body)}`);

    if (!this.idempotencyService.validateRequestHash(requestHash, request.body)) {
      this.logger.warn(`🚨 [IdempotencyInterceptor] 페이로드 불일치 감지: ${key}`);
      this.logger.warn(`🚨 [IdempotencyInterceptor] 기존 레코드는 유지되며, 422 에러를 반환합니다`);
      throw new IdempotencyPayloadMismatchException();
    }

    this.logger.log(`✅ [IdempotencyInterceptor] 페이로드 검증 통과: ${key}`);

    // 저장된 응답 반환
    try {
      const savedResponse = JSON.parse(responseBody || '{}');
      const savedStatusCode = responseCode || 200;

      this.logger.log(`✅ [IdempotencyInterceptor] 멱등키 중복 요청 처리: ${key} (저장된 응답 반환 - ${savedStatusCode})`);

      // 저장된 상태코드가 에러 코드인 경우 예외를 던져서 원래 상태코드 유지
      if (savedStatusCode >= 400) {
        const error = new Error(savedResponse.message || 'Stored Error Response');
        (error as any).status = savedStatusCode;
        (error as any).response = savedResponse;
        throw error;
      }

      return of(savedResponse);
    } catch (error) {
      // 저장된 에러 응답인 경우 그대로 던지기
      if ((error as any).status >= 400) {
        throw error;
      }

      this.logger.error(`🚨 [IdempotencyInterceptor] 저장된 응답 파싱 실패: ${key}`, error);
      // 파싱 실패 시 키 삭제하고 새로 처리하도록 예외 발생
      this.idempotencyService.deleteIdempotencyKey(key);
      throw new BadRequestException('저장된 응답을 처리할 수 없습니다. 다시 시도해주세요.');
    }
  }

  /**
   * 멱등키 형식 검증 (UUID v4 또는 ULID)
   */
  private validateIdempotencyKey(key: string): void {
    // UUID v4 형식 검증
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    // ULID 형식 검증 (26자리 Base32 문자)
    const ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

    // 커스텀 테스트 키 형식 (test로 시작하는 UUID)
    const testKeyRegex = /^test\d*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // 개발/테스트용 간단한 키 형식 (영문자, 숫자, 하이픈만 허용)
    const simpleTestKeyRegex = /^[a-zA-Z0-9\-_]{3,50}$/;

    if (!uuidRegex.test(key) && !ulidRegex.test(key) && !testKeyRegex.test(key) && !simpleTestKeyRegex.test(key)) {
      throw new InvalidIdempotencyKeyException('유효하지 않은 멱등키 형식입니다. UUID v4, ULID, 또는 테스트 키 형식을 사용해주세요.');
    }

    // 키 길이 제한
    if (key.length > 255) {
      throw new InvalidIdempotencyKeyException('멱등키가 너무 깁니다.');
    }
  }

  /**
   * 사용자 ID 추출
   * 현재는 요청 본문에서 추출, 향후 JWT 토큰에서 추출 가능
   */
  private extractUserId(request: any): string {
    // JWT 토큰에서 사용자 ID 추출 (향후 인증 구현 시)
    // const user = request.user;
    // if (user && user.id) {
    //   return user.id;
    // }

    // 현재는 요청 본문에서 추출
    const userId = request.body?.userId;
    if (!userId) {
      throw new BadRequestException('사용자 ID가 필요합니다.');
    }

    return userId;
  }

  /**
   * 요청 경로 추출
   */
  private getRequestPath(request: any): string {
    return request.route?.path || request.url || '/unknown';
  }

  /**
   * Rate Limiting 확인
   */
  private async checkRateLimit(userId: string): Promise<void> {
    try {
      const userKeyCount = await this.idempotencyService.getUserIdempotencyKeyCount(userId);

      if (userKeyCount >= this.MAX_USER_KEYS) {
        this.logger.warn(`사용자 멱등키 한도 초과: ${userId} (${userKeyCount}/${this.MAX_USER_KEYS})`);
        throw new IdempotencyRateLimitException();
      }

      this.logger.debug(`사용자 멱등키 사용량: ${userId} (${userKeyCount}/${this.MAX_USER_KEYS})`);
    } catch (error) {
      if (error instanceof IdempotencyRateLimitException) {
        throw error;
      }
      // Rate Limiting 확인 실패는 치명적이지 않으므로 로그만 남기고 진행
      this.logger.warn(`Rate Limiting 확인 실패: ${userId}`, error);
    }
  }
}