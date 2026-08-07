import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AiPromptsService, type AiPromptPresetRecord } from './ai-prompts.service';
import {
  AiPromptPresetResponseDto,
  CreateAiPromptPresetDto,
  UpdateAiPromptPresetDto,
} from './dto/ai-prompt.dto';

function toDto(row: AiPromptPresetRecord): AiPromptPresetResponseDto {
  return {
    id: row.id,
    scope: row.scope,
    title: row.title,
    content: row.content,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@ApiTags('AI Prompts')
@Controller('ai-prompts')
export class AiPromptsController {
  constructor(private readonly aiPromptsService: AiPromptsService) {}

  @Get()
  @ApiOperation({
    summary: 'AI 프롬프트 양식 목록',
    description: '어드민 전체가 공유하는 목록. 최근 수정순.',
  })
  @ApiQuery({ name: 'scope', description: '적용 범위 (예: product-description)' })
  @ApiResponse({ status: HttpStatus.OK, type: [AiPromptPresetResponseDto] })
  async list(@Query('scope') scope: string): Promise<AiPromptPresetResponseDto[]> {
    if (!scope) throw new BadRequestException('scope is required');

    const rows = await this.aiPromptsService.list(scope);
    return rows.map(toDto);
  }

  @Post()
  @ApiOperation({ summary: 'AI 프롬프트 양식 저장' })
  @ApiQuery({ name: 'scope', description: '적용 범위' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AiPromptPresetResponseDto })
  async create(
    @Query('scope') scope: string,
    @Body() dto: CreateAiPromptPresetDto,
  ): Promise<AiPromptPresetResponseDto> {
    if (!scope) throw new BadRequestException('scope is required');

    const row = await this.aiPromptsService.create({
      scope,
      title: dto.title,
      content: dto.content,
      ownerId: dto.ownerId,
      ownerName: dto.ownerName ?? null,
    });
    return toDto(row);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'AI 프롬프트 양식 수정',
    description: '본인이 만든 양식만 수정할 수 있다 (아니면 403).',
  })
  @ApiParam({ name: 'id', description: '양식 ID' })
  @ApiResponse({ status: HttpStatus.OK, type: AiPromptPresetResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAiPromptPresetDto,
  ): Promise<AiPromptPresetResponseDto> {
    const row = await this.aiPromptsService.update(
      id,
      dto.requesterId,
      dto.title,
      dto.content,
    );
    return toDto(row);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'AI 프롬프트 양식 삭제',
    description: '본인이 만든 양식만 삭제할 수 있다 (아니면 403).',
  })
  @ApiParam({ name: 'id', description: '양식 ID' })
  @ApiQuery({ name: 'requesterId', description: '요청자 식별자' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: '삭제 완료' })
  async remove(
    @Param('id') id: string,
    @Query('requesterId') requesterId: string,
  ): Promise<void> {
    if (!requesterId) throw new BadRequestException('requesterId is required');

    await this.aiPromptsService.remove(id, requesterId);
  }
}
