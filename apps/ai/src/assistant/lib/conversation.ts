import type OpenAI from 'openai';

export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function closure(toolCallId: string): Message {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify({
      ok: false,
      error: '실행 도중 중단돼 결과를 받지 못했다. 이미 반영됐을 수 있으니 다시 실행하기 전에 조회로 확인한다.',
    }),
  };
}

/**
 * 응답 없는 tool_call 을 그 호출 바로 뒤에서 닫는다. 이 상태로 두면 OpenAI 가 대화
 * 전체를 400 으로 거부한다.
 *
 * 배열 맨 끝에 몰아 붙이면 안 된다 — 미응답 호출 뒤에 이미 새 사용자 발화가 있는 기록이면
 * assistant(tool_calls) → user → tool 이 되어 규약을 여전히 어긴다. 그래서 각 호출의
 * 응답 구간을 지나자마자 그 자리에서 닫는다. 미응답이 여러 군데 있어도 모두 처리한다.
 */
export function closeDanglingToolCalls(messages: Message[]): Message[] {
  const out: Message[] = [];

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    out.push(message);

    if (message.role !== 'assistant' || !message.tool_calls?.length) continue;

    // 이 호출에 대한 응답은 바로 뒤에 이어지는 tool 메시지들뿐이다.
    const answered = new Set<string>();
    let next = i + 1;
    for (; next < messages.length; next += 1) {
      const candidate = messages[next];
      if (candidate.role !== 'tool') break;
      answered.add(candidate.tool_call_id);
      out.push(candidate);
    }

    for (const call of message.tool_calls) {
      if (!answered.has(call.id)) out.push(closure(call.id));
    }

    i = next - 1;
  }

  return out;
}

/**
 * assistant 메시지의 content 가 null 인데 tool_calls 도 없으면 빈 문자열로 바꾼다.
 *
 * OpenAI 는 그 조합을 거부한다 — "Invalid value for 'content': expected a string, got null".
 * 한 번 그렇게 저장되면 그 대화는 다음 턴부터 통째로 400 이 되어 영영 못 이어간다.
 * 저장 쪽은 고쳤지만, 이미 그렇게 쌓인 기록도 되살아나야 하므로 읽을 때 한 번 더 막는다.
 */
function sanitize(message: Message): Message {
  if (message.role !== 'assistant') return message;
  if (message.content !== null && message.content !== undefined) return message;
  if (message.tool_calls?.length) return message;

  return { ...message, content: '' };
}

/**
 * DB 에 쌓인 대화를 모델에 그대로 되돌려줄 메시지 배열로 복원한다.
 *
 * assistant 턴은 `contentBlocks` 에 그 턴의 assistant·tool 메시지를 통째로 담아 둔다.
 * 텍스트만 남기면 이전 턴에 업로드해 받은 fileId 같은 것이 사라져서, 모델이
 * "이미지를 다시 첨부해 주세요" 라고 되묻는다 — 실제로 그렇게 막혔다.
 *
 * 저장 시점에 끊긴 턴이 있으면 응답 없는 tool_call 이 남는데, OpenAI 는 그 상태의
 * 대화를 400 으로 거부한다. 그래서 복원할 때마다 한 번 더 닫는다 — 과거 기록에 남은
 * 미응답도 그 자리에서 닫히므로, 그 뒤에 발화가 더 있어도 순서가 어긋나지 않는다.
 */
export function restoreConversation(
  stored: {
    role: string;
    content: string | null;
    contentBlocks: unknown[] | null;
  }[],
): Message[] {
  const messages: Message[] = [];

  for (const row of stored) {
    if (row.role === 'user') {
      messages.push({ role: 'user', content: row.content ?? '' });
      continue;
    }

    if (Array.isArray(row.contentBlocks) && row.contentBlocks.length > 0) {
      messages.push(...(row.contentBlocks as Message[]).map(sanitize));
      continue;
    }

    if (row.content) {
      messages.push({ role: 'assistant', content: row.content });
    }
  }

  return closeDanglingToolCalls(messages);
}
