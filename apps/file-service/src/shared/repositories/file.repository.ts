import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { fileServiceSchema, uploads } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { NewUpload, UpdateUpload } from '../types/file.types';

type FileServiceDb = typeof fileServiceSchema;

@Injectable()
export class FileRepository {
  constructor(
    @InjectTypedDb<FileServiceDb>()
    private readonly dbService: DbService<FileServiceDb>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async create(data: NewUpload) {
    const [file] = await this.db.insert(uploads).values(data).returning();
    return file;
  }

  async findById(id: string) {
    const [file] = await this.db.select().from(uploads).where(eq(uploads.id, id)).limit(1);
    return file;
  }

  async updateStatus(id: string, status: string, additionalData?: UpdateUpload) {
    const [updated] = await this.db
      .update(uploads)
      .set({
        status,
        updatedAt: new Date(),
        ...additionalData,
      })
      .where(eq(uploads.id, id))
      .returning();
    return updated;
  }

  async softDelete(id: string) {
    const [deleted] = await this.db
      .update(uploads)
      .set({
        status: 'deleted',
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(uploads.id, id))
      .returning();
    return deleted;
  }

  async hardDelete(id: string) {
    await this.db.delete(uploads).where(eq(uploads.id, id));
  }
}
