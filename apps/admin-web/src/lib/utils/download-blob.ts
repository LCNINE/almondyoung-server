/**
 * blob 을 파일로 내려받는다.
 *
 * 파일명을 인자로 받는 이유: /api/proxy 가 응답을 arrayBuffer 로 되감으면서
 * Content-Disposition 을 넘기지 않아 서버가 지어준 파일명이 사라진다.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
