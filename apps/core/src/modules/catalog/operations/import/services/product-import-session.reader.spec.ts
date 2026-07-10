import { NotFoundError } from '@app/shared';
import { ProductImportSessionReader } from './product-import-session.reader';

/** 체이닝 select 를 흉내내는 최소 mock. 각 테스트가 결과 배열을 주입. */
function makeDb(rows: any[]) {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    offset: () => Promise.resolve(rows),
  };
  return { run: (fn: any, t?: any) => (t ? fn(t) : fn({ select: () => chain })) } as any;
}

describe('ProductImportSessionReader.getSession', () => {
  it('세션이 없으면 NotFoundError', async () => {
    const reader = new ProductImportSessionReader(makeDb([]));
    await expect(reader.getSession('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
