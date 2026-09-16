import { AssistantChatRepository } from '../repositories/assistant-chat.repository';
import { AssistantChatPurgeService } from './assistant-chat-purge.service';

describe('AssistantChatPurgeService', () => {
  it('유예 기간(30일)만큼 지난 것만 지운다', async () => {
    const purgeSoftDeletedBefore = jest.fn<Promise<number>, [Date]>().mockResolvedValue(3);
    const repository = { purgeSoftDeletedBefore };
    const service = new AssistantChatPurgeService(repository as unknown as AssistantChatRepository);

    const before = Date.now();
    await service.purge();

    // 부호가 뒤집히면 감춘 즉시 지워진다.
    const cutoff = purgeSoftDeletedBefore.mock.calls[0][0];
    const daysAgo = (before - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeCloseTo(30, 3);
  });
});
