import { JwtPayload, RequireScopes } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AssistantChatService } from './assistant-chat.service';
import { AppendMessageDto, CreateSessionDto } from './dto/assistant-chat.dto';

@ApiTags('AI 어시스턴트 대화')
@ApiBearerAuth()
/**
 * 어드민 전용이다. user-service 는 쇼핑몰 고객도 쓰는 IdP 라, 인증만 걸면
 * 로그인한 고객도 이 API 를 부를 수 있다. JwtAuthGuard 는 앱 전역에 걸려 있으므로
 * 여기서는 스코프만 요구한다 (이 저장소의 admin 엔드포인트 공통 방식).
 */
@RequireScopes('admin:access')
@ApiResponse({ status: 403, description: '어드민 권한이 필요합니다.' })
@Controller('/assistant-chat/sessions')
export class AssistantChatController {
  constructor(private readonly service: AssistantChatService) {}

  @Post()
  @ApiOperation({ summary: '대화 시작' })
  @ApiResponse({ status: 201, description: '생성된 세션' })
  async createSession(@CurrentUser() user: JwtPayload, @Body() dto: CreateSessionDto) {
    return this.service.createSession(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '내 대화 목록 (최근 순)' })
  async listSessions(@CurrentUser() user: JwtPayload, @Query('limit') limit?: string) {
    const parsed = Number(limit);
    const size = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 20;
    return this.service.listSessions(user.id, size);
  }

  @Get(':sessionId/messages')
  @ApiOperation({
    summary: '대화 내용 (보낸 순서)',
    description:
      'contentBlocks 를 그대로 모델에 되돌려주면 이전 턴의 도구 결과까지 이어진다.',
  })
  @ApiResponse({ status: 404, description: '대화가 없거나 내 것이 아님' })
  async getMessages(
    @CurrentUser() user: JwtPayload,
    @Param('sessionId') sessionId: string
  ) {
    return this.service.getMessages(user.id, sessionId);
  }

  @Post(':sessionId/messages')
  @ApiOperation({ summary: '메시지 추가' })
  @ApiResponse({ status: 404, description: '대화가 없거나 내 것이 아님' })
  async appendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('sessionId') sessionId: string,
    @Body() dto: AppendMessageDto
  ) {
    return this.service.appendMessage(user.id, sessionId, dto);
  }

  @Delete(':sessionId')
  @ApiOperation({ summary: '대화 삭제', description: '메시지도 함께 지워진다.' })
  @ApiResponse({ status: 404, description: '대화가 없거나 내 것이 아님' })
  async deleteSession(
    @CurrentUser() user: JwtPayload,
    @Param('sessionId') sessionId: string
  ) {
    return this.service.deleteSession(user.id, sessionId);
  }
}
