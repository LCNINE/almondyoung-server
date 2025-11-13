import { Body, Controller, Post } from '@nestjs/common';
import { Public } from 'apps/user-service/src/commons/decorator/public.decorator';
import { SendVerificationCodeDto } from '../dto/twilio.dto';
import { SendMessageService } from '../services/send-verify-code.service';

@Controller('twilio/send-message')
export class SendMessageController {
  constructor(private readonly sendMessageService: SendMessageService) {}

  @Post()
  @Public()
  async sendVerificationCode(
    @Body() sendVerificationCodeDto: SendVerificationCodeDto,
  ) {
    return this.sendMessageService.sendVerificationCode(
      sendVerificationCodeDto,
    );
  }
}
