import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * AI 어시스턴트의 대화 기록.
 *
 * user-service 에 있던 것을 그대로 옮겼다. 원래는 `users.id` 를 FK 로 걸었으나,
 * 논리 DB 가 갈리면 FK 를 못 건다 — userId 는 IdP 가 발급한 sub 를 그대로 담는
 * 값일 뿐이고, 그 사용자가 실재하는지는 JWT 검증이 이미 보증한다.
 *
 * cascade 가 없는 그 자리는 `UserPermanentDeletedConsumer` 가 메운다.
 */
export const assistantChatSessions = pgTable(
  'assistant_chat_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    /** 목록에 보여줄 이름. 첫 사용자 발화에서 따온다. */
    title: text('title'),
    /**
     * 오래된 턴을 접어 둔 요약. 대화는 매 턴 통째로 모델에 다시 실리므로, 길어지면
     * 입력 토큰이 선형으로 는다. 여기 접어 두고 그 뒤 메시지만 실으면 상한이 생긴다.
     */
    summary: text('summary'),
    /**
     * 어느 메시지까지 요약에 들어갔는가. 이 시각 이하의 메시지는 모델에 싣지 않는다.
     *
     * 메시지 id 가 아니라 시각인 이유 — 복원은 createdAt 순서로 읽으므로 경계도 같은
     * 축이어야 한다. id 로 두면 그 메시지를 찾는 조회가 한 번 더 필요하다.
     */
    summarizedThrough: timestamp('summarized_through', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_assistant_sessions_user').on(table.userId, table.updatedAt),
    index('idx_assistant_sessions_deleted_at').on(table.deletedAt),
  ],
);

export const assistantChatMessages = pgTable(
  'assistant_chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => assistantChatSessions.id, { onDelete: 'cascade' }),
    /**
     * 대화에서 누가 말했나. 권한 역할(admin·master)이 아니다 — 이름이 같아 헷갈리지만
     * 이건 모델 API 의 메시지 규약이고 값은 'user' | 'assistant' 뿐이다.
     * 'user' 는 사람이 한 말이라는 뜻이지, 그 사람이 일반 회원이라는 뜻이 아니다.
     *
     * 대화의 주인은 assistant_chat_sessions.user_id 로만 식별한다.
     * 권한은 JWT 에 실려 오고 여기 저장하지 않는다.
     */
    role: varchar('role', { length: 20 }).notNull(),
    content: text('content'),
    /**
     * 모델에게 그대로 되돌려줄 수 있는 원본 메시지(도구 호출·결과 포함).
     * 텍스트만 남기면 이전 턴에 받은 fileId 같은 것이 사라져 대화를 이어갈 수 없다.
     */
    contentBlocks: jsonb('content_blocks').$type<unknown[]>(),
    /** 이 턴에 실제로 실행된 도구. 무엇을 했는지 훑어보는 용도. */
    toolCalls: jsonb('tool_calls').$type<unknown[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_assistant_messages_session').on(table.sessionId, table.createdAt)],
);

/**
 * 어시스턴트가 file-service 에 올린 파일. 상품에 붙지 못한 것을 수거하려고 남긴다.
 *
 * 대화 기록만으로는 부족하다 — 오래된 턴은 요약으로 접히고 탈퇴 회원의 대화는 지워지는데,
 * 그때 fileId 를 잃으면 S3 객체가 영구히 남는다.
 *
 * 세션에 FK 를 걸지 않는다. 대화가 지워진 뒤에도 파일은 계속 수거 대상이어야 한다.
 */
export const assistantUploadedFiles = pgTable(
  'assistant_uploaded_files',
  {
    fileId: uuid('file_id').primaryKey(),
    sessionId: uuid('session_id'),
    contextId: varchar('context_id', { length: 50 }).notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    /** 미참조로 판정해 file-service 에 soft delete 를 요청한 시각. */
    releasedAt: timestamp('released_at', { withTimezone: true }),
    /**
     * 자동으로는 더 못 고치는 상태가 된 시각. 수거 큐에서 빠지고 기록만 남는다.
     *
     * 이 표시가 없으면 되살릴 수 없는 행이 매 주기 배치 앞자리를 차지해, 정작 지워야
     * 할 파일이 영원히 밀린다.
     */
    stuckAt: timestamp('stuck_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_assistant_uploaded_files_uploaded_at').on(table.uploadedAt),
    index('idx_assistant_uploaded_files_released_at').on(table.releasedAt),
  ],
);

export const aiTables = {
  assistantChatSessions,
  assistantChatMessages,
  assistantUploadedFiles,
} as const;

export const aiSchema = { ...aiTables } as const;

export type AiSchema = typeof aiSchema;
