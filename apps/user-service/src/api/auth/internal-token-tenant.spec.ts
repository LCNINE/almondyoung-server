import { DbService } from '@app/db';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { generateKeyPairSync } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { RoleAssignmentManager } from '../iam/assignments/role-assignment.manager';
import { PlatformOperatorManager } from '../iam/tenancy/platform-operator.manager';
import { ConsentsService } from '../consents/consents.service';
import { TokensService } from '../tokens/tokens.service';
import { UsersService } from '../users/users.service';
import { SERVED_TENANT_ID } from '../../tenancy/served-tenant';
import { INTERNAL_TOKEN_AUDIENCE } from '../../constants/auth.constant';
import { AuthService } from './auth.service';

/**
 * 옛 내부 토큰(`aud=user-service-internal`) — 쇼핑몰과 auth-web 이 쿠키로 들고 다니는 세션. `tenant` 클레임이 없고
 * (테넌트 문이 reject 모드인 core 는 이 토큰을 거절한다), 역할은 user-service 의 T 에서 받은 부여만 싣는다. 테넌트 2 직원이 테넌트 도메인
 * 에서 로그인해도 이 토큰에는 테넌트 2 역할이 실리지 않는다.
 */
describe('옛 내부 토큰 — 테넌트 클레임 없이 T 의 부여만 싣는다', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const grants: Record<string, string[]> = { '1': ['user'], '2': ['catalog_manager'] };
  const user = {
    id: 'u-1',
    email: 'a@b.c',
    loginId: 'shopper',
    username: '홍길동',
    password: 'hash',
    deletedAt: null,
    dormantAt: null,
  };

  let service: AuthService;
  let usersService: {
    findUserByLoginId: jest.Mock;
    findUserById: jest.Mock;
    getTokenRoleNames: jest.Mock;
    assignDefaultRoleToUser: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let cookies: Record<string, string>;
  const reply = { setCookie: (name: string, value: string) => (cookies[name] = value) };

  beforeEach(async () => {
    cookies = {};
    usersService = {
      findUserByLoginId: jest.fn().mockResolvedValue(user),
      findUserById: jest.fn().mockResolvedValue(user),
      getTokenRoleNames: jest.fn((_userId: string, tenantId: string) => Promise.resolve(grants[tenantId] ?? [])),
      assignDefaultRoleToUser: jest.fn().mockResolvedValue(undefined),
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('refresh-jwt'), verifyAsync: jest.fn() };
    const config: Record<string, string> = {
      OAUTH_JWT_PRIVATE_KEY: privateKey,
      OAUTH_ISSUER_URL: 'https://user.test',
      OAUTH_JWT_KID: 'kid',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_VERIFICATION_TOKEN_SECRET: 'verification-secret',
    };
    const update = { set: () => ({ where: () => Promise.resolve(undefined) }) };
    const db = {
      update: () => update,
      transaction: (fn: (tx: unknown) => unknown) => Promise.resolve(fn({ update: () => update })),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key], getOrThrow: (key: string) => config[key] },
        },
        { provide: DbService, useValue: { db } },
        { provide: 'STREAM_PUBLISHER_users.events.v1', useValue: { publishEvent: jest.fn() } },
        { provide: ConsentsService, useValue: {} },
        { provide: TokensService, useValue: { saveRefreshToken: jest.fn().mockResolvedValue(undefined) } },
        { provide: RoleAssignmentManager, useValue: { assertNotStaff: jest.fn() } },
        { provide: PlatformOperatorManager, useValue: { assertCanLeave: jest.fn() } },
        { provide: SERVED_TENANT_ID, useValue: '1' },
      ],
    }).compile();
    service = module.get(AuthService);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
  });
  afterEach(() => jest.restoreAllMocks());

  const accessClaims = () => jwt.decode(cookies.accessToken) as Record<string, unknown>;

  it('로그인한 내부 토큰에는 tenant 클레임이 없고 aud 는 내부 토큰이다', async () => {
    await service.signIn({ loginId: 'shopper', password: 'pw', rememberMe: false }, reply as never);

    expect(accessClaims().aud).toBe(INTERNAL_TOKEN_AUDIENCE);
    expect(accessClaims()).not.toHaveProperty('tenant');
  });

  it('역할은 T 에서 받은 부여만 — 다른 테넌트의 부여는 실리지 않는다', async () => {
    await service.signIn({ loginId: 'shopper', password: 'pw', rememberMe: false }, reply as never);

    expect(accessClaims().roles).toEqual(['user']);
    expect(usersService.getTokenRoleNames).toHaveBeenCalledWith('u-1', '1', undefined);
    expect(usersService.getTokenRoleNames).not.toHaveBeenCalledWith('u-1', '2', expect.anything());
  });

  it('리프레시 토큰의 역할도 T 의 부여만', async () => {
    await service.signIn({ loginId: 'shopper', password: 'pw', rememberMe: false }, reply as never);

    const [[refreshPayload]] = jwtService.signAsync.mock.calls as [[{ roles: string[] }]];
    expect(refreshPayload.roles).toEqual(['user']);
  });

  it('고객 가입은 고객 역할을 T 에서 준다', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'u-1', purpose: 'signup_callback' });

    await service.callbackSignup('signup-token', reply as never);

    expect(usersService.assignDefaultRoleToUser).toHaveBeenCalledWith('u-1', '1', expect.anything());
  });
});
