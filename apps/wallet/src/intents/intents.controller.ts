import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { CreateIntentDto } from './dto/create-intent.dto';
import { IntentsService } from './intents.service';

@Controller('v1/intents')
export class IntentsController {
  constructor(private readonly intentsService: IntentsService) {}

  @Post()
  async createIntent(
    @Body() dto: CreateIntentDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const data = await this.intentsService.createIntent(dto, correlationId);
    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':intentId')
  async getIntent(@Param('intentId') intentId: string) {
    const data = await this.intentsService.getIntent(intentId);
    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }
}
