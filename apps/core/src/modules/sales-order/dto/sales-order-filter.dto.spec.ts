import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SalesOrderFilterDto } from './sales-order-filter.dto';

describe('SalesOrderFilterDto.channels', () => {
  it.each([
    { input: ' naver, ,coupang, ', expected: ['naver', 'coupang'] },
    { input: [' naver ', '', ' coupang '], expected: ['naver', 'coupang'] },
    { input: ['medusa,naver', 'coupang,3pl'], expected: ['medusa', 'naver', 'coupang', '3pl'] },
    { input: 'naver', expected: ['naver'] },
    { input: ' , ', expected: [] },
    { input: [], expected: [] },
    { input: undefined, expected: undefined },
  ])('$input 를 채널 목록으로 변환한다', ({ input, expected }) => {
    const dto = plainToInstance(SalesOrderFilterDto, { channels: input });

    expect(dto.channels).toEqual(expected);
    expect(validateSync(dto)).toEqual([]);
  });

  it.each([
    { channels: 'naver,invalid' },
    { channels: ['coupang', 'invalid'] },
    { channels: ['naver', 123] },
    { channels: 123 },
    { channels: { channel: 'naver' } },
  ])('잘못된 채널 값 %j 는 거절한다', ({ channels }) => {
    const dto = plainToInstance(SalesOrderFilterDto, { channels });

    expect(validateSync(dto).map((error) => error.property)).toEqual(['channels']);
  });

  it('기존 channel 과 channels 를 함께 받는다', () => {
    const dto = plainToInstance(SalesOrderFilterDto, { channel: 'medusa', channels: 'naver,coupang' });

    expect(dto.channel).toBe('medusa');
    expect(dto.channels).toEqual(['naver', 'coupang']);
    expect(validateSync(dto)).toEqual([]);
  });

  it('기존 단일 채널의 검증을 유지한다', () => {
    expect(validateSync(plainToInstance(SalesOrderFilterDto, { channel: 'naver' }))).toEqual([]);
    expect(
      validateSync(plainToInstance(SalesOrderFilterDto, { channel: 'invalid' })).map((error) => error.property),
    ).toEqual(['channel']);
  });
});
