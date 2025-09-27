import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            signUp: jest.fn().mockImplementation((dto) =>
              Promise.resolve({
                user: {
                  userId: dto.userId,
                  nickname: dto.nickname,
                  email: dto.email,
                },
                accessToken: 'test-token',
              }),
            ),
            signIn: jest
              .fn()
              .mockImplementation((dto) =>
                Promise.resolve({ accessToken: 'test-token' }),
              ),
            signOut: jest.fn().mockResolvedValue('로그아웃'),
            refreshToken: jest.fn().mockResolvedValue('토큰 갱신'),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should sign up and return user info with access token', async () => {
    const signUpDto: SignUpDto = {
      userId: 'test',
      nickname: 'test',
      email: 'test@test.com',
      password: 'test',
      passwordConfirm: 'test',
    };

    const result = await controller.signUp(signUpDto);

    expect(result).toEqual({
      user: {
        userId: signUpDto.userId,
        nickname: signUpDto.nickname,
        email: signUpDto.email,
      },
      accessToken: 'test-token',
    });
    expect(authService.signUp).toHaveBeenCalledWith(signUpDto);
  });

  it('should sign in', async () => {
    const signInDto: SignInDto = {
      userId: 'test',
      password: 'test',
    };

    const result = await controller.signIn(signInDto);
    expect(result).toEqual({ accessToken: 'test-token' });
    expect(authService.signIn).toHaveBeenCalledWith(signInDto);
  });

  it('should sign out', async () => {
    const result = await controller.signOut();
    expect(result).toEqual('로그아웃');
    expect(authService.signOut).toHaveBeenCalled();
  });

  it('should refresh token', async () => {
    const result = await authService.refreshToken();
    expect(result).toEqual('토큰 갱신');
    expect(authService.refreshToken).toHaveBeenCalled();
  });
});
