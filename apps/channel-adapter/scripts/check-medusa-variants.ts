// ========================================================================
// PIMCLIENT: MIGRATION SCRIPT ONLY
// ========================================================================
// This script is allowed to use PimClient for direct PIM API access.
// This is an exception to the MSA boundary rule and should ONLY be used for:
// - One-time data migration/backfill operations
// - Administrative/debugging tasks
// - NOT for regular operational code
// ========================================================================

import { MedusaClient } from '../src/adapters/medusa/medusa.client';
import { PimClient } from '../src/adapters/medusa/pim.client';

class EnvConfigService {
  get<T = any>(propertyPath: string): T | undefined {
    return process.env[propertyPath] as T | undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getOrThrow<T = any>(propertyPath: string): T {
    const value = this.get<T>(propertyPath);
    if (value === undefined || value === null) {
      throw new Error(`Missing env: ${propertyPath}`);
    }
    return value;
  }
}

type CheckResult = {
  masterId: string;
  pimVariants: number;
  medusaVariants: number;
  medusaProductId?: string;
  status: 'ok' | 'missing' | 'variant_mismatch' | 'pim_error' | 'medusa_error';
  error?: string;
};

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const executing: Promise<void>[] = [];

  const enqueue = async (): Promise<void> => {
    if (index >= items.length) return;
    const currentIndex = index++;
    const p = worker(items[currentIndex], currentIndex)
      .then((res) => {
        results[currentIndex] = res;
      })
      .catch((err) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        results[currentIndex] = err as any;
      })
      .then(() => {
        executing.splice(executing.indexOf(p), 1);
      });
    executing.push(p);
    let pending = executing;
    if (executing.length >= limit) {
      pending = [Promise.race(executing)];
    }
    await Promise.all(pending);
    return enqueue();
  };

  await enqueue();
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const deleteMismatched = args.includes('--delete');
  const resyncAfterDelete = args.includes('--resync');
  const concurrencyArg = args.find((a) => a.startsWith('--concurrency='));
  const limit = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : 5;
  const offsetArg = args.find((a) => a.startsWith('--offset='));
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const sliceOffset = offsetArg ? parseInt(offsetArg.split('=')[1], 10) : 0;
  const sliceLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

  const config = new EnvConfigService();
  const pim = new PimClient(config as any);
  const medusa = new MedusaClient(config as any);

  console.log(`Checking Medusa vs PIM variants (concurrency=${limit})...`);

  const masterIds = await pim.getAllActiveMasters();
  const sliced =
    sliceLimit !== undefined
      ? masterIds.slice(sliceOffset, sliceOffset + sliceLimit)
      : masterIds.slice(sliceOffset);

  console.log(
    `Total active masters from PIM channel: ${masterIds.length}. Checking ${sliced.length} (offset=${sliceOffset}${sliceLimit !== undefined ? `, limit=${sliceLimit}` : ''
    }).`,
  );

  const results = await mapLimit(sliced, limit, async (masterId) => {
    const base: CheckResult = {
      masterId,
      pimVariants: 0,
      medusaVariants: 0,
      status: 'ok',
    };

    try {
      const snapshot = await pim.getActiveVersion(masterId);
      base.pimVariants = snapshot.variants.length;

      const medusaProduct = await medusa.findProductByHandle(masterId);
      if (!medusaProduct) {
        return {
          ...base,
          status: 'missing',
        };
      }

      const medusaVariants = medusaProduct.variants?.length || 0;
      base.medusaVariants = medusaVariants;
      base.medusaProductId = medusaProduct.id;

      if (medusaVariants !== base.pimVariants) {
        return {
          ...base,
          status: 'variant_mismatch',
        };
      }

      return base;
    } catch (error: any) {
      const message = error?.message || 'unknown error';
      return {
        ...base,
        status: message.includes('PIM') ? 'pim_error' : 'medusa_error',
        error: message,
      };
    }
  });

  const missing = results.filter((r) => r.status === 'missing');
  const mismatched = results.filter((r) => r.status === 'variant_mismatch');
  const pimErrors = results.filter((r) => r.status === 'pim_error');
  const medusaErrors = results.filter((r) => r.status === 'medusa_error');

  console.log(`OK: ${results.length - missing.length - mismatched.length - pimErrors.length - medusaErrors.length}`);
  console.log(`Missing in Medusa: ${missing.length}`);
  console.log(`Variant mismatch: ${mismatched.length}`);
  console.log(`PIM errors: ${pimErrors.length}`);
  console.log(`Medusa errors: ${medusaErrors.length}`);

  if (missing.length) {
    console.log('Missing handles:', missing.slice(0, 20).map((r) => r.masterId).join(', '), missing.length > 20 ? '...' : '');
  }
  if (mismatched.length) {
    console.log('Variant mismatch handles:', mismatched.slice(0, 20).map((r) => r.masterId).join(', '), mismatched.length > 20 ? '...' : '');
  }
  if (pimErrors.length) {
    console.log('PIM errors:', pimErrors.slice(0, 5).map((r) => `${r.masterId} (${r.error})`).join(', '), pimErrors.length > 5 ? '...' : '');
  }
  if (medusaErrors.length) {
    console.log('Medusa errors:', medusaErrors.slice(0, 5).map((r) => `${r.masterId} (${r.error})`).join(', '), medusaErrors.length > 5 ? '...' : '');
  }

  const targetsForDelete = [...missing, ...mismatched].filter((r) => r.medusaProductId);
  if (deleteMismatched && targetsForDelete.length) {
    console.log(`Deleting ${targetsForDelete.length} Medusa products with missing/mismatched variants...`);
    for (const target of targetsForDelete) {
      if (!target.medusaProductId) continue;
      try {
        await medusa.deleteProduct(target.medusaProductId);
        console.log(`Deleted ${target.medusaProductId} (handle ${target.masterId})`);
      } catch (e: any) {
        console.warn(`Failed to delete ${target.medusaProductId}: ${e?.message}`);
      }
    }
  }

  if (resyncAfterDelete) {
    const toResyncIds = [...missing, ...mismatched].map((r) => r.masterId);
    if (toResyncIds.length) {
      console.log(
        `Resync requested. Run migrate-pim-to-medusa with --masters=${toResyncIds.join(',')}`,
      );
    }
  }
}

main().catch((err) => {
  console.error('Validation failed', err);
  process.exit(1);
});
