import { migrateCategories } from './migrations/categories';
import { migrateProductCategoryLinks } from './migrations/product-category-links';
import { isDryRunFlag } from './lib/env';

function printUsage(): void {
  console.log('Usage:');
  console.log('  ts-node src/index.ts categories [--dry]');
  console.log('  ts-node src/index.ts product-category-links [--dry] [--masters master1,master2]');
}

function parseArgs(args: string[]): {
  command?: string;
  dryRun: boolean;
  masterIds: string[];
} {
  const command = args[0];
  const dryRun = args.includes('--dry') || isDryRunFlag();
  const mastersFlag = args.find((arg) => arg.startsWith('--masters='));
  const mastersIndex = args.indexOf('--masters');
  const mastersValue = mastersFlag
    ? mastersFlag.split('=').slice(1).join('=')
    : mastersIndex >= 0
      ? args[mastersIndex + 1]
      : '';
  const masterIds = mastersValue
    ? mastersValue.split(',').map((value) => value.trim()).filter(Boolean)
    : [];

  return { command, dryRun, masterIds };
}

async function main(): Promise<void> {
  const { command, dryRun, masterIds } = parseArgs(process.argv.slice(2));

  if (!command || command === 'help') {
    printUsage();
    return;
  }

  switch (command) {
    case 'categories':
      await migrateCategories({ dryRun });
      break;
    case 'product-category-links':
      await migrateProductCategoryLinks({ dryRun, masterIds });
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
