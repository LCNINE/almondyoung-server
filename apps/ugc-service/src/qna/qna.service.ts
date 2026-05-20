import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, asc, count, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { answers, questionMedia, questions, type UgcServiceSchema } from '../db/schema';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionListQueryDto, MyQuestionListQueryDto } from './dto/question-list-query.dto';
import { CreateAnswerDto } from './dto/create-answer.dto';
import { type AnswerEntity, type QuestionEntity, type QuestionWithDetailsEntity } from './types';
import { PaginatedResponseDto } from '@app/shared/dto';
import { MAX_QUESTION_MEDIA_COUNT, type QuestionCategory } from './constants';
import { isNotNull } from 'drizzle-orm';

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
          nickname: dto.nickname,
          productId: dto.productId ?? null,
          category: dto.category ?? null,
          subCategory: dto.subCategory ?? null,
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

      const [existing] = await tx
        .select({ id: questions.id })
        .from(questions)
        .where(and(eq(questions.id, id), eq(questions.userId, userId), isNull(questions.deletedAt)));

      if (!existing) {
        throw new NotFoundException('Question not found');
      }

      const [existingAnswer] = await tx.select({ id: answers.id }).from(answers).where(eq(answers.questionId, id));

      if (existingAnswer) {
        throw new ConflictException('답변이 달린 질문은 수정할 수 없습니다');
      }

      const [question] = await tx.update(questions).set(updateData).where(eq(questions.id, id)).returning();

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
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(questions.id, id), eq(questions.userId, userId), isNull(questions.deletedAt)))
        .returning({ id: questions.id });

      if (!question) {
        throw new NotFoundException('Question not found');
      }

      // 질문에 달린 답변도 함께 삭제
      await tx.delete(answers).where(eq(answers.questionId, id));
    }, tx);
  }

  async deleteQuestionByAdmin(id: string, tx?: DbTransaction): Promise<void> {
    return this.inTx(async (tx) => {
      const [question] = await tx
        .update(questions)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(questions.id, id), isNull(questions.deletedAt)))
        .returning({ id: questions.id });

      if (!question) {
        throw new NotFoundException('Question not found');
      }

      // 질문에 달린 답변도 함께 삭제
      await tx.delete(answers).where(eq(answers.questionId, id));
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
        .where(and(eq(questions.id, id), isNull(questions.deletedAt)));

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

      // mineOnly=true인데 비인증이면 빈 결과 반환 (인증 필요한 필터)
      if (query.mineOnly && !currentUserId) {
        return { data: [], total: 0, page, limit };
      }

      const conditions: SQL[] = [isNull(questions.deletedAt)];

      // productId가 있으면 상품별 조회, 없으면 전체 조회 (productId가 있는 것만)
      if (query.productId) {
        conditions.push(eq(questions.productId, query.productId));
      } else {
        // productId가 없으면 상품 문의만 조회 (productId가 null이 아닌 것)
        conditions.push(isNotNull(questions.productId));
      }

      if (query.category) {
        conditions.push(eq(questions.category, query.category));
      }

      // 답변 상태 필터: answered = 'answered', unanswered = 'active'
      if (query.answerStatus === 'answered') {
        conditions.push(eq(questions.status, 'answered'));
      } else if (query.answerStatus === 'unanswered') {
        conditions.push(eq(questions.status, 'active'));
      }

      // 비밀글 제외
      if (query.excludeSecret) {
        conditions.push(eq(questions.isSecret, false));
      }

      // 본인 글만 조회 (currentUserId는 위에서 검증됨)
      if (query.mineOnly && currentUserId) {
        conditions.push(eq(questions.userId, currentUserId));
      }

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

  // ─── 관리자용 전체 문의 목록 ───

  async listAllForAdmin(
    query: {
      page?: number;
      limit?: number;
      category?: QuestionCategory;
      status?: 'active' | 'answered' | 'deleted';
      sort?: string;
      q?: string;
    },
    tx?: DbTransaction,
  ): Promise<PaginatedResponseDto<QuestionWithDetailsEntity>> {
    return this.inTx(async (tx) => {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const offset = (page - 1) * limit;

      const conditions: SQL[] = [];

      // 상태 필터 (기본값: 삭제된 것 제외, deleted 지정 시 삭제됨만)
      if (query.status === 'deleted') {
        conditions.push(isNotNull(questions.deletedAt));
      } else if (query.status) {
        conditions.push(eq(questions.status, query.status));
        conditions.push(isNull(questions.deletedAt));
      } else {
        conditions.push(isNull(questions.deletedAt));
      }

      // 카테고리 필터
      if (query.category) {
        conditions.push(eq(questions.category, query.category as QuestionCategory));
      }

      // 검색어 (제목, 내용, 닉네임)
      if (query.q) {
        const searchTerm = `%${query.q}%`;
        conditions.push(
          sql`(${questions.title} ILIKE ${searchTerm} OR ${questions.content} ILIKE ${searchTerm} OR ${questions.nickname} ILIKE ${searchTerm})`,
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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
        data: data.map((q) => ({
          ...q,
          mediaFileIds: mediaMap.get(q.id) ?? [],
          answer: answerMap.get(q.id) ?? null,
        })),
        total,
        page,
        limit,
      };
    }, tx);
  }

  // ─── 내 문의 목록 ───

  async listMyQuestions(
    userId: string,
    query: MyQuestionListQueryDto,
    tx?: DbTransaction,
  ): Promise<PaginatedResponseDto<QuestionWithDetailsEntity>> {
    return this.inTx(async (tx) => {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const offset = (page - 1) * limit;

      const conditions: SQL[] = [eq(questions.userId, userId), isNull(questions.deletedAt)];

      if (query.category) {
        conditions.push(eq(questions.category, query.category));
      }

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
        data: data.map((q) => ({
          ...q,
          mediaFileIds: mediaMap.get(q.id) ?? [],
          answer: answerMap.get(q.id) ?? null,
        })),
        total,
        page,
        limit,
      };
    }, tx);
  }

  // ─── 삭제된 질문 영구 제거 ───

  async purgeDeletedQuestions(retentionDays: number): Promise<number> {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - retentionDays);

    const deleted = await this.client
      .delete(questions)
      .where(and(isNotNull(questions.deletedAt), lt(questions.deletedAt, threshold)))
      .returning({ id: questions.id });

    return deleted.length;
  }

  // ─── 요약 ───

  async getQnaSummary(productId: string, tx?: DbTransaction) {
    return this.inTx(async (tx) => {
      const rows = await tx
        .select({ status: questions.status, count: count() })
        .from(questions)
        .where(and(eq(questions.productId, productId), isNull(questions.deletedAt)))
        .groupBy(questions.status);

      let answeredCount = 0;
      let unansweredCount = 0;

      for (const row of rows) {
        if (row.status === 'answered') {
          answeredCount = row.count;
        } else {
          unansweredCount += row.count;
        }
      }

      return {
        productId,
        totalCount: answeredCount + unansweredCount,
        answeredCount,
        unansweredCount,
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
        .where(and(eq(questions.id, questionId), isNull(questions.deletedAt)));

      if (!question) {
        throw new NotFoundException('Question not found');
      }

      const [existing] = await tx.select({ id: answers.id }).from(answers).where(eq(answers.questionId, questionId));

      if (existing) {
        throw new ConflictException('Answer already exists for this question');
      }

      try {
        const [answer] = await tx
          .insert(answers)
          .values({
            questionId,
            adminUserId,
            content: dto.content,
          })
          .returning();

        await tx
          .update(questions)
          .set({ status: 'answered', updatedAt: new Date() })
          .where(eq(questions.id, questionId));

        return answer;
      } catch (error: unknown) {
        // Race condition: 다른 관리자가 먼저 답변을 등록한 경우
        if (error instanceof Error && error.message.includes('unique')) {
          throw new ConflictException('Answer already exists for this question');
        }
        throw error;
      }
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
