import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';

@Injectable()
export default class TwilioService {
  constructor(private readonly configService: ConfigService) {}

  async sendVerificationCode(phoneNumber: string) {
    // twilio.com/console에서 계정 SID 및 인증 토큰을 찾으세요.
    // 환경 변수를 설정합니다. http://twil.io/secure를 참조하세요.
    const accountSid = this.configService.get('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get('TWILIO_AUTH_TOKEN');
    const client = twilio(accountSid, authToken);

    async function createMessage() {
      const message = await client.messages.create({
        body: '안녕하세요. 테스트 메시지입니다.',
        from: '+15017122661',
        to: '+821022720693',
      });

      console.log(message.body);
    }

    createMessage();
  }
}
