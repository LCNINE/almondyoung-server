import { migrateCategories } from './migrations/categories';
import { isDryRunFlag } from './lib/env';

function printUsage(): void {
  console.log('Usage:');
  console.log('  ts-node src/index.ts categories [--dry]');
}

function parseArgs(args: string[]): { command?: string; dryRun: boolean } {
  const command = args[0];
  const dryRun = args.includes('--dry') || isDryRunFlag();
  return { command, dryRun };
}

async function main(): Promise<void> {
  const { command, dryRun } = parseArgs(process.argv.slice(2));

  if (!command || command === 'help') {
    printUsage();
    return;
  }

  switch (command) {
    case 'categories':
      await migrateCategories({ dryRun });
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
