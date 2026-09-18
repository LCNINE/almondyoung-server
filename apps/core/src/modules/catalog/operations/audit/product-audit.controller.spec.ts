import { PATH_METADATA } from '@nestjs/common/constants';
import { ProductAuditController } from './product-audit.controller';

it('상품별 이력(:masterId)은 고정 경로보다 뒤에 선언된다', () => {
  const proto = ProductAuditController.prototype;
  const paths: string[] = Object.getOwnPropertyNames(proto)
    .map((key) => Reflect.getMetadata(PATH_METADATA, Object.getOwnPropertyDescriptor(proto, key)?.value ?? {}))
    .filter((path) => typeof path === 'string');

  expect(paths.at(-1)).toBe(':masterId');
  expect(paths.filter((path) => path.startsWith(':'))).toEqual([':masterId']);
});
