import { ReviewExpected, ReviewTarget, validateReviewManifest } from './policy';
import { RunControls, StateStore } from './ports';

export interface ReviewManifest {
  targets: ReviewTarget[];
  expected: ReviewExpected;
}

export interface ReviewRow extends ReviewTarget {
  provider: string;
  status: string;
  deletedAt: string | null;
}

export interface ReviewDependencies extends RunControls {
  repository: {
    eligible(): Promise<ReviewRow[]>;
    find(id: string): Promise<ReviewRow | undefined>;
  };
  store: StateStore;
  deleteReview(id: string): Promise<number>;
  verifyStatistics?(productIds: string[]): Promise<void>;
}

interface ReviewProgress {
  done: Record<string, { httpStatus: number | null; recovered?: boolean }>;
  inFlightId?: string;
  pilotVerified: number;
  pilotCompleted?: boolean;
}

export async function runReviews(manifest: ReviewManifest, deps: ReviewDependencies) {
  validateReviewManifest(manifest.targets, manifest.expected);
  const approved = new Map(manifest.targets.map((row) => [row.id, row]));
  const progressKey = 'review-progress.json';
  const progress = (await deps.store.read<ReviewProgress>(progressKey)) ?? { done: {}, pilotVerified: 0 };

  if (
    Object.keys(progress.done).some((id) => !approved.has(id)) ||
    (progress.inFlightId && !approved.has(progress.inFlightId))
  ) {
    throw new Error('Stored review progress is outside approved scope');
  }

  if (progress.inFlightId) {
    const current = await deps.repository.find(progress.inFlightId);

    if (!current) throw new Error('In-flight review disappeared');
    if (current.deletedAt) {
      if (!progress.pilotCompleted) {
        throw new Error('Recovered pilot deletion has no HTTP status; operator reconciliation required');
      }
      progress.done[current.id] = { httpStatus: null, recovered: true };
      delete progress.inFlightId;
      if (!deps.dryRun) await deps.store.write(progressKey, progress);
    } else {
      throw new Error('Unresolved previous review deletion; operator reconciliation required');
    }
  }

  const live = await deps.repository.eligible();
  const remaining = manifest.targets.filter((row) => !progress.done[row.id]);
  const expectedLive = new Map(remaining.map((row) => [row.id, row]));

  if (
    live.length !== remaining.length ||
    live.some((row) => {
      const expected = expectedLive.get(row.id);

      return (
        !expected ||
        row.productId !== expected.productId ||
        row.rating !== expected.rating ||
        row.provider !== 'admin' ||
        row.status !== 'active' ||
        !!row.deletedAt
      );
    })
  ) {
    throw new Error('Live review scope differs from approved manifest and verified progress');
  }

  await deps.checkLoad();
  if (deps.dryRun)
    return { status: 'dry-run', deleted: Object.keys(progress.done).length, remaining: remaining.length };

  const verifyPilot = async () => {
    if (progress.pilotVerified < 5 || progress.pilotCompleted) return;
    const canaryIds = Object.keys(progress.done)
      .filter((id) => progress.done[id].httpStatus === 204)
      .slice(0, 5);
    const canaries = await Promise.all(canaryIds.map((id) => deps.repository.find(id)));

    if (canaries.length !== 5 || canaries.some((row) => !row?.deletedAt)) throw new Error('Five-review canary failed');
    await deps.checkLoad();
    await deps.verifyStatistics?.([...new Set(canaries.map((row) => row!.productId))]);
    progress.pilotCompleted = true;
    await deps.store.write(progressKey, progress);
  };

  await verifyPilot();

  for (const target of remaining) {
    if (!deps.canWrite()) break;
    await deps.checkWrite();
    await deps.checkLoad();
    const current = await deps.repository.find(target.id);

    if (
      !current ||
      current.provider !== 'admin' ||
      current.status !== 'active' ||
      current.deletedAt ||
      current.rating !== target.rating ||
      current.productId !== target.productId
    ) {
      throw new Error(`Review no longer matches approved scope: ${target.id}`);
    }

    progress.inFlightId = target.id;
    await deps.store.write(progressKey, progress);
    const httpStatus = await deps.deleteReview(target.id);
    const after = await deps.repository.find(target.id);

    if (httpStatus !== 204 || !after?.deletedAt) {
      throw new Error(`Review deletion did not verify HTTP 204 and deleted_at: ${target.id}`);
    }

    progress.done[target.id] = { httpStatus };
    progress.pilotVerified = Math.min(5, progress.pilotVerified + 1);
    delete progress.inFlightId;
    await deps.store.write(progressKey, progress);
    deps.log({ id: target.id, httpStatus, phase: 'soft-delete-verified' });

    await verifyPilot();

    await deps.sleep(200);
  }

  const finalEligible = await deps.repository.eligible();
  const outstanding = finalEligible.filter((row) => approved.has(row.id));

  if (finalEligible.some((row) => !approved.has(row.id))) throw new Error('New out-of-manifest review scope detected');

  await deps.verifyStatistics?.([
    ...new Set(manifest.targets.filter((row) => progress.done[row.id]).map((row) => row.productId)),
  ]);

  return {
    status: outstanding.length ? 'partial' : 'complete',
    deleted: Object.keys(progress.done).length,
    remaining: outstanding.length,
    sourceStatistics: deps.verifyStatistics ? 'verified' : 'not-verified',
    searchIndexPropagation: 'not-independently-verified',
  };
}
