import { createImageKeyAllocator } from './form-export.types';

describe('createImageKeyAllocator', () => {
  it('처음 보는 fileId 마다 IMG-1 부터 번호를 준다', () => {
    const alloc = createImageKeyAllocator();
    expect(alloc.keyFor('f1')).toBe('IMG-1');
    expect(alloc.keyFor('f2')).toBe('IMG-2');
  });

  it('같은 fileId 는 같은 키를 돌려준다', () => {
    const alloc = createImageKeyAllocator();
    expect(alloc.keyFor('f1')).toBe('IMG-1');
    expect(alloc.keyFor('f1')).toBe('IMG-1');
  });

  it('seed 된 배정을 그대로 유지한다', () => {
    const alloc = createImageKeyAllocator({ 'IMG-3': 'f9' });
    expect(alloc.keyFor('f9')).toBe('IMG-3');
  });

  it('seed 의 최대 번호 뒤에서 새 키를 이어 붙인다', () => {
    const alloc = createImageKeyAllocator({ 'IMG-3': 'f9' });
    expect(alloc.keyFor('fnew')).toBe('IMG-4');
  });

  it('entries 는 할당된 전량을 (imageKey, fileId) 로 돌려준다', () => {
    const alloc = createImageKeyAllocator();
    alloc.keyFor('f1');
    alloc.keyFor('f2');
    expect(alloc.entries()).toEqual([
      { imageKey: 'IMG-1', fileId: 'f1' },
      { imageKey: 'IMG-2', fileId: 'f2' },
    ]);
  });
});
