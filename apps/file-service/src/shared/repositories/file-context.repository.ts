import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { fileServiceSchema, fileContexts } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { FileContext, UpdateFileContext } from '../types/file.types';

type FileServiceDb = typeof fileServiceSchema;

@Injectable()
export class FileContextRepository {
  constructor(
    @InjectTypedDb<FileServiceDb>()
    private readonly dbService: DbService<FileServiceDb>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async findById(id: string): Promise<FileContext | undefined> {
    const [context] = await this.db
      .select()
      .from(fileContexts)
      .where(eq(fileContexts.id, id))
      .limit(1);
    return context;
  }

  async findAll(activeOnly = true): Promise<FileContext[]> {
    const conditions = activeOnly ? eq(fileContexts.isActive, true) : undefined;
    return this.db
      .select()
      .from(fileContexts)
      .where(conditions);
  }

  async update(id: string, data: UpdateFileContext): Promise<FileContext> {
    const [updated] = await this.db
      .update(fileContexts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(fileContexts.id, id))
      .returning();
    return updated;
  }
}

