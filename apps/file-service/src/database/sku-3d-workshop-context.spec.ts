import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILE_CONTEXTS, SKU_3D_WORKSHOP_CONTEXT_ID } from './default-file-contexts';

const context = FILE_CONTEXTS.find((ctx) => ctx.id === SKU_3D_WORKSHOP_CONTEXT_ID)!;

function glbHeader(): Buffer {
  const json = Buffer.from('{"asset":{"version":"2.0"}}  ');
  const header = Buffer.alloc(20);

  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.write('JSON', 16);

  return Buffer.concat([header, json]);
}

const DETECTOR = join(__dirname, '../shared/services/file-type-detector.service.ts');

// file-type 은 ESM 이라 jest 안에서는 판별이 null 로 떨어진다 — 판별기 스펙과 같이 자식 프로세스로 판별한다
function detect(buffer: Buffer): string | null {
  const file = join(mkdtempSync(join(tmpdir(), 'sku3d-ctx-')), 'f.bin');

  writeFileSync(file, buffer);

  const script = `
    const { FileTypeDetector } = require(${JSON.stringify(DETECTOR)});
    new FileTypeDetector().detectMimeType(require('node:fs').readFileSync(${JSON.stringify(file)}))
      .then((m) => process.stdout.write('###' + JSON.stringify(m ?? null)));
  `;
  const stdout = execFileSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  return JSON.parse(stdout.slice(stdout.indexOf('###') + 3)) as string | null;
}

// 업로드는 파일 내용으로 판별한 MIME 을 검사한다 — 워커 산출물이 판별되는 값이 허용 목록에 있어야 한다
describe('sku-3d-workshop file context', () => {
  jest.setTimeout(60_000);

  it('is private only', () => {
    expect(context).toMatchObject({ allowPublic: false, allowPrivate: true });
  });

  it.each([
    ['blend', Buffer.concat([Buffer.from('BLENDER-v405REND'), Buffer.alloc(4096)])],
    ['glb', glbHeader()],
    ['png', Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex')],
  ])('accepts detected %s', (_name, buffer) => {
    const detected = detect(buffer);

    expect(detected).toBeTruthy();
    expect(context.allowedMimeTypes).toContain(detected);
  });
});
