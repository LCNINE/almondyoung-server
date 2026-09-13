import { join } from 'path';
import { collectTsFiles, moduleSpecifiers, readCodeWithoutComments } from './arch-spec.helpers';

const KERNEL_DIR = join(__dirname, 'inbound', 'kernel');
const DOCUMENT_MODULES = /(^|\/)(procurement|warehouse-transfer)(\/|$)/;

/**
 * 입고 커널의 경계 (스펙 docs/superpowers/specs/2026-09-14-purchase-order-owns-receiving-design.md §3·§8).
 *
 * - 문서가 커널을 부르고, 커널은 문서를 부르지 않는다 — 의존은 문서 → 커널 한 방향.
 * - 커널은 트랜잭션을 스스로 열지 않는다 — 호출자의 tx 안에서만 돈다.
 * - 커널은 db.query 관계 API 를 쓰지 않는다(CLAUDE.md Inventory Query Rules).
 *
 * 첫 위반이 생기면 이 스펙보다 스펙 문서를 먼저 고칠 것.
 */
describe('inbound receipt kernel boundary (arch)', () => {
  const files = collectTsFiles(KERNEL_DIR);

  it('커널 파일이 있다 — 디렉터리가 옮겨지면 아래 단언이 빈 집합으로 통과하지 않게', () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it('커널은 procurement/ · warehouse-transfer/ 를 import 하지 않는다', () => {
    const violations = files.flatMap((file) =>
      moduleSpecifiers(file)
        .filter((s) => DOCUMENT_MODULES.test(s))
        .map((s) => `${file}: ${s}`),
    );
    expect(violations).toEqual([]);
  });

  it('커널은 트랜잭션을 스스로 열지 않는다 — DbService 주입·transaction() 호출이 없다', () => {
    const violations = files.filter((file) =>
      /\bDbService\b|InjectTypedDb|\.transaction\(/.test(readCodeWithoutComments(file)),
    );
    expect(violations).toEqual([]);
  });

  it('커널은 db.query 관계 API 를 쓰지 않는다', () => {
    const violations = files.filter((file) =>
      /\.query\.[A-Za-z]+\.find(First|Many)\(/.test(readCodeWithoutComments(file)),
    );
    expect(violations).toEqual([]);
  });
});
