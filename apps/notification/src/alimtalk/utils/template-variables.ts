const VARIABLE = /#\{([^{}]+)\}/g;

export interface VariableSource {
  linkMo?: string | null;
  linkPc?: string | null;
}

/** 본문과 버튼 링크에 나오는 #{변수} 이름을 처음 나온 순서대로 한 번씩 뽑는다. NHN 은 버튼 이름은 치환하지 않는다. */
export function extractVariables(content: string, buttons: VariableSource[] = []): string[] {
  const texts = [content, ...buttons.flatMap((b) => [b.linkMo ?? '', b.linkPc ?? ''])];
  const names: string[] = [];
  for (const text of texts) {
    for (const match of text.matchAll(VARIABLE)) {
      const name = match[1].trim();
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/** 값이 없는 변수는 그대로 둔다 — 미리보기에서 빠진 자리가 보이게. */
export function renderVariables(content: string, values: Record<string, string>): string {
  return content.replace(VARIABLE, (whole, name: string) => values[name.trim()] ?? whole);
}

export type VariableBinding =
  | { name: string; source: 'RECIPIENT_NAME' }
  | { name: string; source: 'FIXED'; value: string };

/** 받는 사람마다 넣을 치환값. 받는 사람 이름 칸은 그 사람 이름으로, 나머지는 고정값으로 채운다. */
export function parametersFor(bindings: VariableBinding[], recipientName: string): Record<string, string> {
  return Object.fromEntries(bindings.map((b) => [b.name, b.source === 'RECIPIENT_NAME' ? recipientName : b.value]));
}

/** 템플릿이 요구하는데 값을 정하지 않은 변수, 고정값이 비어 있는 변수 */
export function missingVariables(required: string[], bindings: VariableBinding[]): string[] {
  return required.filter((name) => {
    const binding = bindings.find((b) => b.name === name);
    if (!binding) return true;
    return binding.source === 'FIXED' && binding.value.trim() === '';
  });
}
