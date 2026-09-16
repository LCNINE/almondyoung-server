import type OpenAI from 'openai';
import { closeDanglingToolCalls } from './conversation';

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const call = (id: string) => ({
  id,
  type: 'function' as const,
  function: { name: 'create_product', arguments: '{}' },
});

describe('closeDanglingToolCalls', () => {
  it('응답 없는 tool_call 에 실패 결과를 채운다', () => {
    const messages: Message[] = [
      { role: 'user', content: '등록해줘' },
      { role: 'assistant', content: null, tool_calls: [call('a'), call('b')] },
      { role: 'tool', tool_call_id: 'a', content: '{"ok":true}' },
    ];

    const closed = closeDanglingToolCalls(messages);

    expect(closed.slice(0, 3)).toEqual(messages);
    expect(closed).toHaveLength(4);
    expect(closed[3]).toMatchObject({ role: 'tool', tool_call_id: 'b' });
  });

  it('모두 응답됐으면 그대로 둔다', () => {
    const messages: Message[] = [
      { role: 'assistant', content: null, tool_calls: [call('a')] },
      { role: 'tool', tool_call_id: 'a', content: '{}' },
      { role: 'assistant', content: '끝' },
    ];

    expect(closeDanglingToolCalls(messages)).toEqual(messages);
  });
});
