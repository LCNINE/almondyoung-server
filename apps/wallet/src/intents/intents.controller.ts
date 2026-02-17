import { Body, Controller, Get, Headers, Param, Post, Put } from '@nestjs/common';
import { CreateIntentDto } from './dto/create-intent.dto';
import { ConfigureLegsDto } from './dto/configure-legs.dto';
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

  @Put(':intentId/legs')
  async configureLegs(
    @Param('intentId') intentId: string,
    @Body() dto: ConfigureLegsDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const data = await this.intentsService.configureLegs(
      intentId,
      dto,
      correlationId,
    );

    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':intentId/legs/:legId/authorize')
  async authorizeLeg(
    @Param('intentId') intentId: string,
    @Param('legId') legId: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const data = await this.intentsService.authorizeLeg(
      intentId,
      legId,
      correlationId,
    );

    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':intentId/legs/:legId/capture')
  async captureLeg(
    @Param('intentId') intentId: string,
    @Param('legId') legId: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const data = await this.intentsService.captureLeg(
      intentId,
      legId,
      correlationId,
    );

    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':intentId/cancel')
  async cancelIntent(
    @Param('intentId') intentId: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const data = await this.intentsService.cancelIntent(intentId, correlationId);

    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':intentId/supersede')
  async supersedeIntent(
    @Param('intentId') intentId: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const data = await this.intentsService.supersedeIntent(intentId, correlationId);

    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }
}
