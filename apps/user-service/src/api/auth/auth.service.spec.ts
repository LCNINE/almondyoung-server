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

// bcrypt mock
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
}));

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
      findUserByEmail: jest.fn(),
      findUserByLoginId: jest.fn(),
      findUserByNickname: jest.fn(),
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
      usersService.findUserByEmail.mockResolvedValue(null);
      usersService.findUserByLoginId.mockResolvedValue(null);
      usersService.findUserByNickname.mockResolvedValue(null);
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
      usersService.findUserByEmail.mockResolvedValue(null);
      usersService.findUserByLoginId.mockResolvedValue(null);
      usersService.findUserByNickname.mockResolvedValue(null);
    });

    it('이미 가입된 이메일이면 ConflictException 을 던진다', async () => {
      usersService.findUserByEmail.mockResolvedValue({ id: 'other-user-id' } as any);

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow(ConflictException);
      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow('이미 가입된 이메일입니다.');
    });

    it('이메일 인증 여부와 무관하게 거절한다 (미인증 재가입 흐름은 없다)', async () => {
      usersService.findUserByEmail.mockResolvedValue({ id: 'other-user-id', isEmailVerified: false } as any);

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow('이미 가입된 이메일입니다.');
    });

    it('이미 존재하는 loginId면 ConflictException을 던져야 한다', async () => {
      usersService.findUserByLoginId.mockResolvedValue({ id: 'other-user-id' } as any);

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow(ConflictException);
      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow('이미 존재하는 아이디입니다.');
    });

    it('이미 존재하는 닉네임이면 ConflictException을 던져야 한다', async () => {
      usersService.findUserByNickname.mockResolvedValue({ id: 'other-user-id' } as any);

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow(ConflictException);
      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow('이미 존재하는 닉네임입니다.');
    });

    it('이메일 중복이 loginId·닉네임 중복보다 먼저 판정된다', async () => {
      usersService.findUserByEmail.mockResolvedValue({ id: 'a' } as any);
      usersService.findUserByLoginId.mockResolvedValue({ id: 'b' } as any);
      usersService.findUserByNickname.mockResolvedValue({ id: 'c' } as any);

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow('이미 가입된 이메일입니다.');
    });
  });

  describe('에러 핸들링', () => {
    it('ConflictException이 아닌 에러는 InternalServerErrorException으로 변환해야 한다', async () => {
      usersService.findUserByEmail.mockRejectedValue(new Error('DB connection failed'));

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow(InternalServerErrorException);
    });
  });
});
