import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyApprovedFields, validateReviewManifest } from './policy';
import { ProductProposal } from './products';

// This local-only tool reads approved artifacts. It never reads authentication files or calls APIs.
async function seed(): Promise<void> {
  const [auditFolder, sessionFolder, reviewCsv, outputFolder] = process.argv.slice(2);
  if (!outputFolder) throw new Error('Usage: seed <audit-folder> <session-folder> <review-csv> <output-folder>');
  const csv = await readFile(reviewCsv, 'utf8');
  if (
    createHash('sha256').update(csv).digest('hex') !==
    '8cbd71876eb33cb479170ad390fea71976b8c88fc890772693b86abb55939e72'
  ) {
    throw new Error('Approved review backup checksum changed');
  }
  const targets = csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [id, productId, rating] = line.split(',');
      return { id, productId, rating: Number(rating) };
    });
  const expected = { count: 3662, rating2: 767, rating3: 2895, products: 619 };
  validateReviewManifest(targets, expected);

  const approved = JSON.parse(await readFile(join(auditFolder, 'approved-updates.json'), 'utf8')) as {
    updates: ProductProposal[];
  };
  const journal = (await readFile(join(sessionFolder, 'mutation-journal.ndjson'), 'utf8'))
    .trim()
    .split('\n')
    .map(
      (line) =>
        JSON.parse(line) as { event: string; masterId: string; fields?: Record<string, string>; newVersionId?: string },
    );
  const verified = new Map<string, { fields: Record<string, string>; versionId?: string }>();
  for (const row of journal.filter((row) => row.event === 'verified')) {
    const previous = verified.get(row.masterId);
    verified.set(row.masterId, {
      fields: { ...previous?.fields, ...row.fields },
      versionId: row.newVersionId ?? previous?.versionId,
    });
  }

  const held = new Map<string, { masterId: string; reason: string }>();
  for (const file of await readdir(join(sessionFolder, 'states'))) {
    if (!file.endsWith('.json')) continue;
    const state = JSON.parse(await readFile(join(sessionFolder, 'states', file), 'utf8'));
    if (state.phase !== 'verified')
      held.set(state.masterId, {
        masterId: state.masterId,
        reason: `Legacy operation requires reconciliation: ${state.phase}`,
      });
  }

  const updates: ProductProposal[] = [];
  for (const proposal of approved.updates) {
    const completed = verified.get(proposal.masterId);
    const fields = Object.fromEntries(
      Object.entries(proposal.setProductInfo).filter(([field, value]) => completed?.fields[field] !== value),
    );
    emptyApprovedFields({}, fields);
    if (!Object.keys(fields).length || held.has(proposal.masterId)) continue;
    updates.push({
      masterId: proposal.masterId,
      name: proposal.name,
      expectedActiveVersionId: completed?.versionId ?? proposal.expectedActiveVersionId,
      setProductInfo: fields,
    });
  }

  await mkdir(outputFolder, { recursive: true, mode: 0o700 });
  const artifacts = { reviews: { targets, expected }, products: { updates, held: [...held.values()] } };
  const hashes: Record<string, unknown> = {};
  for (const [kind, value] of Object.entries(artifacts)) {
    const body = JSON.stringify(value);
    await writeFile(join(outputFolder, `${kind}.json`), body, { mode: 0o600 });
    hashes[kind] = {
      key: `inputs/approved-maintenance-202610/${kind}.json`,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
  }
  await writeFile(join(outputFolder, 'manifest-index.json'), JSON.stringify(hashes, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify({
      reviewTargets: targets.length,
      pendingProducts: updates.length,
      pendingFields: updates.reduce((sum, row) => sum + Object.keys(row.setProductInfo).length, 0),
      heldProducts: held.size,
      hashes,
    }),
  );
}

seed().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
