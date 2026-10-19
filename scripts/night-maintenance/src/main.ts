import { AdminApi, ApiError } from './api';
import { CloudLoadProbe } from './cloud-load';
import { ReadonlyDatabases, secretJson } from './database';
import { assertHealthy, LoadSnapshot, pacedDelay } from './health';
import { assertWriteWindow, jobWindow } from './policy';
import { RunControls } from './ports';
import { ProductProposal, ProductVersion, runProducts } from './products';
import { ReviewManifest, runReviews } from './reviews';
import { S3StateStore } from './storage';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

async function main(): Promise<void> {
  const kind = required('JOB_KIND');
  if (!['reviews', 'products'].includes(kind)) throw new Error('Unknown job kind');
  const region = required('AWS_REGION');
  const date = required('RUN_DATE');
  const dryRun = process.env.DRY_RUN !== 'false';
  const window = jobWindow(date, kind);
  if (!dryRun) assertWriteWindow(window, new Date());
  if (!process.env.ECS_CONTAINER_METADATA_URI_V4) throw new Error('This entry point requires an ECS task runtime');

  const operationId = required('OPERATION_ID');
  if (!/^[a-zA-Z0-9-]+$/.test(operationId)) throw new Error('Invalid operation ID');
  const store = new S3StateStore(required('ARTIFACT_BUCKET'), `runs/${operationId}/${kind}`, region);
  const reportKey = dryRun ? 'dry-run-report.json' : 'report.json';
  let lastLoad: LoadSnapshot | undefined;
  let runtimePhase = 'manifest';
  let lastVerifiedOperation: Record<string, unknown> | undefined;
  let databases: ReadonlyDatabases | undefined;
  let stopRequested = false;
  const startedAt = new Date().toISOString();
  process.once('SIGTERM', () => {
    stopRequested = true;
  });
  const log = (entry: Record<string, unknown>) => {
    lastVerifiedOperation = entry;
    console.log(JSON.stringify({ at: new Date().toISOString(), kind, ...entry }));
  };

  try {
    const manifest = await store.immutable<ReviewManifest | { updates: ProductProposal[]; held: unknown[] }>(
      required('INPUT_KEY'),
      required('INPUT_SHA256'),
    );
    runtimePhase = 'database-credentials';
    const credentials = await secretJson<{ username: string; password: string }>(region, required('DB_SECRET_ARN'));
    databases = new ReadonlyDatabases(
      required('DB_HOST'),
      Number(process.env.DB_PORT ?? 5432),
      credentials,
      required('DB_CA_FILE'),
    );
    runtimePhase = 'database-connect-and-lock';
    await databases.connect();
    const db = databases;
    runtimePhase = 'administrator-credentials';
    const admin = await secretJson<{ loginId: string; password: string }>(region, required('ADMIN_SECRET_ARN'));
    if (!admin.loginId || !admin.password) throw new Error('Missing administrator login credentials');
    const cloud = new CloudLoadProbe(region, required('CLUSTER_NAME'), JSON.parse(required('MONITORED_SERVICES')));
    const coreUrl = required('CORE_URL');
    const ugcUrl = required('UGC_URL');
    const canWrite = () => {
      if (stopRequested) return false;
      try {
        assertWriteWindow(window, new Date());
        return true;
      } catch {
        return false;
      }
    };
    let lastLoadLogAt = 0;
    const controls: RunControls = {
      dryRun,
      canWrite,
      log,
      checkWrite: async () => {
        assertWriteWindow(window, new Date());
        if (stopRequested) throw new Error('Maintenance stop requested');
        await db.assertLock();
        if (await store.read<{ stop?: boolean }>('control.json').then((value) => value?.stop))
          throw new Error('Maintenance stop marker set');
        assertWriteWindow(window, new Date());
      },
      checkLoad: async () => {
        const load = { ...(await db.load()), cpuPercent: await cloud.cpu() };
        lastLoad = load;
        assertHealthy(load);
        if (Date.now() - lastLoadLogAt >= 60000) {
          log({ phase: 'load-check', load, cpuPolicy: 'pace-without-cpu-abort' });
          lastLoadLogAt = Date.now();
        }
      },
      sleep: async (ms) => {
        const remaining = Date.parse(window.endsAt) - Date.now();
        if (remaining <= 0) return;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(pacedDelay(ms, lastLoad?.cpuPercent ?? 0), remaining)),
        );
      },
    };
    const api = new AdminApi({
      loginUrl: `${required('USER_SERVICE_URL')}/auth/signin`,
      loginId: admin.loginId,
      password: admin.password,
      allowedOrigins: [coreUrl, ugcUrl],
      dryRun,
      checkWrite: async (url, method) => {
        await controls.checkWrite();
        await controls.checkLoad();
        if (kind === 'reviews' && method === 'DELETE') {
          const id = new URL(url).pathname.split('/').pop()!;
          const approved = (manifest as ReviewManifest).targets.find((target) => target.id === id);
          const row = await db.review(id);
          if (
            !approved ||
            !row ||
            row.deletedAt ||
            row.provider !== 'admin' ||
            row.status !== 'active' ||
            row.rating !== approved.rating ||
            row.productId !== approved.productId
          ) {
            throw new Error('Review scope changed before API request');
          }
        }
        await db.assertLock();
        assertWriteWindow(window, new Date());
      },
    });
    runtimePhase = 'administrator-login';
    await api.login();
    const principal = api.principal();
    if (
      !principal.roles.some((role) => ['master', 'admin'].includes(role)) &&
      !principal.scopes.includes('admin:ugc:modify')
    )
      throw new Error('Administrator authorization not established');
    await store.write('runtime-probe.json', {
      at: startedAt,
      ecs: true,
      databaseReadOnly: true,
      credentialsSource: 'task-role-and-secrets-manager',
    });

    runtimePhase = 'execute-and-verify';
    let result: Record<string, unknown>;
    if (kind === 'reviews') {
      const input = manifest as ReviewManifest;
      if (
        input.expected.count !== 3662 ||
        input.expected.rating2 !== 767 ||
        input.expected.rating3 !== 2895 ||
        input.expected.products !== 619 ||
        input.targets.some((row) => !uuid.test(row.id) || !uuid.test(row.productId))
      ) {
        throw new Error('Review manifest is outside the approved operation');
      }
      await api.request(`${ugcUrl}/reviews/admin/reviews?limit=1`);
      result = await runReviews(input, {
        ...controls,
        store,
        repository: { eligible: () => db.eligibleReviews(), find: (id) => db.review(id) },
        deleteReview: async (id) => (await api.request(`${ugcUrl}/reviews/admin/reviews/${id}`, 'DELETE')).status,
        verifyStatistics: async (productIds) => {
          const expected = new Map((await db.reviewCounts(productIds)).map((row) => [row.productId, row]));
          for (let index = 0; index < productIds.length; index += 50) {
            const ids = productIds.slice(index, index + 50);
            const response = await api.request<{
              summaries: Array<{ productId: string; totalCount: number; averageRating: number }>;
            }>(`${ugcUrl}/reviews/rating-summaries?productIds=${ids.join(',')}`);
            if (response.data.summaries.length !== ids.length) throw new Error('Review aggregate API omitted products');
            for (const row of response.data.summaries) {
              const source = expected.get(row.productId) ?? { reviewCount: 0, averageRating: 0 };
              if (row.totalCount !== source.reviewCount || Math.abs(row.averageRating - source.averageRating) > 0.01) {
                throw new Error('Review aggregate API does not match database');
              }
            }
          }
        },
      });
    } else {
      const input = manifest as { updates: ProductProposal[]; held: unknown[] };
      if (input.updates.some((row) => !uuid.test(row.masterId) || !uuid.test(row.expectedActiveVersionId))) {
        throw new Error('Invalid product proposal identifiers');
      }
      result = await runProducts(input.updates, {
        ...controls,
        store,
        api: {
          current: async (id) => (await api.request<ProductVersion>(`${coreUrl}/masters/${id}`)).data,
          draft: async (id, draftId) =>
            (await api.request<ProductVersion>(`${coreUrl}/masters/${id}/versions/${draftId}`)).data,
          create: async (id, parentVersionId) =>
            (
              await api.request<ProductVersion>(`${coreUrl}/masters/${id}/versions`, 'POST', {
                parentVersionId,
                copyMappings: true,
              })
            ).data,
          update: async (id, draftId, productInfo) =>
            (await api.request<ProductVersion>(`${coreUrl}/masters/${id}/versions/${draftId}`, 'PUT', { productInfo }))
              .data,
          publish: async (id, versionId, expectedActiveVersionId) => {
            const response = await api.request<{ origin?: string }>(
              `${coreUrl}/masters/${id}/versions/${versionId}/publish`,
              'PATCH',
              { origin: 'bulk_import', expectedActiveVersionId },
            );
            if (response.data.origin !== 'bulk_import') throw new Error('Server did not acknowledge bulk publication');
          },
        },
      });
      result.held = input.held;
    }

    const report = {
      ...result,
      kind,
      dryRun,
      startedAt,
      finishedAt: new Date().toISOString(),
      window,
      notificationDelivery: 'not-configured',
      load: lastLoad,
      cpuPolicy: 'pace-without-cpu-abort',
    };
    await store.write(reportKey, report);
    log({ phase: 'finished', ...report });
    if (result.status === 'partial') process.exitCode = 2;
  } catch (error) {
    const failure = {
      status: 'failed',
      kind,
      dryRun,
      startedAt,
      finishedAt: new Date().toISOString(),
      phase: runtimePhase,
      lastVerifiedOperation,
      durableStatePrefix: `runs/${operationId}/${kind}`,
      load: lastLoad,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      httpStatus: error instanceof ApiError ? error.status : undefined,
      // Never serialize raw login, HTTP response, database config or AWS credential errors.
      reason:
        error instanceof ApiError || (error instanceof Error && error.constructor === Error)
          ? error.message
          : 'External service failure; consult phase and errorName',
    };
    await store.write(reportKey, failure).catch(() => log({ phase: 'report-storage-failed' }));
    log(failure);
    process.exitCode = 1;
  } finally {
    await databases?.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      phase: 'startup-failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      reason: error instanceof Error && error.constructor === Error ? error.message : undefined,
    }),
  );
  process.exitCode = 1;
});
