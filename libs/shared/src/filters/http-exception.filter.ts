import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

interface ErrorResponse {
  error?: string;
  message?: string | string[];
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const status = exception.getStatus();

    const errorResponse = exception.getResponse() as ErrorResponse;

    const errorObject = {
      success: false,
      error: this.getErrorCode(status, errorResponse),
      message: this.getErrorMessage(errorResponse),
      ...(process.env.NODE_ENV !== 'production' && {
        devMessage: `${exception.message} - ${request.method} ${request.url}`,
      }),
    };

    return response.status(status).send(errorObject);
  }

  private getErrorCode(status: number, errorResponse: ErrorResponse): string {
    if (errorResponse?.error) {
      return errorResponse.error;
    }

    // Default mapping of HTTP status codes to error codes
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

    return 'An unexpected error occurred';
  }
}
