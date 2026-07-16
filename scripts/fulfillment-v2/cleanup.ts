import {
  cleanup,
  connectDatabase,
  parseArgs,
  readArtifact,
  requiredArg,
  requireCutoverAt,
  requireWorkflowMode,
} from './toolkit';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const auditPath = requiredArg(args, 'audit');
  const snapshotId = requiredArg(args, 'snapshot-id');
  const execute = args.get('execute') === true;
  const workflowMode = requireWorkflowMode();
  const cutoverAt = requireCutoverAt();
  const signingKey = process.env.FULFILLMENT_V2_AUDIT_SIGNING_KEY;
  const artifact = await readArtifact(auditPath);
  const sql = connectDatabase();
  try {
    const deleted = await cleanup(sql, {
      artifact,
      snapshotId,
      execute,
      workflowMode,
      cutoverAt,
      signingKey,
    });
    console.log(
      JSON.stringify(
        {
          mode: execute ? 'execute' : 'dry-run',
          auditPath,
          auditHash: artifact.integrity.artifactHash,
          snapshotId,
          advisoryLock: 'acquired',
          deleted,
          message: execute
            ? 'Cleanup committed. Run fulfillment:v2:verify before enabling V2.'
            : 'Dry-run passed. No rows were changed; add --execute only after snapshot evidence is recorded.',
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
