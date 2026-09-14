import { z } from 'zod';

export const productAiDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000),
    seoTitle: z.string().trim().min(1).max(255),
    seoDescription: z.string().trim().min(1).max(500),
    seoKeywords: z.array(z.string().trim().min(1).max(80)).max(15),
    tags: z.array(z.string().trim().min(1).max(80)).max(15),
    thumbnailFileId: z.uuid().nullable(),
    additionalImageFileIds: z.array(z.uuid()).max(5),
    sections: z
      .array(
        z.union([
          z.object({ kind: z.literal('text'), heading: z.string().max(200), body: z.string().max(4000) }).strict(),
          z.object({ kind: z.literal('image'), fileId: z.uuid(), alt: z.string().max(300) }).strict(),
        ]),
      )
      .min(1)
      .max(30),
    pendingItems: z.array(z.string().max(300)).max(20),
  })
  .strict();

export type ProductAiDraft = z.infer<typeof productAiDraftSchema>;
export type ProductAiSavedProduct = { masterId: string; versionId: string; messageId: string };

export function draftImageIds(draft: ProductAiDraft): string[] {
  return [
    ...new Set([
      ...(draft.thumbnailFileId ? [draft.thumbnailFileId] : []),
      ...draft.additionalImageFileIds,
      ...draft.sections.flatMap((section) => (section.kind === 'image' ? [section.fileId] : [])),
    ]),
  ];
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );

// The model supplies text and attachment IDs, never executable HTML or arbitrary image URLs.
export function renderDraftHtml(draft: ProductAiDraft, imageUrls: Map<string, string>): string {
  return draft.sections
    .map((section) => {
      if (section.kind === 'text') {
        return `${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ''}<p>${escapeHtml(section.body).replace(/\n/g, '<br />')}</p>`;
      }
      const url = imageUrls.get(section.fileId);
      if (!url || !/^https?:\/\//.test(url)) throw new Error('상세페이지 이미지 주소를 확인해 주세요.');
      return `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(section.alt)}" style="max-width:100%;height:auto" /></figure>`;
    })
    .join('\n');
}
