/**
 * Prometheus 텍스트 형식에서 이름이 정확히 `name` 인 샘플 값을 라벨과 무관하게 더한다. 샘플이 없으면 0.
 * 줄 모양: `name{labels} value [timestamp]` — 값은 이름·라벨 바로 뒤의 칸이다.
 */
export function sumSamples(text: string, name: string): number {
  let total = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith(name)) continue;
    let rest = line.slice(name.length);
    if (rest.startsWith('{')) rest = rest.slice(rest.lastIndexOf('}') + 1);
    else if (!rest.startsWith(' ')) continue;
    const value = Number(rest.trim().split(/\s+/)[0]);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}
