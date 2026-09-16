import { RequireScopes, User } from '@app/authorization';
import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateSessionDto } from '../dto/create-session.dto';
import { ListSessionsQueryDto } from '../dto/list-sessions-query.dto';
import { ChatMessageDto, DeletedDto, SessionSummaryDto } from '../dto/session.dto';
import { AssistantSessionService } from '../services/assistant-session.service';
import { AI_SCOPE } from '../../platform/auth/ai-scopes';

/**
 * `request.user` 의 실제 모양. `JwtPayload` 는 id 를 선언하지만 런타임 객체에는 없다 —
 * AuthenticationService.validatePayload 가 토큰의 sub 를 userId 로 옮겨 담기 때문이다.
 * core·analytics 도 같은 이유로 { userId } 를 쓴다.
 */
type AuthenticatedUser = { userId: string };

@ApiTags('AI 어시스턴트 - 대화')
@ApiBearerAuth()
/**
 * 어드민·마스터만 쓴다. 이 앱의 도구는 상품을 지우고 가격을 바꾼다 —
 * 인증만 걸면 로그인한 쇼핑몰 고객도 부를 수 있다.
 *
 * 두 역할의 통과 경로가 다르다: admin 은 이 앱이 시드한 역할→스코프 매핑으로,
 * master 는 ScopeGuard 가 역할만 보고 스코프 조회 전에 통과시킨다 (ai-scopes.ts).
 */
// 대화 기록은 두 쪽 다 자기 것을 갖는다. 도구 권한과는 별개다.
@RequireScopes(AI_SCOPE.ASSISTANT, AI_SCOPE.STOREFRONT)
@ApiResponse({ status: 403, description: 'ai:assistant 또는 ai:storefront 스코프가 필요합니다.' })
@Controller('assistant/sessions')
export class AssistantSessionController {
  constructor(private readonly service: AssistantSessionService) {}

  @Post()
  @ApiOperation({ summary: '대화 시작' })
  @ApiResponse({ status: 201, type: SessionSummaryDto })
  createSession(@User() user: AuthenticatedUser, @Body() dto: CreateSessionDto) {
    return this.service.createSession(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: '내 대화 목록 (최근 순)' })
  @ApiResponse({ status: 200, type: [SessionSummaryDto] })
  listSessions(@User() user: AuthenticatedUser, @Query() query: ListSessionsQueryDto) {
    return this.service.listSessions(user.userId, query.limit);
  }

  @Get(':sessionId/messages')
  @ApiOperation({
    summary: '대화 내용 (보낸 순서)',
    description: 'contentBlocks 에 도구 호출·결과가 그대로 있어 대화를 이어서 열 수 있다.',
  })
  @ApiResponse({ status: 200, type: [ChatMessageDto] })
  @ApiResponse({ status: 404, description: '대화가 없거나 내 것이 아님' })
  listMessages(@User() user: AuthenticatedUser, @Param('sessionId') sessionId: string) {
    return this.service.listMessages(user.userId, sessionId);
  }

  @Delete(':sessionId')
  @ApiOperation({ summary: '대화 삭제', description: '메시지도 함께 지워진다.' })
  @ApiResponse({ status: 200, type: DeletedDto })
  @ApiResponse({ status: 404, description: '대화가 없거나 내 것이 아님' })
  deleteSession(@User() user: AuthenticatedUser, @Param('sessionId') sessionId: string) {
    return this.service.deleteSession(user.userId, sessionId);
  }
}
