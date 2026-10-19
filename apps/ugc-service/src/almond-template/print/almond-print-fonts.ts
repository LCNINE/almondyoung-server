export type AlmondFontFormat = 'ttf' | 'otf' | 'woff' | 'woff2';

// 화면(FontFace)·인쇄(fontconfig) 가 같은 이름을 쓴다. fontconfig 패턴에서 '-' 는 크기 구분자라 넣지 않는다
export function almondFontFamily(fileId: string): string {
  return `AF${fileId.replace(/-/g, '').toLowerCase()}`;
}

export function extractAlmondFontFileIds(svg: string): string[] {
  const ids = [...svg.matchAll(/\bAF([0-9a-f]{32})\b/g)].map(
    ([, hex]) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  );
  return [...new Set(ids)];
}

export function sniffFontFormat(bytes: Buffer): AlmondFontFormat | null {
  if (bytes.length < 4) return null;
  const tag = bytes.subarray(0, 4).toString('latin1');
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'true' || bytes.readUInt32BE(0) === 0x00010000) return 'ttf';
  return null;
}

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 받은 글꼴을 파일 안의 이름과 무관하게 almondFontFamily 이름으로 등록한다
export function almondFontsConfig(fontDir: string, cacheDir: string, files: ReadonlyMap<string, string>): string {
  const rules = [...files]
    .map(
      ([family, path]) =>
        `<match target="scan"><test name="file"><string>${escapeXml(path)}</string></test>` +
        `<edit name="family" mode="assign_replace"><string>${family}</string></edit></match>`,
    )
    .join('\n');
  return `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
<include ignore_missing="yes">/etc/fonts/fonts.conf</include>
<dir>${escapeXml(fontDir)}</dir>
<cachedir>${escapeXml(cacheDir)}</cachedir>
${rules}
</fontconfig>
`;
}
