import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * admin-web 이 이 폴더를 원본 그대로 가져가 빌드한다(`@pii-masking`).
 * 폴더 밖(Nest·드라이버 등)을 import 하면 브라우저 번들이 깨지므로 같은 폴더 안만 허용한다.
 */
describe('pii masking folder', () => {
  const files = readdirSync(__dirname).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

  it('finds the masking files', () => {
    expect(files).toEqual(expect.arrayContaining(['index.ts', 'mask.ts', 'response-paths.ts', 'pii-kinds.ts']));
  });

  it('imports nothing from outside the folder', () => {
    const outside = files.flatMap((f) =>
      [...readFileSync(join(__dirname, f), 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)]
        .map((m) => m[1])
        .filter((spec) => !spec.startsWith('./'))
        .map((spec) => `${f}: ${spec}`),
    );
    expect(outside).toEqual([]);
  });
});
