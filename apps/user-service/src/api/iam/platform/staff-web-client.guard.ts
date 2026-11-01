import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PlatformRepository } from './platform.repository';

/**
 * 직원 웹 앱 서버 전용 경로의 가드 — `Authorization: Basic base64(client_id:client_secret)` 의 클라이언트가 활성 confidential 이고
 * 고정 테넌트가 없어야 한다(= 주소가 테넌트를 정하는 직원 웹 클라이언트, `admin-web`. 쇼핑몰은 고정 테넌트라 못 연다).
 * 그 앱이 이미 쥔 OIDC 비밀이라 새 자격증명을 늘리지 않는다 — 내부 키(`USER_SERVICE_INTERNAL_KEY`)는 연락처 조회까지 연다.
 * 비밀 비교는 토큰 교환(`OAuthManager.assertClientCredentials`)과 같은 규칙이다(지금 비밀, 회전 중이면 옛 비밀) — 그 규칙을 바꾸면
 * 여기도 바꾼다. OAuthModule 을 iam 에 들이지 않으려고 같은 모듈의 저장소로 읽는다.
 */
@Injectable()
export class StaffWebClientGuard implements CanActivate {
  constructor(private readonly platform: PlatformRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const header = request.headers['authorization'];
    if (!header?.startsWith('Basic ')) throw new UnauthorizedException('client credentials required');
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const at = decoded.indexOf(':');
    if (at <= 0) throw new UnauthorizedException('client credentials required');
    const clientId = decoded.slice(0, at);
    const secret = decoded.slice(at + 1);

    const client = await this.platform.findActiveClientSecrets(clientId);
    if (!client || client.clientType !== 'confidential' || client.tenantId !== null || !secret) {
      throw new UnauthorizedException('invalid client credentials');
    }
    if (await bcrypt.compare(secret, client.clientSecretHash)) return true;
    if (client.previousSecretHash && (await bcrypt.compare(secret, client.previousSecretHash))) return true;
    throw new UnauthorizedException('invalid client credentials');
  }
}
