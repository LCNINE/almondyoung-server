/**
 * textarea 커서 위치(selection)에 markdown 조각을 삽입한다.
 * selection 미지정 시 현재 문자열 끝에 append(개행 보정)한다.
 * DOM 비의존 순수 함수 — 호출부(overlay)에서 textarea selection 을 뽑아 전달.
 */
export function insertAtCursor(
  current: string,
  insert: string,
  selection?: { start: number; end: number },
): string {
  if (!selection) {
    const needsLeadingNewline = current.length > 0 && !current.endsWith('\n');
    return `${current}${needsLeadingNewline ? '\n' : ''}${insert}\n`;
  }

  const prefix = current.slice(0, selection.start);
  const suffix = current.slice(selection.end);
  const needsLeadingNewline = prefix.length > 0 && !prefix.endsWith('\n');
  const needsTrailingNewline = suffix.length > 0 && !suffix.startsWith('\n');
  return `${prefix}${needsLeadingNewline ? '\n' : ''}${insert}${needsTrailingNewline ? '\n' : ''}${suffix}`;
}
