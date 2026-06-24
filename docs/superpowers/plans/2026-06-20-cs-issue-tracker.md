# CS Issue-Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `apps/core` `customer-service` module into an internal GitHub-issue-style CS tracker: tickets with a merged timeline of comments (mutable), system events (immutable), and business links, plus flat labels, single-assignee + @mentions, and comment attachments.

**Architecture:** One Drizzle schema (`customer-service.schema.ts`) holds `cs_cases` (reshaped) plus six new tables. Three focused NestJS services (`CsCasesService`, `CsCommentsService`, `CsLabelsService`) sit behind thin controllers. The ticket detail (`GET /cs-cases/:id`) merges comments + `cs_case_events` + existing `business_links` into one time-ordered `timeline`. **No Kafka publishing and no notifications in this phase** — assignment/mention are silent (discovered via queues). All actor/customer identities are opaque uuids (core has no user/customer master).

**Tech Stack:** NestJS, Drizzle ORM (`postgres.js`), `@InjectDb`/`DbService<MergedSchema>`, class-validator DTOs, `@app/shared` domain exceptions, Jest unit tests with a hand-rolled fake `tx` (no live DB).

---

## Design decisions locked in the grill session (do not re-litigate)

- Ticket is **100% internal**. Customer lives in KakaoTalk; the conversation channel stays separate forever. No public/private comment split.
- Status set is exactly **`open | pending | closed`** (`resolved` removed). `pending` = waiting on customer; `open` = needs internal work. Free transitions incl. reopen. Internal handoff = **reassign**, never a new status.
- **Single** `assignedTo`. Reassign emits an event. **@mention is notification-only** and never changes ownership.
- Classification = **flat, admin-managed labels only**. `reasonCode` removed. `priority` stays its own enum. No single-type enforcement.
- Identity = `customerId` (nullable, no FK) + `customerName` (optional) + `externalThreadRef`. **`customerEmail`/`customerPhone` columns removed.**
- `sourceChannel` promoted from `metadata` jsonb to a typed column (default `kakao`).
- Comments mutable: soft-delete only, `editedAt` flag only (no version history), **author-only** edit/delete.
- Attachments: comment-level child table carrying `csCaseId` for "all photos of this case".
- `cs_case_events` is an internal DB log, **not** a Kafka event — the "no unheard events" rule does not apply to it.

## File structure

| File | Responsibility |
|------|----------------|
| `apps/core/src/modules/customer-service/schema/customer-service.schema.ts` | All 7 tables + exported types + `customerServiceSchema` object |
| `apps/core/src/modules/customer-service/__fixtures__/fake-db.ts` | Shared in-memory fake `DbService` for unit tests |
| `apps/core/src/modules/customer-service/dto/*` | Request/response DTOs |
| `apps/core/src/modules/customer-service/services/cs-cases.service.ts` | Case lifecycle: create / list / getOne(+timeline) / updateStatus / assign / createBusinessLink |
| `apps/core/src/modules/customer-service/services/cs-comments.service.ts` | Comments + mentions + attachments |
| `apps/core/src/modules/customer-service/services/cs-labels.service.ts` | Label taxonomy + apply/remove to case |
| `apps/core/src/modules/customer-service/controllers/cs-cases.controller.ts` | `cs-cases` routes |
| `apps/core/src/modules/customer-service/controllers/cs-case-comments.controller.ts` | `cs-cases/:caseId/comments` routes |
| `apps/core/src/modules/customer-service/controllers/cs-case-labels.controller.ts` | `cs-cases/:caseId/labels` routes |
| `apps/core/src/modules/customer-service/controllers/cs-labels.controller.ts` | `cs-labels` taxonomy routes |
| `apps/core/src/modules/customer-service/customer-service.module.ts` | Wires all controllers + services |

**Locked names** (used across tasks — keep identical):

Tables/exports: `csCases`, `csCaseComments`, `csCaseCommentMentions`, `csCaseCommentAttachments`, `csCaseEvents`, `csLabels`, `csCaseLabels`.
Types: `CsCaseStatus = 'open' | 'pending' | 'closed'`, `CsCasePriority = 'low' | 'normal' | 'high' | 'urgent'`, `CsCaseEventType = 'status_changed' | 'assigned' | 'unassigned' | 'label_added' | 'label_removed'`, `CsCaseSourceChannel = 'kakao' | 'web_messenger' | 'manual'`.
Event payloads: `status_changed → { from, to }`; `assigned → { from: string | null, to: string }`; `unassigned → { from: string }`; `label_added`/`label_removed → { labelId, labelName }`.
Timeline item `kind`: `'comment' | 'event' | 'business_link'`, ordered by `occurredAt` ascending.

> **Note on test runs:** never run the full Jest suite (OOM). Run one spec file at a time: `npx jest <path-to-spec>`.

---

### Task 1: Reshape the schema and add the six new tables

**Files:**
- Modify: `apps/core/src/modules/customer-service/schema/customer-service.schema.ts` (full rewrite)
- Test: `apps/core/src/modules/customer-service/schema/customer-service.schema.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/core/src/modules/customer-service/schema/customer-service.schema.spec.ts`:

```typescript
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  csCases,
  csCaseComments,
  csCaseCommentMentions,
  csCaseCommentAttachments,
  csCaseEvents,
  csLabels,
  csCaseLabels,
  customerServiceSchema,
} from './customer-service.schema';

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((c) => c.name);
}

describe('customer-service schema', () => {
  it('drops removed columns and adds new ones on cs_cases', () => {
    const cols = columnNames(csCases);
    expect(cols).toContain('source_channel');
    expect(cols).toContain('external_thread_ref');
    expect(cols).not.toContain('reason_code');
    expect(cols).not.toContain('customer_email');
    expect(cols).not.toContain('customer_phone');
    expect(cols).not.toContain('resolved_at');
  });

  it('registers all seven tables in the schema object', () => {
    expect(Object.keys(customerServiceSchema)).toEqual(
      expect.arrayContaining([
        'csCases',
        'csCaseComments',
        'csCaseCommentMentions',
        'csCaseCommentAttachments',
        'csCaseEvents',
        'csLabels',
        'csCaseLabels',
      ]),
    );
  });

  it('models comment soft-delete and event payload columns', () => {
    expect(columnNames(csCaseComments)).toEqual(expect.arrayContaining(['body', 'edited_at', 'deleted_at', 'deleted_by']));
    expect(columnNames(csCaseEvents)).toEqual(expect.arrayContaining(['type', 'actor_id', 'payload', 'occurred_at']));
    expect(columnNames(csCaseCommentAttachments)).toEqual(expect.arrayContaining(['cs_case_id', 'comment_id', 'file_id']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/core/src/modules/customer-service/schema/customer-service.schema.spec.ts`
Expected: FAIL — imports like `csCaseComments` do not exist yet.

- [ ] **Step 3: Rewrite the schema file**

Replace the entire contents of `apps/core/src/modules/customer-service/schema/customer-service.schema.ts`:

```typescript
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
  (t) => [
    index('idx_cs_attachment_case_id').on(t.csCaseId),
    index('idx_cs_attachment_comment_id').on(t.commentId),
  ],
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/core/src/modules/customer-service/schema/customer-service.schema.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/customer-service/schema/customer-service.schema.ts apps/core/src/modules/customer-service/schema/customer-service.schema.spec.ts
git commit -m "feat(cs): reshape cs_cases and add comment/event/label tables"
```

---

### Task 2: Generate and review the migration

**Files:**
- Create: `apps/core/drizzle/<timestamp>_cs-issue-tracker.sql` (generated)
- Modify: `apps/core/drizzle/meta/*` (generated)

> `mergedSchema` already spreads `...customerServiceSchema`, and `drizzle.config.ts` already lists the CS schema file — no edits needed there. The new tables register automatically.

- [ ] **Step 1: Generate the migration**

Run: `npm run db:generate:core -- --name cs-issue-tracker`
Expected: a new file `apps/core/drizzle/<timestamp>_cs-issue-tracker.sql` plus `drizzle/meta/` updates.

> If drizzle-kit prompts about a column being created/dropped vs renamed, choose **create/drop** (these are not renames). This is why generate runs on a dev machine, never CI.

- [ ] **Step 2: Review the generated SQL**

Open `apps/core/drizzle/<timestamp>_cs-issue-tracker.sql` and confirm it contains:
- `CREATE TABLE "cs_case_comments"`, `"cs_case_comment_mentions"`, `"cs_case_comment_attachments"`, `"cs_case_events"`, `"cs_labels"`, `"cs_case_labels"`
- `ALTER TABLE "cs_cases" ADD COLUMN "source_channel"` and `"external_thread_ref"`
- `ALTER TABLE "cs_cases" DROP COLUMN "reason_code"`, `"customer_email"`, `"customer_phone"`, `"resolved_at"`
- `DROP INDEX ... idx_cs_cases_reason_code`

If anything is wrong, `git rm` the generated file, fix `customer-service.schema.ts`, and regenerate. Never hand-edit a generated migration.

- [ ] **Step 3: Apply locally**

Run: `npm run db:setup -- --stage dev --deployment lcnine-services`
Expected: Phase 2 applies the new migration; no errors.

- [ ] **Step 4: Commit schema + migration together**

```bash
git add apps/core/drizzle/
git commit -m "chore(cs): generate cs-issue-tracker migration"
```

---

### Task 3: Shared in-memory fake DB for unit tests

**Files:**
- Create: `apps/core/src/modules/customer-service/__fixtures__/fake-db.ts`
- Test: `apps/core/src/modules/customer-service/__fixtures__/fake-db.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/core/src/modules/customer-service/__fixtures__/fake-db.spec.ts`:

```typescript
import { csCases } from '../schema/customer-service.schema';
import { makeFakeDb } from './fake-db';

describe('makeFakeDb', () => {
  it('inserts rows and reads them back', async () => {
    const { db, state } = makeFakeDb();
    const [row] = await db.db
      .insert(csCases)
      .values({ subject: 'hello' } as Record<string, unknown>)
      .returning();
    expect(row.subject).toBe('hello');
    expect(state.get(csCases)).toHaveLength(1);
  });

  it('updates rows via set().where().returning()', async () => {
    const { db } = makeFakeDb();
    const [row] = await db.db.insert(csCases).values({ subject: 'a' } as Record<string, unknown>).returning();
    const [updated] = await db.db
      .update(csCases)
      .set({ subject: 'b' })
      .where({ id: row.id } as unknown as never)
      .returning();
    expect(updated.subject).toBe('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/core/src/modules/customer-service/__fixtures__/fake-db.spec.ts`
Expected: FAIL — `makeFakeDb` does not exist.

- [ ] **Step 3: Implement the fake**

Create `apps/core/src/modules/customer-service/__fixtures__/fake-db.ts`:

```typescript
/**
 * Minimal in-memory fake of DbService<MergedSchema> for customer-service unit tests.
 * Filtering in where() is intentionally loose (returns all rows for the table); tests
 * assert on inserted/updated state and returned objects, matching the existing CS test style.
 * The most-recently inserted/updated row is tracked per table so update().returning()
 * can return a deterministic shape.
 */
let seq = 0;
function nextId(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

type Row = Record<string, any>;

export function makeFakeDb(seed: Map<unknown, Row[]> = new Map()) {
  const state = {
    rows: seed,
    get(table: unknown): Row[] {
      if (!this.rows.has(table)) this.rows.set(table, []);
      return this.rows.get(table)!;
    },
  };

  const tx: any = {
    select: (_columns?: unknown) => ({
      from: (table: unknown) => {
        const all = state.get(table);
        const chain: any = {
          where: () => {
            const r = [...all] as Row[] & { orderBy: () => any; limit: (n: number) => Promise<Row[]> };
            r.orderBy = () => ({ limit: (n: number) => Promise.resolve(all.slice(0, n)) });
            (r as any).limit = (n: number) => Promise.resolve(all.slice(0, n));
            return r;
          },
          innerJoin: () => chain,
          leftJoin: () => chain,
          orderBy: () => ({ limit: (n: number) => Promise.resolve(all.slice(0, n)) }),
          limit: (n: number) => Promise.resolve(all.slice(0, n)),
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Row | Row[]) => ({
        returning: () => {
          const list = Array.isArray(values) ? values : [values];
          const inserted = list.map((v) => {
            const row = {
              id: v.id ?? nextId(),
              createdAt: new Date('2026-06-20T00:00:00.000Z'),
              updatedAt: new Date('2026-06-20T00:00:00.000Z'),
              ...v,
            };
            state.get(table).push(row);
            return row;
          });
          return Promise.resolve(inserted);
        },
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Row) => ({
        where: () => ({
          returning: () => {
            const rows = state.get(table);
            const target = rows[rows.length - 1];
            if (!target) return Promise.resolve([]);
            Object.assign(target, patch, { updatedAt: new Date('2026-06-20T00:01:00.000Z') });
            return Promise.resolve([target]);
          },
        }),
      }),
    }),
  };

  const db = { db: { ...tx, transaction: (fn: (t: any) => any) => fn(tx) } };
  return { db, state, tx };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/core/src/modules/customer-service/__fixtures__/fake-db.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/customer-service/__fixtures__/
git commit -m "test(cs): add shared in-memory fake db for unit tests"
```

---

### Task 4: Update DTOs for the new ticket shape

**Files:**
- Modify: `apps/core/src/modules/customer-service/dto/create-cs-case.dto.ts` (full rewrite)
- Modify: `apps/core/src/modules/customer-service/dto/cs-case-response.dto.ts` (full rewrite)
- Create: `apps/core/src/modules/customer-service/dto/update-cs-case-status.dto.ts`
- Create: `apps/core/src/modules/customer-service/dto/assign-cs-case.dto.ts`
- Modify: `apps/core/src/modules/customer-service/dto/index.ts`

- [ ] **Step 1: Rewrite `create-cs-case.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { type CsCasePriority, type CsCaseSourceChannel } from '../schema/customer-service.schema';

export class CreateCsCaseDto {
  @ApiProperty({ description: 'CS Case 제목' })
  @IsString()
  @MaxLength(255)
  subject: string;

  @ApiProperty({ description: '상세 설명(카톡 내용 복사/요약)', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: '우선순위', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal', required: false })
  @IsIn(['low', 'normal', 'high', 'urgent'])
  @IsOptional()
  priority?: CsCasePriority;

  @ApiProperty({ description: '유입 채널', enum: ['kakao', 'web_messenger', 'manual'], default: 'kakao', required: false })
  @IsIn(['kakao', 'web_messenger', 'manual'])
  @IsOptional()
  sourceChannel?: CsCaseSourceChannel;

  @ApiProperty({ description: '외부 대화 포인터(카톡 상담방/닉네임 등)', required: false })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  externalThreadRef?: string;

  @ApiProperty({ description: '고객 ID(회원 특정 시에만)', required: false })
  @IsUUID()
  @IsOptional()
  customerId?: string;

  @ApiProperty({ description: '고객명', required: false })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  customerName?: string;

  @ApiProperty({ description: '담당자 ID', required: false })
  @IsUUID()
  @IsOptional()
  assignedTo?: string;

  @ApiProperty({ description: '표시/추적용 부가 정보', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
```

- [ ] **Step 2: Rewrite `cs-case-response.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';
import {
  type CsCaseEventType,
  type CsCasePriority,
  type CsCaseSourceChannel,
  type CsCaseStatus,
} from '../schema/customer-service.schema';

export class CsCaseTimelineItemDto {
  @ApiProperty({ description: '항목 종류', enum: ['comment', 'event', 'business_link'] })
  kind: 'comment' | 'event' | 'business_link';

  @ApiProperty({ description: '항목 ID' })
  id: string;

  @ApiProperty({ description: '발생 시각' })
  occurredAt: Date;

  @ApiProperty({ description: '행위자(작성자/실행자) ID', nullable: true })
  actorId: string | null;

  @ApiProperty({ description: 'comment: 본문(소프트삭제면 null)', nullable: true, required: false })
  body?: string | null;

  @ApiProperty({ description: 'comment: 삭제 여부', required: false })
  deleted?: boolean;

  @ApiProperty({ description: 'comment: 수정 여부', required: false })
  edited?: boolean;

  @ApiProperty({ description: 'comment: 멘션된 사용자 ID 목록', required: false, type: [String] })
  mentions?: string[];

  @ApiProperty({ description: 'comment: 첨부 file-service ID 목록', required: false, type: [String] })
  attachmentFileIds?: string[];

  @ApiProperty({ description: 'event: 이벤트 종류', required: false })
  eventType?: CsCaseEventType;

  @ApiProperty({ description: 'event/business_link: payload', required: false })
  payload?: Record<string, unknown>;
}

export class CsCaseResponseDto {
  @ApiProperty({ description: 'CS Case ID' })
  id: string;

  @ApiProperty({ description: '상태', enum: ['open', 'pending', 'closed'] })
  status: CsCaseStatus;

  @ApiProperty({ description: '우선순위', enum: ['low', 'normal', 'high', 'urgent'] })
  priority: CsCasePriority;

  @ApiProperty({ description: 'CS Case 제목' })
  subject: string;

  @ApiProperty({ description: '상세 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: '유입 채널', enum: ['kakao', 'web_messenger', 'manual'] })
  sourceChannel: CsCaseSourceChannel;

  @ApiProperty({ description: '외부 대화 포인터', nullable: true })
  externalThreadRef: string | null;

  @ApiProperty({ description: '고객 ID', nullable: true })
  customerId: string | null;

  @ApiProperty({ description: '고객명', nullable: true })
  customerName: string | null;

  @ApiProperty({ description: '담당자 ID', nullable: true })
  assignedTo: string | null;

  @ApiProperty({ description: '부가 정보' })
  metadata: Record<string, unknown>;

  @ApiProperty({ description: '생성자 ID', nullable: true })
  createdBy: string | null;

  @ApiProperty({ description: '종결 시각', nullable: true })
  closedAt: Date | null;

  @ApiProperty({ description: '생성 일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정 일시' })
  updatedAt: Date;

  @ApiProperty({ description: '적용된 라벨 ID 목록', type: [String] })
  labelIds: string[];

  @ApiProperty({ description: '시간순 통합 타임라인', type: [CsCaseTimelineItemDto] })
  timeline: CsCaseTimelineItemDto[];
}
```

- [ ] **Step 3: Create `update-cs-case-status.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { type CsCaseStatus } from '../schema/customer-service.schema';

export class UpdateCsCaseStatusDto {
  @ApiProperty({ description: '새 상태', enum: ['open', 'pending', 'closed'] })
  @IsIn(['open', 'pending', 'closed'])
  status: CsCaseStatus;
}
```

- [ ] **Step 4: Create `assign-cs-case.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class AssignCsCaseDto {
  @ApiProperty({ description: '담당자 ID. null이면 배정 해제', nullable: true })
  @ValidateIf((o) => o.assigneeId !== null)
  @IsUUID()
  @IsOptional()
  assigneeId: string | null;
}
```

- [ ] **Step 5: Rewrite `dto/index.ts`**

```typescript
export * from './create-cs-case.dto';
export * from './cs-case-response.dto';
export * from './update-cs-case-status.dto';
export * from './assign-cs-case.dto';
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: errors only in `cs-cases.service.ts`/`cs-cases.controller.ts` (they still reference removed fields) — those are fixed in Task 5–7. No errors inside `dto/`.

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/customer-service/dto/
git commit -m "feat(cs): update CS DTOs for new ticket shape"
```

---

### Task 5: Rewrite `CsCasesService.create` + add the event helper

**Files:**
- Modify: `apps/core/src/modules/customer-service/services/cs-cases.service.ts`
- Test: `apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts` (rewrite)

- [ ] **Step 1: Write the failing test**

Replace `apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts`:

```typescript
import { csCases } from '../schema/customer-service.schema';
import { makeFakeDb } from '../__fixtures__/fake-db';
import { CsCasesService } from './cs-cases.service';

describe('CsCasesService.create', () => {
  it('creates a ticket with defaults and stamps the operator', async () => {
    const { db, state } = makeFakeDb();
    const service = new CsCasesService(db as any);

    const created = await service.create(
      { subject: '상품 불량 문의', description: '카톡 내용 요약', externalThreadRef: '카톡상담방 A' },
      'operator-1',
    );

    expect(state.get(csCases)).toHaveLength(1);
    expect(created).toMatchObject({
      subject: '상품 불량 문의',
      status: 'open',
      priority: 'normal',
      sourceChannel: 'kakao',
      externalThreadRef: '카톡상담방 A',
      createdBy: 'operator-1',
      labelIds: [],
      timeline: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts`
Expected: FAIL — `create` still references removed fields / response shape differs.

- [ ] **Step 3: Rewrite the top of `cs-cases.service.ts` (imports, types, helpers, create)**

Replace the file header through the `create` method. Keep `getOne`/`createBusinessLink`/`list` for now (fixed in later tasks). New header:

```typescript
import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { and, desc, eq, inArray, or, type InferInsertModel } from 'drizzle-orm';
import { type MergedSchema } from '../../../platform/database/merged-schema';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { BusinessLinkReferenceDto, CreateBusinessLinkDto } from '../../sales-order/dto/create-business-link.dto';
import {
  csCaseEvents,
  csCaseLabels,
  csCases,
  type CsCase,
  type CsCaseEventType,
} from '../schema/customer-service.schema';
import { CreateCsCaseDto } from '../dto/create-cs-case.dto';

type Db = DbService<MergedSchema>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type BusinessLinkInsert = InferInsertModel<typeof wmsTables.businessLinks>;

const CS_CASE_REF_TYPE = 'cs_case';

@Injectable()
export class CsCasesService {
  constructor(@InjectDb() private readonly dbService: DbService<MergedSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: Tx) => Promise<T>, tx?: Tx): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  /** Append an immutable system event row. NOT a Kafka event. */
  private async recordEvent(
    tx: Tx,
    csCaseId: string,
    type: CsCaseEventType,
    actorId: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(csCaseEvents).values({
      csCaseId,
      type,
      actorId: actorId ?? null,
      payload,
    });
  }

  private async loadCaseOrThrow(id: string, tx: Tx): Promise<CsCase> {
    const [csCase] = await tx.select().from(csCases).where(eq(csCases.id, id)).limit(1);
    if (!csCase) {
      throw new NotFoundError(`CS Case ${id} not found`);
    }
    return csCase;
  }

  async create(dto: CreateCsCaseDto, operatorId?: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      const [created] = await trx
        .insert(csCases)
        .values({
          subject: dto.subject,
          description: dto.description ?? null,
          priority: dto.priority ?? 'normal',
          sourceChannel: dto.sourceChannel ?? 'kakao',
          externalThreadRef: dto.externalThreadRef ?? null,
          customerId: dto.customerId ?? null,
          customerName: dto.customerName ?? null,
          assignedTo: dto.assignedTo ?? null,
          metadata: dto.metadata ?? {},
          createdBy: operatorId ?? null,
        })
        .returning();

      return this.toCaseResponse(created, [], []);
    }, tx);
  }
```

Then, further down in the same file, **replace the old `toCaseResponse`** with the version below and **delete** the old `toBusinessTimeline`/`toBusinessTimelineItem`/`toBusinessLinkRef`/`normalizeBusinessLinkRef`/`hasBusinessLinkRef`/`referencesCsCase`/`assertSalesOrderReferenceExists` helpers only if a later task says so — for this task, just add the new `toCaseResponse` signature and a placeholder timeline builder:

```typescript
  private toCaseResponse(csCase: CsCase, labelIds: string[], timeline: unknown[]) {
    return {
      ...csCase,
      metadata: (csCase.metadata ?? {}) as Record<string, unknown>,
      labelIds,
      timeline,
    };
  }
```

> The existing `getOne`/`createBusinessLink` call `this.toCaseResponse(csCase, this.toBusinessTimeline(...))` (two args). Update those two call sites to `this.toCaseResponse(csCase, [], [])` for now so the file compiles; Task 7 replaces them properly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/customer-service/services/cs-cases.service.ts apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts
git commit -m "feat(cs): rebuild CsCasesService.create with new shape + event helper"
```

---

### Task 6: `updateStatus` + status_changed event

**Files:**
- Modify: `apps/core/src/modules/customer-service/services/cs-cases.service.ts`
- Test: `apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts`

- [ ] **Step 1: Add the failing test**

Append to the spec file:

```typescript
import { csCaseEvents } from '../schema/customer-service.schema';

describe('CsCasesService.updateStatus', () => {
  it('closes a ticket, sets closedAt, and records a status_changed event', async () => {
    const { db, state } = makeFakeDb();
    const service = new CsCasesService(db as any);
    const created = await service.create({ subject: 'x' }, 'op-1');

    const updated = await service.updateStatus(created.id, 'closed', 'op-2');

    expect(updated.status).toBe('closed');
    expect(updated.closedAt).not.toBeNull();
    const events = state.get(csCaseEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'status_changed', actorId: 'op-2', payload: { from: 'open', to: 'closed' } });
  });

  it('reopening clears closedAt', async () => {
    const { db } = makeFakeDb();
    const service = new CsCasesService(db as any);
    const created = await service.create({ subject: 'x' }, 'op-1');
    await service.updateStatus(created.id, 'closed', 'op-1');

    const reopened = await service.updateStatus(created.id, 'open', 'op-1');

    expect(reopened.status).toBe('open');
    expect(reopened.closedAt).toBeNull();
  });

  it('is a no-op event when status is unchanged', async () => {
    const { db, state } = makeFakeDb();
    const service = new CsCasesService(db as any);
    const created = await service.create({ subject: 'x' }, 'op-1');

    await service.updateStatus(created.id, 'open', 'op-1');

    expect(state.get(csCaseEvents)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts -t updateStatus`
Expected: FAIL — `updateStatus` is not a function.

- [ ] **Step 3: Implement `updateStatus`**

Add to `CsCasesService`:

```typescript
  async updateStatus(id: string, status: CsCase['status'], operatorId?: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      const current = await this.loadCaseOrThrow(id, trx);
      if (current.status === status) {
        return this.toCaseResponse(current, [], []);
      }

      const [updated] = await trx
        .update(csCases)
        .set({
          status,
          closedAt: status === 'closed' ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(csCases.id, id))
        .returning();

      await this.recordEvent(trx, id, 'status_changed', operatorId, { from: current.status, to: status });
      return this.toCaseResponse(updated, [], []);
    }, tx);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts -t updateStatus`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/customer-service/services/cs-cases.service.ts apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts
git commit -m "feat(cs): add updateStatus with status_changed event"
```

---

### Task 7: `assign`/unassign + events

**Files:**
- Modify: `apps/core/src/modules/customer-service/services/cs-cases.service.ts`
- Test: `apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts`

- [ ] **Step 1: Add the failing test**

Append to the spec:

```typescript
describe('CsCasesService.assign', () => {
  it('assigns an owner and records an assigned event', async () => {
    const { db, state } = makeFakeDb();
    const service = new CsCasesService(db as any);
    const created = await service.create({ subject: 'x' }, 'op-1');

    const updated = await service.assign(created.id, 'agent-9', 'op-1');

    expect(updated.assignedTo).toBe('agent-9');
    expect(state.get(csCaseEvents)[0]).toMatchObject({
      type: 'assigned',
      payload: { from: null, to: 'agent-9' },
    });
  });

  it('unassigns and records an unassigned event', async () => {
    const { db, state } = makeFakeDb();
    const service = new CsCasesService(db as any);
    const created = await service.create({ subject: 'x', assignedTo: 'agent-9' } as any, 'op-1');

    const updated = await service.assign(created.id, null, 'op-1');

    expect(updated.assignedTo).toBeNull();
    expect(state.get(csCaseEvents)[0]).toMatchObject({ type: 'unassigned', payload: { from: 'agent-9' } });
  });

  it('rejects assigning to the current owner', async () => {
    const { db } = makeFakeDb();
    const service = new CsCasesService(db as any);
    const created = await service.create({ subject: 'x', assignedTo: 'agent-9' } as any, 'op-1');

    await expect(service.assign(created.id, 'agent-9', 'op-1')).rejects.toThrow('already assigned');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts -t assign`
Expected: FAIL — `assign` is not a function.

- [ ] **Step 3: Implement `assign`**

Add to `CsCasesService`:

```typescript
  async assign(id: string, assigneeId: string | null, operatorId?: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      const current = await this.loadCaseOrThrow(id, trx);
      if ((current.assignedTo ?? null) === (assigneeId ?? null)) {
        throw new BadRequestError(
          assigneeId ? `CS Case ${id} is already assigned to ${assigneeId}` : `CS Case ${id} is already unassigned`,
        );
      }

      const [updated] = await trx
        .update(csCases)
        .set({ assignedTo: assigneeId, updatedAt: new Date() })
        .where(eq(csCases.id, id))
        .returning();

      if (assigneeId) {
        await this.recordEvent(trx, id, 'assigned', operatorId, { from: current.assignedTo ?? null, to: assigneeId });
      } else {
        await this.recordEvent(trx, id, 'unassigned', operatorId, { from: current.assignedTo });
      }
      return this.toCaseResponse(updated, [], []);
    }, tx);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts -t assign`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/customer-service/services/cs-cases.service.ts apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts
git commit -m "feat(cs): add assign/unassign with events"
```

---

### Task 8: `getOne` merges comments + events + business_links into one timeline

**Files:**
- Modify: `apps/core/src/modules/customer-service/services/cs-cases.service.ts`
- Test: `apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts`

- [ ] **Step 1: Add the failing test**

Append to the spec:

```typescript
import {
  csCaseComments,
  csCaseCommentAttachments,
  csCaseCommentMentions,
  csCaseLabels,
} from '../schema/customer-service.schema';
import { wmsTables } from '../../inventory/schema/inventory.schema';

describe('CsCasesService.getOne timeline', () => {
  it('merges comments, events, and business links ordered by occurredAt, with labelIds', async () => {
    const seed = new Map<unknown, any[]>();
    const caseId = 'aaaaaaaa-0000-4000-8000-000000000001';
    seed.set(csCases, [
      {
        id: caseId,
        status: 'open',
        priority: 'normal',
        subject: 'x',
        metadata: {},
        createdAt: new Date('2026-06-20T00:00:00Z'),
        updatedAt: new Date('2026-06-20T00:00:00Z'),
      },
    ]);
    seed.set(csCaseComments, [
      {
        id: 'c1',
        csCaseId: caseId,
        authorId: 'op-1',
        body: '카톡으로 이렇게 답함',
        editedAt: null,
        deletedAt: null,
        createdAt: new Date('2026-06-20T00:02:00Z'),
      },
    ]);
    seed.set(csCaseCommentMentions, [{ id: 'm1', commentId: 'c1', mentionedUserId: 'agent-2' }]);
    seed.set(csCaseCommentAttachments, [{ id: 'a1', commentId: 'c1', csCaseId: caseId, fileId: 'file_123' }]);
    seed.set(csCaseEvents, [
      {
        id: 'e1',
        csCaseId: caseId,
        type: 'status_changed',
        actorId: 'op-1',
        payload: { from: 'open', to: 'pending' },
        occurredAt: new Date('2026-06-20T00:01:00Z'),
      },
    ]);
    seed.set(wmsTables.businessLinks, [
      {
        id: 'l1',
        sourceType: 'cs_case',
        sourceId: caseId,
        sourceExternalRef: null,
        targetType: 'sales_order',
        targetId: 'so-1',
        targetExternalRef: null,
        relationName: 'opened_for_sales_order',
        metadata: {},
        occurredAt: new Date('2026-06-20T00:03:00Z'),
        createdAt: new Date('2026-06-20T00:03:00Z'),
      },
    ]);
    seed.set(csCaseLabels, [{ id: 'cl1', csCaseId: caseId, labelId: 'label-1' }]);

    const { db } = makeFakeDb(seed);
    const service = new CsCasesService(db as any);

    const result = await service.getOne(caseId);

    expect(result.labelIds).toEqual(['label-1']);
    expect(result.timeline.map((t: any) => t.kind)).toEqual(['event', 'comment', 'business_link']);
    const comment = result.timeline.find((t: any) => t.kind === 'comment') as any;
    expect(comment.mentions).toEqual(['agent-2']);
    expect(comment.attachmentFileIds).toEqual(['file_123']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts -t timeline`
Expected: FAIL — timeline is empty `[]` (placeholder from Task 5).

- [ ] **Step 3: Implement the real `getOne` + timeline builder**

Replace the placeholder `getOne` and `toCaseResponse` in `CsCasesService`:

```typescript
  async getOne(id: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      const csCase = await this.loadCaseOrThrow(id, trx);

      const comments = await trx.select().from(csCaseComments).where(eq(csCaseComments.csCaseId, id));
      const commentIds = comments.map((c) => c.id);
      const mentions = commentIds.length
        ? await trx.select().from(csCaseCommentMentions).where(inArray(csCaseCommentMentions.commentId, commentIds))
        : [];
      const attachments = commentIds.length
        ? await trx.select().from(csCaseCommentAttachments).where(inArray(csCaseCommentAttachments.commentId, commentIds))
        : [];
      const events = await trx.select().from(csCaseEvents).where(eq(csCaseEvents.csCaseId, id));
      const links = await trx
        .select()
        .from(wmsTables.businessLinks)
        .where(
          or(
            and(eq(wmsTables.businessLinks.sourceType, CS_CASE_REF_TYPE), eq(wmsTables.businessLinks.sourceId, id)),
            and(eq(wmsTables.businessLinks.targetType, CS_CASE_REF_TYPE), eq(wmsTables.businessLinks.targetId, id)),
          ),
        );
      const caseLabels = await trx.select().from(csCaseLabels).where(eq(csCaseLabels.csCaseId, id));

      const timeline = this.buildTimeline(id, comments, mentions, attachments, events, links);
      return this.toCaseResponse(csCase, caseLabels.map((l) => l.labelId), timeline);
    }, tx);
  }

  private buildTimeline(
    csCaseId: string,
    comments: Array<Record<string, any>>,
    mentions: Array<Record<string, any>>,
    attachments: Array<Record<string, any>>,
    events: Array<Record<string, any>>,
    links: Array<Record<string, any>>,
  ) {
    const commentItems = comments.map((c) => ({
      kind: 'comment' as const,
      id: c.id,
      occurredAt: c.createdAt as Date,
      actorId: (c.authorId ?? null) as string | null,
      body: c.deletedAt ? null : (c.body as string),
      deleted: Boolean(c.deletedAt),
      edited: Boolean(c.editedAt),
      mentions: mentions.filter((m) => m.commentId === c.id).map((m) => m.mentionedUserId as string),
      attachmentFileIds: attachments.filter((a) => a.commentId === c.id).map((a) => a.fileId as string),
    }));

    const eventItems = events.map((e) => ({
      kind: 'event' as const,
      id: e.id,
      occurredAt: e.occurredAt as Date,
      actorId: (e.actorId ?? null) as string | null,
      eventType: e.type as CsCaseEventType,
      payload: (e.payload ?? {}) as Record<string, unknown>,
    }));

    const linkItems = links.map((link) => {
      const outbound = link.sourceType === CS_CASE_REF_TYPE && link.sourceId === csCaseId;
      return {
        kind: 'business_link' as const,
        id: link.id,
        occurredAt: link.occurredAt as Date,
        actorId: null,
        payload: {
          relationName: link.relationName,
          direction: outbound ? 'outbound' : 'inbound',
          linkedEntity: outbound
            ? { type: link.targetType, id: link.targetId, externalRef: link.targetExternalRef }
            : { type: link.sourceType, id: link.sourceId, externalRef: link.sourceExternalRef },
        } as Record<string, unknown>,
      };
    });

    return [...commentItems, ...eventItems, ...linkItems].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
  }

  private toCaseResponse(csCase: CsCase, labelIds: string[], timeline: unknown[]) {
    return {
      ...csCase,
      metadata: (csCase.metadata ?? {}) as Record<string, unknown>,
      labelIds,
      timeline,
    };
  }
```

Add the missing imports to the top of the file:

```typescript
import {
  csCaseCommentAttachments,
  csCaseCommentMentions,
  csCaseComments,
} from '../schema/customer-service.schema';
```

> `csCaseEvents`, `csCaseLabels`, `csCases` are already imported from Task 5.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts -t timeline`
Expected: PASS. Then run the whole CS service spec: `npx jest apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts` — all green.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/customer-service/services/cs-cases.service.ts apps/core/src/modules/customer-service/services/cs-cases.service.spec.ts
git commit -m "feat(cs): merge comments/events/business-links into ticket timeline"
```

---

### Task 9: `CsCommentsService` — add comment with mentions + attachments

**Files:**
- Create: `apps/core/src/modules/customer-service/services/cs-comments.service.ts`
- Create: `apps/core/src/modules/customer-service/dto/create-cs-comment.dto.ts`
- Test: `apps/core/src/modules/customer-service/services/cs-comments.service.spec.ts`

- [ ] **Step 1: Create the DTO**

`apps/core/src/modules/customer-service/dto/create-cs-comment.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CsCommentAttachmentInput {
  @ApiProperty({ description: 'file-service 파일 ID' })
  @IsString()
  @MaxLength(255)
  fileId: string;

  @ApiProperty({ description: '파일명', required: false })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  fileName?: string;
}

export class CreateCsCommentDto {
  @ApiProperty({ description: '댓글 본문' })
  @IsString()
  body: string;

  @ApiProperty({ description: '멘션할 사용자 ID 목록', required: false, type: [String] })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptional()
  mentionedUserIds?: string[];

  @ApiProperty({ description: '첨부 목록', required: false, type: [CsCommentAttachmentInput] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CsCommentAttachmentInput)
  @IsOptional()
  attachments?: CsCommentAttachmentInput[];
}
```

- [ ] **Step 2: Write the failing test**

`apps/core/src/modules/customer-service/services/cs-comments.service.spec.ts`:

```typescript
import {
  csCaseComments,
  csCaseCommentAttachments,
  csCaseCommentMentions,
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

  it('creates a comment with mentions and attachments', async () => {
    const { db, state } = makeFakeDb(seedCase(caseId));
    const service = new CsCommentsService(db as any);

    const result = await service.addComment(
      caseId,
      {
        body: '확인 후 답변드리겠습니다 @agent',
        mentionedUserIds: ['agent-2'],
        attachments: [{ fileId: 'file_1', fileName: 'defect.jpg' }],
      },
      'op-1',
    );

    expect(result.body).toBe('확인 후 답변드리겠습니다 @agent');
    expect(state.get(csCaseComments)).toHaveLength(1);
    expect(state.get(csCaseCommentMentions)[0]).toMatchObject({ mentionedUserId: 'agent-2' });
    expect(state.get(csCaseCommentAttachments)[0]).toMatchObject({ fileId: 'file_1', csCaseId: caseId });
  });

  it('rejects an empty body', async () => {
    const { db } = makeFakeDb(seedCase(caseId));
    const service = new CsCommentsService(db as any);
    await expect(service.addComment(caseId, { body: '   ' }, 'op-1')).rejects.toThrow('empty');
  });

  it('throws when the case does not exist', async () => {
    const { db } = makeFakeDb();
    const service = new CsCommentsService(db as any);
    await expect(service.addComment(caseId, { body: 'hi' }, 'op-1')).rejects.toThrow('not found');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest apps/core/src/modules/customer-service/services/cs-comments.service.spec.ts`
Expected: FAIL — `CsCommentsService` does not exist.

- [ ] **Step 4: Implement `CsCommentsService`**

`apps/core/src/modules/customer-service/services/cs-comments.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { eq } from 'drizzle-orm';
import { type MergedSchema } from '../../../platform/database/merged-schema';
import {
  csCaseCommentAttachments,
  csCaseCommentMentions,
  csCaseComments,
  csCases,
  type CsCaseComment,
} from '../schema/customer-service.schema';
import { CreateCsCommentDto } from '../dto/create-cs-comment.dto';

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

  async addComment(csCaseId: string, dto: CreateCsCommentDto, authorId: string, tx?: Tx) {
    const body = dto.body?.trim();
    if (!body) throw new BadRequestError('Comment body must not be empty');

    return this.inTx(async (trx) => {
      const [csCase] = await trx.select().from(csCases).where(eq(csCases.id, csCaseId)).limit(1);
      if (!csCase) throw new NotFoundError(`CS Case ${csCaseId} not found`);

      const [comment] = await trx
        .insert(csCaseComments)
        .values({ csCaseId, authorId, body })
        .returning();

      const mentionIds = [...new Set(dto.mentionedUserIds ?? [])];
      if (mentionIds.length) {
        await trx
          .insert(csCaseCommentMentions)
          .values(mentionIds.map((mentionedUserId) => ({ commentId: comment.id, mentionedUserId })));
      }

      const attachments = dto.attachments ?? [];
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
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest apps/core/src/modules/customer-service/services/cs-comments.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/customer-service/services/cs-comments.service.ts apps/core/src/modules/customer-service/services/cs-comments.service.spec.ts apps/core/src/modules/customer-service/dto/create-cs-comment.dto.ts
git commit -m "feat(cs): add CsCommentsService.addComment with mentions + attachments"
```

---

### Task 10: Edit + soft-delete comment (author-only)

**Files:**
- Modify: `apps/core/src/modules/customer-service/services/cs-comments.service.ts`
- Create: `apps/core/src/modules/customer-service/dto/edit-cs-comment.dto.ts`
- Test: `apps/core/src/modules/customer-service/services/cs-comments.service.spec.ts`

- [ ] **Step 1: Create the edit DTO**

`apps/core/src/modules/customer-service/dto/edit-cs-comment.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class EditCsCommentDto {
  @ApiProperty({ description: '수정할 본문' })
  @IsString()
  body: string;
}
```

- [ ] **Step 2: Add the failing test**

Append to `cs-comments.service.spec.ts`:

```typescript
import { ForbiddenError } from '@app/shared';

describe('CsCommentsService edit/delete', () => {
  const caseId = 'aaaaaaaa-0000-4000-8000-000000000001';

  it('lets the author edit and sets editedAt', async () => {
    const { db, state } = makeFakeDb(seedCase(caseId));
    const service = new CsCommentsService(db as any);
    const created = await service.addComment(caseId, { body: 'first' }, 'op-1');

    const edited = await service.editComment(created.id, { body: 'second' }, 'op-1');

    expect(edited.body).toBe('second');
    expect(state.get(csCaseComments)[0].editedAt).not.toBeNull();
  });

  it('blocks editing someone else’s comment', async () => {
    const { db } = makeFakeDb(seedCase(caseId));
    const service = new CsCommentsService(db as any);
    const created = await service.addComment(caseId, { body: 'first' }, 'op-1');

    await expect(service.editComment(created.id, { body: 'x' }, 'op-2')).rejects.toThrow('author');
  });

  it('soft-deletes (author only) keeping the row', async () => {
    const { db, state } = makeFakeDb(seedCase(caseId));
    const service = new CsCommentsService(db as any);
    const created = await service.addComment(caseId, { body: 'first' }, 'op-1');

    await service.deleteComment(created.id, 'op-1');

    expect(state.get(csCaseComments)).toHaveLength(1);
    expect(state.get(csCaseComments)[0].deletedAt).not.toBeNull();
    expect(state.get(csCaseComments)[0].deletedBy).toBe('op-1');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest apps/core/src/modules/customer-service/services/cs-comments.service.spec.ts -t "edit/delete"`
Expected: FAIL — `editComment`/`deleteComment` not defined.

- [ ] **Step 4: Implement edit + soft-delete**

Add to `CsCommentsService` (and add `ForbiddenError` to the `@app/shared` import):

```typescript
  async editComment(commentId: string, dto: { body: string }, actorId: string, tx?: Tx) {
    const body = dto.body?.trim();
    if (!body) throw new BadRequestError('Comment body must not be empty');

    return this.inTx(async (trx) => {
      const comment = await this.loadCommentOrThrow(commentId, trx);
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

  async deleteComment(commentId: string, actorId: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      const comment = await this.loadCommentOrThrow(commentId, trx);
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
```

Update the import line:

```typescript
import { BadRequestError, ForbiddenError, NotFoundError } from '@app/shared';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest apps/core/src/modules/customer-service/services/cs-comments.service.spec.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/customer-service/services/cs-comments.service.ts apps/core/src/modules/customer-service/services/cs-comments.service.spec.ts apps/core/src/modules/customer-service/dto/edit-cs-comment.dto.ts
git commit -m "feat(cs): author-only comment edit + soft-delete"
```

---

### Task 11: `CsLabelsService` — taxonomy + apply/remove to case

**Files:**
- Create: `apps/core/src/modules/customer-service/services/cs-labels.service.ts`
- Create: `apps/core/src/modules/customer-service/dto/cs-label.dto.ts`
- Test: `apps/core/src/modules/customer-service/services/cs-labels.service.spec.ts`

- [ ] **Step 1: Create DTOs**

`apps/core/src/modules/customer-service/dto/cs-label.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsHexColor, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCsLabelDto {
  @ApiProperty({ description: '라벨 이름(유일)' })
  @IsString()
  @MaxLength(96)
  name: string;

  @ApiProperty({ description: '색상(hex)', required: false, default: '#888888' })
  @IsHexColor()
  @IsOptional()
  color?: string;
}

export class ApplyCsLabelDto {
  @ApiProperty({ description: '적용할 라벨 ID' })
  @IsUUID()
  labelId: string;
}
```

- [ ] **Step 2: Write the failing test**

`apps/core/src/modules/customer-service/services/cs-labels.service.spec.ts`:

```typescript
import { csCaseEvents, csCaseLabels, csCases, csLabels } from '../schema/customer-service.schema';
import { makeFakeDb } from '../__fixtures__/fake-db';
import { CsLabelsService } from './cs-labels.service';

describe('CsLabelsService', () => {
  const caseId = 'aaaaaaaa-0000-4000-8000-000000000001';

  it('creates a label in the taxonomy', async () => {
    const { db, state } = makeFakeDb();
    const service = new CsLabelsService(db as any);
    const label = await service.createLabel({ name: '환불', color: '#ff0000' });
    expect(label.name).toBe('환불');
    expect(state.get(csLabels)).toHaveLength(1);
  });

  it('applies a label to a case and records a label_added event', async () => {
    const seed = new Map<unknown, any[]>();
    seed.set(csCases, [{ id: caseId, subject: 'x', status: 'open' }]);
    seed.set(csLabels, [{ id: 'label-1', name: '환불', isActive: true }]);
    const { db, state } = makeFakeDb(seed);
    const service = new CsLabelsService(db as any);

    await service.applyLabel(caseId, 'label-1', 'op-1');

    expect(state.get(csCaseLabels)[0]).toMatchObject({ csCaseId: caseId, labelId: 'label-1' });
    expect(state.get(csCaseEvents)[0]).toMatchObject({ type: 'label_added', payload: { labelId: 'label-1', labelName: '환불' } });
  });

  it('rejects applying an unknown label', async () => {
    const seed = new Map<unknown, any[]>();
    seed.set(csCases, [{ id: caseId, subject: 'x', status: 'open' }]);
    const { db } = makeFakeDb(seed);
    const service = new CsLabelsService(db as any);
    await expect(service.applyLabel(caseId, 'nope', 'op-1')).rejects.toThrow('not found');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest apps/core/src/modules/customer-service/services/cs-labels.service.spec.ts`
Expected: FAIL — `CsLabelsService` does not exist.

- [ ] **Step 4: Implement `CsLabelsService`**

`apps/core/src/modules/customer-service/services/cs-labels.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { ConflictError, NotFoundError } from '@app/shared';
import { and, asc, eq } from 'drizzle-orm';
import { type MergedSchema } from '../../../platform/database/merged-schema';
import {
  csCaseEvents,
  csCaseLabels,
  csCases,
  csLabels,
  type CsCaseEventType,
} from '../schema/customer-service.schema';
import { CreateCsLabelDto } from '../dto/cs-label.dto';

type Db = DbService<MergedSchema>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

@Injectable()
export class CsLabelsService {
  constructor(@InjectDb() private readonly dbService: DbService<MergedSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: Tx) => Promise<T>, tx?: Tx): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  private async recordEvent(tx: Tx, csCaseId: string, type: CsCaseEventType, actorId: string | undefined, payload: Record<string, unknown>) {
    await tx.insert(csCaseEvents).values({ csCaseId, type, actorId: actorId ?? null, payload });
  }

  async listLabels(tx?: Tx) {
    return this.inTx(
      (trx) => trx.select().from(csLabels).orderBy(asc(csLabels.sortOrder)).limit(500),
      tx,
    );
  }

  async createLabel(dto: CreateCsLabelDto, tx?: Tx) {
    return this.inTx(async (trx) => {
      const [existing] = await trx.select().from(csLabels).where(eq(csLabels.name, dto.name)).limit(1);
      if (existing) throw new ConflictError(`Label "${dto.name}" already exists`);
      const [label] = await trx
        .insert(csLabels)
        .values({ name: dto.name, color: dto.color ?? '#888888' })
        .returning();
      return label;
    }, tx);
  }

  async applyLabel(csCaseId: string, labelId: string, actorId: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      const [csCase] = await trx.select().from(csCases).where(eq(csCases.id, csCaseId)).limit(1);
      if (!csCase) throw new NotFoundError(`CS Case ${csCaseId} not found`);
      const [label] = await trx.select().from(csLabels).where(eq(csLabels.id, labelId)).limit(1);
      if (!label) throw new NotFoundError(`CS label ${labelId} not found`);

      const [existing] = await trx
        .select()
        .from(csCaseLabels)
        .where(and(eq(csCaseLabels.csCaseId, csCaseId), eq(csCaseLabels.labelId, labelId)))
        .limit(1);
      if (existing) return existing;

      const [applied] = await trx.insert(csCaseLabels).values({ csCaseId, labelId }).returning();
      await this.recordEvent(trx, csCaseId, 'label_added', actorId, { labelId, labelName: label.name });
      return applied;
    }, tx);
  }

  async removeLabel(csCaseId: string, labelId: string, actorId: string, tx?: Tx) {
    return this.inTx(async (trx) => {
      const [label] = await trx.select().from(csLabels).where(eq(csLabels.id, labelId)).limit(1);
      await trx
        .delete(csCaseLabels)
        .where(and(eq(csCaseLabels.csCaseId, csCaseId), eq(csCaseLabels.labelId, labelId)));
      await this.recordEvent(trx, csCaseId, 'label_removed', actorId, {
        labelId,
        labelName: label?.name ?? null,
      });
    }, tx);
  }
}
```

> The fake DB needs `delete()`. Add this method to `tx` in `__fixtures__/fake-db.ts` (inside `makeFakeDb`, alongside `update`):

```typescript
    delete: (table: unknown) => ({
      where: () => {
        state.rows.set(table, []);
        return Promise.resolve([]);
      },
    }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest apps/core/src/modules/customer-service/services/cs-labels.service.spec.ts`
Expected: PASS (3 tests). Re-run the fake-db spec to confirm no regression: `npx jest apps/core/src/modules/customer-service/__fixtures__/fake-db.spec.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/customer-service/services/cs-labels.service.ts apps/core/src/modules/customer-service/services/cs-labels.service.spec.ts apps/core/src/modules/customer-service/dto/cs-label.dto.ts apps/core/src/modules/customer-service/__fixtures__/fake-db.ts
git commit -m "feat(cs): label taxonomy + apply/remove with events"
```

---

### Task 12: Controllers + module wiring

**Files:**
- Modify: `apps/core/src/modules/customer-service/controllers/cs-cases.controller.ts`
- Create: `apps/core/src/modules/customer-service/controllers/cs-case-comments.controller.ts`
- Create: `apps/core/src/modules/customer-service/controllers/cs-case-labels.controller.ts`
- Create: `apps/core/src/modules/customer-service/controllers/cs-labels.controller.ts`
- Modify: `apps/core/src/modules/customer-service/customer-service.module.ts`
- Test: `apps/core/src/modules/customer-service/controllers/cs-cases.controller.spec.ts` (extend)

- [ ] **Step 1: Extend the controller spec**

Replace `apps/core/src/modules/customer-service/controllers/cs-cases.controller.spec.ts`:

```typescript
import { CsCasesController } from './cs-cases.controller';

describe('CsCasesController', () => {
  function makeController() {
    const service = {
      create: jest.fn(),
      list: jest.fn(),
      getOne: jest.fn(),
      createBusinessLink: jest.fn(),
      updateStatus: jest.fn(),
      assign: jest.fn(),
    };
    return { controller: new CsCasesController(service as any), service };
  }

  it('uses the authenticated user id as the creator', () => {
    const { controller, service } = makeController();
    controller.create({ subject: 'x' } as any, { id: 'u-1' });
    expect(service.create).toHaveBeenCalledWith({ subject: 'x' }, 'u-1');
  });

  it('delegates status update with the operator id', () => {
    const { controller, service } = makeController();
    controller.updateStatus('case-1', { status: 'closed' } as any, { sub: 'u-9' });
    expect(service.updateStatus).toHaveBeenCalledWith('case-1', 'closed', 'u-9');
  });

  it('delegates assignment with the operator id', () => {
    const { controller, service } = makeController();
    controller.assign('case-1', { assigneeId: 'agent-2' } as any, { userId: 'u-3' });
    expect(service.assign).toHaveBeenCalledWith('case-1', 'agent-2', 'u-3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/core/src/modules/customer-service/controllers/cs-cases.controller.spec.ts`
Expected: FAIL — `updateStatus`/`assign` not on controller.

- [ ] **Step 3: Rewrite `cs-cases.controller.ts`**

```typescript
import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { CreateBusinessLinkDto } from '../../sales-order/dto/create-business-link.dto';
import { AssignCsCaseDto, CreateCsCaseDto, CsCaseResponseDto, UpdateCsCaseStatusDto } from '../dto';
import { CsCasesService } from '../services/cs-cases.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

@ApiTags('CS Cases')
@Controller('cs-cases')
export class CsCasesController {
  constructor(private readonly service: CsCasesService) {}

  @Post()
  @ApiOperation({ summary: 'CS Case 생성' })
  @ApiResponse({ status: 201, type: CsCaseResponseDto })
  create(@Body() dto: CreateCsCaseDto, @User() user: AuthenticatedUser) {
    return this.service.create(dto, this.getUserId(user));
  }

  @Get()
  @ApiOperation({ summary: 'CS Case 목록 조회' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  list(@Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number) {
    return this.service.list(limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'CS Case 단건 조회(타임라인 포함)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: CsCaseResponseDto })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'CS Case 상태 변경(재오픈 포함)' })
  @ApiParam({ name: 'id' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateCsCaseStatusDto, @User() user: AuthenticatedUser) {
    return this.service.updateStatus(id, dto.status, this.getUserId(user));
  }

  @Patch(':id/assignee')
  @ApiOperation({ summary: 'CS Case 담당자 배정/해제' })
  @ApiParam({ name: 'id' })
  assign(@Param('id') id: string, @Body() dto: AssignCsCaseDto, @User() user: AuthenticatedUser) {
    return this.service.assign(id, dto.assigneeId, this.getUserId(user));
  }

  @Post(':id/business-links')
  @ApiOperation({ summary: 'CS Case 업무 연결 생성' })
  @ApiParam({ name: 'id' })
  createBusinessLink(@Param('id') id: string, @Body() dto: CreateBusinessLinkDto) {
    return this.service.createBusinessLink(id, dto);
  }

  private getUserId(user: AuthenticatedUser): string | undefined {
    return user?.id ?? user?.userId ?? user?.sub;
  }
}
```

> Keep `createBusinessLink` working: `CsCasesService.createBusinessLink` from the original file is preserved (only its final `toCaseResponse(...)` call sites were updated to the 3-arg form in Task 5). If `createBusinessLink` still returns a timeline item via the old helpers, leave it — it is exercised by the existing business-link tests retained from the original suite.

- [ ] **Step 4: Create `cs-case-comments.controller.ts`**

```typescript
import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { CreateCsCommentDto } from '../dto/create-cs-comment.dto';
import { EditCsCommentDto } from '../dto/edit-cs-comment.dto';
import { CsCommentsService } from '../services/cs-comments.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

@ApiTags('CS Comments')
@Controller('cs-cases/:caseId/comments')
export class CsCaseCommentsController {
  constructor(private readonly service: CsCommentsService) {}

  @Post()
  @ApiOperation({ summary: '댓글 작성(멘션/첨부 포함)' })
  @ApiParam({ name: 'caseId' })
  add(@Param('caseId') caseId: string, @Body() dto: CreateCsCommentDto, @User() user: AuthenticatedUser) {
    return this.service.addComment(caseId, dto, this.getUserId(user));
  }

  @Patch(':commentId')
  @ApiOperation({ summary: '댓글 수정(작성자 본인만)' })
  @ApiParam({ name: 'caseId' })
  @ApiParam({ name: 'commentId' })
  edit(@Param('commentId') commentId: string, @Body() dto: EditCsCommentDto, @User() user: AuthenticatedUser) {
    return this.service.editComment(commentId, dto, this.getUserId(user));
  }

  @Delete(':commentId')
  @ApiOperation({ summary: '댓글 삭제(소프트, 작성자 본인만)' })
  @ApiParam({ name: 'caseId' })
  @ApiParam({ name: 'commentId' })
  remove(@Param('commentId') commentId: string, @User() user: AuthenticatedUser) {
    return this.service.deleteComment(commentId, this.getUserId(user));
  }

  private getUserId(user: AuthenticatedUser): string {
    const id = user?.id ?? user?.userId ?? user?.sub;
    if (!id) throw new Error('Authenticated user id missing');
    return id;
  }
}
```

- [ ] **Step 5: Create `cs-case-labels.controller.ts`**

```typescript
import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { ApplyCsLabelDto } from '../dto/cs-label.dto';
import { CsLabelsService } from '../services/cs-labels.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

@ApiTags('CS Case Labels')
@Controller('cs-cases/:caseId/labels')
export class CsCaseLabelsController {
  constructor(private readonly service: CsLabelsService) {}

  @Post()
  @ApiOperation({ summary: 'CS Case에 라벨 적용' })
  @ApiParam({ name: 'caseId' })
  apply(@Param('caseId') caseId: string, @Body() dto: ApplyCsLabelDto, @User() user: AuthenticatedUser) {
    return this.service.applyLabel(caseId, dto.labelId, this.getUserId(user));
  }

  @Delete(':labelId')
  @ApiOperation({ summary: 'CS Case에서 라벨 제거' })
  @ApiParam({ name: 'caseId' })
  @ApiParam({ name: 'labelId' })
  remove(@Param('caseId') caseId: string, @Param('labelId') labelId: string, @User() user: AuthenticatedUser) {
    return this.service.removeLabel(caseId, labelId, this.getUserId(user));
  }

  private getUserId(user: AuthenticatedUser): string {
    const id = user?.id ?? user?.userId ?? user?.sub;
    if (!id) throw new Error('Authenticated user id missing');
    return id;
  }
}
```

- [ ] **Step 6: Create `cs-labels.controller.ts`**

```typescript
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateCsLabelDto } from '../dto/cs-label.dto';
import { CsLabelsService } from '../services/cs-labels.service';

@ApiTags('CS Labels')
@Controller('cs-labels')
export class CsLabelsController {
  constructor(private readonly service: CsLabelsService) {}

  @Get()
  @ApiOperation({ summary: '라벨 taxonomy 목록' })
  list() {
    return this.service.listLabels();
  }

  @Post()
  @ApiOperation({ summary: '라벨 생성(관리자)' })
  create(@Body() dto: CreateCsLabelDto) {
    return this.service.createLabel(dto);
  }
}
```

- [ ] **Step 7: Rewrite `customer-service.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { CsCasesController } from './controllers/cs-cases.controller';
import { CsCaseCommentsController } from './controllers/cs-case-comments.controller';
import { CsCaseLabelsController } from './controllers/cs-case-labels.controller';
import { CsLabelsController } from './controllers/cs-labels.controller';
import { CsCasesService } from './services/cs-cases.service';
import { CsCommentsService } from './services/cs-comments.service';
import { CsLabelsService } from './services/cs-labels.service';

@Module({
  controllers: [CsCasesController, CsCaseCommentsController, CsCaseLabelsController, CsLabelsController],
  providers: [CsCasesService, CsCommentsService, CsLabelsService],
  exports: [CsCasesService, CsCommentsService, CsLabelsService],
})
export class CustomerServiceModule {}
```

- [ ] **Step 8: Run the controller test + build**

Run: `npx jest apps/core/src/modules/customer-service/controllers/cs-cases.controller.spec.ts`
Expected: PASS (3 tests).

Run: `npx nest build core`
Expected: build succeeds with no type errors.

- [ ] **Step 9: Commit**

```bash
git add apps/core/src/modules/customer-service/controllers/ apps/core/src/modules/customer-service/customer-service.module.ts
git commit -m "feat(cs): wire CS controllers (cases/comments/labels) into module"
```

---

### Task 13: Lint, full-module test sweep, final verification

**Files:** none (verification only)

- [ ] **Step 1: Run all customer-service specs (scoped, not the whole suite)**

Run: `npx jest --testPathPattern='modules/customer-service'`
Expected: all CS specs green.

- [ ] **Step 2: Lint the touched module**

Run: `npx eslint "apps/core/src/modules/customer-service/**/*.ts" --fix`
Expected: no remaining errors.

- [ ] **Step 3: Type-check the app**

Run: `npx nest build core`
Expected: success.

- [ ] **Step 4: Commit any lint fixups**

```bash
git add apps/core/src/modules/customer-service/
git commit -m "chore(cs): lint + final verification for CS issue tracker"
```

---

## Self-Review

**Spec coverage:**
- Internal-only ticket → no public/private split anywhere. ✓ (Task 1, 4)
- Status `open/pending/closed`, free transitions + reopen → `UpdateCsCaseStatusDto` + `updateStatus` clears `closedAt` on reopen. ✓ (Task 4, 6)
- Single assignee + reassignment events; @mention notify-only → `assign` + `assigned`/`unassigned` events; mentions stored in join table, never touch `assignedTo`. ✓ (Task 7, 9)
- Flat labels only, admin-managed, no reasonCode → `csLabels`/`csCaseLabels`, `reasonCode` dropped. ✓ (Task 1, 11)
- Identity = customerId + customerName + externalThreadRef; email/phone removed → schema + DTO. ✓ (Task 1, 4)
- sourceChannel promoted to column. ✓ (Task 1, 4)
- Comments mutable: soft-delete, editedAt only, author-only → Task 10. ✓
- Attachments comment-level child table with csCaseId → `csCaseCommentAttachments` + Task 9. ✓
- cs_case_events is internal DB log, no Kafka, no notifications → no event-bus imports anywhere in the plan. ✓
- Timeline merges comments + events + business_links → Task 8. ✓

**Placeholder scan:** No "TBD"/"add validation"/"handle edge cases" left; every code step shows full code; every test step shows full test code and the exact run command + expected result.

**Type consistency:** `updateStatus(id, status, operatorId?)`, `assign(id, assigneeId|null, operatorId?)`, `addComment(caseId, dto, authorId)`, `editComment(commentId, dto, actorId)`, `deleteComment(commentId, actorId)`, `applyLabel(caseId, labelId, actorId)`, `removeLabel(caseId, labelId, actorId)`, `createLabel(dto)`, `listLabels()` — controller call sites in Task 12 match these signatures. Event types (`status_changed/assigned/unassigned/label_added/label_removed`) and payload shapes are identical across Tasks 6/7/11 and the timeline builder in Task 8. Table/export names match the locked list in Task 1.

**Known follow-ups (out of scope for this plan, intentionally):**
- Notifications + Kafka publishing (add publisher + consumer together in a later phase).
- `list()` currently returns cases without timeline (intended — detail view loads timeline). If the original `list()`/`createBusinessLink()` retained from the pre-existing service reference any removed column, fix them to the new shape during Task 5 Step 3 (they only touch `csCases` + `businessLinks`, which are unchanged in those code paths).
- Admin-web UI (assignee/mention pickers, label management, attachment uploader) lives in a separate `admin-web` plan.
