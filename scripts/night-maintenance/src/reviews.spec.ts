import { runReviews, ReviewDependencies, ReviewManifest, ReviewRow } from './reviews';

function fixture() {
  const targets = Array.from({ length: 6 }, (_, index) => ({
    id: `id-${index}`,
    productId: `p-${index}`,
    rating: index % 2 ? 3 : 2,
  }));
  const rows: ReviewRow[] = targets.map((row) => ({ ...row, status: 'active', provider: 'admin', deletedAt: null }));
  let saved: unknown;
  const calls: string[] = [];
  const manifest: ReviewManifest = { targets, expected: { count: 6, rating2: 3, rating3: 3, products: 6 } };
  const dependencies: ReviewDependencies = {
    repository: {
      eligible: async () => rows.filter((row) => !row.deletedAt),
      find: async (id) => rows.find((row) => row.id === id),
    },
    store: {
      read: async <T>() => saved as T | undefined,
      write: async (_, value) => {
        saved = JSON.parse(JSON.stringify(value));
      },
    },
    deleteReview: async (id) => {
      calls.push(id);
      rows.find((row) => row.id === id)!.deletedAt = '2026-10-16T17:00:00Z';
      return 204;
    },
    checkWrite: async () => {},
    checkLoad: async () => {},
    canWrite: () => true,
    sleep: async () => {},
    log: () => {},
    dryRun: false,
  };

  return { manifest, dependencies, rows, calls, saved: () => saved };
}

describe('scoped review cleanup', () => {
  it('dry-run validates exact scope and never calls DELETE', async () => {
    const f = fixture();
    f.dependencies.dryRun = true;
    expect(await runReviews(f.manifest, f.dependencies)).toMatchObject({ status: 'dry-run', remaining: 6 });
    expect(f.calls).toEqual([]);
  });

  it('rejects an added eligible review before issuing any DELETE', async () => {
    const f = fixture();
    f.rows.push({ ...f.rows[0], id: 'not-approved' });
    await expect(runReviews(f.manifest, f.dependencies)).rejects.toThrow('scope');
    expect(f.calls).toEqual([]);
  });

  it('persists intent before deleting and verifies the five-review canary before continuing', async () => {
    const f = fixture();
    const original = f.dependencies.deleteReview;
    f.dependencies.deleteReview = async (id) => {
      expect(f.saved()).toMatchObject({ inFlightId: id });
      return original(id);
    };
    const checks: number[] = [];
    f.dependencies.checkLoad = async () => {
      checks.push(f.calls.length);
    };

    expect(await runReviews(f.manifest, f.dependencies)).toMatchObject({
      status: 'complete',
      deleted: 6,
      remaining: 0,
    });
    expect(checks).toContain(5);
    expect(f.rows.every((row) => !!row.deletedAt)).toBe(true);
  });

  it('stops if the API returns 204 without a persisted soft delete', async () => {
    const f = fixture();
    f.dependencies.deleteReview = async () => 204;
    await expect(runReviews(f.manifest, f.dependencies)).rejects.toThrow('deleted_at');
  });

  it('recovers a persisted in-flight deletion and resumes without deleting that ID again', async () => {
    const f = fixture();
    f.rows[0].deletedAt = '2026-10-16T17:00:00Z';
    await f.dependencies.store.write('review-progress.json', {
      done: {},
      inFlightId: 'id-0',
      pilotVerified: 5,
      pilotCompleted: true,
    });

    expect(await runReviews(f.manifest, f.dependencies)).toMatchObject({ status: 'complete', deleted: 6 });
    expect(f.calls).not.toContain('id-0');
  });

  it('stops when a recovered pilot lacks the required HTTP204 evidence', async () => {
    const f = fixture();
    f.rows[0].deletedAt = 'verified';
    await f.dependencies.store.write('review-progress.json', { done: {}, inFlightId: 'id-0', pilotVerified: 0 });

    await expect(runReviews(f.manifest, f.dependencies)).rejects.toThrow('Recovered pilot');
    await expect(runReviews(f.manifest, f.dependencies)).rejects.toThrow('Recovered pilot');
    expect(f.calls).toEqual([]);
  });

  it('never repeats an unresolved deletion after interruption', async () => {
    const f = fixture();
    await f.dependencies.store.write('review-progress.json', { done: {}, inFlightId: 'id-0', pilotVerified: 0 });

    await expect(runReviews(f.manifest, f.dependencies)).rejects.toThrow('Unresolved previous');
    expect(f.calls).toEqual([]);
  });

  it('verifies a persisted fifth deletion canary before issuing the sixth request', async () => {
    const f = fixture();
    const done = Object.fromEntries(
      f.rows.slice(0, 5).map((row) => {
        row.deletedAt = 'verified';
        return [row.id, { httpStatus: 204 }];
      }),
    );
    await f.dependencies.store.write('review-progress.json', { done, pilotVerified: 5 });
    let canaryChecked = false;
    f.dependencies.verifyStatistics = async () => {
      canaryChecked = true;
    };
    const original = f.dependencies.deleteReview;
    f.dependencies.deleteReview = async (id) => {
      expect(canaryChecked).toBe(true);
      return original(id);
    };

    expect(await runReviews(f.manifest, f.dependencies)).toMatchObject({ status: 'complete' });
  });

  it('refuses writes when durable intent cannot be stored', async () => {
    const f = fixture();
    f.dependencies.store.write = async () => {
      throw new Error('S3 unavailable');
    };
    await expect(runReviews(f.manifest, f.dependencies)).rejects.toThrow('S3 unavailable');
    expect(f.calls).toEqual([]);
  });

  it('reports partial progress at the deadline instead of claiming completion', async () => {
    const f = fixture();
    f.dependencies.canWrite = () => f.calls.length < 2;
    expect(await runReviews(f.manifest, f.dependencies)).toMatchObject({ status: 'partial', deleted: 2, remaining: 4 });
    expect(f.calls).toHaveLength(2);
  });
});
