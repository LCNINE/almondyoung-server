import { generateKeyPairSync } from 'node:crypto';
import { PermissionGuard, PermissionModule, RolePermissionSource, SnapshotFetch } from '@app/authorization';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { JwtAccessStrategy } from '../../api/auth/strategies/jwt-access.strategy';
import { ConsentsController } from '../../api/consents/consents.controller';
import { ConsentsService } from '../../api/consents/consents.service';
import { OAuthRepository } from '../../api/oauth/oauth.repository';
import { UsersController } from '../../api/users/users.controller';
import { UsersService } from '../../api/users/users.service';
import { WithdrawnReplayService } from '../../api/users/withdrawn-replay.service';
import { INTERNAL_TOKEN_AUDIENCE } from '../../constants/auth.constant';
import { DemoBoundaryGuard } from '../../demo/demo-boundary.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

/** 권한 사본이 없어도 고객 라우트 판정은 역할을 보지 않는다. */
class UnconfiguredSource extends RolePermissionSource {
  isConfigured(): boolean {
    return false;
  }

  async fetch(): Promise<SnapshotFetch> {
    return { status: 'not_modified' };
  }
}

const ISSUER = 'https://auth.test';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// 고객 셀프서비스(@StoreRoute)는 인증만 요구한다 — 앱과 같은 전역 가드 순서(DemoBoundary → JwtAuth → Permission).
describe('user-service 고객 셀프서비스 라우트 인증', () => {
  let app: NestFastifyApplication;
  const consents = { getMyConsent: jest.fn().mockResolvedValue({ marketingConsent: true }) };
  const users = { updateMyProfile: jest.fn().mockResolvedValue(undefined) };
  const jwt = new JwtService({ privateKey, signOptions: { algorithm: 'RS256', issuer: ISSUER, expiresIn: '5m' } });
  const tokenFor = (roles: string[]) =>
    jwt.sign({ sub: 'user-a', email: 'a@example.com', roles }, { audience: INTERNAL_TOKEN_AUDIENCE });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          isGlobal: true,
          load: [() => ({ OAUTH_JWT_PUBLIC_KEY: publicKey, OAUTH_ISSUER_URL: ISSUER })],
        }),
        PassportModule,
        PermissionModule.forRoot({ service: 'user-service', source: UnconfiguredSource }),
      ],
      controllers: [ConsentsController, UsersController],
      providers: [
        JwtAccessStrategy,
        { provide: OAuthRepository, useValue: { findActiveClientById: jest.fn().mockResolvedValue(null) } },
        { provide: ConsentsService, useValue: consents },
        { provide: UsersService, useValue: users },
        { provide: WithdrawnReplayService, useValue: {} },
        { provide: APP_GUARD, useClass: DemoBoundaryGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const call = (method: 'GET' | 'PATCH', url: string, token?: string) =>
    app.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(method === 'PATCH' ? { payload: { nickname: undefined } } : {}),
    });

  it.each([
    ['GET', '/consents'],
    ['PATCH', '/users/me'],
  ] as const)('%s %s 는 토큰이 없으면 401', async (method, url) => {
    const res = await call(method, url);
    expect(res.statusCode).toBe(401);
    expect(consents.getMyConsent).not.toHaveBeenCalled();
    expect(users.updateMyProfile).not.toHaveBeenCalled();
  });

  it.each([
    ['역할 없음', []],
    ['권한 체계로만 만든 직원 역할', ['logistics_worker']],
    ['고객', ['customer']],
  ])('%s 토큰으로 GET /consents 는 200 이고 토큰 사용자 id 로 조회한다', async (_name, roles) => {
    const res = await call('GET', '/consents', tokenFor(roles));
    expect(res.statusCode).toBe(200);
    expect(consents.getMyConsent).toHaveBeenCalledWith('user-a');
  });

  it.each([
    ['역할 없음', []],
    ['권한 체계로만 만든 직원 역할', ['logistics_worker']],
    ['고객', ['customer']],
  ])('%s 토큰으로 PATCH /users/me 는 200 이고 토큰 사용자 id 로 고친다', async (_name, roles) => {
    const res = await call('PATCH', '/users/me', tokenFor(roles));
    expect(res.statusCode).toBe(200);
    expect(users.updateMyProfile).toHaveBeenCalledWith('user-a', expect.anything());
  });
});
