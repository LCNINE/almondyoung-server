import { RequireScopes, User } from '@app/authorization';
import { Controller, Logger, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { clientAbortSignal } from '../lib/client-abort';
import { callerAuthHeaders, readTurn } from '../lib/multipart';
import { AssistantChatService, type TurnEvent } from '../services/assistant-chat.service';
import { AI_SCOPE } from '../../platform/auth/ai-scopes';
import { grantedAiScopes } from '../../platform/auth/granted-scopes';

@ApiTags('AI 어시스턴트 - 채팅')
@ApiBearerAuth()
// 두 스코프 모두 이 엔드포인트로 들어온다. 무엇을 부를 수 있는지는 도구 목록이 가른다.
@RequireScopes(AI_SCOPE.ASSISTANT, AI_SCOPE.STOREFRONT)
@ApiResponse({ status: 403, description: 'ai:assistant 또는 ai:storefront 스코프가 필요합니다.' })
@Controller('assistant/sessions')
export class AssistantChatController {
  private readonly logger = new Logger(AssistantChatController.name);

  constructor(private readonly service: AssistantChatService) {}

  @Post(':sessionId/messages')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: '메시지 보내기 (SSE 스트리밍)',
    description:
      'text/event-stream 으로 delta·tool·session_title·done/aborted/error 를 흘린다. ' +
      'multipart 필드: content(문자열), files(파일, 반복), fileIds(첨부 식별자, files 와 같은 순서).',
  })
  @ApiResponse({ status: 404, description: '대화가 없거나 내 것이 아님' })
  async sendMessage(
    @User() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const turn = await readTurn(request);
    const headers = callerAuthHeaders(request);

    const events = this.service.runTurn({
      userId: user.userId,
      sessionId,
      turn,
      // 여기서 기다릴 것이 없으므로 async 가 아니다 — 타입만 Promise 면 도구 쪽은 그대로 await 한다.
      coreHeaders: (extra?: Record<string, string>) => Promise.resolve({ ...headers, ...extra }),
      signal: clientAbortSignal(reply),
      grantedScopes: grantedAiScopes(request),
    });

    // 첫 이벤트를 받기 전에 헤더를 내보내지 않는다 — 소유 확인이 던지는 404 가
    // 200 스트림 안의 문구로 바뀌면 클라이언트가 실패를 성공으로 읽는다.
    const first = await events.next();
    if (first.done) {
      reply.status(204).send();
      return;
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 프록시가 버퍼링하면 스트리밍이 의미를 잃는다.
      'X-Accel-Buffering': 'no',
    });

    const send = (event: string, data: unknown) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // 헤더가 나간 뒤로는 예외를 밖으로 내보낼 수 없다 — 전역 필터가 JSON 오류를 쓰려다
    // ERR_HTTP_HEADERS_SENT 를 내고 응답이 끝나지 않는다. 남은 실패는 SSE error 로 알리고
    // 반드시 스트림을 닫는다. (runner 안의 모델·도구 오류는 거기서 이미 잡힌다 —
    // 여기로 오는 것은 대화 조회·답변 저장 같은 DB 예외다.)
    try {
      let step: IteratorResult<TurnEvent> = first;
      while (!step.done) {
        const event: TurnEvent = step.value;

        if (event.type === 'delta') {
          send('delta', { text: event.text });
        } else if (event.type === 'tool') {
          send('tool', { name: event.name, status: event.status });
        } else if (event.type === 'title') {
          send('session_title', { title: event.title });
        } else {
          const { message, toolCalls, consumedIds } = event.payload;
          send(event.event, { message, toolCalls, consumedIds });
        }

        step = await events.next();
      }
    } catch (err) {
      this.logger.error(`스트리밍 중 오류: ${(err as Error)?.message?.slice(0, 300)}`);
      send('error', {
        message: '요청을 처리하지 못했습니다. 이미 반영된 작업이 있을 수 있으니 확인해 주세요.',
      });
    } finally {
      // 제너레이터를 반드시 닫는다. send() 가 yield 중간에 던지면 runTurn 이 중단된
      // 상태로 남아 자기 finally 를 못 돌고, SessionTurnLock 이 풀리지 않아 그 대화가
      // 프로세스가 죽을 때까지 409 만 낸다.
      await events.return(undefined);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  }
}
