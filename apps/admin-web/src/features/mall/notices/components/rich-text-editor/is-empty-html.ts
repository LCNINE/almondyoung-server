/**
 * 에디터 본문이 비었는지 판정한다.
 * Tiptap 의 빈 본문은 `getHTML()` 이 '<p></p>' 를 반환하므로 단순 trim 으로는 빈값 판정이 안 된다.
 * 텍스트도 없고 이미지도 없으면 빈 본문으로 본다(이미지만 있는 본문은 유효).
 */
export function isEmptyHtml(html: string): boolean {
  if (!html) return true;
  if (html.includes('<img')) return false;
  return (
    html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim() === ''
  );
}
