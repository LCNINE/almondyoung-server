import { Injectable } from '@nestjs/common';
import { SignInDTO, SignUpDTO } from './dto/auth.dto';

@Injectable()
export class AuthService {
  async signUp(signUpDto: SignUpDTO) {
    return signUpDto;
  }

  async signIn(signInDto: SignInDTO) {
    return signInDto;
  }

  async signOut() {
    return '로그아웃';
  }

  async refreshToken() {
    return '토큰 갱신';
  }
}
