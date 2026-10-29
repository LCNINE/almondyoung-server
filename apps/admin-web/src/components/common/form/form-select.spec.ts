import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormSelect } from './form-select';

// radix 는 닫힌 목록의 항목을 서버 렌더에서 그리지 않는다 — 구조만 보도록 얇은 태그로 바꾼다
jest.mock('@/components/ui/select', () => {
  const tag = (name: string) => ({ children }: { children?: ReactNode }) =>
    require('react').createElement(name, null, children);
  return {
    Select: tag('select-root'),
    SelectTrigger: tag('trigger'),
    SelectValue: tag('value'),
    SelectContent: tag('content'),
    SelectGroup: tag('group'),
    SelectLabel: tag('label'),
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) =>
      require('react').createElement('item', { value }, children),
  };
});

const html = (options: { value: string; label: string; group?: string }[]) =>
  renderToStaticMarkup(createElement(FormSelect, { options }));

describe('FormSelect', () => {
  it('renders without groups as a flat list', () => {
    expect(html([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }])).toContain(
      '<content><item value="a">A</item><item value="b">B</item></content>',
    );
  });

  it('renders grouped options under their label', () => {
    expect(
      html([
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', group: '다른 직원' },
      ]),
    ).toContain(
      '<content><item value="a">A</item><group><label>다른 직원</label><item value="b">B</item></group></content>',
    );
  });
});
