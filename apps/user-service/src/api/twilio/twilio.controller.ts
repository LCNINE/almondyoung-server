import { Body, Controller, Post } from '@nestjs/common';
import TwilioService from './twilio.service';
import { Public } from '../../constants/public.decorator';

@Controller('twilio')
export class TwilioController {
  constructor(private readonly twilioService: TwilioService) {}

  @Post('send-verify-code')
  @Public()
  // todo: validate phone number,code
  async sendVerifyCode(@Body() body: { phoneNumber: string;  }) {
    return this.twilioService.sendVerifyCode(body.phoneNumber);
  }
}
