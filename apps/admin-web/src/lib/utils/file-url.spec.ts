import { resolvePublicFileUrl } from './file-url';

describe('resolvePublicFileUrl', () => {
  it('프로토콜을 생략한 주소(//)는 file-service 경로로 감싸지 않는다', () => {
    expect(resolvePublicFileUrl('//almondyoung.com/a.png')).toBe('//almondyoung.com/a.png');
  });

  it('fileId 는 file-service 공개 경로가 된다', () => {
    expect(resolvePublicFileUrl('abc')).toMatch(/\/files\/public\/abc$/);
  });
});
