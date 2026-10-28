import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '@app/authorization';
import { Observable, firstValueFrom, isObservable } from 'rxjs';
import { WALLET_JWT_AUTH_KEY } from './wallet-auth.decorator';
import { WALLET_ADMIN_AUTH_KEY } from './wallet-admin-auth.decorator';

// ─── JWT-authenticated request interface ─────────────────────────────────────

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  url: string;
  cookies?: Record<string, string | undefined>;
  user?: {
    userId?: string;
    sub?: string;
    id?: string;
    [key: string]: unknown;
  };
  /** Set by WalletAuthGuard when JWT cookie auth succeeds */
  jwtUserId?: string;
  /** 검증된 고객 access token 원문. 다른 서비스로 되전달할 때 쓴다(헤더/쿠키 어느 쪽이든). */
  jwtToken?: string;
  /** Set by WalletAuthGuard when API-key auth is used (merchant backend) */
  isApiKeyAuth?: boolean;
}

// ─── Auth guard (API key + JWT cookie) ───────────────────────────────────────

@Injectable()
export class WalletAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtAuthGuard) private readonly jwtAuthGuard: Pick<JwtAuthGuard, 'canActivate'>,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const type = context.getType<'http'>();
    if (type !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();

    const isJwtAuth = this.reflector.getAllAndOverride<boolean>(WALLET_JWT_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const isAdminAuth = this.reflector.getAllAndOverride<boolean>(WALLET_ADMIN_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isAdminAuth) {
      // ── Admin path: JWT required, no API-key fallback ────────────────────
      // 인가는 이 가드 뒤의 전역 PermissionGuard 가 라우트의 권한 키로 한다.
      if (!(await this.tryJwtAuth(context, request))) {
        throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Missing or invalid JWT cookie' });
      }

      return true;
    }

    if (isJwtAuth) {
      // ── JWT cookie path (browser-facing endpoints) ──────────────────────
      // API key is accepted as a fallback (e.g. merchant backend calling GET /v1/payment-methods)
      if (await this.tryJwtAuth(context, request)) {
        return true;
      }

      if (this.tryApiKeyAuth(request)) {
        return true;
      }

      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Missing or invalid JWT cookie' });
    }

    // ── API key path (merchant backend) ────────────────────────────────────
    this.requireApiKeyAuth(request);
    return true;
  }

  private async tryJwtAuth(context: ExecutionContext, request: AuthenticatedRequest): Promise<boolean> {
    const originalAuthHeader = getHeader(request.headers, 'authorization');
    const cookieToken = getAccessTokenFromRequest(request);
    const injectedAuthHeader = cookieToken ? `Bearer ${cookieToken}` : null;

    // Shared JwtAccessStrategy extracts Authorization first, then cookie.
    // Inject cookie token into Authorization to avoid parser/proxy variance.
    if (injectedAuthHeader) {
      setHeader(request.headers, 'authorization', injectedAuthHeader);
    }

    try {
      const activated = await resolveCanActivate(this.jwtAuthGuard.canActivate(context));
      if (!activated) return false;
    } catch {
      return false;
    } finally {
      if (injectedAuthHeader !== null) {
        setHeader(request.headers, 'authorization', originalAuthHeader);
      }
    }

    const jwtUserId = getUserIdFromRequestUser(request.user);
    if (!jwtUserId) return false;

    request.jwtUserId = jwtUserId;
    request.jwtToken = cookieToken ?? getBearerToken(originalAuthHeader) ?? undefined;
    return true;
  }

  private tryApiKeyAuth(request: AuthenticatedRequest): boolean {
    const apiKey = process.env.WALLET_API_KEY;
    const token = getBearerToken(getHeader(request.headers, 'authorization'));
    if (!apiKey || !token || token !== apiKey) {
      return false;
    }

    request.isApiKeyAuth = true;
    return true;
  }

  private requireApiKeyAuth(request: AuthenticatedRequest): void {
    const apiKey = process.env.WALLET_API_KEY;
    const token = getBearerToken(getHeader(request.headers, 'authorization'));
    if (!token || !apiKey) {
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Missing authorization' });
    }

    if (token !== apiKey) {
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Invalid API key' });
    }

    request.isApiKeyAuth = true;
  }
}

function getUserIdFromRequestUser(user: AuthenticatedRequest['user']): string | null {
  if (!user) return null;
  const candidate = user.userId ?? user.sub ?? user.id;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function getBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
}

function getAccessTokenFromRequest(request: AuthenticatedRequest): string | null {
  const fromCookies = request.cookies?.accessToken;
  if (typeof fromCookies === 'string' && fromCookies.length > 0) {
    return fromCookies;
  }

  const cookieHeader = getHeader(request.headers, 'cookie');
  if (!cookieHeader) return null;
  return parseCookieValue(cookieHeader, 'accessToken');
}

function setHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
  value: string | undefined,
): void {
  const lower = name.toLowerCase();
  const upper = name.toUpperCase();

  if (value === undefined) {
    delete headers[name];
    delete headers[lower];
    delete headers[upper];
    return;
  }

  headers[name] = value;
  headers[lower] = value;
}

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  const direct = headers[name] ?? headers[lowerName] ?? headers[name.toUpperCase()];
  if (direct !== undefined) {
    if (Array.isArray(direct)) {
      return lowerName === 'cookie' ? direct.join('; ') : direct[0];
    }
    return direct;
  }

  const key = Object.keys(headers).find((k) => k.toLowerCase() === lowerName);
  const val = key ? headers[key] : undefined;
  if (Array.isArray(val)) {
    return val[0];
  }
  return val;
}

function parseCookieValue(cookieHeader: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`));
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

async function resolveCanActivate(result: boolean | Promise<boolean> | unknown): Promise<boolean> {
  if (typeof result === 'boolean') {
    return result;
  }
  if (isObservable(result)) {
    return firstValueFrom(result as Observable<boolean>);
  }
  if (result && typeof (result as Promise<boolean>).then === 'function') {
    return result as Promise<boolean>;
  }
  return Boolean(result);
}
