import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Observable } from 'rxjs';
import { FastifyRequest } from 'fastify';

@Injectable()
export class DevAuthGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const userIdFromHeader = request.headers['x-user-id'];

    // x-user-id 헤더가 배열일 수 있으니 string 타입으로 안전하게 처리
    const userId = Array.isArray(userIdFromHeader)
      ? userIdFromHeader[0]
      : userIdFromHeader;

    if (userId) {
      request.user = { userId };
      return true;
    }

    return false;
  }
}
