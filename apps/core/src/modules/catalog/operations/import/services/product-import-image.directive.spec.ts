import {
  extractDirectiveImageKeys,
  replaceDirectiveImageKeys,
} from './product-import-image.directive';

describe('extractDirectiveImageKeys', () => {
  it('본문의 imageKey 를 등장 순서로 뽑는다', () => {
    const md = '앞\n::product-image{imageKey="IMG-2" alt="상세"}\n뒤\n::product-image{imageKey="IMG-3"}';
    expect(extractDirectiveImageKeys(md)).toEqual(['IMG-2', 'IMG-3']);
  });

  it('같은 키가 여러 번 나와도 한 번만 돌려준다', () => {
    const md = '::product-image{imageKey="IMG-2"}\n::product-image{imageKey="IMG-2"}';
    expect(extractDirectiveImageKeys(md)).toEqual(['IMG-2']);
  });

  it('속성 순서가 달라도 찾는다', () => {
    expect(extractDirectiveImageKeys('::product-image{alt="a" imageKey="IMG-9"}')).toEqual(['IMG-9']);
  });

  it('imageKey 가 없는 디렉티브(이미 fileId 인 것)는 무시한다', () => {
    const md = '::product-image{fileId="0193aaaa-bbbb-cccc-dddd-eeeeeeeeeeee" alt="x"}';
    expect(extractDirectiveImageKeys(md)).toEqual([]);
  });

  it('본문이 없으면 빈 배열', () => {
    expect(extractDirectiveImageKeys(undefined)).toEqual([]);
    expect(extractDirectiveImageKeys('')).toEqual([]);
  });

  it('다른 디렉티브는 건드리지 않는다', () => {
    expect(extractDirectiveImageKeys('::note{imageKey="IMG-1"}')).toEqual([]);
  });
});

describe('replaceDirectiveImageKeys', () => {
  it('imageKey 를 fileId 로 바꾸고 alt 는 보존한다', () => {
    const md = '::product-image{imageKey="IMG-2" alt="상세컷"}';
    const out = replaceDirectiveImageKeys(md, new Map([['IMG-2', '0193aaaa-bbbb-cccc-dddd-eeeeeeeeeeee']]));
    expect(out).toBe('::product-image{fileId="0193aaaa-bbbb-cccc-dddd-eeeeeeeeeeee" alt="상세컷"}');
  });

  it('같은 키가 여러 번 나오면 전부 바꾼다', () => {
    const md = '::product-image{imageKey="IMG-2"}\nx\n::product-image{imageKey="IMG-2"}';
    const out = replaceDirectiveImageKeys(md, new Map([['IMG-2', 'f-1']]));
    expect(out).toBe('::product-image{fileId="f-1"}\nx\n::product-image{fileId="f-1"}');
  });

  it('맵에 없는 키는 그대로 둔다', () => {
    const md = '::product-image{imageKey="IMG-7"}';
    expect(replaceDirectiveImageKeys(md, new Map())).toBe(md);
  });

  it('본문에 디렉티브가 없으면 원문 그대로', () => {
    expect(replaceDirectiveImageKeys('그냥 설명', new Map([['IMG-1', 'f-1']]))).toBe('그냥 설명');
  });
});
