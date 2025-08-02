import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { SubscriptionException } from '../exceptions/subscription.exceptions';

/**
 * Standard error response interface
 */
interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  message?: string;
  error?: {
    code: string;
    message: string;
    details: any;
  };
}

/**
 * 구독 관련 예외 필터
 */
@Catch(SubscriptionException)
export class SubscriptionExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SubscriptionExceptionFilter.name);

  catch(exception: SubscriptionException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse() as Record<string, any>;

    this.logger.error(
      `Subscription Exception: ${exception.message}`,
      exception.stack,
      {
        url: request.url,
        method: request.method,
        code: exception.code,
      },
    );

    const errorResponse: ErrorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      error: {
        code: exception.code,
        message: exception.message,
        details: exceptionResponse?.details || null,
      },
    };

    response.status(status).json(errorResponse);
  }
}

/**
 * 일반 HTTP 예외 필터
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    this.logger.error(`HTTP Exception: ${exception.message}`, exception.stack, {
      url: request.url,
      method: request.method,
      status,
    });

    const errorResponse: ErrorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message:
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as Record<string, any>)?.message ||
            exception.message,
    };

    response.status(status).json(errorResponse);
  }
}

/**
 * 전역 예외 필터 (모든 예외 처리)
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    this.logger.error(
      `Unhandled Exception: ${message}`,
      exception instanceof Error ? exception.stack : String(exception),
      {
        url: request.url,
        method: request.method,
      },
    );

    const errorResponse: ErrorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    };

    response.status(status).json(errorResponse);
  }
}
