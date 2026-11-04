import { DbService } from '@app/db';
import { BadRequestException } from '@nestjs/common';
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
 * 내부 세션 토큰(`aud=user-service-internal`) — 쇼핑몰과 auth-web 이 쿠키로 들고 다니는 세션. 계정은 한 테넌트의 것이라
 * (ADR-0056) `tenant` 는 그 계정의 테넌트이고 역할은 그 테넌트에서 받은 부여만 싣는다. 테넌트 1 계정에게는 지금과 같다(T = 1).
 * 클레임이 없으면 클레임만 보는 core·file-service·ai 가 reject 모드에서 쇼핑몰 고객의 업로드·`@StoreRoute` 를 거절한다.
 */
describe('내부 세션 토큰 — 계정의 테넌트와 그 테넌트의 부여만 싣는다', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const grants: Record<string, string[]> = { '1': ['user'], '2': ['catalog_manager'] };
  const shopper = {
    id: 'u-1',
    email: 'a@b.c',
    loginId: 'shopper',
    username: '홍길동',
    password: 'hash',
    deletedAt: null,
    dormantAt: null,
  };
  const staffTwo = { ...shopper, id: 'u-2', loginId: 'acmestaff' };
  const tenantOf: Record<string, string> = { 'u-1': '1', 'u-2': '2' };

  let service: AuthService;
  let usersService: {
    findUserByLoginIdInTenant: jest.Mock;
    findUserById: jest.Mock;
    accountTenantOf: jest.Mock;
    getTokenRoleNames: jest.Mock;
    assignDefaultRoleToUser: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let cookies: Record<string, string>;
  const reply = { setCookie: (name: string, value: string) => (cookies[name] = value) };

  beforeEach(async () => {
    cookies = {};
    usersService = {
      // 테넌트 안에서 찾기 — 그 테넌트의 계정만 나온다.
      findUserByLoginIdInTenant: jest.fn((tenantId: string, loginId: string) =>
        Promise.resolve([shopper, staffTwo].find((u) => u.loginId === loginId && tenantOf[u.id] === tenantId) ?? null),
      ),
      findUserById: jest.fn((id: string) => Promise.resolve(id === 'u-2' ? staffTwo : shopper)),
      accountTenantOf: jest.fn((id: string) => Promise.resolve(tenantOf[id])),
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
  const signIn = (loginId: string, siteTenantId?: string) =>
    service.signIn({ loginId, password: 'pw', rememberMe: false }, reply as never, siteTenantId);

  it('테넌트 1 계정의 내부 토큰은 지금과 같다 — tenant 1, 테넌트 1 의 부여, 내부 토큰 aud', async () => {
    await signIn('shopper');

    expect(accessClaims().aud).toBe(INTERNAL_TOKEN_AUDIENCE);
    expect(accessClaims().tenant).toBe('1');
    expect(accessClaims().roles).toEqual(['user']);
  });

  it('다른 테넌트 계정의 내부 토큰은 그 테넌트의 것이고 그 테넌트의 부여만 싣는다', async () => {
    await signIn('acmestaff', '2');

    expect(accessClaims().tenant).toBe('2');
    expect(accessClaims().roles).toEqual(['catalog_manager']);
    expect(usersService.getTokenRoleNames).not.toHaveBeenCalledWith('u-2', '1', expect.anything());
  });

  it('토큰을 다시 받아도(restoreToken) 계정의 테넌트다', async () => {
    await service.restoreToken('u-2', reply as never);

    expect(accessClaims().tenant).toBe('2');
  });

  it('리프레시 토큰의 역할도 계정 테넌트의 부여만', async () => {
    await signIn('acmestaff', '2');

    const [[refreshPayload]] = jwtService.signAsync.mock.calls as [[{ roles: string[] }]];
    expect(refreshPayload.roles).toEqual(['catalog_manager']);
  });

  it('화면의 테넌트가 오면 그 테넌트 안에서만 계정을 찾는다', async () => {
    await signIn('acmestaff', '2');

    expect(usersService.findUserByLoginIdInTenant).toHaveBeenCalledWith('2', 'acmestaff');
    expect(accessClaims().tenant).toBe('2');
  });

  it('화면의 테넌트가 없으면(쇼핑몰이 직접 부르는 로그인) 앱 설정 T 의 계정만 찾는다 — 전체에서 찾지 않는다', async () => {
    await signIn('shopper');
    expect(usersService.findUserByLoginIdInTenant).toHaveBeenLastCalledWith('1', 'shopper');

    const otherTenant = await signIn('acmestaff').catch((e: unknown) => e);
    expect(otherTenant).toBeInstanceOf(BadRequestException);
    expect((otherTenant as BadRequestException).message).toMatch(/아이디 또는 비밀번호/);
  });

  it('다른 테넌트의 계정은 «아이디 또는 비밀번호 틀림»과 같은 응답으로 거절한다', async () => {
    const otherTenant = await signIn('acmestaff', '1').catch((e: unknown) => e);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
    const wrongPassword = await signIn('shopper', '1').catch((e: unknown) => e);

    expect(otherTenant).toBeInstanceOf(BadRequestException);
    expect(wrongPassword).toBeInstanceOf(BadRequestException);
    expect((otherTenant as BadRequestException).getResponse()).toEqual(
      (wrongPassword as BadRequestException).getResponse(),
    );
    expect(cookies.accessToken).toBeUndefined();
  });

  it('고객 가입은 고객 역할을 T 에서 준다', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'u-1', purpose: 'signup_callback' });

    await service.callbackSignup('signup-token', reply as never);

    expect(usersService.assignDefaultRoleToUser).toHaveBeenCalledWith('u-1', '1', expect.anything());
  });
});
