import { Body, Controller, Post, ServiceUnavailableException } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InternalOnly } from '@app/authorization';
import { Channel } from '../../shared/enums';
import { SendSmsDto, SendSmsResponseDto } from '../dto';
import { ProviderManagerService } from '../services/provider-manager.service';

@ApiTags('internal-sms')
@Controller('internal/sms')
export class SmsInternalController {
  constructor(private readonly providerManager: ProviderManagerService) {}

  @Post('send')
  @InternalOnly()
  @ApiOperation({ summary: 'SMS 발송 (서비스 간 호출 전용)' })
  @ApiBody({ type: SendSmsDto })
  @ApiResponse({ status: 201, type: SendSmsResponseDto })
  async send(@Body() dto: SendSmsDto): Promise<SendSmsResponseDto> {
    const provider = await this.providerManager.getAvailableProviderForChannel(Channel.SMS);

    if (!provider) {
      throw new ServiceUnavailableException('SMS 발송 프로바이더가 없습니다');
    }

    const result = await provider.send({ to: dto.to, content: dto.content });

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      provider: provider.getName(),
    };
  }
}
