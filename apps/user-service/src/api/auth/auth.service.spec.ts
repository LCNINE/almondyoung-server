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

  describe('새 유저 회원가입', () => {
    beforeEach(() => {
      usersService.findUserByEmail.mockResolvedValue(null);
      usersService.findUserByLoginId.mockResolvedValue(null);
      usersService.findUserByNickname.mockResolvedValue(null);
    });

    it('회원가입 성공 시 /callback/signup으로 리다이렉트해야 한다', async () => {
      await service.signUp(baseSignUpDto, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(302);
      expect(mockRedirect).toHaveBeenCalledWith(
        expect.stringContaining('/callback/signup?redirect_to=/'),
      );
    });

    it('redirect_to 파라미터가 있으면 해당 경로로 리다이렉트해야 한다', async () => {
      await service.signUp(baseSignUpDto, mockReply, '/mypage');

      expect(mockRedirect).toHaveBeenCalledWith(
        expect.stringContaining('/callback/signup?redirect_to=/mypage'),
      );
    });

    it('비밀번호를 bcrypt로 해싱해야 한다', async () => {
      await service.signUp(baseSignUpDto, mockReply);

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
    });

    it('유저 프로필에 생년월일을 업데이트해야 한다', async () => {
      await service.signUp(baseSignUpDto, mockReply);

      expect(usersService.updateMyProfile).toHaveBeenCalledWith(
        'new-user-id',
        { birthDate: '19900101' },
        expect.anything(),
      );
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
  });

  describe('기존 유저 (미인증 이메일) 재가입', () => {
    const existingUser = {
      id: 'existing-user-id',
      email: 'test@example.com',
      isEmailVerified: false,
    };

    beforeEach(() => {
      usersService.findUserByEmail.mockResolvedValue(existingUser as any);
      usersService.findUserByLoginId.mockResolvedValue(null);
      usersService.findUserByNickname.mockResolvedValue(null);

      // update 체이닝 mock 재설정
      mockClient.update.mockReturnValue({ set: mockSet });
      mockSet.mockReturnValue({ where: mockWhere });
      mockWhere.mockResolvedValue(undefined);
    });

    it('유저 정보를 업데이트한 후 /callback/signup으로 리다이렉트해야 한다', async () => {
      await service.signUp(baseSignUpDto, mockReply);

      // users 테이블 업데이트 확인
      expect(mockClient.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
          username: '테스트',
          nickname: '테스트닉',
          loginId: 'testuser',
          password: 'hashed_password',
          isEmailVerified: false,
        }),
      );

      // 리다이렉트 확인
      expect(mockReply.status).toHaveBeenCalledWith(302);
      expect(mockRedirect).toHaveBeenCalledWith(
        expect.stringContaining('/callback/signup?redirect_to=/'),
      );
    });

    it('프로필 생년월일을 업데이트해야 한다', async () => {
      await service.signUp(baseSignUpDto, mockReply);

      expect(usersService.updateMyProfile).toHaveBeenCalledWith(
        'existing-user-id',
        { birthDate: '19900101' },
        expect.anything(),
      );
    });

    it('동의 항목을 업데이트해야 한다', async () => {
      await service.signUp(baseSignUpDto, mockReply);

      // update가 consents에 대해서도 호출되었는지 확인
      // 두 번째 update 호출이 consents 업데이트
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          isOver14: true,
          termsOfService: true,
          electronicTransaction: true,
          privacyPolicy: true,
          thirdPartySharing: false,
          marketingConsent: false,
        }),
      );
    });

    it('다른 유저가 같은 loginId를 사용 중이면 ConflictException을 던져야 한다', async () => {
      usersService.findUserByLoginId.mockResolvedValue({ id: 'another-user-id' } as any);

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow(ConflictException);
      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow('이미 존재하는 아이디입니다.');
    });

    it('본인이 같은 loginId를 사용 중이면 통과해야 한다', async () => {
      usersService.findUserByLoginId.mockResolvedValue({ id: 'existing-user-id' } as any);

      await service.signUp(baseSignUpDto, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(302);
    });

    it('다른 유저가 같은 닉네임을 사용 중이면 ConflictException을 던져야 한다', async () => {
      usersService.findUserByNickname.mockResolvedValue({ id: 'another-user-id' } as any);

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow(ConflictException);
      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow('이미 존재하는 닉네임입니다.');
    });

    it('본인이 같은 닉네임을 사용 중이면 통과해야 한다', async () => {
      usersService.findUserByNickname.mockResolvedValue({ id: 'existing-user-id' } as any);

      await service.signUp(baseSignUpDto, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(302);
    });
  });

  describe('기존 유저 (인증 완료된 이메일)', () => {
    it('이미 인증된 이메일이면 ConflictException을 던져야 한다', async () => {
      usersService.findUserByEmail.mockResolvedValue({
        id: 'existing-user-id',
        email: 'test@example.com',
        isEmailVerified: true,
      } as any);

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow(ConflictException);
      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow(
        '이미 가입된 이메일입니다. 로그인을 시도해주세요.',
      );
    });
  });

  describe('에러 핸들링', () => {
    it('ConflictException이 아닌 에러는 InternalServerErrorException으로 변환해야 한다', async () => {
      usersService.findUserByEmail.mockRejectedValue(new Error('DB connection failed'));

      await expect(service.signUp(baseSignUpDto, mockReply)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
