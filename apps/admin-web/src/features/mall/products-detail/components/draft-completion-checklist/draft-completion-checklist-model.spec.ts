import {
  getDraftCompletionChecklistItems,
  shouldShowDraftCompletionChecklist,
} from './draft-completion-checklist-model';

describe('draft completion checklist model', () => {
  it('shows only for draft version detail views', () => {
    expect(
      shouldShowDraftCompletionChecklist({
        source: 'version',
        status: 'draft',
        versionId: 'ver-draft',
      }),
    ).toBe(true);

    expect(
      shouldShowDraftCompletionChecklist({
        source: 'master',
        status: 'active',
        versionId: null,
      }),
    ).toBe(false);

    expect(
      shouldShowDraftCompletionChecklist({
        source: 'version',
        status: 'active',
        versionId: 'ver-active',
      }),
    ).toBe(false);

    expect(
      shouldShowDraftCompletionChecklist({
        source: 'version',
        status: 'inactive',
        versionId: 'ver-inactive',
      }),
    ).toBe(false);
  });

  it('builds advisory checklist items with a pricing deep link for the same draft version', () => {
    const items = getDraftCompletionChecklistItems({
      masterId: 'master-1',
      versionId: 'ver-draft',
    });

    expect(items.map((item) => item.id)).toEqual([
      'basic-information',
      'images',
      'options-and-variants',
      'pricing-rules',
      'publish-readiness',
    ]);

    expect(items.find((item) => item.id === 'pricing-rules')?.href).toBe(
      '/mall/pricing/master-1?versionId=ver-draft',
    );

    expect(items.every((item) => item.state === 'advisory')).toBe(true);
    expect(items.every((item) => item.blocksPublish === false)).toBe(true);
    expect(items.every((item) => item.href.length > 0)).toBe(true);
  });
});
