export type PageRangeItem = number | '...';

export function getPageRange(
  currentPage: number,
  pageCount: number,
  delta = 2
): PageRangeItem[] {
  if (pageCount <= 1) return [1];

  const middle: PageRangeItem[] = [];
  for (
    let i = Math.max(2, currentPage - delta);
    i <= Math.min(pageCount - 1, currentPage + delta);
    i++
  ) {
    middle.push(i);
  }

  const range: PageRangeItem[] =
    currentPage - delta > 2 ? [1, '...'] : [1];
  range.push(...middle);
  if (currentPage + delta < pageCount - 1) {
    range.push('...', pageCount);
  } else {
    range.push(pageCount);
  }

  return range;
}
