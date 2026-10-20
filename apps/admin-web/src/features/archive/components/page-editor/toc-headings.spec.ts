import { collectHeadings } from './toc-headings';

it('collects headings in order, including nested ones, and skips empty titles', () => {
  const heading = (id: string, level: number, text: string, children = []) => ({
    id,
    type: 'heading',
    props: { level },
    content: [{ type: 'text', text }],
    children,
  });

  expect(
    collectHeadings([
      heading('a', 2, '왜 추가해야 하나요?'),
      { id: 'p', type: 'paragraph', content: [{ type: 'text', text: '본문' }] },
      {
        id: 't',
        type: 'toggleListItem',
        content: [],
        children: [heading('b', 3, '1단계') as never],
      },
      heading('c', 2, '   '),
    ])
  ).toEqual([
    { id: 'a', level: 2, text: '왜 추가해야 하나요?' },
    { id: 'b', level: 3, text: '1단계' },
  ]);
});
