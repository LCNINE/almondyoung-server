import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DbTransaction, TagReadModel } from '../../../types';
import { productTagValues, tagValues, tagGroups } from '../../../schema';

@Injectable()
export class TagReadLoader {
  async getTags(
    tx: DbTransaction,
    masterId: string,
    versionId: string,
  ): Promise<TagReadModel[]> {
    const tagResults = await tx
      .select({
        tagValueId: productTagValues.tagValueId,
        tagValueName: tagValues.name,
        tagValueDisplayOrder: tagValues.displayOrder,
        tagGroupId: tagGroups.id,
        tagGroupName: tagGroups.name,
      })
      .from(productTagValues)
      .innerJoin(
        tagValues,
        eq(productTagValues.tagValueId, tagValues.id)
      )
      .innerJoin(
        tagGroups,
        eq(tagValues.groupId, tagGroups.id)
      )
      .where(
        and(
          eq(productTagValues.masterId, masterId),
          eq(productTagValues.versionId, versionId),
          eq(tagValues.isActive, true),
          eq(tagGroups.isActive, true)
        )
      )
      .orderBy(
        asc(tagGroups.displayOrder),
        asc(tagValues.displayOrder)
      );

    return tagResults.map(r => ({
      id: r.tagValueId,
      name: r.tagValueName,
      displayOrder: r.tagValueDisplayOrder,
      groupId: r.tagGroupId,
      groupName: r.tagGroupName,
    }));
  }
}
