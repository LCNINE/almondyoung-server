import { type InferInsertModel, type InferSelectModel, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/**
 * 정렬 키 전용 컬럼 — 반드시 이진(C) 콜레이션이어야 한다.
 *
 * 이 DB 의 기본 콜레이션은 `en_US.utf8` 이고, 거기서는 `'Zz' < 'a0'` 가 **거짓**이다
 * (대소문자를 1차 가중치에서 무시하므로 a 가 Z 보다 앞선다). 분수 인덱스는 대문자 구간을
 * «음수 쪽»으로 쓰므로, 기본 콜레이션에 두면 맨 앞으로 옮긴 페이지가 DB 정렬에서는 맨 뒤로
 * 가서 화면과 서버가 서로 다른 순서를 갖게 된다 — 조용히 어긋나는 종류의 버그다.
 * `COLLATE "C"` 로 못 박으면 바이트 순서가 보장되고 자바스크립트 문자열 비교와 정확히 일치한다.
 */
const sortKeyColumn = customType<{ data: string; driverData: string }>({
  dataType: () => 'varchar(64) COLLATE "C"',
});

/**
 * 아카이브(사내 문서) 스페이스.
 * - team: 로그인한 관리자 전원이 읽고 쓴다. ownerId 는 null.
 * - private: 작성자 본인만 접근한다. ownerId 가 그 사람이다.
 */
export type ArchiveSpace = 'team' | 'private';

/**
 * 본문 정본은 `content`(블록 JSON)다. `contentMarkdown` 은 내보내기·diff 용 파생이고
 * `searchText` 는 검색용 평문 파생이다 — 둘 다 정본에서 다시 만들 수 있어야 한다.
 *
 * 형제 순서는 `sortKey`(분수 인덱스 문자열)로 잡는다. 정수 순번을 쓰면 한 번 옮길 때마다
 * 형제 전원을 다시 써야 하고 동시 이동이 서로를 덮는다 — sort-key.ts 의 주석 참고.
 */
export const archivePages = pgTable(
  'archive_pages',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    // 상위 페이지가 영구 삭제되면 하위도 함께 사라져야 한다. 트리에 끊긴 가지를 남기지 않는다.
    parentId: uuid('parent_id').references((): AnyPgColumn => archivePages.id, {
      onDelete: 'cascade',
    }),
    space: varchar('space', { length: 16 }).$type<ArchiveSpace>().notNull().default('team'),
    ownerId: uuid('owner_id'),
    title: varchar('title', { length: 255 }).notNull().default(''),
    icon: varchar('icon', { length: 32 }),
    coverUrl: text('cover_url'),
    content: jsonb('content')
      .notNull()
      .default(sql`'[]'::jsonb`),
    contentMarkdown: text('content_markdown').notNull().default(''),
    searchText: text('search_text').notNull().default(''),
    sortKey: sortKeyColumn('sort_key').notNull(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_archive_pages_parent').on(t.parentId, t.sortKey),
    // 사이드바가 그리는 «한 스페이스의 살아있는 페이지 전체»를 그대로 덮는 부분 인덱스.
    index('idx_archive_pages_space_alive')
      .on(t.space, t.ownerId, t.sortKey)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_archive_pages_deleted_at').on(t.deletedAt),
    index('idx_archive_pages_updated_at').on(t.updatedAt),
    // 스페이스는 두 값뿐이다. 애플리케이션만 믿지 않고 DB 에서도 막는다.
    check('ck_archive_pages_space', sql`${t.space} IN ('team', 'private')`),
    // 개인 문서는 반드시 주인이 있고, 팀 문서는 주인이 없다 — 둘이 어긋나면 권한 판정이 갈라진다.
    check('ck_archive_pages_owner', sql`(${t.space} = 'private') = (${t.ownerId} IS NOT NULL)`),
  ],
);

/**
 * 저장 시점 스냅샷. 자동 저장마다 남기면 폭증하므로 서비스가 간격·작성자 기준으로 솎아낸다.
 */
export const archivePageVersions = pgTable(
  'archive_page_versions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    pageId: uuid('page_id')
      .notNull()
      .references(() => archivePages.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull().default(''),
    content: jsonb('content')
      .notNull()
      .default(sql`'[]'::jsonb`),
    contentMarkdown: text('content_markdown').notNull().default(''),
    authorId: uuid('author_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_archive_page_versions_page').on(t.pageId, t.createdAt)],
);

export const archivePageFavorites = pgTable(
  'archive_page_favorites',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    pageId: uuid('page_id')
      .notNull()
      .references(() => archivePages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_archive_page_favorites').on(t.pageId, t.userId),
    index('idx_archive_page_favorites_user').on(t.userId),
  ],
);

export const archiveSchema = {
  archivePages,
  archivePageVersions,
  archivePageFavorites,
};

export type ArchivePage = InferSelectModel<typeof archivePages>;
export type NewArchivePage = InferInsertModel<typeof archivePages>;
export type ArchivePageVersion = InferSelectModel<typeof archivePageVersions>;
export type ArchivePageFavorite = InferSelectModel<typeof archivePageFavorites>;
