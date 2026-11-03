import { RoleAssignmentManager } from '../iam/assignments/role-assignment.manager';
import { IamLastOperatorError, IamStaffCannotLeaveError } from '../iam/iam.errors';
import { PlatformOperatorManager } from '../iam/tenancy/platform-operator.manager';
import { DbService } from '@app/db';
import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { LocalSignUpDto } from './dto/sign-up.dto';
import { ConsentsService } from '../consents/consents.service';
import { TokensService } from '../tokens/tokens.service';
import { UsersService } from '../users/users.service';
import { Cafe24LinkService } from '../cafe24-link/cafe24-link.service';
import { SERVED_TENANT_ID } from '../../tenancy/served-tenant';
import { TENANT_CONTEXT_KEY } from '@app/tenancy';
import { ClsServiceManager } from 'nestjs-cls';
import { ProviderType } from '../../commons/types';

// bcrypt mock
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
}));

// 가입이 계정을 기록하는 테넌트가 '1' 이라는 기본값에서 오지 않음을 보이려고 다른 값을 섬긴다.
const SERVED = 'acme';

describe('AuthService - signUp', () => {
  let service: AuthService;
  let usersService: Record<string, jest.Mock>;
  let configService: Record<string, jest.Mock>;

  // DB client mock (transaction 내부에서 사용되는 체이닝 메서드)
  const mockWhere = jest.fn().mockResolvedValue(undefined);
  const mockSet = jest.fn().mockReturnValue({ where: mockWhere });
  const mockReturning = jest.fn().mockResolvedValue([{ id: 'new-user-id' }]);
  const mockValues = jest.fn().mockReturnValue({ returning: mockReturning });
  const mockInsertValues = jest.fn().mockResolvedValue(undefined);

  const mockClient = {
    update: jest.fn().mockReturnValue({ set: mockSet }),
    insert: jest.fn().mockReturnValue({ values: mockValues }),
  };

  // reply mock (FastifyReply)
  const mockRedirect = jest.fn();
  const mockReply = {
    status: jest.fn().mockReturnValue({ redirect: mockRedirect }),
  } as any;

  // 공통 signUpDto
  const baseSignUpDto: LocalSignUpDto = {
    email: 'test@example.com',
    username: '테스트',
    nickname: '테스트닉',
    password: 'password123',
    loginId: 'testuser',
    isOver14: true,
    termsOfService: true,
    electronicTransaction: true,
    privacyPolicy: true,
    thirdPartySharing: false,
    marketingConsent: false,
    birthday: '19900101',
    phoneNumber: '+821012345678',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    usersService = {
      findUserByEmailInTenant: jest.fn(),
      findUserByLoginIdInTenant: jest.fn(),
      findUserByNicknameInTenant: jest.fn(),
      updateMyProfile: jest.fn().mockResolvedValue(undefined),
    };

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      }),
      getOrThrow: jest.fn().mockReturnValue('test-secret'),
    };

    // transaction mock: 콜백을 바로 실행하고 mockClient를 tx로 전달
    const mockDbService = {
      db: {
        transaction: jest.fn().mockImplementation((cb: Function) => cb(mockClient)),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: { signAsync: jest.fn() } },
        { provide: ConfigService, useValue: configService },
        { provide: DbService, useValue: mockDbService },
        { provide: 'STREAM_PUBLISHER_users.events.v1', useValue: { publishEvent: jest.fn() } },
        { provide: ConsentsService, useValue: {} },
        { provide: TokensService, useValue: {} },
        { provide: RoleAssignmentManager, useValue: { assertNotStaff: jest.fn() } },
        { provide: PlatformOperatorManager, useValue: { assertCanLeave: jest.fn() } },
        { provide: SERVED_TENANT_ID, useValue: SERVED },
        {
          provide: Cafe24LinkService,
          useValue: {
            linkCafe24Account: jest.fn(),
            issueSignupBootstrapData: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    // getClient가 tx를 반환하도록 내부 동작 보장
    // (transaction mock에서 mockClient를 tx로 넘기므로 getClient(tx) = mockClient)

    // insert mock을 케이스별로 재설정
    mockValues.mockReturnValue({ returning: mockReturning });
    mockReturning.mockResolvedValue([{ id: 'new-user-id' }]);

    // insert가 consents용으로도 호출될 수 있으므로 values mock을 유연하게 설정
    mockClient.insert.mockReturnValue({
      values: jest.fn().mockImplementation((val) => {
        // returning()이 있으면 users insert, 없으면 consents insert
        if (val.email) {
          return { returning: mockReturning };
        }
        return Promise.resolve(undefined);
      }),
    });
  });

  // ⚠️ 이 스펙은 2026-02-02 커밋 63573e574 ("회원가입 시 이메일/아이디/닉네임 중복
  // 체크 로직 간소화 및 불필요한 코드 제거", -55줄) 이후로 계속 빨갰다. 그 커밋이
  // "미인증 이메일 재가입" 흐름과 302 리다이렉트를 통째로 걷어냈는데 스펙만 남았다.
  // 지금 signUp 은 리다이렉트하지 않고 { userId, signupToken, message } 를 반환하며,
  // 이미 가입된 이메일은 인증 여부와 무관하게 무조건 거절한다.

  describe('새 유저 회원가입', () => {
    beforeEach(() => {
      usersService.findUserByEmailInTenant.mockResolvedValue(null);
      usersService.findUserByLoginIdInTenant.mockResolvedValue(null);
      usersService.findUserByNicknameInTenant.mockResolvedValue(null);
    });

    it('가입에 성공하면 userId·signupToken·성공 메시지를 반환한다', async () => {
      const result = await service.signUp(baseSignUpDto, mockReply);

      expect(result).toEqual({
        userId: 'new-user-id',
        signupToken: undefined, // jwtService.signAsync 목이 값을 안 돌려준다
        message: '회원가입 성공',
      });
    });

    it('리다이렉트하지 않는다 — 호출자가 signupToken 을 교환한다', async () => {
      await service.signUp(baseSignUpDto, mockReply, '/mypage');

      expect(mockReply.status).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('새 계정은 이 앱이 섬기는 테넌트의 계정이다', async () => {
      await service.signUp(baseSignUpDto, mockReply);

      const values = mockClient.insert.mock.results[0].value.values as jest.Mock;
      const userValues = values.mock.calls.map(([v]) => v).find((v) => v.loginId === 'testuser');
      expect(userValues).toEqual(expect.objectContaining({ tenantId: SERVED }));
    });

    it('비밀번호를 bcrypt로 해싱해야 한다', async () => {
      await service.signUp(baseSignUpDto, mockReply);

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
    });

    it('유저 프로필에 생년월일과 휴대폰 번호를 업데이트해야 한다', async () => {
      await service.signUp(baseSignUpDto, mockReply);

      expect(usersService.updateMyProfile).toHaveBeenCalledWith(
        'new-user-id',
        { birthDate: '19900101', phoneNumber: '+821012345678' },
        expect.anything(),
      );
    });
  });

  describe('중복 거절', () => {
    beforeEach(() => {
      usersService.findUserByEmailInTenant.mockResolvedValue(null);
      usersService.findUserByLoginIdInTenant.mockResolvedValue(null);
      usersService.findUserByNicknameInTenant.mockResolvedValue(null);
    });

    it('이미 가입된 이메일이면 ConflictException 을 던진다', async () => {
      usersService.findUserByEmailInTenant.mockResolvedValue({ id: 'other-user-id' } as any);

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow(ConflictException);
      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow('이미 가입된 이메일입니다.');
    });

    it('이메일 인증 여부와 무관하게 거절한다 (미인증 재가입 흐름은 없다)', async () => {
      usersService.findUserByEmailInTenant.mockResolvedValue({ id: 'other-user-id', isEmailVerified: false } as any);

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow('이미 가입된 이메일입니다.');
    });

    it('이미 존재하는 loginId면 ConflictException을 던져야 한다', async () => {
      usersService.findUserByLoginIdInTenant.mockResolvedValue({ id: 'other-user-id' } as any);

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow(ConflictException);
      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow('이미 존재하는 아이디입니다.');
    });

    it('이미 존재하는 닉네임이면 ConflictException을 던져야 한다', async () => {
      usersService.findUserByNicknameInTenant.mockResolvedValue({ id: 'other-user-id' } as any);

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow(ConflictException);
      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow('이미 존재하는 닉네임입니다.');
    });

    it('세 값의 중복은 이 앱이 섬기는 테넌트 안에서만 묻는다', async () => {
      await service.signUp(baseSignUpDto, mockReply);

      expect(usersService.findUserByEmailInTenant).toHaveBeenCalledWith(SERVED, 'test@example.com', mockClient);
      expect(usersService.findUserByLoginIdInTenant).toHaveBeenCalledWith(SERVED, 'testuser', mockClient);
      expect(usersService.findUserByNicknameInTenant).toHaveBeenCalledWith(SERVED, '테스트닉', mockClient);
    });

    // 10(contract) 전에는 DB 가 이메일·아이디를 아직 전역으로 막는다 — 다른 테넌트 계정이 가진 값이면 테넌트 안 검사는 통과하고
    // insert 가 23505 로 실패한다. 오늘과 같은 안내(409)로 돌려준다.
    it.each([
      ['users_email_unique', '이미 가입된 이메일입니다.'],
      ['users_login_id_unique', '이미 존재하는 아이디입니다.'],
    ])('DB 전역 unique(%s)에 걸리면 같은 409 안내를 준다', async (constraint, message) => {
      mockReturning.mockRejectedValueOnce(
        Object.assign(new Error('Failed query'), { cause: { code: '23505', constraint_name: constraint } }),
      );

      const attempt = service.signUp(baseSignUpDto, mockReply);
      await expect(attempt).rejects.toThrow(ConflictException);
      await expect(attempt).rejects.toThrow(message);
    });

    it('이메일 중복이 loginId·닉네임 중복보다 먼저 판정된다', async () => {
      usersService.findUserByEmailInTenant.mockResolvedValue({ id: 'a' } as any);
      usersService.findUserByLoginIdInTenant.mockResolvedValue({ id: 'b' } as any);
      usersService.findUserByNicknameInTenant.mockResolvedValue({ id: 'c' } as any);

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow('이미 가입된 이메일입니다.');
    });
  });

  describe('에러 핸들링', () => {
    it('ConflictException이 아닌 에러는 InternalServerErrorException으로 변환해야 한다', async () => {
      usersService.findUserByEmailInTenant.mockRejectedValue(new Error('DB connection failed'));

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow(InternalServerErrorException);
    });
  });
});

describe('AuthService - 소셜 가입', () => {
  // 처음 보는 소셜 계정이면 계정을 새로 만든다 — 그 계정도 이 앱이 섬기는 테넌트의 것이다.
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const limit = jest.fn();
  const returning = jest.fn();
  const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, limit };
  const tx = {
    select: () => chain,
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ table, values });
        return Object.assign(Promise.resolve(undefined), {
          returning: () => returning(values),
        });
      },
    }),
  };
  let service: AuthService;
  let usersService: { findUserByEmailInTenant: jest.Mock; findSocialAccountInTenant: jest.Mock };
  const reply = () => ({ status: jest.fn().mockReturnValue({ redirect: jest.fn() }) }) as never;

  beforeEach(async () => {
    inserted.length = 0;
    limit.mockReset();
    // 기본 역할 조회 하나뿐이다 — 기존 계정 찾기·이메일 중복은 UsersService 의 테넌트 안 조회다.
    limit.mockResolvedValueOnce([{ roleId: 'role-user' }]);
    returning.mockReset();
    returning.mockImplementation((values: Record<string, unknown>) =>
      Promise.resolve([{ id: 'social-user', email: values.email, username: values.username }]),
    );
    usersService = {
      findUserByEmailInTenant: jest.fn().mockResolvedValue(null),
      findSocialAccountInTenant: jest.fn().mockResolvedValue(null),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('social-token') } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined), getOrThrow: jest.fn().mockReturnValue('secret') },
        },
        { provide: DbService, useValue: {} },
        { provide: 'STREAM_PUBLISHER_users.events.v1', useValue: { publishEvent: jest.fn() } },
        { provide: ConsentsService, useValue: {} },
        { provide: TokensService, useValue: {} },
        { provide: RoleAssignmentManager, useValue: { assertNotStaff: jest.fn() } },
        { provide: PlatformOperatorManager, useValue: { assertCanLeave: jest.fn() } },
        { provide: SERVED_TENANT_ID, useValue: SERVED },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('records the served tenant on the new account and on its customer role', async () => {
    await service.signInWithSocial(
      { name: '소셜', email: 'social@example.com', providerId: 'k-1' },
      ProviderType.KAKAO,
      reply(),
      tx as never,
    );

    const account = inserted.find((i) => i.values.loginId === 'kakao_k-1');
    expect(account?.values).toEqual(expect.objectContaining({ tenantId: SERVED }));
    const role = inserted.find((i) => i.values.roleId === 'role-user');
    expect(role?.values).toEqual(expect.objectContaining({ tenantId: SERVED }));
  });

  it('기존 계정 찾기와 이메일 중복은 이 앱이 섬기는 테넌트 안에서 묻는다', async () => {
    await service.signInWithSocial(
      { name: '소셜', email: 'social@example.com', providerId: 'k-1' },
      ProviderType.KAKAO,
      reply(),
      tx as never,
    );

    expect(usersService.findSocialAccountInTenant).toHaveBeenCalledWith(SERVED, ProviderType.KAKAO, 'k-1', tx);
    expect(usersService.findUserByEmailInTenant).toHaveBeenCalledWith(SERVED, 'social@example.com', tx);
  });

  // 다른 테넌트 계정에 붙은 신원이면 이 테넌트에선 새 가입으로 가는데, 10(contract) 전에는 전역 unique 가 insert 를 막는다.
  // 그 DB 오류 원문(이메일·이름이 든 질의 파라미터)이 카카오 콜백의 리디렉트 주소(?errorMessage=)로 나가면 안 된다.
  it.each(['users_login_id_unique', 'users_email_unique'])(
    'DB 전역 unique(%s)에 걸리면 개인정보 없는 안내로 실패한다',
    async (constraint) => {
      returning.mockRejectedValueOnce(
        Object.assign(new Error('Failed query: insert into "users" params: kakao_k-1,소셜,social@example.com'), {
          cause: { code: '23505', constraint_name: constraint },
        }),
      );

      const attempt = service.signInWithSocial(
        { name: '소셜', email: 'social@example.com', providerId: 'k-1' },
        ProviderType.KAKAO,
        reply(),
        tx as never,
      );

      await expect(attempt).rejects.toThrow('This email already exists');
      await expect(attempt).rejects.not.toThrow(/social@example\.com|소셜/);
    },
  );

  it('이 테넌트에 그 소셜 신원의 계정이 있으면 새로 만들지 않고 그 계정으로 들어간다', async () => {
    usersService.findSocialAccountInTenant.mockResolvedValue({ id: 'kakao-regular', email: 'social@example.com' });

    await service.signInWithSocial(
      { name: '소셜', email: 'social@example.com', providerId: 'k-1' },
      ProviderType.KAKAO,
      reply(),
      tx as never,
    );

    expect(inserted).toHaveLength(0);
    expect(usersService.findUserByEmailInTenant).not.toHaveBeenCalled();
  });
});

/**
 * 탈퇴는 "고객 입장에서 완전히 사라진 것"이어야 한다.
 * 식별정보 파기와 로그인 차단이 함께 성립하는지를 본다.
 */
describe('AuthService - 탈퇴 익명화', () => {
  let service: AuthService;
  let publishedInTenant: (string | undefined)[];
  let updates: { table: unknown; set: Record<string, unknown> }[];
  let deletes: unknown[];
  let publishEvent: jest.Mock;
  let tx: object;
  const leaving = { assertCanLeave: jest.fn(), assertNotStaff: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    leaving.assertCanLeave.mockResolvedValue(undefined);
    leaving.assertNotStaff.mockResolvedValue(undefined);
    updates = [];
    deletes = [];
    publishedInTenant = [];
    publishEvent = jest.fn(() => {
      const cls = ClsServiceManager.getClsService();
      publishedInTenant.push(cls.isActive() ? cls.get<string>(TENANT_CONTEXT_KEY) : undefined);
    });

    tx = {
      update: jest.fn((table: unknown) => ({
        set: jest.fn((set: Record<string, unknown>) => {
          updates.push({ table, set });
          return { where: jest.fn().mockResolvedValue(undefined) };
        }),
      })),
      delete: jest.fn((table: unknown) => {
        deletes.push(table);
        return { where: jest.fn().mockResolvedValue(undefined) };
      }),
      select: jest.fn(() => ({
        from: () => ({
          where: () => ({ limit: jest.fn().mockResolvedValue([{ email: 'member@example.com', username: '홍길동', tenantId: '2' }]),
          }),
        }),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: {} },
        { provide: JwtService, useValue: { signAsync: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(), getOrThrow: jest.fn() } },
        {
          provide: DbService,
          useValue: {
            db: { transaction: jest.fn().mockImplementation((cb: Function) => cb(tx)) },
            run: jest.fn((cb: Function, outer?: unknown) => cb(outer ?? tx)),
          },
        },
        { provide: 'STREAM_PUBLISHER_users.events.v1', useValue: { publishEvent } },
        { provide: ConsentsService, useValue: {} },
        { provide: TokensService, useValue: { deleteAllTokens: jest.fn().mockResolvedValue(undefined) } },
        { provide: Cafe24LinkService, useValue: {} },
        { provide: RoleAssignmentManager, useValue: leaving },
        { provide: PlatformOperatorManager, useValue: leaving },
        { provide: SERVED_TENANT_ID, useValue: '1' },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  const USER_ID = '00000000-1111-2222-3333-444444444444';

  it('식별정보를 원본으로 되돌릴 수 없는 값으로 덮는다', async () => {
    await service.softDeleteUser(USER_ID);

    const identity = updates.find((u) => 'loginId' in u.set);
    expect(identity).toBeDefined();
    expect(identity!.set.loginId).toMatch(/^withdrawn_/);
    expect(identity!.set.email).toMatch(/^withdrawn_.*@deleted\.invalid$/);
    expect(identity!.set.username).toBe('탈퇴회원');
    expect(identity!.set.deletedAt).toBeInstanceOf(Date);
  });

  it('비밀번호를 지워 대조 자체가 성립하지 않게 한다', async () => {
    await service.softDeleteUser(USER_ID);

    const identity = updates.find((u) => 'loginId' in u.set);
    expect(identity!.set.password).toBeNull();
  });

  it('아이디·이메일 유일 제약을 풀어 같은 주소로 재가입할 수 있게 한다', async () => {
    await service.softDeleteUser(USER_ID);

    const identity = updates.find((u) => 'loginId' in u.set);
    // 사용자 id 에서 파생하므로 계정마다 다르다 — 두 탈퇴자가 같은 값으로 충돌하지 않는다.
    expect(identity!.set.loginId).toContain(USER_ID.replace(/-/g, '').slice(0, 20));
    expect(String(identity!.set.loginId).length).toBeLessThanOrEqual(30);
    expect(String(identity!.set.email).length).toBeLessThanOrEqual(60);
  });

  it('법정 보관 근거가 없는 부가 개인정보 행을 지운다', async () => {
    await service.softDeleteUser(USER_ID);

    // profiles / user_identities / cafe24_links / wishlist / recent_views
    // + business_licenses / shops (사업자번호 유일 제약이 재가입을 막지 않도록)
    expect(deletes).toHaveLength(7);
  });

  it('살아있는 세션을 끊는다', async () => {
    await service.softDeleteUser(USER_ID);

    const revoke = updates.find((u) => u.set.isRevoked === true);
    expect(revoke).toBeDefined();
  });

  it('UserDeleted 이벤트를 익명화 전 이메일·이름과 함께 발행한다', async () => {
    await service.softDeleteUser(USER_ID);

    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'UserDeleted',
        aggregateId: USER_ID,
        payload: { userId: USER_ID, email: 'member@example.com', name: '홍길동' },
      }),
    );
  });

  // 봉투의 테넌트는 발행 순간의 맥락이다 — 요청이 다른 테넌트 화면에서 왔어도 탈퇴는 계정의 테넌트 일이다(ADR-0056).
  it('UserDeleted 는 계정의 테넌트로 낸다 — 요청 맥락이 다른 테넌트여도', async () => {
    const cls = ClsServiceManager.getClsService();
    const after = await cls.run(async () => {
      cls.set(TENANT_CONTEXT_KEY, '1');
      await service.softDeleteUser(USER_ID);
      return cls.get<string>(TENANT_CONTEXT_KEY);
    });

    expect(publishedInTenant).toEqual(['2']);
    expect(after).toBe('1'); // 같은 요청의 다른 이벤트는 그대로 화면의 테넌트
  });

  it('refuses to withdraw the last platform operator', async () => {
    leaving.assertCanLeave.mockRejectedValue(new IamLastOperatorError());
    await expect(service.softDeleteUser(USER_ID)).rejects.toBeInstanceOf(IamLastOperatorError);
    expect(updates).toHaveLength(0);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('checks the last platform operator inside the withdrawal transaction', async () => {
    await service.softDeleteUser(USER_ID);
    expect(leaving.assertCanLeave).toHaveBeenCalledWith(USER_ID, tx);
  });

  it('does not anonymize a staff account', async () => {
    leaving.assertNotStaff.mockRejectedValue(new IamStaffCannotLeaveError());
    await expect(service.softDeleteUser(USER_ID)).rejects.toBeInstanceOf(IamStaffCannotLeaveError);
    expect(leaving.assertNotStaff).toHaveBeenCalledWith(USER_ID, tx);
    expect(leaving.assertCanLeave).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(deletes).toHaveLength(0);
    expect(publishEvent).not.toHaveBeenCalled();
  });
});

/**
 * 아이디 찾기·비밀번호 찾기·재설정은 그 앱의 테넌트(앱 설정 T) 계정만 찾는다(ADR-0056) — 같은 번호·아이디·이메일의 다른 테넌트
 * 계정은 «없는 계정»과 같다. 찾기 화면은 쇼핑몰(T)에만 있다.
 */
describe('AuthService - 찾기·재설정은 테넌트 안', () => {
  let service: AuthService;
  let updated: jest.Mock;
  let jwt: { signAsync: jest.Mock; verify: jest.Mock };

  const PHONE = '01012345678';
  const MINE = { id: '00000000-0000-0000-0000-00000000000a', loginId: 'mine', email: 'mine@example.com' };
  const THEIRS = { id: '00000000-0000-0000-0000-00000000000b', loginId: 'theirs', email: 'theirs@example.com' };
  /** 계정 둘 — MINE 은 T, THEIRS 는 다른 테넌트. 같은 번호를 쓴다. */
  const accountsOf = (tenantId: string) => (tenantId === SERVED ? [MINE] : [THEIRS]);

  /** select 체인 — 어떤 경로든 마지막 limit 이 이 값을 낸다(인증 기록·프로필 번호). */
  const selectChain = (rows: unknown[]) => {
    const chain: Record<string, jest.Mock> = {};
    for (const step of ['from', 'where', 'orderBy']) chain[step] = jest.fn(() => chain);
    chain.limit = jest.fn().mockResolvedValue(rows);
    return chain;
  };

  beforeEach(async () => {
    updated = jest.fn().mockResolvedValue(undefined);
    jwt = { signAsync: jest.fn().mockResolvedValue('reset-token'), verify: jest.fn() };

    const usersService = {
      findUsersByPhoneNumber: jest.fn(async (tenantId: string) => accountsOf(tenantId)),
      findUserByLoginIdInTenant: jest.fn(
        async (tenantId: string, loginId: string) => accountsOf(tenantId).find((a) => a.loginId === loginId) ?? null,
      ),
      findUserByIdInTenant: jest.fn(
        async (tenantId: string, id: string) => accountsOf(tenantId).find((a) => a.id === id) ?? null,
      ),
      findUserByEmailInTenant: jest.fn(
        async (tenantId: string, email: string) => accountsOf(tenantId).find((a) => a.email === email) ?? null,
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: jest.fn(), getOrThrow: jest.fn().mockReturnValue('secret') } },
        {
          provide: DbService,
          useValue: {
            db: {
              // 인증 기록과 프로필 둘 다 «같은 번호로 인증됨» 이다.
              select: jest.fn(() => selectChain([{ phoneNumber: PHONE }])),
              update: jest.fn(() => ({ set: jest.fn(() => ({ where: updated })) })),
            },
          },
        },
        { provide: 'STREAM_PUBLISHER_users.events.v1', useValue: { publishEvent: jest.fn() } },
        { provide: ConsentsService, useValue: {} },
        { provide: TokensService, useValue: {} },
        { provide: Cafe24LinkService, useValue: {} },
        { provide: RoleAssignmentManager, useValue: {} },
        { provide: PlatformOperatorManager, useValue: {} },
        { provide: SERVED_TENANT_ID, useValue: SERVED },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('아이디 찾기는 같은 번호의 다른 테넌트 계정을 돌려주지 않는다', async () => {
    await expect(service.forgetUserId(PHONE)).resolves.toEqual({ loginIds: ['mine'] });
  });

  it('비밀번호 찾기에서 다른 테넌트의 아이디는 «일치하는 계정 없음»이다', async () => {
    await expect(service.forgotPassword(PHONE, 'theirs')).rejects.toMatchObject({ status: 404 });
    expect(jwt.signAsync).not.toHaveBeenCalled();

    await expect(service.forgotPassword(PHONE, 'mine')).resolves.toEqual({ verificationToken: 'reset-token' });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: MINE.id }, expect.anything());
  });

  it('재설정 토큰이 다른 테넌트 계정을 가리키면 바꾸지 않는다', async () => {
    jwt.verify.mockReturnValue({ sub: THEIRS.id });
    await expect(service.resetPassword('t', 'new-password')).rejects.toMatchObject({ status: 404 });
    expect(updated).not.toHaveBeenCalled();

    jwt.verify.mockReturnValue({ sub: MINE.id });
    await expect(service.resetPassword('t', 'new-password')).resolves.toBeUndefined();
    expect(updated).toHaveBeenCalledTimes(1);
  });

  it('레거시 재설정 토큰(이메일 문자열)도 그 테넌트의 이메일만 찾는다', async () => {
    jwt.verify.mockReturnValue(THEIRS.email);
    await expect(service.resetPassword('t', 'new-password')).rejects.toMatchObject({ status: 404 });
    expect(updated).not.toHaveBeenCalled();

    jwt.verify.mockReturnValue(MINE.email);
    await expect(service.resetPassword('t', 'new-password')).resolves.toBeUndefined();
    expect(updated).toHaveBeenCalledTimes(1);
  });
});
