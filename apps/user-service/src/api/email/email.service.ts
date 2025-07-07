import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ResendService } from 'nestjs-resend';
import {
  createFindUserIdTemplate,
  createPasswordResetTemplate,
  createSignUpConfirmationTemplate,
} from '../../utils/templates/email-templates';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly resendService: ResendService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async sendResetPasswordLink(email: string): Promise<void> {
    const payload = { email };

    const token = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_VERIFICATION_TOKEN_SECRET'),
      expiresIn: `${this.configService.get('JWT_RESET_PASSWORD_ACCESS_TOKEN_EXPIRATION')}`,
    });

    const url = `${this.configService.get('EMAIL_RESET_PASSWORD_URL')}?token=${token}`;
    const template = createPasswordResetTemplate(url);

    return this.sendMail({
      email,
      ...template,
    });
  }

  async sendForgetUserIdLink(email: string, loginId: string): Promise<void> {
    const template = createFindUserIdTemplate(loginId);

    return this.sendMail({
      email,
      ...template,
    });
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    try {
      const url = `${this.configService.get('SIGNUP_REDIRECT_URL')}?token=${token}`;
      const template = createSignUpConfirmationTemplate(url);

      return this.sendMail({
        email,
        ...template,
      });
    } catch (error) {
      this.logger.error('Failed to send verification email', error);
      throw error;
    }
  }

  private async sendMail({
    email,
    subject,
    text,
    html,
  }: {
    email: string;
    subject: string;
    text: string;
    html: string;
  }) {
    try {
      this.logger.debug(`이메일을 보내려고 시도중입니다: ${email}`);
      await this.resendService.send({
        from: 'noreply@almondyoung.com',
        to: email,
        subject,
        text,
        html,
      });
      this.logger.log(`이메일이 성공적으로 전송되었습니다: ${email}`);
    } catch (error) {
      this.logger.error(`이메일 전송 실패: ${email}`, error.stack);
      throw new ConflictException('이메일 전송 실패');
    }
  }

  public async decodeConfirmationToken(token: string) {
    try {
      const payload = await this.jwtService.verify(token, {
        secret: this.configService.get('JWT_VERIFICATION_TOKEN_SECRET'),
      });

      if (typeof payload === 'object' && 'email' in payload) {
        return payload.email;
      }
      throw new BadRequestException();
    } catch (error) {
      if (error?.name === 'TokenExpiredError') {
        throw new BadRequestException('Email confirmation token expired');
      }
      throw new BadRequestException('Bad confirmation token');
    }
  }
}
