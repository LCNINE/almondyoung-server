import { type InferInsertModel, type InferSelectModel, relations, sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

export type CsCaseStatus = 'open' | 'pending' | 'closed';
export type CsCasePriority = 'low' | 'normal' | 'high' | 'urgent';
export type CsCaseSourceChannel = 'kakao' | 'web_messenger' | 'manual';
export type CsCaseEventType = 'status_changed' | 'assigned' | 'unassigned' | 'label_added' | 'label_removed';

export const csCases = pgTable(
  'cs_cases',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    status: varchar('status', { length: 32 }).$type<CsCaseStatus>().notNull().default('open'),
    priority: varchar('priority', { length: 32 }).$type<CsCasePriority>().notNull().default('normal'),
    subject: varchar('subject', { length: 255 }).notNull(),
    description: text('description'),
    sourceChannel: varchar('source_channel', { length: 32 }).$type<CsCaseSourceChannel>().notNull().default('kakao'),
    externalThreadRef: varchar('external_thread_ref', { length: 255 }),
    customerId: uuid('customer_id'),
    customerName: varchar('customer_name', { length: 255 }),
    assignedTo: uuid('assigned_to'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_cs_cases_status').on(t.status),
    index('idx_cs_cases_customer_id').on(t.customerId),
    index('idx_cs_cases_assigned_to').on(t.assignedTo),
    index('idx_cs_cases_source_channel').on(t.sourceChannel),
    index('idx_cs_cases_created_at').on(t.createdAt),
  ],
);

export const csCaseComments = pgTable(
  'cs_case_comments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    csCaseId: uuid('cs_case_id').notNull(),
    authorId: uuid('author_id').notNull(),
    body: text('body').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_cs_case_comments_case_id').on(t.csCaseId, t.createdAt)],
);

export const csCaseCommentMentions = pgTable(
  'cs_case_comment_mentions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    commentId: uuid('comment_id').notNull(),
    mentionedUserId: uuid('mentioned_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_cs_comment_mention').on(t.commentId, t.mentionedUserId),
    index('idx_cs_mention_user').on(t.mentionedUserId),
  ],
);

export const csCaseCommentAttachments = pgTable(
  'cs_case_comment_attachments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    csCaseId: uuid('cs_case_id').notNull(),
    commentId: uuid('comment_id').notNull(),
    fileId: varchar('file_id', { length: 255 }).notNull(),
    fileName: varchar('file_name', { length: 255 }),
    sortOrder: integer('sort_order').notNull().default(0),
    uploadedBy: uuid('uploaded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_cs_attachment_case_id').on(t.csCaseId), index('idx_cs_attachment_comment_id').on(t.commentId)],
);

export const csCaseEvents = pgTable(
  'cs_case_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    csCaseId: uuid('cs_case_id').notNull(),
    type: varchar('type', { length: 48 }).$type<CsCaseEventType>().notNull(),
    actorId: uuid('actor_id'),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_cs_case_events_case_id').on(t.csCaseId, t.occurredAt)],
);

export const csLabels = pgTable(
  'cs_labels',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    name: varchar('name', { length: 96 }).notNull(),
    color: varchar('color', { length: 16 }).notNull().default('#888888'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('uq_cs_labels_name').on(t.name)],
);

export const csCaseLabels = pgTable(
  'cs_case_labels',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    csCaseId: uuid('cs_case_id').notNull(),
    labelId: uuid('label_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('uq_cs_case_label').on(t.csCaseId, t.labelId), index('idx_cs_case_labels_case_id').on(t.csCaseId)],
);

export const csCasesRelations = relations(csCases, () => ({}));

export const customerServiceSchema = {
  csCases,
  csCaseComments,
  csCaseCommentMentions,
  csCaseCommentAttachments,
  csCaseEvents,
  csLabels,
  csCaseLabels,
  csCasesRelations,
};

export type CustomerServiceSchema = typeof customerServiceSchema;
export type CsCase = InferSelectModel<typeof csCases>;
export type NewCsCase = InferInsertModel<typeof csCases>;
export type CsCaseComment = InferSelectModel<typeof csCaseComments>;
export type CsCaseEvent = InferSelectModel<typeof csCaseEvents>;
export type CsLabel = InferSelectModel<typeof csLabels>;
export type CsCaseCommentAttachment = InferSelectModel<typeof csCaseCommentAttachments>;
