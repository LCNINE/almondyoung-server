import {
  formatVersionLifecycleError,
  getVersionLifecycleActions,
  getVersionLifecycleDeleteSuccessHref,
} from './version-lifecycle-actions-model';

describe('version lifecycle actions model', () => {
  it('exposes publish and delete draft actions for draft version detail views', () => {
    expect(
      getVersionLifecycleActions({
        source: 'version',
        status: 'draft',
        versionId: 'ver-draft',
      })
    ).toEqual({
      canPublish: true,
      canDeleteDraft: true,
    });

    expect(
      getVersionLifecycleActions({
        source: 'master',
        status: 'active',
        versionId: null,
      })
    ).toEqual({
      canPublish: false,
      canDeleteDraft: false,
    });
  });

  it('exposes publish but not delete draft actions for inactive version detail views', () => {
    expect(
      getVersionLifecycleActions({
        source: 'version',
        status: 'inactive',
        versionId: 'ver-inactive',
      })
    ).toEqual({
      canPublish: true,
      canDeleteDraft: false,
    });
  });

  it('routes draft delete success to the product list instead of active detail', () => {
    expect(getVersionLifecycleDeleteSuccessHref()).toBe('/mall/products-list');
  });

  it('formats backend validation errors from common response shapes', () => {
    expect(
      formatVersionLifecycleError({
        response: {
          message: 'Publish validation failed',
          errors: [
            'variantCode duplicates active variants',
            { message: 'price calculation failed' },
          ],
        },
      })
    ).toEqual({
      title: 'Publish validation failed',
      details: [
        'variantCode duplicates active variants',
        'price calculation failed',
      ],
    });

    expect(
      formatVersionLifecycleError({
        response: {
          message: ['name should not be empty', 'base price is missing'],
        },
      })
    ).toEqual({
      title: '발행할 수 없습니다.',
      details: ['name should not be empty', 'base price is missing'],
    });

    expect(formatVersionLifecycleError(new Error('Network failed'))).toEqual({
      title: 'Network failed',
      details: [],
    });
  });

  it('splits newline-separated Core publish validation messages into details', () => {
    expect(
      formatVersionLifecycleError({
        response: {
          message:
            'Invalid calculated prices: \n' +
            'Variant variant-1: price calculation failed - missing rule\n' +
            'Variant variant-2: membership price is -100 (must be >= 0)',
        },
      })
    ).toEqual({
      title: 'Invalid calculated prices:',
      details: [
        'Variant variant-1: price calculation failed - missing rule',
        'Variant variant-2: membership price is -100 (must be >= 0)',
      ],
    });
  });
});
