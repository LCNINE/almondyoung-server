import { ConflictError, NotFoundError } from '@app/shared';
import { csCaseEvents, csCaseLabels, csCases, csLabels } from '../schema/customer-service.schema';
import { makeFakeDb } from '../__fixtures__/fake-db';
import { CsLabelsService } from './cs-labels.service';

const caseId = 'aaaaaaaa-0000-4000-8000-000000000001';
const labelId = 'bbbbbbbb-0000-4000-8000-000000000001';
const actorId = 'cccccccc-0000-4000-8000-000000000001';

function seedCaseAndLabel(label: Record<string, unknown> = {}) {
  const seed = new Map<unknown, any[]>();
  seed.set(csCases, [{ id: caseId, subject: 'x', status: 'open' }]);
  seed.set(csLabels, [{ id: labelId, name: '환불', isActive: true, ...label }]);
  return seed;
}

describe('CsLabelsService', () => {
  it('lists labels ordered for taxonomy consumers with a 500 row cap', async () => {
    const seed = new Map<unknown, any[]>();
    seed.set(
      csLabels,
      Array.from({ length: 501 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        name: `label-${index + 1}`,
        color: '#888888',
        isActive: true,
        sortOrder: index + 1,
      })),
    );
    const { db } = makeFakeDb(seed);
    const service = new CsLabelsService(db as any);

    const labels = await service.listLabels();

    expect(labels).toHaveLength(500);
    expect(labels[0].sortOrder).toBe(1);
    expect(labels[499].sortOrder).toBe(500);
  });

  it('creates an active label in the taxonomy with the default color', async () => {
    const { db, state } = makeFakeDb();
    const service = new CsLabelsService(db as any);

    const label = await service.createLabel({ name: '환불' });

    expect(label).toMatchObject({
      name: '환불',
      color: '#888888',
      isActive: true,
      sortOrder: 0,
    });
    expect(state.get(csLabels)).toHaveLength(1);
  });

  it('rejects duplicate label names', async () => {
    const seed = new Map<unknown, any[]>();
    seed.set(csLabels, [{ id: labelId, name: '환불', color: '#ff0000', isActive: true, sortOrder: 0 }]);
    const { db } = makeFakeDb(seed);
    const service = new CsLabelsService(db as any);

    await expect(service.createLabel({ name: '환불', color: '#00ff00' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('applies a label to a case and records a label_added event', async () => {
    const { db, state } = makeFakeDb(seedCaseAndLabel());
    const service = new CsLabelsService(db as any);

    const result = await service.applyLabel(caseId, labelId, actorId);

    expect(result).toMatchObject({ csCaseId: caseId, labelId });
    expect(state.get(csCaseLabels)).toHaveLength(1);
    expect(state.get(csCaseEvents)).toHaveLength(1);
    expect(state.get(csCaseEvents)[0]).toMatchObject({
      csCaseId: caseId,
      type: 'label_added',
      actorId,
      payload: { labelId, labelName: '환불' },
    });
  });

  it('returns the existing case-label without recording another event when already applied', async () => {
    const seed = seedCaseAndLabel();
    seed.set(csCaseLabels, [{ id: 'dddddddd-0000-4000-8000-000000000001', csCaseId: caseId, labelId }]);
    const { db, state } = makeFakeDb(seed);
    const service = new CsLabelsService(db as any);

    const result = await service.applyLabel(caseId, labelId, actorId);

    expect(result).toMatchObject({ id: 'dddddddd-0000-4000-8000-000000000001', csCaseId: caseId, labelId });
    expect(state.get(csCaseLabels)).toHaveLength(1);
    expect(state.get(csCaseEvents)).toHaveLength(0);
  });

  it('rejects applying a label to an unknown case', async () => {
    const seed = new Map<unknown, any[]>();
    seed.set(csLabels, [{ id: labelId, name: '환불', isActive: true }]);
    const { db } = makeFakeDb(seed);
    const service = new CsLabelsService(db as any);

    await expect(service.applyLabel(caseId, labelId, actorId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects applying an unknown label', async () => {
    const seed = new Map<unknown, any[]>();
    seed.set(csCases, [{ id: caseId, subject: 'x', status: 'open' }]);
    const { db } = makeFakeDb(seed);
    const service = new CsLabelsService(db as any);

    await expect(service.applyLabel(caseId, labelId, actorId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects applying an inactive label', async () => {
    const { db } = makeFakeDb(seedCaseAndLabel({ isActive: false }));
    const service = new CsLabelsService(db as any);

    await expect(service.applyLabel(caseId, labelId, actorId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('removes a label from a case and records a label_removed event', async () => {
    const seed = seedCaseAndLabel();
    seed.set(csCaseLabels, [{ id: 'dddddddd-0000-4000-8000-000000000001', csCaseId: caseId, labelId }]);
    const { db, state } = makeFakeDb(seed);
    const service = new CsLabelsService(db as any);

    await service.removeLabel(caseId, labelId, actorId);

    expect(state.get(csCaseLabels)).toHaveLength(0);
    expect(state.get(csCaseEvents)).toHaveLength(1);
    expect(state.get(csCaseEvents)[0]).toMatchObject({
      csCaseId: caseId,
      type: 'label_removed',
      actorId,
      payload: { labelId, labelName: '환불' },
    });
  });

  it('rejects removing an unknown label', async () => {
    const seed = new Map<unknown, any[]>();
    seed.set(csCases, [{ id: caseId, subject: 'x', status: 'open' }]);
    const { db } = makeFakeDb(seed);
    const service = new CsLabelsService(db as any);

    await expect(service.removeLabel(caseId, labelId, actorId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
