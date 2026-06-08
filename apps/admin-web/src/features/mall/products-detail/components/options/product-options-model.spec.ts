import {
  canEditProductOptions,
  toProductOptionsFormValues,
  toProductOptionsUpdateDto,
} from './product-options-model';

describe('product options editing model', () => {
  const detail = {
    source: 'version' as const,
    versionId: 'ver-draft',
    status: 'draft' as const,
    optionGroups: [
      {
        id: 'grp-color',
        displayName: 'Color',
        sortOrder: 2,
        values: [
          {
            id: 'val-blue',
            optionGroupId: 'grp-color',
            displayName: 'Blue',
            sortOrder: 2,
          },
          {
            id: 'val-red',
            optionGroupId: 'grp-color',
            displayName: 'Red',
            sortOrder: 1,
          },
        ],
      },
      {
        id: 'grp-size',
        displayName: 'Size',
        sortOrder: 1,
        values: [],
      },
    ],
  };

  it('allows editing only for draft version detail views', () => {
    expect(canEditProductOptions(detail)).toBe(true);

    expect(
      canEditProductOptions({
        ...detail,
        source: 'master',
        versionId: null,
        status: 'active',
      })
    ).toBe(false);

    expect(
      canEditProductOptions({
        ...detail,
        source: 'version',
        versionId: 'ver-active',
        status: 'active',
      })
    ).toBe(false);

    expect(
      canEditProductOptions({
        ...detail,
        source: 'version',
        versionId: 'ver-inactive',
        status: 'inactive',
      })
    ).toBe(false);
  });

  it('normalizes current option groups and values into stable form rows', () => {
    expect(toProductOptionsFormValues(detail)).toEqual({
      groups: [
        {
          clientId: 'existing-grp-size',
          id: 'grp-size',
          displayName: 'Size',
          sortOrder: 1,
          values: [],
        },
        {
          clientId: 'existing-grp-color',
          id: 'grp-color',
          displayName: 'Color',
          sortOrder: 2,
          values: [
            {
              clientId: 'existing-val-red',
              id: 'val-red',
              displayName: 'Red',
              sortOrder: 1,
            },
            {
              clientId: 'existing-val-blue',
              id: 'val-blue',
              displayName: 'Blue',
              sortOrder: 2,
            },
          ],
        },
      ],
    });
  });

  it('builds an optionDiff for added groups, display edits, value additions, and removals', () => {
    const current = toProductOptionsFormValues(detail);

    expect(
      toProductOptionsUpdateDto(detail.optionGroups, {
        groups: [
          {
            ...current.groups[0],
            displayName: ' Size ',
            values: [
              {
                clientId: 'new-size-small',
                id: null,
                displayName: ' Small ',
                sortOrder: 1,
              },
            ],
          },
          {
            ...current.groups[1],
            displayName: ' Color Family ',
            values: [
              {
                ...current.groups[1].values[0],
                displayName: ' Crimson ',
              },
            ],
          },
          {
            clientId: 'new-grp-material',
            id: null,
            displayName: ' Material ',
            sortOrder: 3,
            values: [
              {
                clientId: 'new-material-cotton',
                id: null,
                displayName: ' Cotton ',
                sortOrder: 1,
              },
            ],
          },
        ],
      })
    ).toEqual({
      optionDiff: {
        add: [
          {
            displayName: 'Material',
            sortOrder: 3,
            values: [
              {
                displayName: 'Cotton',
                sortOrder: 1,
              },
            ],
          },
        ],
        modifyDisplay: [
          {
            optionGroupId: 'grp-color',
            displayName: 'Color Family',
            sortOrder: 2,
            values: [
              {
                optionValueId: 'val-red',
                displayName: 'Crimson',
                sortOrder: 1,
              },
            ],
          },
        ],
        addValues: [
          {
            optionGroupId: 'grp-size',
            values: [
              {
                displayName: 'Small',
                sortOrder: 1,
              },
            ],
          },
        ],
        removeValues: [
          {
            optionGroupId: 'grp-color',
            optionValueIds: ['val-blue'],
          },
        ],
      },
    });
  });

  it('builds an optionDiff for removed option groups', () => {
    const current = toProductOptionsFormValues(detail);

    expect(
      toProductOptionsUpdateDto(detail.optionGroups, {
        groups: [current.groups[1]],
      })
    ).toEqual({
      optionDiff: {
        remove: ['grp-size'],
      },
    });
  });

  it('requires every remaining group and value to have a display name', () => {
    expect(() =>
      toProductOptionsUpdateDto(detail.optionGroups, {
        groups: [
          {
            clientId: 'new-grp-empty',
            id: null,
            displayName: ' ',
            sortOrder: 1,
            values: [],
          },
        ],
      })
    ).toThrow('옵션 그룹명은 비워둘 수 없습니다.');

    expect(() =>
      toProductOptionsUpdateDto(detail.optionGroups, {
        groups: [
          {
            clientId: 'new-grp-size',
            id: null,
            displayName: 'Size',
            sortOrder: 1,
            values: [
              {
                clientId: 'new-val-empty',
                id: null,
                displayName: ' ',
                sortOrder: 1,
              },
            ],
          },
        ],
      })
    ).toThrow('옵션 값명은 비워둘 수 없습니다.');
  });

  it('requires every remaining option group to have at least one value', () => {
    const current = toProductOptionsFormValues(detail);

    expect(() =>
      toProductOptionsUpdateDto(detail.optionGroups, {
        groups: [
          {
            ...current.groups[1],
            values: [],
          },
        ],
      })
    ).toThrow('옵션 값은 최소 1개 이상 필요합니다.');

    expect(() =>
      toProductOptionsUpdateDto(detail.optionGroups, {
        groups: [
          {
            clientId: 'new-grp-material',
            id: null,
            displayName: 'Material',
            sortOrder: 1,
            values: [],
          },
        ],
      })
    ).toThrow('옵션 값은 최소 1개 이상 필요합니다.');
  });
});
