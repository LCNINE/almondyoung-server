import { PATH_METADATA } from '@nestjs/common/constants';
import { ProductAuditController } from './product-audit.controller';

it('상품별 이력(:masterId)은 고정 경로 뒤에 선언돼 recent 를 가리지 않는다', () => {
  const proto = ProductAuditController.prototype;
  const paths: string[] = Object.getOwnPropertyNames(proto)
    .map((key) => Reflect.getMetadata(PATH_METADATA, Object.getOwnPropertyDescriptor(proto, key)?.value ?? {}))
    .filter((path) => typeof path === 'string');

  expect(paths).toContain('recent');
  expect(paths.at(-1)).toBe(':masterId');
  expect(paths.filter((path) => path.startsWith(':'))).toEqual([':masterId']);
});
