import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as JSZip from 'jszip';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SNIFF_WINDOW = 4100;
const SERVICE = join(__dirname, 'file-type-detector.service.ts');

/**
 * `.xlsx` 는 zip 컨테이너다. `file-type` 은 엔트리를 훑다가 `[Content_Types].xml` 을 만나야
 * 일반 zip 이 아니라 xlsx 라고 확정하는데, **그 엔트리의 위치가 만든 도구마다 다르다**:
 *
 * - exceljs·Excel — 맨 앞에 쓴다
 * - **openpyxl — 맨 뒤에 쓴다**
 *
 * 그래서 앞부분만 잘라 넘기면 openpyxl 산출물이 `application/zip` 으로 떨어지고 업로드가
 * `Invalid file type` 400 으로 거부된다. `skills/product-bulk-form` 의 `write_form.py` 가
 * openpyxl 로 쓰므로 그 스킬이 만든 양식은 크기와 무관하게 전부 여기에 걸렸다 —
 * `[Content_Types].xml` 이 항상 파일 끝에 오기 때문이다.
 */
async function buildWorkbook({ contentTypesLast }: { contentTypesLast: boolean }): Promise<Buffer> {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>`;

  // 압축 후에도 판별 창(4100B)을 넘기려면 앞쪽 엔트리가 커야 한다. 잘 압축되는 반복
  // 문자열로는 창을 못 넘기므로 값이 매번 다른 내용을 쓴다.
  const rows = Array.from({ length: 9000 }, (_, i) => `<c r="A${i}"><v>${i * 7919}</v></c>`).join('');

  const zip = new JSZip();
  const addBody = () => {
    zip.file('docProps/app.xml', '<?xml version="1.0"?><Properties/>');
    zip.file('docProps/core.xml', '<?xml version="1.0"?><cp:coreProperties xmlns:cp="x"/>');
    zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`);
    zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook/>');
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships/>');
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships/>');
  };

  if (contentTypesLast) {
    addBody();
    zip.file('[Content_Types].xml', contentTypes);
  } else {
    zip.file('[Content_Types].xml', contentTypes);
    addBody();
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * **jest 안에서는 이 서비스를 직접 부를 수 없다.** `file-type` 은 순수 ESM 이고 `exports` 맵에
 * `require` 조건이 없어, jest 의 CJS 리졸버가 `Cannot find module 'file-type'` 로 실패한다.
 * 서비스는 그 예외를 삼키고 `null` 을 돌려주므로, 직접 부르면 **무엇을 넣든 null 이 나와**
 * 테스트가 아무것도 지키지 못한 채 통과한다.
 *
 * 그래서 별도 Node 프로세스에서 실제 서비스를 돌린다 — `form-export.skill-interop.spec.ts`
 * 가 python 을 부르는 것과 같은 방식이다. 런타임(Node 22)은 ESM 을 문제없이 읽는다.
 */
function detectViaChildProcess(files: string[]): (string | null)[] {
  const script = `
    const { FileTypeDetector } = require(${JSON.stringify(SERVICE)});
    const { readFileSync } = require('node:fs');
    const detector = new FileTypeDetector();
    (async () => {
      const out = [];
      for (const f of ${JSON.stringify(files)}) out.push(await detector.detectMimeType(readFileSync(f)));
      process.stdout.write('###' + JSON.stringify(out));
    })();
  `;
  const stdout = execFileSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  const parsed: unknown = JSON.parse(stdout.slice(stdout.indexOf('###') + 3));
  if (!Array.isArray(parsed)) throw new Error(`자식 프로세스가 배열을 내놓지 않았습니다: ${stdout}`);
  return parsed.map((mime) => (typeof mime === 'string' ? mime : null));
}

describe('FileTypeDetector', () => {
  // ts-node 로 자식 프로세스를 띄우므로 기본 5초로는 모자라다.
  jest.setTimeout(60_000);

  it('워크북을 만든 도구가 [Content_Types].xml 을 어디에 두든 xlsx 로 판정한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'file-type-detector-'));
    const openpyxlLike = join(dir, 'openpyxl-order.xlsx');
    const exceljsLike = join(dir, 'exceljs-order.xlsx');

    const late = await buildWorkbook({ contentTypesLast: true });
    writeFileSync(openpyxlLike, late);
    writeFileSync(exceljsLike, await buildWorkbook({ contentTypesLast: false }));

    // 픽스처가 실제로 결함을 재현하는지 먼저 확인한다 — 단서가 판별 창 안에 들어와 버리면
    // 이 테스트는 아무것도 지키지 못한 채 통과한다.
    expect(late.indexOf(Buffer.from('[Content_Types].xml'))).toBeGreaterThan(SNIFF_WINDOW);

    expect(detectViaChildProcess([openpyxlLike, exceljsLike])).toEqual([XLSX_MIME, XLSX_MIME]);
  });
});
