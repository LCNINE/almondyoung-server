import { NotFoundException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { QnaService } from './qna.service';

describe('QnaService.getQuestion — 삭제된 문의', () => {
  const deletedQuestion = { id: 'q1', userId: 'u1', isSecret: false, deletedAt: new Date('2026-10-20T00:00:00Z') };

  // 조회 조건에 삭제 제외가 들어 있으면 DB 처럼 삭제된 행을 돌려주지 않는다.
  function makeService() {
    const dialect = new PgDialect();
    const tx = {
      select: () => ({
        from: () => ({
          where: (cond: SQL) => {
            const { sql } = dialect.sqlToQuery(cond);
            const rows = sql.includes('"deleted_at" is null') ? [] : [deletedQuestion];
            return Object.assign(Promise.resolve(rows), { orderBy: () => Promise.resolve([]) });
          },
        }),
      }),
    };
    const service = new QnaService({ db: { transaction: (fn: (t: unknown) => unknown) => fn(tx) } } as never, {} as never);
    jest.spyOn(service as never, 'fetchMediaFileIdsByQuestionIds').mockResolvedValue(new Map() as never);
    jest.spyOn(service as never, 'fetchAnswersByQuestionIds').mockResolvedValue(new Map() as never);
    return service;
  }

  it('관리자는 삭제된 문의 상세를 연다 — 목록의 삭제됨 필터에서 들어온다', async () => {
    const question = await makeService().getQuestion('q1', null, true);
    expect(question.deletedAt).toEqual(deletedQuestion.deletedAt);
  });

  it('고객에게 삭제된 문의는 없는 문의다', async () => {
    await expect(makeService().getQuestion('q1', 'u1', false)).rejects.toBeInstanceOf(NotFoundException);
  });
});
