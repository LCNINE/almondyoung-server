import { describe, expect, it } from 'vitest';
import { filePublicBase, publicFileUrl } from './publicFileUrl';

describe('publicFileUrl', () => {
  it('따로 준 주소를 끝 빗금 없이 쓴다', () => {
    expect(filePublicBase('http://localhost:3080/', 'http://localhost:3100')).toBe('http://localhost:3080');
  });

  it('주소가 없으면 core 도메인의 file 주소를 쓴다', () => {
    expect(filePublicBase(undefined, 'https://core.tenant-2.example')).toBe('https://file.tenant-2.example');
  });

  it('core 도메인이 아니면 사진 주소를 만들지 않는다', () => {
    expect(filePublicBase(undefined, 'http://localhost:3100')).toBeNull();
    expect(filePublicBase(undefined, '')).toBeNull();
    expect(publicFileUrl(null, 'f1')).toBeNull();
  });

  it('공개 파일 경로를 붙인다', () => {
    expect(publicFileUrl('https://file.tenant-2.example', 'f1')).toBe('https://file.tenant-2.example/files/public/f1');
  });
});
