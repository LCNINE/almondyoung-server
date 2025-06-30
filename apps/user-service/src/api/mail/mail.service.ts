import { MailerService } from '@nestjs-modules/mailer';
import { ConflictException, Injectable } from '@nestjs/common';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async sendPasswordResetEmail(email: string): Promise<boolean> {
    try {
      await this.mailerService.sendMail({
        to: email,
        from: 'noreplay@gmail.com',
        subject: '비밀번호 재설정',
        text: '비밀번호 재설정을 위한 이메일입니다.',
        html: '<b>비밀번호 재설정을 위한 이메일입니다.</b>',
      });
      return true;
    } catch (error) {
      throw new ConflictException(error);
    }
  }
}
