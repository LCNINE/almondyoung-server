import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, asc, count, desc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import { answers, questionMedia, questions, type UgcServiceSchema } from '../db/schema';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionListQueryDto } from './dto/question-list-query.dto';
import { CreateAnswerDto } from './dto/create-answer.dto';
import { type AnswerEntity, type QuestionEntity, type QuestionWithDetailsEntity } from './types';
import { PaginatedResponseDto } from '@app/shared/dto';
import { MAX_QUESTION_MEDIA_COUNT } from './constants';

type DbTransaction = Parameters<Parameters<DbService<UgcServiceSchema>['db']['transaction']>[0]>[0];

@Injectable()
export class QnaService {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  private get client() {
    return this.db.db;
  }

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> {
    return tx ? fn(tx) : this.client.transaction(fn);
  }

  private normalizeMediaFileIds(mediaFileIds?: string[] | null): string[] {
    if (!mediaFileIds) {
      return [];
    }

    if (mediaFileIds.length > MAX_QUESTION_MEDIA_COUNT) {
      throw new BadRequestException(`Media files can be attached up to ${MAX_QUESTION_MEDIA_COUNT}`);
    }

    const uniqueMedia = new Set(mediaFileIds);
    if (uniqueMedia.size !== mediaFileIds.length) {
      throw new BadRequestException('Duplicate media files are not allowed');
    }

    return mediaFileIds;
  }

  private async insertQuestionMedia(questionId: string, mediaFileIds: string[], tx: DbTransaction): Promise<void> {
    if (mediaFileIds.length === 0) {
      return;
    }

    await tx.insert(questionMedia).values(
      mediaFileIds.map((fileId, index) => ({
        questionId,
        fileId,
        order: index,
      })),
    );
  }

  private async fetchMediaFileIdsByQuestionIds(
    questionIds: string[],
    tx: DbTransaction,
  ): Promise<Map<string, string[]>> {
    if (questionIds.length === 0) {
      return new Map();
    }

    const rows = await tx
      .select({
        questionId: questionMedia.questionId,
        fileId: questionMedia.fileId,
        order: questionMedia.order,
      })
      .from(questionMedia)
      .where(inArray(questionMedia.questionId, questionIds))
      .orderBy(questionMedia.questionId, questionMedia.order);

    const mediaMap = new Map<string, string[]>();
    for (const row of rows) {
      const list = mediaMap.get(row.questionId);
      if (list) {
        list.push(row.fileId);
      } else {
        mediaMap.set(row.questionId, [row.fileId]);
      }
    }

    return mediaMap;
  }

  private async fetchAnswersByQuestionIds(
    questionIds: string[],
    tx: DbTransaction,
  ): Promise<Map<string, AnswerEntity>> {
    if (questionIds.length === 0) {
      return new Map();
    }

    const rows = await tx.select().from(answers).where(inArray(answers.questionId, questionIds));

    const answerMap = new Map<string, AnswerEntity>();
    for (const row of rows) {
      answerMap.set(row.questionId, row);
    }

    return answerMap;
  }

  // ─── 질문 CRUD ───

  async createQuestion(userId: string, dto: CreateQuestionDto, tx?: DbTransaction): Promise<QuestionWithDetailsEntity> {
    return this.inTx(async (tx) => {
      const mediaFileIds = this.normalizeMediaFileIds(dto.mediaFileIds);

      const [question] = await tx
        .insert(questions)
        .values({
          userId,
          productId: dto.productId,
          title: dto.title,
          content: dto.content,
          isSecret: dto.isSecret ?? false,
        })
        .returning();

      await this.insertQuestionMedia(question.id, mediaFileIds, tx);

      return {
        ...question,
        mediaFileIds,
        answer: null,
      };
    }, tx);
  }

  async updateQuestion(
    userId: string,
    id: string,
    dto: UpdateQuestionDto,
    tx?: DbTransaction,
  ): Promise<QuestionWithDetailsEntity> {
    return this.inTx(async (tx) => {
      const hasMediaUpdate = dto.mediaFileIds !== undefined;
      const mediaFileIds = this.normalizeMediaFileIds(dto.mediaFileIds);

      const updateData: Partial<QuestionEntity> = {
        updatedAt: new Date(),
      };

      if (dto.title !== undefined) updateData.title = dto.title;
      if (dto.content !== undefined) updateData.content = dto.content;
      if (dto.isSecret !== undefined) updateData.isSecret = dto.isSecret;

      const hasFieldUpdate = Object.keys(updateData).length > 1;

      if (!hasFieldUpdate && !hasMediaUpdate) {
        throw new BadRequestException('No fields to update');
      }

      const [question] = await tx
        .update(questions)
        .set(updateData)
        .where(and(eq(questions.id, id), eq(questions.userId, userId), ne(questions.status, 'deleted')))
        .returning();

      if (!question) {
        throw new NotFoundException('Question not found');
      }

      if (hasMediaUpdate) {
        await tx.delete(questionMedia).where(eq(questionMedia.questionId, id));
        await this.insertQuestionMedia(id, mediaFileIds, tx);
      }

      const resolvedMediaFileIds = hasMediaUpdate
        ? mediaFileIds
        : ((await this.fetchMediaFileIdsByQuestionIds([id], tx)).get(id) ?? []);

      const answerMap = await this.fetchAnswersByQuestionIds([id], tx);

      return {
        ...question,
        mediaFileIds: resolvedMediaFileIds,
        answer: answerMap.get(id) ?? null,
      };
    }, tx);
  }

  async deleteQuestion(userId: string, id: string, tx?: DbTransaction): Promise<void> {
    return this.inTx(async (tx) => {
      const [question] = await tx
        .update(questions)
        .set({ status: 'deleted', updatedAt: new Date() })
        .where(and(eq(questions.id, id), eq(questions.userId, userId), ne(questions.status, 'deleted')))
        .returning({ id: questions.id });

      if (!question) {
        throw new NotFoundException('Question not found');
      }
    }, tx);
  }

  async getQuestion(
    id: string,
    currentUserId?: string | null,
    isAdmin?: boolean,
    tx?: DbTransaction,
  ): Promise<QuestionWithDetailsEntity> {
    return this.inTx(async (tx) => {
      const [question] = await tx
        .select()
        .from(questions)
        .where(and(eq(questions.id, id), ne(questions.status, 'deleted')));

      if (!question) {
        throw new NotFoundException('Question not found');
      }

      if (question.isSecret && !isAdmin && question.userId !== currentUserId) {
        throw new ForbiddenException('Secret question is not accessible');
      }

      const mediaMap = await this.fetchMediaFileIdsByQuestionIds([id], tx);
      const answerMap = await this.fetchAnswersByQuestionIds([id], tx);

      return {
        ...question,
        mediaFileIds: mediaMap.get(id) ?? [],
        answer: answerMap.get(id) ?? null,
      };
    }, tx);
  }

  async listByProduct(
    query: QuestionListQueryDto,
    currentUserId?: string | null,
    isAdmin?: boolean,
    tx?: DbTransaction,
  ): Promise<PaginatedResponseDto<QuestionWithDetailsEntity & { hideSecret: boolean }>> {
    return this.inTx(async (tx) => {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const offset = (page - 1) * limit;

      const conditions: SQL[] = [eq(questions.productId, query.productId), ne(questions.status, 'deleted')];

      const whereClause = and(...conditions);

      const [{ count: total }] = await tx.select({ count: count() }).from(questions).where(whereClause);

      const orderByClause = query.sort === 'oldest' ? asc(questions.createdAt) : desc(questions.createdAt);

      const data = await tx
        .select()
        .from(questions)
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      const questionIds = data.map((q) => q.id);
      const mediaMap = await this.fetchMediaFileIdsByQuestionIds(questionIds, tx);
      const answerMap = await this.fetchAnswersByQuestionIds(questionIds, tx);

      return {
        data: data.map((q) => {
          const shouldHide = q.isSecret && !isAdmin && q.userId !== currentUserId;
          return {
            ...q,
            mediaFileIds: mediaMap.get(q.id) ?? [],
            answer: answerMap.get(q.id) ?? null,
            hideSecret: shouldHide,
          };
        }),
        total,
        page,
        limit,
      };
    }, tx);
  }

  // ─── 답변 CRUD ───

  async createAnswer(
    adminUserId: string,
    questionId: string,
    dto: CreateAnswerDto,
    tx?: DbTransaction,
  ): Promise<AnswerEntity> {
    return this.inTx(async (tx) => {
      const [question] = await tx
        .select({ id: questions.id })
        .from(questions)
        .where(and(eq(questions.id, questionId), ne(questions.status, 'deleted')));

      if (!question) {
        throw new NotFoundException('Question not found');
      }

      const [existing] = await tx.select({ id: answers.id }).from(answers).where(eq(answers.questionId, questionId));

      if (existing) {
        throw new ConflictException('Answer already exists for this question');
      }

      const [answer] = await tx
        .insert(answers)
        .values({
          questionId,
          adminUserId,
          content: dto.content,
        })
        .returning();

      await tx.update(questions).set({ status: 'answered', updatedAt: new Date() }).where(eq(questions.id, questionId));

      return answer;
    }, tx);
  }

  async updateAnswer(
    adminUserId: string,
    questionId: string,
    dto: CreateAnswerDto,
    tx?: DbTransaction,
  ): Promise<AnswerEntity> {
    return this.inTx(async (tx) => {
      const [answer] = await tx
        .update(answers)
        .set({
          content: dto.content,
          adminUserId,
          updatedAt: new Date(),
        })
        .where(eq(answers.questionId, questionId))
        .returning();

      if (!answer) {
        throw new NotFoundException('Answer not found');
      }

      return answer;
    }, tx);
  }

  async deleteAnswer(questionId: string, tx?: DbTransaction): Promise<void> {
    return this.inTx(async (tx) => {
      const [answer] = await tx.delete(answers).where(eq(answers.questionId, questionId)).returning({ id: answers.id });

      if (!answer) {
        throw new NotFoundException('Answer not found');
      }

      await tx.update(questions).set({ status: 'active', updatedAt: new Date() }).where(eq(questions.id, questionId));
    }, tx);
  }
}
