import { AssistantSessionReader } from '../assistant-session.reader';
import type { AssistantChatRepository, MessageRow } from '../../repositories/assistant-chat.repository';
import { estimateTokens } from '../../lib/conversation-size';

function row(role: 'user' | 'assistant', content: string, createdAt: Date): MessageRow {
  return {
    id: `${role}-${createdAt.toISOString()}`,
    sessionId: 's1',
    role,
    content,
    contentBlocks: null,
    toolCalls: null,
    createdAt,
  };
}

const OLD = new Date('2026-09-16T01:00:00Z');
const BOUNDARY = new Date('2026-09-16T02:00:00Z');
const RECENT = new Date('2026-09-16T03:00:00Z');

function makeReader(all: MessageRow[]) {
  const asked: { after?: Date; all?: boolean } = {};
  const repository = {
    findMessages: () => {
      asked.all = true;
      return Promise.resolve(all);
    },
    findMessagesAfter: (_id: string, after: Date) => {
      asked.after = after;
      return Promise.resolve(all.filter((m) => m.createdAt > after));
    },
  } as unknown as AssistantChatRepository;

  return { reader: new AssistantSessionReader(repository), asked };
}

describe('접어 둔 대화 복원', () => {
  const all = [row('user', '옛날 얘기', OLD), row('assistant', '옛날 답', BOUNDARY), row('user', '최근 얘기', RECENT)];

  it('요약이 없으면 전부 읽는다', async () => {
    const { reader, asked } = makeReader(all);

    const restored = await reader.loadConversation({ id: 's1', summary: null, summarizedThrough: null });

    expect(asked.all).toBe(true);
    expect(restored).toHaveLength(3);
  });

  it('요약이 있으면 그 시각 이후만 읽고 앞에 요약을 놓는다', async () => {
    const { reader, asked } = makeReader(all);

    const restored = await reader.loadConversation({
      id: 's1',
      summary: '상품 masterId=m1 을 등록했다. fileId=f1 이미지를 붙였다.',
      summarizedThrough: BOUNDARY,
    });

    expect(asked.after).toBe(BOUNDARY);
    expect(restored).toHaveLength(2);
    // 식별자를 잃으면 다음 턴이 이미 한 일을 처음부터 다시 한다.
    expect(restored[0]).toMatchObject({ role: 'user' });
    expect(JSON.stringify(restored[0].content)).toContain('masterId=m1');
    expect(restored[1]).toMatchObject({ content: '최근 얘기' });
  });

  it('요약만 있고 경계가 없으면 접지 않은 것으로 본다', async () => {
    const { reader, asked } = makeReader(all);

    await reader.loadConversation({ id: 's1', summary: '요약', summarizedThrough: null });

    // 한쪽만 채워진 상태로 잘라 읽으면 대화가 통째로 사라질 수 있다.
    expect(asked.all).toBe(true);
  });
});

describe('estimateTokens', () => {
  it('대화가 길수록 크게 잡는다', () => {
    const short = estimateTokens([{ role: 'user', content: '짧다' }]);
    const long = estimateTokens([{ role: 'user', content: '길다'.repeat(1000) }]);

    expect(long).toBeGreaterThan(short);
    // 2,000자면 임계(12,000토큰)에는 한참 못 미친다 — 어림값이 자릿수를 벗어나지 않는지만 본다.
    expect(long).toBeGreaterThan(500);
    expect(long).toBeLessThan(2_000);
  });

  it('빈 대화는 0에 가깝다', () => {
    expect(estimateTokens([])).toBeLessThan(5);
  });
});

describe('접기 판단과 요약 입력', () => {
  function withTools(): MessageRow[] {
    // 식별자는 사람이 쓴 문장이 아니라 도구 호출·결과에만 있다.
    const blocks = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'create_product', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 't1', content: '{"masterId":"m-777","versionId":"v-777"}' },
      { role: 'assistant', content: '등록했습니다' },
    ];
    return [
      row('user', '상품 등록해줘', OLD),
      { ...row('assistant', '등록했습니다', BOUNDARY), contentBlocks: blocks },
      ...Array.from({ length: 6 }, (_, i) => row('user', `최근 ${i}`, new Date(RECENT.getTime() + i * 1000))),
    ];
  }

  function makeCompactor(rows: MessageRow[]) {
    const calls: { after?: Date; all?: boolean; prompt?: string } = {};
    const repository = {
      findMessages: () => {
        calls.all = true;
        return Promise.resolve(rows);
      },
      findMessagesAfter: (_id: string, after: Date) => {
        calls.after = after;
        return Promise.resolve(rows.filter((m) => m.createdAt > after));
      },
      saveSummary: () => Promise.resolve(),
    } as unknown as AssistantChatRepository;

    return { repository, calls };
  }

  it('이미 접힌 세션은 요약 이후 구간만 다시 본다', async () => {
    const { ConversationCompactorService } = await import('../conversation-compactor.service');
    const { repository, calls } = makeCompactor(withTools());

    await new ConversationCompactorService(repository).compactIfNeeded({
      id: 's1',
      summary: '앞서 요약',
      summarizedThrough: BOUNDARY,
    });

    // 전체를 다시 재면 한 번 접은 뒤에도 매 턴 재요약이 돌아, 아끼려던 비용을 도로 쓴다.
    expect(calls.after).toBe(BOUNDARY);
    expect(calls.all).toBeUndefined();
  });

  it('요약 입력에 도구 호출과 결과가 실린다', async () => {
    const { describeForSummary } = await import('../conversation-compactor.service');
    const { restoreConversation } = await import('../../lib/conversation');

    const lines = restoreConversation(withTools().slice(0, 2)).map(describeForSummary).join('\n');

    // 식별자는 도구 결과에만 있다. 이게 빠지면 "식별자를 그대로 옮기라" 는 지시가
    // 옮길 대상 자체를 못 받아, 다음 턴이 이미 한 일을 처음부터 다시 한다.
    expect(lines).toContain('m-777');
    expect(lines).toContain('도구호출: create_product');
    // 도구만 부르고 말이 없는 턴이 "null" 로 찍히면 안 된다.
    expect(lines).not.toContain('null');
  });
});

describe('긴 도구 결과가 있어도 대화를 잃지 않는다', () => {
  it('한 줄이 너무 길면 그 줄만 줄이고 잘렸다고 남긴다', async () => {
    const { describeForSummary } = await import('../conversation-compactor.service');

    // 상품 목록 20건이나 엑셀 결과는 한 줄이 수만 자다.
    const huge = describeForSummary({
      role: 'tool',
      tool_call_id: 't1',
      content: `{"masterId":"m-777","rows":"${'x'.repeat(50_000)}"}`,
    });

    expect(huge).toContain('m-777'); // 식별자는 앞쪽이라 살아남는다
    expect(huge).toContain('생략'); // 지어내지 않게 잘렸다고 알린다
    expect(huge.length).toBeLessThan(3_000);
  });

  it('요약에 들어간 만큼만 접힌 것으로 표시한다', async () => {
    const { ConversationCompactorService } = await import('../conversation-compactor.service');

    // 줄마다 상한(2,000자)이 걸리므로, 예산(40,000자)에는 약 20줄까지 들어간다.
    const many: MessageRow[] = Array.from({ length: 60 }, (_, i) =>
      row('user', 'y'.repeat(5_000), new Date(OLD.getTime() + i * 1000)),
    );

    let savedThrough: Date | undefined;
    const repository = {
      findMessages: () => Promise.resolve(many),
      findMessagesAfter: () => Promise.resolve(many),
      saveSummary: (_id: string, _s: string, through: Date) => {
        savedThrough = through;
        return Promise.resolve();
      },
    } as unknown as AssistantChatRepository;

    const service = new ConversationCompactorService(repository);
    // 요약 호출만 가로챈다 — 네트워크를 타지 않고 경계 계산만 본다.
    jest.spyOn(service as unknown as { summarize: () => Promise<string> }, 'summarize').mockResolvedValue('요약됨');

    await service.compactIfNeeded({ id: 's1', summary: null, summarizedThrough: null });

    expect(savedThrough).toBeDefined();
    // 전체 끝(59번째)을 경계로 잡으면 요약에 없는 구간이 원문에서도 빠져 영영 사라진다.
    const last = many.at(-1)!.createdAt;
    expect(savedThrough!.getTime()).toBeLessThan(last.getTime());
  });
});

describe('요약 입력 예산', () => {
  /** contentBlocks 는 여러 메시지로 펼쳐진다 — 도구를 여러 번 돈 턴은 행 하나가 거대해진다. */
  function hugeRow(createdAt: Date): MessageRow {
    const blocks = Array.from({ length: 60 }, (_, i) => [
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: `t${i}`, type: 'function', function: { name: 'search_products', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: `t${i}`, content: `{"rows":"${'z'.repeat(5_000)}"}` },
    ]).flat();

    return { ...row('assistant', '했습니다', createdAt), contentBlocks: blocks };
  }

  async function foldOf(rows: MessageRow[]) {
    const { ConversationCompactorService } = await import('../conversation-compactor.service');

    let saved: { summary: string; through: Date } | undefined;
    const repository = {
      findMessages: () => Promise.resolve(rows),
      findMessagesAfter: () => Promise.resolve(rows),
      saveSummary: (_id: string, summary: string, through: Date) => {
        saved = { summary, through };
        return Promise.resolve();
      },
    } as unknown as AssistantChatRepository;

    const service = new ConversationCompactorService(repository);
    let given = '';
    jest
      .spyOn(service as unknown as { summarize: (t: string, p: string | null) => Promise<string> }, 'summarize')
      .mockImplementation((transcript: string) => {
        given = transcript;
        return Promise.resolve('요약됨');
      });

    await service.compactIfNeeded({ id: 's1', summary: null, summarizedThrough: null });
    return { given, saved };
  }

  it('행 하나가 예산을 넘어도 접기를 포기하지 않고, 입력은 예산 안에 둔다', async () => {
    const rows = [
      hugeRow(OLD),
      ...Array.from({ length: 6 }, (_, i) => row('user', `최근 ${i}`, new Date(RECENT.getTime() + i * 1000))),
    ];

    const { given, saved } = await foldOf(rows);

    // 포기하면 그 세션은 영영 못 접고 계속 커진다.
    expect(saved).toBeDefined();
    expect(saved!.through).toEqual(OLD);
    // 넘겨도 안 된다 — 요약 모델이 거부하면 접기가 매 턴 실패한다.
    expect(given.length).toBeLessThanOrEqual(40_000);
  });

  it('여러 행이면 예산에 들어가는 만큼만 접고 나머지는 원문으로 남긴다', async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      row('user', 'w'.repeat(4_000), new Date(OLD.getTime() + i * 1000)),
    );
    const rows = [...many, ...Array.from({ length: 6 }, (_, i) => row('user', `최근 ${i}`, RECENT))];

    const { given, saved } = await foldOf(rows);

    expect(given.length).toBeLessThanOrEqual(40_000);
    // 경계가 접기 후보의 끝이면, 요약에 없는 구간이 원문에서도 빠져 사라진다.
    expect(saved!.through.getTime()).toBeLessThan(many.at(-1)!.createdAt.getTime());
  });
});

describe('초대형 행은 앞부분만 남기지 않는다', () => {
  it('모든 줄을 균등히 줄여 후반부도 요약 입력에 넣는다', async () => {
    const { ConversationCompactorService } = await import('../conversation-compactor.service');

    // 도구를 60번 돈 턴. 각 결과에 서로 다른 식별자가 들어 있다.
    const blocks = Array.from({ length: 60 }, (_, i) => [
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: `t${i}`, type: 'function', function: { name: 'get_product', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: `t${i}`, content: `{"masterId":"m-${i}","junk":"${'z'.repeat(5_000)}"}` },
    ]).flat();

    const rows: MessageRow[] = [
      { ...row('assistant', '했습니다', OLD), contentBlocks: blocks },
      ...Array.from({ length: 6 }, (_, i) => row('user', `최근 ${i}`, new Date(RECENT.getTime() + i * 1000))),
    ];

    const repository = {
      findMessages: () => Promise.resolve(rows),
      findMessagesAfter: () => Promise.resolve(rows),
      saveSummary: () => Promise.resolve(),
    } as unknown as AssistantChatRepository;

    const service = new ConversationCompactorService(repository);
    let given = '';
    jest
      .spyOn(service as unknown as { summarize: (t: string, p: string | null) => Promise<string> }, 'summarize')
      .mockImplementation((transcript: string) => {
        given = transcript;
        return Promise.resolve('요약됨');
      });

    await service.compactIfNeeded({ id: 's1', summary: null, summarizedThrough: null });

    // 이 행은 경계가 자기 자신이라 원문에서 빠진다. 앞부분만 남기고 자르면
    // 뒤쪽 식별자는 요약에도 원문에도 없이 사라진다.
    expect(given).toContain('m-0');
    expect(given).toContain('m-59');
    expect(given.length).toBeLessThanOrEqual(40_000);
  });
});

describe('clamp 는 상한을 지킨다', () => {
  it('접미사까지 포함해 limit 을 넘지 않는다', async () => {
    const { describeForSummary } = await import('../conversation-compactor.service');

    // 줄마다 limit 을 조금씩 넘으면 줄이 많을수록 그 합이 커져 뒤쪽 줄이 통째로 잘린다.
    const line = describeForSummary({ role: 'tool', tool_call_id: 't', content: 'x'.repeat(100_000) });

    expect(line.length).toBeLessThanOrEqual(2_000 + '도구결과: '.length);
  });
});
