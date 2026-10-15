import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { dead_letters, failure_actions } from './dead-letter.schema';

const ROOT = join(__dirname, '../../../..');
const SCHEMA_PATH = 'libs/events/src/dead-letter/dead-letter.schema.ts';

describe('event.dead_letters 스키마 (#1016 8번)', () => {
  it('켜는 앱(core·channel-adapter)의 drizzle config 에만 물린다', () => {
    const configs = ['core', 'channel-adapter', 'wallet', 'membership', 'analytics', 'file-service'];
    const holders = configs.filter((app) =>
      readFileSync(join(ROOT, `apps/${app}/drizzle.config.ts`), 'utf8').includes(SCHEMA_PATH),
    );
    expect(holders).toEqual(['core', 'channel-adapter']);
  });

  it('유일 키는 (consumer_group, handler, message_id) 다 — 재전달이 행을 늘리지 않는다', () => {
    const config = getTableConfig(dead_letters);
    const unique = config.indexes.find((index) => index.config.name === 'uq_dead_letters_group_handler_message');
    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.columns.map((column) => ('name' in column ? column.name : ''))).toEqual([
      'consumer_group',
      'handler',
      'message_id',
    ]);
  });

  it('두 테이블 모두 event 스키마에 있다', () => {
    expect(getTableConfig(dead_letters).schema).toBe('event');
    expect(getTableConfig(failure_actions).schema).toBe('event');
  });
});
