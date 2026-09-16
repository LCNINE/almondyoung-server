import type OpenAI from 'openai';
import { closeDanglingToolCalls, restoreConversation } from './conversation';

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

describe('restoreConversation', () => {
  it('assistant 턴의 contentBlocks 를 그대로 펼친다', () => {
    const blocks = [
      { role: 'assistant', content: null, tool_calls: [call('a')] },
      { role: 'tool', tool_call_id: 'a', content: '{"ok":true,"fileId":"f1"}' },
      { role: 'assistant', content: '올렸습니다' },
    ];

    const restored = restoreConversation([
      { role: 'user', content: '이미지 올려줘', contentBlocks: null },
      { role: 'assistant', content: '올렸습니다', contentBlocks: blocks },
    ]);

    // 텍스트만 남기면 f1 이 사라져 다음 턴에 이미지를 다시 달라고 되묻는다.
    expect(restored).toEqual([{ role: 'user', content: '이미지 올려줘' }, ...blocks]);
  });

  it('contentBlocks 가 없으면 텍스트만 되살린다', () => {
    expect(restoreConversation([{ role: 'assistant', content: '네', contentBlocks: null }])).toEqual([
      { role: 'assistant', content: '네' },
    ]);
  });

  it('끊긴 턴이 남긴 응답 없는 tool_call 을 닫는다', () => {
    const restored = restoreConversation([
      { role: 'user', content: '지워줘', contentBlocks: null },
      {
        role: 'assistant',
        content: null,
        contentBlocks: [{ role: 'assistant', content: null, tool_calls: [call('x')] }],
      },
    ]);

    // 응답 없는 tool_call 이 남아 있으면 OpenAI 가 대화 전체를 400 으로 거부한다.
    expect(restored.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'x' });
  });
});

describe('closeDanglingToolCalls — 뒤에 발화가 더 있는 기록', () => {
  it('미응답 호출을 그 자리에서 닫는다 (맨 끝이 아니라)', () => {
    const messages: Message[] = [
      { role: 'user', content: '지워줘' },
      { role: 'assistant', content: null, tool_calls: [call('a')] },
      // 여기서 끊겼다. 사용자가 다시 말을 걸어 대화가 이어졌다.
      { role: 'user', content: '어떻게 됐어?' },
      { role: 'assistant', content: '확인해볼게요' },
    ];

    const closed = closeDanglingToolCalls(messages);

    // assistant(tool_calls) 바로 뒤여야 한다. 맨 끝에 붙이면
    // assistant → user → tool 이 되어 OpenAI 가 400 으로 거부한다.
    expect(closed[2]).toMatchObject({ role: 'tool', tool_call_id: 'a' });
    expect(closed[3]).toEqual({ role: 'user', content: '어떻게 됐어?' });
  });

  it('미응답이 여러 군데면 전부 닫는다', () => {
    const messages: Message[] = [
      { role: 'assistant', content: null, tool_calls: [call('a')] },
      { role: 'user', content: '다시' },
      { role: 'assistant', content: null, tool_calls: [call('b')] },
    ];

    const ids = closeDanglingToolCalls(messages)
      .filter((m) => m.role === 'tool')
      .map((m) => (m as { tool_call_id: string }).tool_call_id);

    expect(ids).toEqual(['a', 'b']);
  });
});

describe('restoreConversation — content 가 null 인 assistant 턴', () => {
  it('tool_calls 없이 content 만 null 인 것은 빈 문자열로 고친다', () => {
    // ask_choice 로 선택지만 내고 말을 보태지 않은 턴이 이 모양으로 저장됐다.
    // 그대로 되돌려주면 OpenAI 가 대화 전체를 400 으로 거부해 대화가 죽는다.
    const restored = restoreConversation([
      { role: 'user', content: '상품 업로드해줘', contentBlocks: null },
      {
        role: 'assistant',
        content: null,
        contentBlocks: [
          { role: 'assistant', content: null, tool_calls: [call('c1')] },
          { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
          { role: 'assistant', content: null },
        ],
      },
    ]);

    expect(restored.at(-1)).toEqual({ role: 'assistant', content: '' });
  });

  it('tool_calls 가 있으면 content: null 을 그대로 둔다 — 그건 규약상 올바르다', () => {
    const restored = restoreConversation([
      {
        role: 'assistant',
        content: null,
        contentBlocks: [
          { role: 'assistant', content: null, tool_calls: [call('c1')] },
          { role: 'tool', tool_call_id: 'c1', content: '{}' },
        ],
      },
    ]);

    expect(restored[0]).toMatchObject({ content: null, tool_calls: [{ id: 'c1' }] });
  });
});
