import { ForbiddenError } from '@app/shared';
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
    const { db, state } = makeFakeDb(seedCase(caseId));
    const service = new CsCommentsService(db as any);

    await expect(
      service.addComment(caseId, { body: 'hi', attachments: [{ fileId: '   ' }] }, authorId),
    ).rejects.toThrow('fileId');
    expect(state.get(csCaseComments)).toHaveLength(0);
    expect(state.get(csCaseCommentMentions)).toHaveLength(0);
    expect(state.get(csCaseCommentAttachments)).toHaveLength(0);
  });

  it('throws when the case does not exist', async () => {
    const { db } = makeFakeDb();
    const service = new CsCommentsService(db as any);
    await expect(service.addComment(caseId, { body: 'hi' }, authorId)).rejects.toThrow('not found');
  });
});

describe('CsCommentsService edit/delete', () => {
  const caseId = 'aaaaaaaa-0000-4000-8000-000000000001';
  const authorId = 'bbbbbbbb-0000-4000-8000-000000000001';
  const otherAuthorId = 'cccccccc-0000-4000-8000-000000000001';

  it('lets the author edit and sets editedAt', async () => {
    const { db, state } = makeFakeDb(seedCase(caseId));
    const service = new CsCommentsService(db as any);
    const created = await service.addComment(caseId, { body: 'first' }, authorId);

    const edited = await service.editComment(created.id, { body: 'second' }, authorId);

    expect(edited.body).toBe('second');
    expect(state.get(csCaseComments)[0].editedAt).not.toBeNull();
  });

  it('blocks editing someone else’s comment', async () => {
    const { db } = makeFakeDb(seedCase(caseId));
    const service = new CsCommentsService(db as any);
    const created = await service.addComment(caseId, { body: 'first' }, authorId);

    await expect(service.editComment(created.id, { body: 'x' }, otherAuthorId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('soft-deletes (author only) keeping the row', async () => {
    const { db, state } = makeFakeDb(seedCase(caseId));
    const service = new CsCommentsService(db as any);
    const created = await service.addComment(caseId, { body: 'first' }, authorId);

    await service.deleteComment(created.id, authorId);

    expect(state.get(csCaseComments)).toHaveLength(1);
    expect(state.get(csCaseComments)[0].deletedAt).not.toBeNull();
    expect(state.get(csCaseComments)[0].deletedBy).toBe(authorId);
  });
});
