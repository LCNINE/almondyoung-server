import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, desc, eq } from 'drizzle-orm';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@app/shared';
import { type PimSchema, pimSchema } from '../../schema/catalog.schema';
import { DbTransaction } from '../../catalog.types';

export type AiPromptPresetRecord = {
  id: string;
  scope: string;
  title: string;
  content: string;
  ownerId: string;
  ownerName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type CreateInput = {
  scope: string;
  title: string;
  content: string;
  ownerId: string;
  ownerName: string | null;
};

/** 같은 scope 안에서 제목이 겹치면 목록에서 구분이 안 되므로 막는다. */
const DUPLICATE_TITLE_CODE = '23505';

function isDuplicateTitle(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === DUPLICATE_TITLE_CODE
  );
}

@Injectable()
export class AiPromptsService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  async list(scope: string, tx?: DbTransaction): Promise<AiPromptPresetRecord[]> {
    return this.db.run(async (trx) => {
      return trx
        .select()
        .from(pimSchema.aiPromptPresets)
        .where(eq(pimSchema.aiPromptPresets.scope, scope))
        .orderBy(desc(pimSchema.aiPromptPresets.updatedAt));
    }, tx);
  }

  async find(id: string, tx?: DbTransaction): Promise<AiPromptPresetRecord | null> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(pimSchema.aiPromptPresets)
        .where(eq(pimSchema.aiPromptPresets.id, id));

      return row ?? null;
    }, tx);
  }

  async create(input: CreateInput, tx?: DbTransaction): Promise<AiPromptPresetRecord> {
    if (input.content.trim().length === 0) {
      throw new BadRequestError('프롬프트 본문은 비워둘 수 없습니다.');
    }
    if (input.title.trim().length === 0) {
      throw new BadRequestError('양식 제목을 입력해주세요.');
    }

    return this.db.run(async (trx) => {
      try {
        const [row] = await trx
          .insert(pimSchema.aiPromptPresets)
          .values({
            scope: input.scope,
            title: input.title.trim(),
            content: input.content,
            ownerId: input.ownerId,
            ownerName: input.ownerName,
          })
          .returning();

        if (!row) {
          throw new Error('ai_prompt_presets insert 결과가 비었습니다.');
        }
        return row;
      } catch (err) {
        if (isDuplicateTitle(err)) {
          throw new ConflictError(`같은 이름의 양식이 이미 있습니다: ${input.title}`);
        }
        throw err;
      }
    }, tx);
  }

  async update(
    id: string,
    requesterId: string,
    title: string,
    content: string,
    tx?: DbTransaction,
  ): Promise<AiPromptPresetRecord> {
    if (content.trim().length === 0) {
      throw new BadRequestError('프롬프트 본문은 비워둘 수 없습니다.');
    }

    return this.db.run(async (trx) => {
      const existing = await this.find(id, trx);
      if (!existing) {
        throw new NotFoundError(`양식을 찾을 수 없습니다: ${id}`);
      }
      if (existing.ownerId !== requesterId) {
        throw new ForbiddenError('본인이 만든 양식만 수정할 수 있습니다.');
      }

      try {
        const [row] = await trx
          .update(pimSchema.aiPromptPresets)
          .set({ title: title.trim(), content, updatedAt: new Date() })
          .where(eq(pimSchema.aiPromptPresets.id, id))
          .returning();

        if (!row) {
          throw new Error('ai_prompt_presets update 결과가 비었습니다.');
        }
        return row;
      } catch (err) {
        if (isDuplicateTitle(err)) {
          throw new ConflictError(`같은 이름의 양식이 이미 있습니다: ${title}`);
        }
        throw err;
      }
    }, tx);
  }

  async remove(id: string, requesterId: string, tx?: DbTransaction): Promise<void> {
    await this.db.run(async (trx) => {
      const existing = await this.find(id, trx);
      if (!existing) {
        throw new NotFoundError(`양식을 찾을 수 없습니다: ${id}`);
      }
      if (existing.ownerId !== requesterId) {
        throw new ForbiddenError('본인이 만든 양식만 삭제할 수 있습니다.');
      }

      await trx
        .delete(pimSchema.aiPromptPresets)
        .where(
          and(
            eq(pimSchema.aiPromptPresets.id, id),
            eq(pimSchema.aiPromptPresets.ownerId, requesterId),
          ),
        );
    }, tx);
  }
}
