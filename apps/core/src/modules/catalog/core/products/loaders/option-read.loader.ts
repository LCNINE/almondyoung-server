import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  DbTransaction,
  OptionGroupReadModel,
  OptionValueReadModel,
  VariantOptionValueReadModel,
} from '../../../catalog.types';
import {
  productMasterOptionGroups,
  productOptionGroups,
  productOptionGroupDisplays,
  productOptionValues,
  productOptionValueDisplays,
  variantOptionValues,
} from '../../../schema/catalog.schema';

@Injectable()
export class OptionReadLoader {
  async getOptionGroups(
    tx: DbTransaction,
    masterId: string,
    versionId: string,
    locale: string,
  ): Promise<OptionGroupReadModel[]> {
    const optionGroupResults = await tx
      .select({
        id: productOptionGroups.id,
        displayName: productOptionGroupDisplays.displayName,
        sortOrder: productOptionGroupDisplays.sortOrder,
        createdAt: productOptionGroups.createdAt,
      })
      .from(productMasterOptionGroups)
      .innerJoin(productOptionGroups, eq(productMasterOptionGroups.optionGroupId, productOptionGroups.id))
      .innerJoin(
        productOptionGroupDisplays,
        and(
          eq(productOptionGroups.id, productOptionGroupDisplays.optionGroupId),
          eq(productOptionGroupDisplays.masterId, masterId),
          eq(productOptionGroupDisplays.versionId, versionId),
          eq(productOptionGroupDisplays.locale, locale),
        ),
      )
      .where(and(eq(productMasterOptionGroups.masterId, masterId), eq(productMasterOptionGroups.versionId, versionId)))
      .orderBy(asc(productOptionGroupDisplays.sortOrder));

    const optionGroupIds = optionGroupResults.map((g) => g.id);

    if (optionGroupIds.length === 0) {
      return [];
    }

    const allValues = await tx
      .select({
        id: productOptionValues.id,
        optionGroupId: productOptionValues.optionGroupId,
        displayName: productOptionValueDisplays.displayName,
        sortOrder: productOptionValueDisplays.sortOrder,
        createdAt: productOptionValues.createdAt,
      })
      .from(productOptionValues)
      .innerJoin(
        productOptionValueDisplays,
        and(
          eq(productOptionValues.id, productOptionValueDisplays.optionValueId),
          eq(productOptionValueDisplays.masterId, masterId),
          eq(productOptionValueDisplays.versionId, versionId),
          eq(productOptionValueDisplays.locale, locale),
        ),
      )
      .where(inArray(productOptionValues.optionGroupId, optionGroupIds))
      .orderBy(asc(productOptionValues.optionGroupId), asc(productOptionValueDisplays.sortOrder));

    const valuesByGroup = new Map<string, OptionValueReadModel[]>();
    for (const v of allValues) {
      const list = valuesByGroup.get(v.optionGroupId) ?? [];
      list.push(v);
      valuesByGroup.set(v.optionGroupId, list);
    }

    return optionGroupResults.map((group) => ({
      ...group,
      values: valuesByGroup.get(group.id) ?? [],
    }));
  }

  async getVariantOptionValues(
    tx: DbTransaction,
    variantId: string,
    versionId: string,
    locale: string,
  ): Promise<VariantOptionValueReadModel[]> {
    const optionValues = await tx
      .select({
        id: productOptionValues.id,
        optionGroupId: productOptionValues.optionGroupId,
        optionGroupName: productOptionGroupDisplays.displayName,
        displayName: productOptionValueDisplays.displayName,
        sortOrder: productOptionValueDisplays.sortOrder,
        createdAt: productOptionValues.createdAt,
      })
      .from(variantOptionValues)
      .innerJoin(productOptionValues, eq(variantOptionValues.optionValueId, productOptionValues.id))
      .innerJoin(
        productOptionValueDisplays,
        and(
          eq(productOptionValues.id, productOptionValueDisplays.optionValueId),
          eq(productOptionValueDisplays.versionId, versionId),
          eq(productOptionValueDisplays.locale, locale),
        ),
      )
      .innerJoin(productOptionGroups, eq(productOptionValues.optionGroupId, productOptionGroups.id))
      .innerJoin(
        productOptionGroupDisplays,
        and(
          eq(productOptionGroups.id, productOptionGroupDisplays.optionGroupId),
          eq(productOptionGroupDisplays.versionId, versionId),
          eq(productOptionGroupDisplays.locale, locale),
        ),
      )
      .where(eq(variantOptionValues.variantId, variantId))
      .orderBy(asc(productOptionGroupDisplays.sortOrder), asc(productOptionValueDisplays.sortOrder));

    return optionValues;
  }
}
