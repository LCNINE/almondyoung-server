import { pgTable, uuid, varchar, text, bigint, boolean, timestamp, index, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

export const fileContexts = pgTable('file_contexts', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  allowPublic: boolean('allow_public').default(false).notNull(),
  allowPrivate: boolean('allow_private').default(true).notNull(),
  allowedMimeTypes: jsonb('allowed_mime_types').$type<string[]>(),
  maxFileSize: bigint('max_file_size', { mode: 'number' }).notNull(),
  pathPrefix: varchar('path_prefix', { length: 100 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    fileName: varchar('file_name', { length: 255 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),

    filePath: text('file_path').notNull(),
    url: text('url').notNull(),
    storageProvider: varchar('storage_provider', { length: 20 }).default('s3').notNull(),

    status: varchar('status', { length: 20 }).default('active').notNull(),

    contextId: varchar('context_id', { length: 50 })
      .notNull()
      .references(() => fileContexts.id, { onDelete: 'restrict' }),

    metadata: jsonb('metadata').$type<{
      width?: number;
      height?: number;
      duration?: number;
      pages?: number;
      [key: string]: any;
    }>(),

    uploadedBy: uuid('uploaded_by').notNull(),
    isPublic: boolean('is_public').default(false).notNull(),
    // 파일이 속한 테넌트(올린 요청의 테넌트). 버킷도 이 테넌트의 것이다. expand 기간엔 nullable —
    // 테넌트를 모르는 쓰기는 DB 기본값이 채운다(마이그 SQL 에만 있다), NOT NULL 은 contract 에서.
    tenantId: varchar('tenant_id', { length: 64 }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
    activatedAt: timestamp('activated_at'),
  },
  (table) => [
    index('idx_uploads_status').on(table.status),
    index('idx_uploads_context_id').on(table.contextId),
    index('idx_uploads_uploaded_by').on(table.uploadedBy),
    index('idx_uploads_created_at').on(table.createdAt),
  ],
);

export const fileContextsRelations = relations(fileContexts, ({ many }) => ({
  uploads: many(uploads),
}));

export const uploadsRelations = relations(uploads, ({ one }) => ({
  context: one(fileContexts, {
    fields: [uploads.contextId],
    references: [fileContexts.id],
  }),
}));

export const fileServiceSchema = {
  fileContexts,
  uploads,
} as const;

export type FileServiceSchema = typeof fileServiceSchema;
