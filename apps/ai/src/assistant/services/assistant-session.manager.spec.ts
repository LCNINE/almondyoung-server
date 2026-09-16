import { AssistantSessionManager, titleFrom } from './assistant-session.manager';
import type { AssistantChatRepository } from '../repositories/assistant-chat.repository';
import type { AssistantSessionReader } from './assistant-session.reader';

function makeManager() {
  const updated: { sessionId: string; title: string }[] = [];
  const inserted: unknown[] = [];

  const repository = {
    updateTitle: (sessionId: string, title: string) => {
      updated.push({ sessionId, title });
      return Promise.resolve();
    },
    insertMessage: (message: unknown) => {
      inserted.push(message);
      return Promise.resolve(message as never);
    },
  } as unknown as AssistantChatRepository;

  const reader = {} as AssistantSessionReader;

  return { manager: new AssistantSessionManager(repository, reader), updated, inserted };
}

describe('titleFrom', () => {
  it('첫 줄만 쓰고 길면 자른다', () => {
    expect(titleFrom('가나다\n라마바')).toBe('가나다');
    expect(titleFrom('가'.repeat(50))).toBe(`${'가'.repeat(40)}…`);
  });

  it('빈 문자열이면 기본 이름을 준다', () => {
    expect(titleFrom('   ')).toBe('새 대화');
  });
});

describe('AssistantSessionManager', () => {
  it('제목이 없을 때만 첫 발화에서 딴다', async () => {
    const { manager, updated } = makeManager();

    await expect(manager.ensureTitle('s1', null, '상품 등록해줘')).resolves.toBe('상품 등록해줘');
    expect(updated).toEqual([{ sessionId: 's1', title: '상품 등록해줘' }]);
  });

  it('이미 제목이 있으면 덮지 않는다', async () => {
    const { manager, updated } = makeManager();

    // 이어 말할 때마다 제목이 바뀌면 목록에서 어떤 대화인지 못 알아본다.
    await expect(manager.ensureTitle('s1', '기존 제목', '그리고 가격도')).resolves.toBeNull();
    expect(updated).toHaveLength(0);
  });

  it('발화도 첨부도 없으면 저장하지 않고 막는다', async () => {
    const { manager, inserted } = makeManager();

    await expect(manager.appendUserMessage('s1', '   ', false)).rejects.toThrow('보낼 메시지가 없습니다.');
    expect(inserted).toHaveLength(0);
  });

  it('첨부만 있으면 빈 발화라도 받는다', async () => {
    const { manager, inserted } = makeManager();

    // 엑셀만 던지고 "이거 올려줘" 를 안 쓰는 사용자가 실제로 있다.
    await manager.appendUserMessage('s1', '', true);
    expect(inserted).toHaveLength(1);
  });
});
