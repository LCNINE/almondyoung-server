import { maskAuthorName } from './mask-author-name';

describe('maskAuthorName', () => {
  it.each([
    ['', ''],
    ['홍', '홍'],
    ['홍길', '홍*'],
    ['홍길동', '홍**'],
    ['홍길동님', '홍***님'],
    ['abcde', 'a***e'],
    ['홍*동', '홍*동'],
    ['ab***', 'ab***'],
  ])('%p -> %p', (input, expected) => {
    expect(maskAuthorName(input)).toBe(expected);
  });
});
