import { draftImageIds, productAiDraftSchema, renderDraftHtml } from './draft';

const id = '550e8400-e29b-41d4-a716-446655440000';
const draft = productAiDraftSchema.parse({
  name: '스티커',
  description: '',
  seoTitle: '고양이 스티커',
  seoDescription: '고양이 그림',
  seoKeywords: [],
  tags: [],
  thumbnailFileId: id,
  additionalImageFileIds: [id],
  pendingItems: [],
  sections: [
    { kind: 'text', heading: '<script>', body: 'A & B\n<img onerror="attack">' },
    { kind: 'image', fileId: id, alt: '" onerror="attack' },
  ],
});
it('escapes model text and attributes and deduplicates images across usages', () => {
  expect(draftImageIds(draft)).toEqual([id]);
  const html = renderDraftHtml(draft, new Map([[id, 'https://images.example/product.png']]));
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('A &amp; B<br />&lt;img');
  expect(html).toContain('alt="&quot; onerror=&quot;attack"');
  expect(html).not.toContain('<script>');
});
it('refuses missing images or executable URLs', () => {
  expect(() => renderDraftHtml(draft, new Map())).toThrow();
  expect(() => renderDraftHtml(draft, new Map([[id, 'javascript:alert(1)']]))).toThrow();
});
