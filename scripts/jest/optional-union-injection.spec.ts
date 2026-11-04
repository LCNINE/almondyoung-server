import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

const root = join(__dirname, '../..');

// 고치면 DB 없이 no-op 이던 트래킹 쓰기가 켜진다. 따로 판단할 때까지 현재 동작을 고정한다.
const KNOWN = [
  'libs/events/src/tracking/event-trace.reader.ts dbService',
  'libs/events/src/tracking/event-tracking.service.ts dbService',
];

function unsafeParameters(fileName: string, content: string): string[] {
  const source = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isConstructorDeclaration(node)) {
      for (const parameter of node.parameters) {
        const decorators = (ts.getDecorators(parameter) ?? []).map((decorator) => decorator.expression.getText(source));
        const optional = decorators.includes('Optional()');
        const injected = decorators.some((decorator) => /^(Inject|InjectQueue)\(/.test(decorator));
        let type = parameter.type;

        while (type && ts.isParenthesizedTypeNode(type)) type = type.type;

        if (optional && !injected && type && ts.isUnionTypeNode(type)) {
          const line = source.getLineAndCharacterOfPosition(parameter.getStart(source)).line + 1;
          violations.push(`${fileName}:${line} ${parameter.name.getText(source)}`);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(source);

  return violations;
}

it('optional union constructor parameters in apps and libs require an explicit injection token', () => {
  expect(
    unsafeParameters('fixture.ts', 'class X { constructor(@Optional() service: Service | null) {} }'),
  ).toHaveLength(1);
  expect(
    unsafeParameters('fixture.ts', 'class X { constructor(@Optional() @Inject(Service) service: Service | null) {} }'),
  ).toEqual([]);
  expect(
    unsafeParameters('fixture.ts', "class X { constructor(@Optional() @InjectQueue('jobs') queue: Queue | null) {} }"),
  ).toEqual([]);

  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'apps', 'libs'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => /^(apps\/[^/]+\/src\/|libs\/)/.test(file) && /\.tsx?$/.test(file));
  const violations = files.flatMap((file) => {
    const content = readFileSync(join(root, file), 'utf8');

    return content.includes('@Optional') ? unsafeParameters(file, content) : [];
  });

  expect(violations.map((v) => v.replace(/:\d+ /, ' '))).toEqual(KNOWN);
});

it('transpile-only core output explicitly requires ProductMatchingService', () => {
  const configPath = join(root, 'apps/core/tsconfig.app.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, join(root, 'apps/core'));
  const fileName = join(root, 'apps/core/src/modules/catalog/core/products/services/product-masters.service.ts');
  const output = ts.transpileModule(readFileSync(fileName, 'utf8'), {
    fileName,
    compilerOptions: parsed.options,
  }).outputText;

  expect(config.error).toBeUndefined();
  expect(parsed.errors).toEqual([]);
  expect(output).toMatch(/__param\(7, .*\.Inject\)\(.*\.forwardRef\)\(\(\) => .*\.ProductMatchingService\)\)\)/);
  expect(output).not.toMatch(/__param\(7, .*\.Optional/);
});
