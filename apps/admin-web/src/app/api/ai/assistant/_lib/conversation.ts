import type OpenAI from 'openai';

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export function closeDanglingToolCalls(messages: Message[]): Message[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'assistant' || !message.tool_calls?.length) continue;

    const answered = new Set(
      messages
        .slice(i + 1)
        .flatMap((m) => (m.role === 'tool' ? [m.tool_call_id] : []))
    );
    const missing = message.tool_calls.filter((call) => !answered.has(call.id));

    return [
      ...messages,
      ...missing.map((call) => ({
        role: 'tool' as const,
        tool_call_id: call.id,
        content: JSON.stringify({
          ok: false,
          error:
            '실행 도중 중단돼 결과를 받지 못했다. 이미 반영됐을 수 있으니 다시 실행하기 전에 조회로 확인한다.',
        }),
      })),
    ];
  }
  return messages;
}
