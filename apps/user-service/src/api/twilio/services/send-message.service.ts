import { Inject, Injectable } from '@nestjs/common';
import { SendMessageDto } from '../dto/twilio.dto';

@Injectable()
export class SendMessageService {
  constructor(
    @Inject('TWILIO_PHONE_NUMBER') private readonly twilioPhoneNumber: string,
    @Inject('TWILIO_CLIENT') private readonly twilio,
    @Inject('TWILIO_SERVICE_ID') private readonly twilioServiceId: string,
  ) {}

  async sendMessage(sendMessageDto: SendMessageDto) {
    return this.twilio.messages.create({
      to: sendMessageDto.phoneNumber,
      from: this.twilioPhoneNumber,
      body: sendMessageDto.body,
    });
  }
}
