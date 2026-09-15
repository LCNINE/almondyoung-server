import type OpenAI from 'openai';
import { MODEL, requireAssistantClient, logUsage } from '../_lib/openai';
import { CORE_API_URL, coreAuthHeaders } from '../../prompts/_lib/core';
import {
  buildSystemPrompt,
  buildToolDefinitions,
  runTool,
} from '@/features/assistant/skills/registry';
import type { SkillAttachment } from '@/features/assistant/skills/types';
import { closeDanglingToolCalls } from '../_lib/conversation';

export const runtime = 'nodejs';

/** 한 요청 안에서 도는 도구 호출 횟수 상한. 모델이 같은 도구를 물고 늘어져도 여기서 끊긴다. */
const MAX_TURNS = 12;

const TIME_BUDGET_MS = 40_000;

/**
 * 클라이언트가 돌려보내는 대화. 텍스트뿐 아니라 도구 호출·결과까지 그대로 싣는다.
 *
 * 텍스트만 보내면 이전 턴에 업로드해 받은 fileId 같은 것이 사라져서, 모델이
 * "이미지를 다시 첨부해 주세요" 라고 되묻는다. 실제로 그렇게 막혔다.
 */
type ClientMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** 스킬의 provider 중립 정의를 OpenAI function 형식으로 옮긴다. */
function toOpenAiTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return buildToolDefinitions().map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

export async function POST(request: Request) {
  const guard = await requireAssistantClient();
  if (guard.error) return guard.error;

  const form = await request.formData();

  const raw = form.get('messages');
  if (typeof raw !== 'string') {
    return Response.json({ message: 'messages 가 필요합니다.' }, { status: 400 });
  }

  let history: ClientMessage[];
  try {
    history = JSON.parse(raw);
  } catch {
    return Response.json({ message: 'messages 형식이 잘못되었습니다.' }, { status: 400 });
  }
  if (!Array.isArray(history) || history.length === 0) {
    return Response.json({ message: '보낼 메시지가 없습니다.' }, { status: 400 });
  }

  // 패널이 files 와 같은 순서로 fileIds 를 보낸다. 같은 이름의 첨부를 구분하려면
  // 파일명이 아니라 이 키로 식별해야 한다.
  const fileIds = form.getAll('fileIds').map(String);
  const attachments: SkillAttachment[] = [];
  for (const entry of form.getAll('files')) {
    if (entry instanceof File) {
      attachments.push({
        id: fileIds[attachments.length] ?? `att-${attachments.length}`,
        fileName: entry.name,
        mimeType: entry.type || 'application/octet-stream',
        bytes: Buffer.from(await entry.arrayBuffer()),
      });
    }
  }

  const ctx = {
    coreHeaders: coreAuthHeaders,
    coreApiUrl: CORE_API_URL,
    fileServiceUrl: (
      process.env.FILE_SERVICE_URL ?? 'http://localhost:3080'
    ).replace(/\/+$/, ''),
    // 도구 안에서 조회 → 저장으로 이어질 때, 취소 이후 저장이 나가는 것을 막는다.
    signal: request.signal,
    attachments,
  };

  // system 은 매번 서버가 새로 붙인다 — 지시문을 고치면 진행 중인 대화에도 바로 반영된다.
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...history.filter((m) => m.role !== 'system'),
  ];

  // 첨부가 있으면 모델이 그 사실을 알아야 업로드 도구를 부를 수 있다.
  // 파일 내용은 넘기지 않는다 — .xlsx 는 모델이 읽을 수 있는 형식이 아니고,
  // 도구가 바이트를 그대로 Core 로 넘기므로 읽을 필요도 없다.
  if (attachments.length > 0) {
    messages.push({
      role: 'user',
      content: `[이번 메시지에 첨부된 파일: ${attachments
        .map((a) => a.fileName)
        .join(', ')}]`,
    });
  }

  /**
   * 업로드 도구가 실제로 쓴 첨부의 키만 모은다. 도구가 ok:true 를 줘도 일부만 올라갈 수
   * 있어서(파일명 불일치·개별 실패), 전부 소비한 것으로 치면 재시도할 파일까지 사라진다.
   */
  const consumedIds = new Set<string>();

  const tools = toOpenAiTools();
  // 결과까지 클라이언트로 내려보낸다 — 패널이 상품 목록 같은 것을 카드로 렌더한다.
  // 모델이 표를 그려 좁은 패널에 쏟는 것보다 훨씬 읽기 쉽다.
  const toolCalls: { name: string; input: unknown; result?: unknown }[] = [];

  /** 브라우저가 요청을 끊으면(Esc) 여기서 도는 도구 실행도 멈춰야 한다. */
  const aborted = () => request.signal.aborted;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };
      const finish = (event: string, data: unknown) => {
        send(event, data);
        closed = true;
        controller.close();
      };
      const snapshot = () => ({
        toolCalls,
        consumedIds: [...consumedIds],
        conversation: closeDanglingToolCalls(
          messages.filter((m) => m.role !== 'system')
        ),
      });

      const startedAt = Date.now();

      try {
        for (let turn = 0; turn < MAX_TURNS; turn += 1) {
          if (aborted()) return finish('aborted', snapshot());
          if (turn > 0 && Date.now() - startedAt > TIME_BUDGET_MS) {
            return finish('done', {
              message:
                '시간이 오래 걸려 여기서 멈췄습니다. 이어서 진행하려면 "계속"이라고 말씀해 주세요.',
              ...snapshot(),
            });
          }

          // 스트리밍으로 받아 텍스트를 곧바로 흘려보낸다. 도구를 여러 번 도는
          // 작업은 20초 넘게 걸려서, 침묵이 길면 고장으로 읽힌다.
          const streamed = await guard.client.chat.completions.create(
            {
              model: MODEL,
              messages,
              tools,
              stream: true,
              // 스트리밍은 기본적으로 usage 를 안 준다. 비용 추적이 끊기지 않게 켠다.
              stream_options: { include_usage: true },
            },
            { signal: request.signal }
          );

          let content = '';
          const partials = new Map<
            number,
            { id: string; name: string; args: string }
          >();

          for await (const chunk of streamed) {
            if (aborted()) return finish('aborted', snapshot());

            if (chunk.usage) logUsage(chunk.usage, { turn });

            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              content += delta.content;
              send('delta', { text: delta.content });
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

          messages.push({
            role: 'assistant',
            content: content || null,
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
            return finish('done', { message: content, ...snapshot() });
          }

          for (const call of calls) {
            // 무엇을 하는 중인지 알린다. 도구가 여러 개면 침묵이 길어진다.
            send('tool', { name: call.name, status: 'running' });

            // 모델이 만든 JSON 이라 깨질 수 있다 — 파싱 실패를 도구 오류로 돌려주면
            // 모델이 스스로 고쳐 다시 부른다. 여기서 던지면 루프가 죽는다.
            let input: unknown;
            try {
              input = call.args ? JSON.parse(call.args) : {};
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
            if (aborted()) return finish('aborted', snapshot());

            let result: unknown;
            try {
              result = await runTool(call.name, input, ctx);
            } catch (toolError) {
              if (aborted() || (toolError as Error)?.name === 'AbortError') {
                return finish('aborted', snapshot());
              }
              throw toolError;
            }

            toolCalls.push({ name: call.name, input, result });
            const consumed = (result as { consumedIds?: unknown })?.consumedIds;
            if (Array.isArray(consumed)) {
              for (const id of consumed) {
                if (typeof id === 'string') consumedIds.add(id);
              }
            }
            send('tool', { name: call.name, status: 'done' });

            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify(result ?? null),
            });
          }
        }

        // 한도로 끊겨도 그때까지 실행된 도구 결과(업로드한 fileId 등)는 살려 보낸다.
        return finish('done', {
          message:
            '작업이 너무 많은 단계로 길어져 중단했습니다. 요청을 나눠서 다시 말씀해 주세요.',
          ...snapshot(),
        });
      } catch (err) {
        if (aborted() || (err as Error)?.name === 'AbortError') {
          return finish('aborted', snapshot());
        }
        console.error('[ai/assistant] 오류', {
          message: (err as Error)?.message?.slice(0, 300),
        });
        return finish('error', {
          message: toUserMessage(err),
          ...snapshot(),
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 프록시가 버퍼링하면 스트리밍이 의미를 잃는다.
      'X-Accel-Buffering': 'no',
    },
  });
}

/** OpenAI 오류를 사용자 문장으로 옮긴다. 상태코드를 그대로 보여주지 않는다. */
function toUserMessage(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 429) return 'AI 요청이 몰려 있습니다. 잠시 후 다시 시도해 주세요.';
  if (status === 401 || status === 403) return 'AI 사용 권한을 확인해 주세요.';
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
