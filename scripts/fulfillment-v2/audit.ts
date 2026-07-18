import {
  connectDatabase,
  createAuditArtifact,
  parseArgs,
  requiredArg,
  requireCutoverAt,
  requireWorkflowMode,
  writeArtifact,
} from './toolkit';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const output = requiredArg(args, 'output');
  const workflowMode = requireWorkflowMode();
  if (workflowMode !== 'maintenance') {
    throw new Error('Audit must run with FULFILLMENT_WORKFLOW_MODE=maintenance.');
  }
  const cutoverAt = requireCutoverAt();
  const signingKey = process.env.FULFILLMENT_V2_AUDIT_SIGNING_KEY;
  const sql = connectDatabase();
  try {
    const artifact = await createAuditArtifact(sql, { workflowMode, cutoverAt, signingKey });
    await writeArtifact(output, artifact);
    console.log(
      JSON.stringify(
        {
          output,
          auditHash: artifact.integrity.artifactHash,
          signed: artifact.integrity.signature !== null,
          database: artifact.database,
          cutoverAt: artifact.cutoverAt,
          snapshotId: artifact.snapshotId,
          counts: artifact.state.counts,
          affectedStockPairs: artifact.state.affectedStock.length,
          blockers: artifact.blockers,
          warnings: artifact.warnings,
        },
        null,
        2,
      ),
    );
    if (artifact.blockers.length > 0) process.exitCode = 2;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
