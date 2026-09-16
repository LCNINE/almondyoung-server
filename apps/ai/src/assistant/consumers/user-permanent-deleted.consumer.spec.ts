import { AssistantChatRepository } from '../repositories/assistant-chat.repository';
import { UserPermanentDeletedConsumer } from './user-permanent-deleted.consumer';

describe('UserPermanentDeletedConsumer', () => {
  const makeConsumer = () => {
    const repository = { softDeleteSessionsByUser: jest.fn().mockResolvedValue(2) };
    return {
      repository,
      consumer: new UserPermanentDeletedConsumer(repository as unknown as AssistantChatRepository),
    };
  };

  it('영구 삭제된 사용자의 대화를 감춘다', async () => {
    const { consumer, repository } = makeConsumer();

    await consumer.onUserPermanentDeleted({ userId: 'u-1', deletedAt: new Date().toISOString() });

    expect(repository.softDeleteSessionsByUser).toHaveBeenCalledWith('u-1', expect.any(Date));
  });

  // 빈 userId 는 WHERE 없는 UPDATE 가 된다.
  it('userId 가 없으면 아무것도 건드리지 않는다', async () => {
    const { consumer, repository } = makeConsumer();

    await consumer.onUserPermanentDeleted({ userId: '', deletedAt: new Date().toISOString() });

    expect(repository.softDeleteSessionsByUser).not.toHaveBeenCalled();
  });
});
