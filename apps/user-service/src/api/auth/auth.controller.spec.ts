import { REQUIRED_SCOPES_KEY } from '@app/authorization';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/sign-in.dto';
import { LocalSignUpDto } from './dto/sign-up.dto';

// 컨트롤러는 얇은 위임 계층이다. 여기서 검증하는 건 "authService 에 무엇을
// 어떤 인자로 넘기는가" 뿐이고, 그중 유일한 자체 로직이 signUp 의
// encrypted_id_token(snake) → encryptedIdToken(camel) 정규화다.
function makeSignUpDto(overrides: Partial<LocalSignUpDto> = {}): LocalSignUpDto {
  return {
    isOver14: true,
    termsOfService: true,
    electronicTransaction: true,
    privacyPolicy: true,
    thirdPartySharing: true,
    marketingConsent: false,
    email: 'test@test.com',
    username: '홍길동',
    nickname: 'tester',
    loginId: 'user1234',
    password: 'password123!',
    birthday: '19900101',
    phoneNumber: '+821012345678',
    ...overrides,
  };
}

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const res = {} as FastifyReply;
  const req = {} as FastifyRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            signUp: jest.fn().mockResolvedValue({ accessToken: 'test-token' }),
            signIn: jest.fn().mockResolvedValue({ accessToken: 'test-token' }),
            signOut: jest.fn().mockResolvedValue('로그아웃'),
          },
        },
        // 컨트롤러가 OAuth 실패 리다이렉트에서 FRONTEND_URL 을 읽는다.
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('signUp 은 dto·res·redirect_to 를 그대로 authService 에 넘긴다', async () => {
    const dto = makeSignUpDto();

    const result = await controller.signUp(dto, res, '/after-signup');

    expect(result).toEqual({ accessToken: 'test-token' });
    expect(authService.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ loginId: dto.loginId, email: dto.email }),
      res,
      '/after-signup',
    );
  });

  it('signUp 은 snake_case encrypted_id_token 을 camelCase 로 정규화한다', async () => {
    const dto = { ...makeSignUpDto(), encrypted_id_token: 'encrypted-token' };

    await controller.signUp(dto, res);

    expect(authService.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ encryptedIdToken: 'encrypted-token' }),
      res,
      undefined,
    );
  });

  it('signUp 은 camelCase 가 이미 있으면 그걸 우선한다', async () => {
    const dto = { ...makeSignUpDto({ encryptedIdToken: 'camel' }), encrypted_id_token: 'snake' };

    await controller.signUp(dto, res);

    expect(authService.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ encryptedIdToken: 'camel' }),
      res,
      undefined,
    );
  });

  it('signIn 은 dto 와 res 를 authService 에 넘긴다', async () => {
    const signInDto: SignInDto = { loginId: 'user1234', password: 'password123!' };

    const result = await controller.signIn(signInDto, res);

    expect(result).toEqual({ accessToken: 'test-token' });
    expect(authService.signIn).toHaveBeenCalledWith(signInDto, res);
  });

  it('signOut 은 request 와 reply 를 authService 에 넘긴다', async () => {
    const result = await controller.signOut(req, res);

    expect(result).toEqual('로그아웃');
    expect(authService.signOut).toHaveBeenCalledWith(req, res);
  });
});

// 본인 계정 동작(비밀번호 변경·PIN 재설정용 비밀번호 확인)은 로그인한 누구나 해야 한다.
// 옛 역할 스코프(user:modify 등)를 요구하면 새 권한 체계로 만든 역할만 가진 직원 계정
// (예: logistics_worker)이 임시 비밀번호를 못 바꾼다. 둘 다 서버가 현재 비밀번호를 확인한다.
describe('AuthController 본인 계정 라우트', () => {
  it.each(['changePassword', 'verifyPasswordForPinReset'] as const)('%s 는 역할 스코프를 요구하지 않는다', (method) => {
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, AuthController.prototype[method])).toBeUndefined();
  });
});
