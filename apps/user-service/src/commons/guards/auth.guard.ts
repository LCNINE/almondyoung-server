import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from '../../constants/public.decorator';

interface JwtPayload {
  sub: number;
  email: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class PublicPrivateGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('토큰이 없습니다.');
    }
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get<string>('AUTH_SECRET'),
      });
      // 💡 We're assigning the payload to the request object here
      // so that we can access it in our route handlers
      request['user'] = payload as any;
    } catch {
      throw new UnauthorizedException('토큰이 유효하지 않습니다.');
    }
    return true;
  }

  private extractTokenFromHeader(request: FastifyRequest): string | undefined {
    return request.cookies.accessToken;
  }
}
