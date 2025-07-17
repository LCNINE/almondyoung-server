import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  HttpException,
  Logger,
  ParseIntPipe, // 👈 추가
} from '@nestjs/common';

import { PgIntegrationService } from './pg-integration.service';
import { CreateCardMethodDto } from './dto/create-card-method'; // 👈 .dto 확장자 추가
import {
  CardMethodResponseDto,
  CardMethodListResponseDto,
} from './dto/card-method-response.dto';

@Controller('users/:userId/pg-integration')
export class PgIntegrationController {
  private readonly logger = new Logger(PgIntegrationController.name);

  constructor(private readonly pgIntegrationService: PgIntegrationService) {}

  @Post('cards')
  @HttpCode(HttpStatus.CREATED)
  async registerCard(
    @Body() dto: CreateCardMethodDto,
  ): Promise<CardMethodResponseDto> {
    this.logger.log(`Card registration request from user: ${dto.userId}`);
    return await this.pgIntegrationService.registerCard(dto);
  }

  @Get('cards')
  async getCardMethods(
    @Param('userId', ParseIntPipe) userId: string, // 👈 수정
  ): Promise<CardMethodListResponseDto> {
    this.logger.log(`Get cards for user: ${userId}`);
    const cards = await this.pgIntegrationService.getCardMethods(userId);
    return new CardMethodListResponseDto(cards, cards.length);
  }

  @Delete('cards/:methodId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCard(
    @Param('userId', ParseIntPipe) userId: string, // 👈 수정
    @Param('methodId') methodId: string,
  ): Promise<void> {
    this.logger.log(`Delete card ${methodId} for user: ${userId}`);
    await this.pgIntegrationService.deleteCardMethod(userId, methodId);
  }

  @Patch('cards/:methodId/default')
  @HttpCode(HttpStatus.OK)
  async setDefaultCard(
    @Param('userId', ParseIntPipe) userId: string, // 👈 수정
    @Param('methodId') methodId: string,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Set default card ${methodId} for user: ${userId}`);
    await this.pgIntegrationService.setDefaultMethod(userId, methodId);
    return {
      success: true,
      message: '기본 결제수단이 설정되었습니다',
    };
  }

  @Get('cards/:methodId')
  async getCardDetail(
    @Param('userId', ParseIntPipe) userId: string, // 👈 수정
    @Param('methodId') methodId: string,
  ): Promise<CardMethodResponseDto> {
    this.logger.log(`Get card detail ${methodId} for user: ${userId}`);
    const cards = await this.pgIntegrationService.getCardMethods(userId);
    const card = cards.find((c) => c.id === methodId);
    if (!card) {
      throw new HttpException(
        '결제수단을 찾을 수 없습니다',
        HttpStatus.NOT_FOUND,
      );
    }
    return card;
  }
}
