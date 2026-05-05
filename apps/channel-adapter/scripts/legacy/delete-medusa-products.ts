import { MedusaClient } from '../../src/adapters/medusa/medusa.client';

class EnvConfigService {
  get<T = any>(propertyPath: string): T | undefined {
    return process.env[propertyPath] as T | undefined;
  }
  getOrThrow<T = any>(propertyPath: string): T {
    const v = this.get<T>(propertyPath);
    if (v === undefined || v === null) {
      throw new Error(`Missing env: ${propertyPath}`);
    }
    return v;
  }
}

async function main() {
  const handlesArg = process.argv.find((a) => a.startsWith('--handles='));
  if (!handlesArg) {
    throw new Error('Usage: ts-node delete-medusa-products.ts --handles=handle1,handle2');
  }
  const handles = handlesArg
    .replace('--handles=', '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  const config = new EnvConfigService();
  const medusa = new MedusaClient(config as any);

  console.log(`Deleting ${handles.length} Medusa products by handle...`);
  for (const handle of handles) {
    try {
      const found = await medusa.findProductByHandle(handle);
      if (!found) {
        console.log(`- ${handle}: not found, skip`);
        continue;
      }
      await medusa.deleteProduct(found.id);
      console.log(`- ${handle}: deleted (${found.id})`);
    } catch (err: any) {
      console.error(`- ${handle}: delete failed`, err?.response?.data || err?.message);
    }
  }
}

main().catch((err) => {
  console.error('delete-medusa-products failed:', err);
  process.exit(1);
});
