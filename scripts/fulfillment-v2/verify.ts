import {
  connectDatabase,
  parseArgs,
  readArtifact,
  requiredArg,
  requireCutoverAt,
  requireWorkflowMode,
  verify,
} from './toolkit';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const auditPath = requiredArg(args, 'audit');
  const workflowMode = requireWorkflowMode();
  const cutoverAt = requireCutoverAt();
  const signingKey = process.env.FULFILLMENT_V2_AUDIT_SIGNING_KEY;
  const artifact = await readArtifact(auditPath);
  const sql = connectDatabase();
  try {
    const report = await verify(sql, artifact, { workflowMode, cutoverAt, signingKey });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
