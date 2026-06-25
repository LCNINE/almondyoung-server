import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { BadRequestError, ForbiddenError, NotFoundError } from '@app/shared';
import { eq } from 'drizzle-orm';
import { type MergedSchema } from '../../../platform/database/merged-schema';
import { CreateCsCommentDto } from '../dto/create-cs-comment.dto';
import { EditCsCommentDto } from '../dto/edit-cs-comment.dto';
import {
  csCaseCommentAttachments,
  csCaseCommentMentions,
  csCaseComments,
  csCases,
  type CsCaseComment,
} from '../schema/customer-service.schema';

type Db = DbService<MergedSchema>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

@Injectable()
export class CsCommentsService {
  constructor(@InjectDb() private readonly dbService: DbService<MergedSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: Tx) => Promise<T>, tx?: Tx): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  private async loadCommentOrThrow(commentId: string, tx: Tx): Promise<CsCaseComment> {
    const [row] = await tx.select().from(csCaseComments).where(eq(csCaseComments.id, commentId)).limit(1);
    if (!row) throw new NotFoundError(`CS comment ${commentId} not found`);
    return row;
  }

  private assertCommentBelongsToCase(comment: CsCaseComment, csCaseId: string): void {
    if (comment.csCaseId !== csCaseId) {
      throw new NotFoundError(`CS comment ${comment.id} not found in CS Case ${csCaseId}`);
    }
  }

  async addComment(csCaseId: string, dto: CreateCsCommentDto, authorId: string, tx?: Tx) {
    const body = dto.body?.trim();
    if (!body) throw new BadRequestError('Comment body must not be empty');

    const attachments = (dto.attachments ?? []).map((attachment) => ({
      ...attachment,
      fileId: attachment.fileId.trim(),
    }));
    if (attachments.some((attachment) => !attachment.fileId)) {
      throw new BadRequestError('Attachment fileId must not be empty');
    }

    return this.inTx(async (trx) => {
      const [csCase] = await trx.select().from(csCases).where(eq(csCases.id, csCaseId)).limit(1);
      if (!csCase) throw new NotFoundError(`CS Case ${csCaseId} not found`);

      const [comment] = await trx.insert(csCaseComments).values({ csCaseId, authorId, body }).returning();

      const mentionIds = [...new Set(dto.mentionedUserIds ?? [])];
      if (mentionIds.length) {
        await trx
          .insert(csCaseCommentMentions)
          .values(mentionIds.map((mentionedUserId) => ({ commentId: comment.id, mentionedUserId })));
      }

      if (attachments.length) {
        await trx.insert(csCaseCommentAttachments).values(
          attachments.map((a, index) => ({
            csCaseId,
            commentId: comment.id,
            fileId: a.fileId,
            fileName: a.fileName ?? null,
            sortOrder: index,
            uploadedBy: authorId,
          })),
        );
      }

      return { ...comment, mentions: mentionIds, attachmentFileIds: attachments.map((a) => a.fileId) };
    }, tx);
  }

  async editComment(csCaseId: string, commentId: string, dto: EditCsCommentDto, actorId: string, tx?: Tx) {
    const body = dto.body?.trim();
    if (!body) throw new BadRequestError('Comment body must not be empty');

    return this.inTx(async (trx) => {
      const comment = await this.loadCommentOrThrow(commentId, trx);
      this.assertCommentBelongsToCase(comment, csCaseId);
      if (comment.deletedAt) throw new BadRequestError('Cannot edit a deleted comment');
      if (comment.authorId !== actorId) throw new ForbiddenError('Only the author can edit this comment');

      const [updated] = await trx
        .update(csCaseComments)
        .set({ body, editedAt: new Date(), updatedAt: new Date() })
        .where(eq(csCaseComments.id, commentId))
        .returning();
      return updated;
    }, tx);
  }

  async deleteComment(csCaseId: string, commentId: string, actorId: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      const comment = await this.loadCommentOrThrow(commentId, trx);
      this.assertCommentBelongsToCase(comment, csCaseId);
      if (comment.authorId !== actorId) throw new ForbiddenError('Only the author can delete this comment');
      if (comment.deletedAt) return comment;

      const [updated] = await trx
        .update(csCaseComments)
        .set({ deletedAt: new Date(), deletedBy: actorId, updatedAt: new Date() })
        .where(eq(csCaseComments.id, commentId))
        .returning();
      return updated;
    }, tx);
  }
}
