import { Body, Controller, ValidationPipe } from '@nestjs/common';
import { SignInDTO, SignUpDTO } from './dto/auth.dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  async signUp(@Body(ValidationPipe) signUpDto: SignUpDTO) {
    return this.authService.signUp(signUpDto);
  }

  async signIn(@Body(ValidationPipe) signInDto: SignInDTO) {
    return this.authService.signIn(signInDto);
  }

  async signOut() {
    return this.authService.signOut();
  }
}
