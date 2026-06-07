import { collapseTree } from './collapse';
import type { MasterVersionDto, VersionStatus } from '@/lib/types/dto/products';

function version({
  id,
  version: versionNumber,
  status,
  children = [],
}: {
  id: string;
  version: number;
  status: VersionStatus;
  children?: MasterVersionDto[];
}): MasterVersionDto {
  return {
    id,
    masterId: 'master-1',
    version: versionNumber,
    status,
    name: `Version ${versionNumber}`,
    parentVersionId: null,
    children,
    createdAt: `2026-01-0${versionNumber}T00:00:00.000Z`,
    updatedAt: `2026-01-0${versionNumber}T00:00:00.000Z`,
    draftOwnerId: null,
  };
}

describe('collapseTree', () => {
  it('includes draft versions by default', () => {
    const draft = version({ id: 'draft-2', version: 2, status: 'draft' });
    const active = version({
      id: 'active-1',
      version: 1,
      status: 'active',
      children: [draft],
    });

    const result = collapseTree([active]);

    expect(result.visibleVersions.map((v) => v.id)).toEqual(['active-1', 'draft-2']);
    expect(result.edges).toEqual([{ source: 'active-1', target: 'draft-2' }]);
  });

  it('keeps draft versions in collapsed linear chains', () => {
    const inactiveLeaf = version({ id: 'inactive-5', version: 5, status: 'inactive' });
    const draftMiddle = version({
      id: 'draft-4',
      version: 4,
      status: 'draft',
      children: [inactiveLeaf],
    });
    const inactiveMiddle = version({
      id: 'inactive-3',
      version: 3,
      status: 'inactive',
      children: [draftMiddle],
    });
    const draftHead = version({
      id: 'draft-2',
      version: 2,
      status: 'draft',
      children: [inactiveMiddle],
    });
    const activeRoot = version({
      id: 'active-1',
      version: 1,
      status: 'active',
      children: [draftHead],
    });

    const result = collapseTree([activeRoot]);

    expect(result.visibleVersions.map((v) => v.id)).toEqual(['active-1', 'inactive-5']);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].versions.map((v) => [v.id, v.status])).toEqual([
      ['draft-2', 'draft'],
      ['inactive-3', 'inactive'],
      ['draft-4', 'draft'],
    ]);
    expect(result.edges).toEqual([
      { source: 'active-1', target: 'group:active-1->inactive-5' },
      { source: 'group:active-1->inactive-5', target: 'inactive-5' },
    ]);
  });
});
