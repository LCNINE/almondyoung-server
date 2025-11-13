import { Body, Controller, Post } from '@nestjs/common';
import { Public } from 'apps/user-service/src/commons/decorator/public.decorator';
import { SendMessageDto } from '../dto/twilio.dto';
import { SendMessageService } from '../services/send-message.service';

@Controller('twilio/send-message')
export class SendMessageController {
  constructor(private readonly sendMessageService: SendMessageService) {}

  @Post('send-message')
  @Public()
  async sendMessage(@Body() sendMessageDto: SendMessageDto) {
    return this.sendMessageService.sendMessage(sendMessageDto);
  }
}
