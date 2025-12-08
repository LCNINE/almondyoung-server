import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from 'apps/user-service/src/commons/decorator/public.decorator';
import { SendVerificationCodeDto } from '../dto/twilio.dto';
import { SendMessageService } from '../services/send-verify-code.service';


@ApiTags('Twilio - 인증 메시지')
@Controller('twilio/send-message')
export class SendMessageController {
  constructor(private readonly sendMessageService: SendMessageService) { }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 1 } }) // 1분에 1번만 발송 가능
  @Post()
  @Public()
  @ApiOperation({
    summary: '인증 코드 발송',
    description: '지정된 전화번호로 SMS 인증 코드를 발송합니다.',
  })
  @ApiBody({ type: SendVerificationCodeDto })
  @ApiResponse({
    status: 201,
    description: '인증 코드가 성공적으로 발송되었습니다.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '인증 코드가 발송되었습니다.' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (유효하지 않은 전화번호, 너무 빠른 재발송 등)',
  })
  @ApiResponse({
    status: 500,
    description: '서버 오류',
  })
  async sendVerificationCode(
    @Body() sendVerificationCodeDto: SendVerificationCodeDto,
  ) {
    return this.sendMessageService.sendVerificationCode(
      sendVerificationCodeDto,
    );
  }
}
