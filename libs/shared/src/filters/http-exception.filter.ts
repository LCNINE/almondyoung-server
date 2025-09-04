import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ApplicationException } from './application.exception';

interface ErrorResponse {
  error?: string;
  message?: string | string[];
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let status = 500;
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let message = '서버 오류가 발생했습니다';
    let devMessage: string | undefined;

    // 1. Custom ApplicationException 처리
    if (exception instanceof ApplicationException) {
      status = exception.getHttpStatus();
      errorCode = exception.getErrorCode();
      message = exception.message;
      devMessage = `${exception.name}: ${exception.message} - ${request.method} ${request.url}`;
    }
    // 2. NestJS HttpException 처리
    else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const errorResponse = exception.getResponse() as ErrorResponse;
      errorCode = this.getErrorCode(status, errorResponse);
      message = this.getErrorMessage(errorResponse);
      devMessage = `${exception.message} - ${request.method} ${request.url}`;
    }
    // 3. 일반 Error 처리
    else if (exception instanceof Error) {
      console.error('Unhandled error:', exception);
      message =
        process.env.NODE_ENV === 'production'
          ? '서버 오류가 발생했습니다'
          : exception.message;
      devMessage = `${exception.name}: ${exception.message} - ${request.method} ${request.url}`;
    }
    // 4. 알 수 없는 에러
    else {
      console.error('Unknown error:', exception);
      devMessage = `Unknown error: ${JSON.stringify(exception)} - ${request.method} ${request.url}`;
    }

    // 통일된 응답 형식
    const errorObject = {
      success: false,
      error: errorCode,
      message: message,
      ...(process.env.NODE_ENV !== 'production' &&
        devMessage && {
          devMessage: devMessage,
        }),
    };

    // 개발 환경에서 스택 트레이스 추가
    if (
      process.env.NODE_ENV !== 'production' &&
      exception instanceof Error &&
      exception.stack
    ) {
      errorObject['stack'] = exception.stack;
    }

    return response.status(status).send(errorObject);
  }

  private getErrorCode(status: number, errorResponse: ErrorResponse): string {
    if (errorResponse?.error) {
      return errorResponse.error;
    }

    const errorCodes: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
    };

    return errorCodes[status] || `ERROR_${status}`;
  }

  private getErrorMessage(errorResponse: ErrorResponse): string {
    if (typeof errorResponse === 'string') {
      return errorResponse;
    }

    if (errorResponse?.message) {
      return Array.isArray(errorResponse.message)
        ? errorResponse.message[0]
        : errorResponse.message;
    }

    return '서버 오류가 발생했습니다';
  }
}
