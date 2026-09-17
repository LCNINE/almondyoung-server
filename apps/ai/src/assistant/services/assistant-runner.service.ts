import { Injectable, Logger } from '@nestjs/common';
import { buildSystemPrompt, buildToolDefinitions, runTool } from '../../skills/registry';
import type { SkillAttachment, SkillContext } from '../../skills/types';
import { buildDateTimeContext } from '../lib/chat-datetime';
import { closeDanglingToolCalls, type Message } from '../lib/conversation';
import { MODEL, getOpenAiClient, logUsage, toUserMessage } from '../lib/openai';
import type OpenAI from 'openai';
import { urlEnv } from '../../platform/env';
import { UploadedFileRepository } from '../../files/uploaded-file.repository';

/**
 * 한 요청 안에서 도는 도구 호출 라운드 상한. 모델이 같은 도구를 물고 늘어져도 여기서 끊긴다.
 * clip 의 MAX_TOOL_ROUNDS 와 같은 역할이다.
 */
const MAX_TURNS = 12;

/** 여기를 넘기면 다음 라운드로 넘어가지 않는다. 진행 중인 라운드는 끝까지 둔다. */
const TIME_BUDGET_MS = 40_000;

export type RunEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' }
  | { type: 'settled'; event: 'done' | 'aborted' | 'error'; payload: RunResult };

export type RunResult = {
  message?: string;
  toolCalls: { name: string; input: unknown; result?: unknown }[];
  consumedIds: string[];
  /** 다음 턴에 그대로 되돌려줄 메시지. 이 턴에 새로 생긴 것만 담는다. */
  turnBlocks: Message[];
};

export type RunInput = {
  /** 이번 턴의 사용자 발화. 이미 DB 에 저장된 뒤 넘어온다. */
  history: Message[];
  /**
   * 이 요청이 가드에서 통과받은 스코프. 모델 앞에 놓일 도구를 여기서 가른다 —
   * 어드민과 고객이 같은 엔드포인트로 들어와도 부를 수 있는 것이 달라야 한다.
   */
  grantedScopes: readonly string[];
  attachments: SkillAttachment[];
  coreHeaders: SkillContext['coreHeaders'];
  signal: AbortSignal;
  /** 올린 파일을 어느 대화에서 올렸는지 기록하려고 받는다. */
  sessionId?: string;
  now?: Date;
};

/** 스킬의 provider 중립 정의를 OpenAI function 형식으로 옮긴다. */
function toOpenAiTools(grantedScopes: readonly string[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return buildToolDefinitions(grantedScopes).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

@Injectable()
export class AssistantRunnerService {
  private readonly logger = new Logger(AssistantRunnerService.name);

  constructor(private readonly uploadedFiles: UploadedFileRepository) {}

  /**
   * 스코프 조합별 도구 정의. 조합은 몇 개뿐이고 프로세스 수명 동안 바뀌지 않으므로
   * 한 번 만들어 재사용한다 — 매 요청 다시 만들면 같은 JSON 을 반복해 직렬화할 뿐이다.
   */
  private readonly toolsByScope = new Map<string, OpenAI.Chat.Completions.ChatCompletionTool[]>();

  private toolsFor(grantedScopes: readonly string[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
    const key = [...grantedScopes].sort().join('|');
    const cached = this.toolsByScope.get(key);
    if (cached) return cached;

    const tools = toOpenAiTools(grantedScopes);
    this.toolsByScope.set(key, tools);
    return tools;
  }

  /**
   * 모델을 돌리며 이벤트를 흘린다. 컨트롤러는 이 제너레이터를 SSE 프레임으로 옮기기만 한다 —
   * HTTP 를 모르는 곳에 루프를 두면 테스트가 쉽고, 나중에 큐 워커에서도 같은 코드를 쓴다.
   */
  async *run(input: RunInput): AsyncGenerator<RunEvent> {
    const { history, attachments, coreHeaders, signal, grantedScopes } = input;

    const ctx: SkillContext = {
      coreHeaders,
      // 포트는 scripts/local/e2e-env-map.sh 가 정본이다 — 3000 은 user-service 고
      // core 는 3100, file-service 는 3010 이다. 틀린 폴백은 도구를 IdP 로 보내고
      // 모델은 원인을 알 수 없는 404 만 받는다.
      coreApiUrl: urlEnv('CORE_API_URL', 'http://localhost:3100'),
      fileServiceUrl: urlEnv('FILE_SERVICE_URL', 'http://localhost:3010'),
      // 도구 안에서 조회 → 저장으로 이어질 때, 취소 이후 저장이 나가는 것을 막는다.
      signal,
      attachments,
      onUpload: (fileId, contextId) => this.uploadedFiles.record(fileId, contextId, input.sessionId ?? null),
    };

    // system 은 매번 서버가 새로 붙인다 — 지시문을 고치면 진행 중인 대화에도 바로 반영된다.
    const messages: Message[] = [
      { role: 'system', content: buildSystemPrompt(grantedScopes) },
      ...history.filter((m) => m.role !== 'system'),
    ];

    // 지금이 언제인지는 마지막 사용자 턴 뒤에 붙인다. 시스템 프롬프트에 두면 캐시되는
    // 접두사의 맨 앞이 매 요청 바뀌어 캐시가 통째로 깨진다 (clip chat.constants.ts 의 교훈).
    messages.push({ role: 'user', content: buildDateTimeContext(input.now ?? new Date()) });

    // 첨부가 있으면 모델이 그 사실을 알아야 업로드 도구를 부를 수 있다.
    // 파일 내용은 넘기지 않는다 — .xlsx 는 모델이 읽을 수 있는 형식이 아니고,
    // 도구가 바이트를 그대로 Core 로 넘기므로 읽을 필요도 없다.
    if (attachments.length > 0) {
      messages.push({
        role: 'user',
        content: `[이번 메시지에 첨부된 파일: ${attachments.map((a) => a.fileName).join(', ')}]`,
      });
    }

    /** 이 턴에 새로 생긴 메시지만 따로 모은다 — 저장할 것은 이것뿐이다. */
    const turnStart = messages.length;

    /**
     * 업로드 도구가 실제로 쓴 첨부의 키만 모은다. 도구가 ok:true 를 줘도 일부만 올라갈 수
     * 있어서(파일명 불일치·개별 실패), 전부 소비한 것으로 치면 재시도할 파일까지 사라진다.
     */
    const consumedIds = new Set<string>();
    // 결과까지 클라이언트로 내려보낸다 — 패널이 상품 목록 같은 것을 카드로 렌더한다.
    const toolCalls: { name: string; input: unknown; result?: unknown }[] = [];

    const aborted = () => signal.aborted;
    const snapshot = (message?: string): RunResult => ({
      message,
      toolCalls,
      consumedIds: [...consumedIds],
      turnBlocks: closeDanglingToolCalls(messages.slice(turnStart)),
    });

    const startedAt = Date.now();

    try {
      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
        if (aborted()) {
          yield { type: 'settled', event: 'aborted', payload: snapshot() };
          return;
        }
        if (turn > 0 && Date.now() - startedAt > TIME_BUDGET_MS) {
          yield {
            type: 'settled',
            event: 'done',
            payload: snapshot('시간이 오래 걸려 여기서 멈췄습니다. 이어서 진행하려면 "계속"이라고 말씀해 주세요.'),
          };
          return;
        }

        // 스트리밍으로 받아 텍스트를 곧바로 흘려보낸다. 도구를 여러 번 도는
        // 작업은 20초 넘게 걸려서, 침묵이 길면 고장으로 읽힌다.
        const streamed = await getOpenAiClient().chat.completions.create(
          {
            model: MODEL,
            messages,
            tools: this.toolsFor(grantedScopes),
            stream: true,
            // 스트리밍은 기본적으로 usage 를 안 준다. 비용 추적이 끊기지 않게 켠다.
            stream_options: { include_usage: true },
          },
          { signal },
        );

        let content = '';
        const partials = new Map<number, { id: string; name: string; args: string }>();

        for await (const chunk of streamed) {
          if (aborted()) {
            yield { type: 'settled', event: 'aborted', payload: snapshot() };
            return;
          }

          if (chunk.usage) logUsage(chunk.usage, { turn }, chunk.model);

          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            yield { type: 'delta', text: delta.content };
          }

          for (const part of delta?.tool_calls ?? []) {
            const slot = partials.get(part.index) ?? { id: '', name: '', args: '' };
            if (part.id) slot.id = part.id;
            if (part.function?.name) slot.name += part.function.name;
            if (part.function?.arguments) slot.args += part.function.arguments;
            partials.set(part.index, slot);
          }
        }

        const calls = [...partials.values()].filter((c) => c.name);

        // content 를 null 로 둘 수 있는 것은 tool_calls 가 같이 있을 때뿐이다.
        // 도구를 부르지 않고 말도 없이 끝난 턴을 null 로 저장하면, 다음 턴에 그 기록을
        // 되돌려줄 때 OpenAI 가 대화 전체를 400 으로 거부한다
        // ("Invalid value for 'content': expected a string, got null").
        // ask_choice 로 선택지만 내고 말을 보태지 않는 턴이 정확히 이 모양이다.
        messages.push({
          role: 'assistant',
          content: calls.length > 0 ? content || null : content,
          ...(calls.length > 0
            ? {
                tool_calls: calls.map((c) => ({
                  id: c.id,
                  type: 'function' as const,
                  function: { name: c.name, arguments: c.args || '{}' },
                })),
              }
            : {}),
        });

        if (calls.length === 0) {
          yield { type: 'settled', event: 'done', payload: snapshot(content) };
          return;
        }

        for (const call of calls) {
          // 무엇을 하는 중인지 알린다. 도구가 여러 개면 침묵이 길어진다.
          yield { type: 'tool', name: call.name, status: 'running' };

          // 모델이 만든 JSON 이라 깨질 수 있다 — 파싱 실패를 도구 오류로 돌려주면
          // 모델이 스스로 고쳐 다시 부른다. 여기서 던지면 루프가 죽는다.
          let toolInput: unknown;
          try {
            toolInput = call.args ? JSON.parse(call.args) : {};
          } catch {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({
                ok: false,
                error: '인자가 올바른 JSON 이 아니다. 다시 만들어 호출한다.',
              }),
            });
            continue;
          }

          // 도구 하나가 끝날 때마다 확인한다 — 취소 뒤에 발행 같은 되돌리기 어려운
          // 작업이 이어지는 것을 막는다.
          if (aborted()) {
            yield { type: 'settled', event: 'aborted', payload: snapshot() };
            return;
          }

          let result: unknown;
          try {
            result = await runTool(call.name, toolInput, ctx, grantedScopes);
          } catch (toolError) {
            if (aborted() || (toolError as Error)?.name === 'AbortError') {
              yield { type: 'settled', event: 'aborted', payload: snapshot() };
              return;
            }
            throw toolError;
          }

          toolCalls.push({ name: call.name, input: toolInput, result });
          const consumed = (result as { consumedIds?: unknown })?.consumedIds;
          if (Array.isArray(consumed)) {
            for (const id of consumed) {
              if (typeof id === 'string') consumedIds.add(id);
            }
          }
          yield { type: 'tool', name: call.name, status: 'done' };

          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result ?? null),
          });
        }
      }

      // 한도로 끊겨도 그때까지 실행된 도구 결과(업로드한 fileId 등)는 살려 보낸다.
      yield {
        type: 'settled',
        event: 'done',
        payload: snapshot('작업이 너무 많은 단계로 길어져 중단했습니다. 요청을 나눠서 다시 말씀해 주세요.'),
      };
    } catch (err) {
      if (aborted() || (err as Error)?.name === 'AbortError') {
        yield { type: 'settled', event: 'aborted', payload: snapshot() };
        return;
      }
      this.logger.error(`어시스턴트 오류: ${(err as Error)?.message?.slice(0, 300)}`);
      yield { type: 'settled', event: 'error', payload: snapshot(toUserMessage(err)) };
    }
  }
}
