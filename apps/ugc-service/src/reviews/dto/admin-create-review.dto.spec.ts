import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminCreateReviewDto } from './create-review.dto';

const valid = {
  productId: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  authorName: '홍길동',
  writtenAt: '2026-09-01T00:00:00+09:00',
  rating: 5,
  content: '향이 좋아요.',
};

async function check(input: Record<string, unknown>) {
  const dto = plainToInstance(AdminCreateReviewDto, input);
  const errors = await validate(dto);
  return { dto, failed: errors.map((e) => e.property) };
}

describe('AdminCreateReviewDto', () => {
  it('정상 입력은 통과한다', async () => {
    expect((await check(valid)).failed).toEqual([]);
  });

  it('작성자명은 앞뒤 공백을 걷어서 받는다', async () => {
    const { dto, failed } = await check({ ...valid, authorName: '  홍길동 ' });
    expect(failed).toEqual([]);
    expect(dto.authorName).toBe('홍길동');
  });

  it.each([['   '], [''], ['가'.repeat(101)]])('작성자명 %j 는 거절한다', async (authorName) => {
    expect((await check({ ...valid, authorName })).failed).toEqual(['authorName']);
  });

  it('작성자명 100자는 통과한다', async () => {
    expect((await check({ ...valid, authorName: '가'.repeat(100) })).failed).toEqual([]);
  });

  it.each([['   '], [''], ['\n\t']])('본문 %j 는 거절한다', async (content) => {
    expect((await check({ ...valid, content })).failed).toEqual(['content']);
  });

  it.each([[0], [6], [4.5], ['5']])('별점 %j 는 거절한다', async (rating) => {
    expect((await check({ ...valid, rating })).failed).toEqual(['rating']);
  });

  it.each([['2026-09-01'], ['2026-09-01T00:00:00'], ['not-a-date'], ['2026-02-30T00:00:00+09:00']])(
    '오프셋 없는·잘못된 작성 시각 %j 는 거절한다',
    async (writtenAt) => {
      expect((await check({ ...valid, writtenAt })).failed).toEqual(['writtenAt']);
    },
  );

  it('UTC 표기(Z)는 통과한다', async () => {
    expect((await check({ ...valid, writtenAt: '2026-08-31T15:00:00.000Z' })).failed).toEqual([]);
  });

  it('상품 ID 는 UUID 여야 한다', async () => {
    expect((await check({ ...valid, productId: 'prod_01ABC' })).failed).toEqual(['productId']);
  });

  it('미디어는 5장까지', async () => {
    const five = Array.from({ length: 5 }, () => randomUUID());
    expect((await check({ ...valid, mediaFileIds: five })).failed).toEqual([]);
    expect((await check({ ...valid, mediaFileIds: [...five, randomUUID()] })).failed).toEqual(['mediaFileIds']);
  });
});
