/**
 * 구독 결제 전용 구조화된 로깅 서비스
 * 
 * 요구사항:
 * - 6.3: 구조화된 에러 로깅 (correlation ID 포함)
 * - 5.5: 외부 서비스가 활용할 수 있는 상세한 에러 정보 제공
 */

import { Injectable, Logger } from '@nestjs/common';
import { RecurringPaymentError, RecurringPaymentErrorType } from '../shared/errors/recurring-payment.errors';

/**
 * 로그 레벨 열거형
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * 구조화된 로그 엔트리 인터페이스
 */
export interface StructuredLogEntry {
  /** 로그 레벨 */
  level: LogLevel;
  /** 로그 메시지 */
  message: string;
  /** 상관관계 ID */
  correlationId: string;
  /** 타임스탬프 */
  timestamp: string;
  /** 로그 카테고리 */
  category: string;
  /** 사용자 ID (마스킹됨) */
  userId?: string;
  /** 결제수단 ID (마스킹됨) */
  paymentMethodId?: string;
  /** 트랜잭션 ID */
  transactionId?: string;
  /** 에러 타입 */
  errorType?: RecurringPaymentErrorType;
  /** 재시도 가능 여부 */
  retryable?: boolean;
  /** 처리 시간 (밀리초) */
  processingTimeMs?: number;
  /** 추가 컨텍스트 정보 */
  context?: Record<string, any>;
  /** 에러 스택 트레이스 (에러 로그인 경우) */
  stackTrace?: string;
}

/**
 * 구독 결제 로거 서비스
 */
@Injectable()
export class RecurringPaymentLoggerService {
  private readonly logger = new Logger(RecurringPaymentLoggerService.name);

  /**
   * 구독 결제 요청 시작 로그
   */
  logPaymentRequestStart(
    correlationId: string,
    userId: string,
    paymentMethodId: string,
    amount: number,
    subscriptionType: string,
    additionalContext?: Record<string, any>
  ): void {
    const logEntry: StructuredLogEntry = {
      level: LogLevel.INFO,
      message: '구독 결제 요청 시작',
      correlationId,
      timestamp: new Date().toISOString(),
      category: 'RECURRING_PAYMENT_REQUEST',
      userId: this.maskId(userId),
      paymentMethodId: this.maskId(paymentMethodId),
      context: {
        amount,
        subscriptionType,
        currency: 'KRW',
        ...this.sanitizeContext(additionalContext),
      },
    };

    this.writeLog(logEntry);
  }

  /**
   * 구독 결제 성공 로그
   */
  logPaymentSuccess(
    correlationId: string,
    transactionId: string,
    paymentEventId: string,
    userId: string,
    amount: number,
    processingTimeMs: number,
    additionalContext?: Record<string, any>
  ): void {
    const logEntry: StructuredLogEntry = {
      level: LogLevel.INFO,
      message: '구독 결제 성공',
      correlationId,
      timestamp: new Date().toISOString(),
      category: 'RECURRING_PAYMENT_SUCCESS',
      userId: this.maskId(userId),
      transactionId,
      processingTimeMs,
      context: {
        paymentEventId,
        amount,
        currency: 'KRW',
        ...this.sanitizeContext(additionalContext),
      },
    };

    this.writeLog(logEntry);
  }

  /**
   * 구독 결제 에러 로그
   */
  logPaymentError(
    correlationId: string,
    error: RecurringPaymentError | Error,
    userId?: string,
    paymentMethodId?: string,
    processingTimeMs?: number,
    additionalContext?: Record<string, any>
  ): void {
    const isRecurringPaymentError = error instanceof RecurringPaymentError;
    
    const logEntry: StructuredLogEntry = {
      level: LogLevel.ERROR,
      message: `구독 결제 실패: ${error.message}`,
      correlationId,
      timestamp: new Date().toISOString(),
      category: 'RECURRING_PAYMENT_ERROR',
      userId: userId ? this.maskId(userId) : undefined,
      paymentMethodId: paymentMethodId ? this.maskId(paymentMethodId) : undefined,
      errorType: isRecurringPaymentError ? error.type : RecurringPaymentErrorType.INTERNAL_ERROR,
      retryable: isRecurringPaymentError ? error.retryable : true,
      processingTimeMs,
      context: {
        errorName: error.name,
        httpStatusCode: isRecurringPaymentError ? error.httpStatusCode : 500,
        retryAfterSeconds: isRecurringPaymentError ? error.retryAfterSeconds : undefined,
        errorDetails: isRecurringPaymentError ? this.sanitizeErrorDetails(error.details) : undefined,
        ...this.sanitizeContext(additionalContext),
      },
      stackTrace: error.stack,
    };

    this.writeLog(logEntry);
  }

  /**
   * 결제수단 검증 로그
   */
  logPaymentMethodValidation(
    correlationId: string,
    paymentMethodId: string,
    userId: string,
    isValid: boolean,
    validationTimeMs: number,
    errorType?: RecurringPaymentErrorType,
    additionalContext?: Record<string, any>
  ): void {
    const logEntry: StructuredLogEntry = {
      level: isValid ? LogLevel.INFO : LogLevel.WARN,
      message: `결제수단 검증 ${isValid ? '성공' : '실패'}`,
      correlationId,
      timestamp: new Date().toISOString(),
      category: 'PAYMENT_METHOD_VALIDATION',
      userId: this.maskId(userId),
      paymentMethodId: this.maskId(paymentMethodId),
      errorType,
      processingTimeMs: validationTimeMs,
      context: {
        validationResult: isValid,
        ...this.sanitizeContext(additionalContext),
      },
    };

    this.writeLog(logEntry);
  }

  /**
   * HMS API 호출 로그
   */
  logHmsApiCall(
    correlationId: string,
    apiEndpoint: string,
    hmsMemberId: string,
    success: boolean,
    responseTimeMs: number,
    hmsStatus?: string,
    errorMessage?: string
  ): void {
    const logEntry: StructuredLogEntry = {
      level: success ? LogLevel.DEBUG : LogLevel.WARN,
      message: `HMS API 호출 ${success ? '성공' : '실패'}: ${apiEndpoint}`,
      correlationId,
      timestamp: new Date().toISOString(),
      category: 'HMS_API_CALL',
      processingTimeMs: responseTimeMs,
      context: {
        apiEndpoint,
        hmsMemberId: this.maskId(hmsMemberId),
        success,
        hmsStatus,
        errorMessage: errorMessage ? errorMessage.substring(0, 200) : undefined,
      },
    };

    this.writeLog(logEntry);
  }

  /**
   * 동시성 제어 로그
   */
  logConcurrencyControl(
    correlationId: string,
    paymentMethodId: string,
    userId: string,
    action: 'LOCK_ACQUIRED' | 'LOCK_FAILED' | 'DEADLOCK_DETECTED' | 'RETRY_ATTEMPT',
    attemptNumber?: number,
    waitTimeMs?: number
  ): void {
    const logEntry: StructuredLogEntry = {
      level: action === 'LOCK_FAILED' || action === 'DEADLOCK_DETECTED' ? LogLevel.WARN : LogLevel.DEBUG,
      message: `동시성 제어: ${action}`,
      correlationId,
      timestamp: new Date().toISOString(),
      category: 'CONCURRENCY_CONTROL',
      userId: this.maskId(userId),
      paymentMethodId: this.maskId(paymentMethodId),
      context: {
        action,
        attemptNumber,
        waitTimeMs,
      },
    };

    this.writeLog(logEntry);
  }

  /**
   * 멱등성 처리 로그
   */
  logIdempotencyHandling(
    correlationId: string,
    idempotencyKey: string,
    action: 'KEY_GENERATED' | 'CACHE_HIT' | 'CACHE_MISS' | 'CACHE_STORED',
    userId?: string
  ): void {
    const logEntry: StructuredLogEntry = {
      level: LogLevel.DEBUG,
      message: `멱등성 처리: ${action}`,
      correlationId,
      timestamp: new Date().toISOString(),
      category: 'IDEMPOTENCY_HANDLING',
      userId: userId ? this.maskId(userId) : undefined,
      context: {
        idempotencyKey: this.maskId(idempotencyKey),
        action,
      },
    };

    this.writeLog(logEntry);
  }

  /**
   * 성능 메트릭 로그
   */
  logPerformanceMetrics(
    correlationId: string,
    operation: string,
    totalTimeMs: number,
    breakdownMs?: Record<string, number>
  ): void {
    const logEntry: StructuredLogEntry = {
      level: totalTimeMs > 5000 ? LogLevel.WARN : LogLevel.INFO,
      message: `성능 메트릭: ${operation}`,
      correlationId,
      timestamp: new Date().toISOString(),
      category: 'PERFORMANCE_METRICS',
      processingTimeMs: totalTimeMs,
      context: {
        operation,
        breakdownMs,
        performanceWarning: totalTimeMs > 5000 ? 'SLOW_OPERATION' : undefined,
      },
    };

    this.writeLog(logEntry);
  }

  /**
   * 구조화된 로그 출력
   */
  private writeLog(logEntry: StructuredLogEntry): void {
    const logMessage = `[${logEntry.category}] ${logEntry.message}`;
    const logContext = {
      correlationId: logEntry.correlationId,
      timestamp: logEntry.timestamp,
      ...logEntry.context,
      userId: logEntry.userId,
      paymentMethodId: logEntry.paymentMethodId,
      transactionId: logEntry.transactionId,
      errorType: logEntry.errorType,
      retryable: logEntry.retryable,
      processingTimeMs: logEntry.processingTimeMs,
    };

    switch (logEntry.level) {
      case LogLevel.DEBUG:
        this.logger.debug(logMessage, logContext);
        break;
      case LogLevel.INFO:
        this.logger.log(logMessage, logContext);
        break;
      case LogLevel.WARN:
        this.logger.warn(logMessage, logContext);
        break;
      case LogLevel.ERROR:
        this.logger.error(logMessage, logEntry.stackTrace, logContext);
        break;
    }
  }

  /**
   * ID 마스킹 처리
   */
  private maskId(id: string): string {
    if (!id) return '';
    if (id.length <= 8) {
      return id.substring(0, 3) + '***';
    }
    return id.substring(0, 4) + '***' + id.substring(id.length - 4);
  }

  /**
   * 컨텍스트 정보 정제 (민감한 정보 제거)
   */
  private sanitizeContext(context?: Record<string, any>): Record<string, any> {
    if (!context) return {};

    const sanitized: Record<string, any> = {};
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'cardNumber', 'cvv'];

    Object.keys(context).forEach(key => {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveFields.some(field => lowerKey.includes(field));
      
      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof context[key] === 'string' && context[key].length > 500) {
        // 긴 문자열은 잘라서 저장
        sanitized[key] = context[key].substring(0, 500) + '...';
      } else {
        sanitized[key] = context[key];
      }
    });

    return sanitized;
  }

  /**
   * 에러 상세 정보 정제 (민감한 정보 제거)
   */
  private sanitizeErrorDetails(details?: Record<string, any>): Record<string, any> | undefined {
    if (!details) return undefined;

    const sanitized: Record<string, any> = {};

    // 안전한 필드들만 포함
    const safeFields = [
      'reason',
      'hmsStatus',
      'methodType',
      'currentPurpose',
      'allowedPurposes',
      'availableCredit',
      'requiredAmount',
      'gatewayCode',
      'occurredAt',
    ];

    safeFields.forEach(field => {
      if (details[field] !== undefined) {
        sanitized[field] = details[field];
      }
    });

    // ID 필드들은 마스킹 처리
    if (details.hmsMemberId) {
      sanitized.hmsMemberId = this.maskId(details.hmsMemberId);
    }
    if (details.paymentMethodId) {
      sanitized.paymentMethodId = this.maskId(details.paymentMethodId);
    }

    // 게이트웨이 메시지는 길이 제한
    if (details.gatewayMessage) {
      sanitized.gatewayMessage = details.gatewayMessage.substring(0, 200);
    }

    return sanitized;
  }

  /**
   * 상관관계 ID 생성
   */
  static generateCorrelationId(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 15);
    return `req_${timestamp}_${randomPart}`;
  }
}