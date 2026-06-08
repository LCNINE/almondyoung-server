import type {
  ProductOptionGroup,
  UpdateMasterVersionDto,
} from '../../../../../lib/services/products/products-detail.types';

export type ProductOptionsDetail = {
  source: 'master' | 'version';
  versionId: string | null;
  status: 'active' | 'inactive' | 'draft' | null;
  optionGroups: ProductOptionGroup[];
};

export type ProductOptionValueFormRow = {
  clientId: string;
  id: string | null;
  displayName: string;
  sortOrder: number;
};

export type ProductOptionGroupFormRow = {
  clientId: string;
  id: string | null;
  displayName: string;
  sortOrder: number;
  values: ProductOptionValueFormRow[];
};

export type ProductOptionsFormValues = {
  groups: ProductOptionGroupFormRow[];
};

export function canEditProductOptions(detail: ProductOptionsDetail): boolean {
  return (
    detail.source === 'version' &&
    detail.status === 'draft' &&
    Boolean(detail.versionId)
  );
}

function bySortOrder<T extends { sortOrder: number; displayName: string }>(
  a: T,
  b: T
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.displayName.localeCompare(b.displayName);
}

export function toProductOptionsFormValues(
  detail: Pick<ProductOptionsDetail, 'optionGroups'>
): ProductOptionsFormValues {
  return {
    groups: detail.optionGroups
      .map((group) => ({
        clientId: `existing-${group.id}`,
        id: group.id,
        displayName: group.displayName,
        sortOrder: group.sortOrder,
        values: group.values
          .map((value) => ({
            clientId: `existing-${value.id}`,
            id: value.id,
            displayName: value.displayName,
            sortOrder: value.sortOrder,
          }))
          .sort(bySortOrder),
      }))
      .sort(bySortOrder),
  };
}

export function createNewOptionGroup(
  existingGroups: ProductOptionGroupFormRow[]
): ProductOptionGroupFormRow {
  const sortOrder =
    existingGroups.reduce((max, group) => Math.max(max, group.sortOrder), 0) +
    1;

  return {
    clientId: `new-group-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    id: null,
    displayName: '',
    sortOrder,
    values: [createNewOptionValue([], 1)],
  };
}

export function createNewOptionValue(
  existingValues: ProductOptionValueFormRow[],
  fallbackSortOrder?: number
): ProductOptionValueFormRow {
  const sortOrder =
    fallbackSortOrder ??
    existingValues.reduce((max, value) => Math.max(max, value.sortOrder), 0) +
      1;

  return {
    clientId: `new-value-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    id: null,
    displayName: '',
    sortOrder,
  };
}

function trimDisplayName(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(message);
  }
  return trimmed;
}

function normalizeGroup(group: ProductOptionGroupFormRow) {
  const displayName = trimDisplayName(
    group.displayName,
    '옵션 그룹명은 비워둘 수 없습니다.'
  );
  const values = group.values.map((value) => ({
    ...value,
    displayName: trimDisplayName(
      value.displayName,
      '옵션 값명은 비워둘 수 없습니다.'
    ),
  }));

  if (values.length === 0) {
    throw new Error('옵션 값은 최소 1개 이상 필요합니다.');
  }

  return {
    ...group,
    displayName,
    values,
  };
}

function sortOptionGroups(groups: ProductOptionGroup[]): ProductOptionGroup[] {
  return groups
    .map((group) => ({
      ...group,
      values: [...group.values].sort(bySortOrder),
    }))
    .sort(bySortOrder);
}

export function toProductOptionsUpdateDto(
  currentGroups: ProductOptionGroup[],
  values: ProductOptionsFormValues
): UpdateMasterVersionDto {
  const current = sortOptionGroups(currentGroups);
  const currentById = new Map(current.map((group) => [group.id, group]));
  const normalizedGroups = values.groups.map(normalizeGroup);
  const remainingExistingGroupIds = new Set(
    normalizedGroups
      .map((group) => group.id)
      .filter((id): id is string => Boolean(id))
  );

  const optionDiff: NonNullable<UpdateMasterVersionDto['optionDiff']> = {};

  for (const group of normalizedGroups) {
    if (!group.id) {
      optionDiff.add ??= [];
      optionDiff.add.push({
        displayName: group.displayName,
        sortOrder: group.sortOrder,
        values: group.values.map((value) => ({
          displayName: value.displayName,
          sortOrder: value.sortOrder,
        })),
      });
      continue;
    }

    const originalGroup = currentById.get(group.id);
    if (!originalGroup) continue;

    const currentValueById = new Map(
      originalGroup.values.map((value) => [value.id, value])
    );
    const remainingExistingValueIds = new Set(
      group.values
        .map((value) => value.id)
        .filter((id): id is string => Boolean(id))
    );
    const modifiedValues = group.values
      .filter((value) => {
        if (!value.id) return false;
        const originalValue = currentValueById.get(value.id);
        return (
          originalValue &&
          (value.displayName !== originalValue.displayName ||
            value.sortOrder !== originalValue.sortOrder)
        );
      })
      .map((value) => ({
        optionValueId: value.id as string,
        displayName: value.displayName,
        sortOrder: value.sortOrder,
      }));

    const groupDisplayChanged =
      group.displayName !== originalGroup.displayName ||
      group.sortOrder !== originalGroup.sortOrder;

    if (groupDisplayChanged || modifiedValues.length > 0) {
      optionDiff.modifyDisplay ??= [];
      optionDiff.modifyDisplay.push({
        optionGroupId: group.id,
        displayName: group.displayName,
        sortOrder: group.sortOrder,
        ...(modifiedValues.length > 0 ? { values: modifiedValues } : {}),
      });
    }

    const addedValues = group.values
      .filter((value) => !value.id)
      .map((value) => ({
        displayName: value.displayName,
        sortOrder: value.sortOrder,
      }));

    if (addedValues.length > 0) {
      optionDiff.addValues ??= [];
      optionDiff.addValues.push({
        optionGroupId: group.id,
        values: addedValues,
      });
    }

    const removedValueIds = originalGroup.values
      .filter((value) => !remainingExistingValueIds.has(value.id))
      .map((value) => value.id);

    if (removedValueIds.length > 0) {
      optionDiff.removeValues ??= [];
      optionDiff.removeValues.push({
        optionGroupId: group.id,
        optionValueIds: removedValueIds,
      });
    }
  }

  const removedGroupIds = current
    .filter((group) => !remainingExistingGroupIds.has(group.id))
    .map((group) => group.id);

  if (removedGroupIds.length > 0) {
    optionDiff.remove = removedGroupIds;
  }

  return { optionDiff };
}
