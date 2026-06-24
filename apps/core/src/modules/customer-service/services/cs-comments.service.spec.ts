import {
  csCaseCommentAttachments,
  csCaseCommentMentions,
  csCaseComments,
  csCases,
} from '../schema/customer-service.schema';
import { makeFakeDb } from '../__fixtures__/fake-db';
import { CsCommentsService } from './cs-comments.service';

function seedCase(caseId: string) {
  const seed = new Map<unknown, any[]>();
  seed.set(csCases, [{ id: caseId, subject: 'x', status: 'open' }]);
  return seed;
}

describe('CsCommentsService.addComment', () => {
  const caseId = 'aaaaaaaa-0000-4000-8000-000000000001';
  const authorId = 'bbbbbbbb-0000-4000-8000-000000000001';
  const mentionedUserId = 'cccccccc-0000-4000-8000-000000000001';

  it('creates a comment with mentions and attachments', async () => {
    const { db, state } = makeFakeDb(seedCase(caseId));
    const service = new CsCommentsService(db as any);

    const result = await service.addComment(
      caseId,
      {
        body: '확인 후 답변드리겠습니다 @agent',
        mentionedUserIds: [mentionedUserId],
        attachments: [{ fileId: 'file_1', fileName: 'defect.jpg' }],
      },
      authorId,
    );

    expect(result.body).toBe('확인 후 답변드리겠습니다 @agent');
    expect(state.get(csCaseComments)).toHaveLength(1);
    expect(state.get(csCaseCommentMentions)[0]).toMatchObject({ mentionedUserId });
    expect(state.get(csCaseCommentAttachments)[0]).toMatchObject({
      fileId: 'file_1',
      csCaseId: caseId,
      sortOrder: 0,
      uploadedBy: authorId,
    });
  });

  it('rejects an empty body', async () => {
    const { db } = makeFakeDb(seedCase(caseId));
    const service = new CsCommentsService(db as any);
    await expect(service.addComment(caseId, { body: '   ' }, authorId)).rejects.toThrow('empty');
  });

  it('rejects an attachment with an empty fileId', async () => {
    const { db } = makeFakeDb(seedCase(caseId));
    const service = new CsCommentsService(db as any);

    await expect(
      service.addComment(caseId, { body: 'hi', attachments: [{ fileId: '   ' }] }, authorId),
    ).rejects.toThrow('fileId');
  });

  it('throws when the case does not exist', async () => {
    const { db } = makeFakeDb();
    const service = new CsCommentsService(db as any);
    await expect(service.addComment(caseId, { body: 'hi' }, authorId)).rejects.toThrow('not found');
  });
});
