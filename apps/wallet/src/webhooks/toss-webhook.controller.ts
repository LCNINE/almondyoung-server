import { Body, Controller, HttpCode, Post, SetMetadata } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TossWebhookService } from './toss-webhook.service';
import { TossWebhookBodyDto } from './dto';

@SetMetadata('isPublic', true)
@ApiTags('Webhooks')
@Controller('v1/webhooks')
export class TossWebhookController {
  constructor(private readonly webhookService: TossWebhookService) {}

  @Post('toss')
  @HttpCode(200)
  @ApiOperation({ summary: 'Toss payment webhook receiver' })
  async handleToss(@Body() body: TossWebhookBodyDto): Promise<void> {
    await this.webhookService.handle(body);
  }
}
