import { describeError } from './errors';

describe('describeError', () => {
  it('drizzle 쿼리 오류는 원인(postgres) 메시지만 — 쿼리 params 에 든 번호를 찍지 않는다', () => {
    const error = Object.assign(new Error('Failed query: insert into "sms_tracked_links" …\nparams: +821000000001,u1'), {
      cause: new Error('duplicate key value violates unique constraint "sms_tracked_links_pkey"'),
    });

    expect(describeError(error)).toBe('duplicate key value violates unique constraint "sms_tracked_links_pkey"');
  });

  it('원인이 없으면 params 앞까지만', () => {
    expect(describeError(new Error('Failed query: select 1\nparams: +821000000001'))).toBe('Failed query: select 1');
  });

  it('보통 오류는 메시지 그대로', () => {
    expect(describeError(new Error('템플릿에 링크가 없습니다'))).toBe('템플릿에 링크가 없습니다');
    expect(describeError('x')).toBe('x');
  });
});
