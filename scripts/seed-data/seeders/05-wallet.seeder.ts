import { Logger } from '../shared/logger';

const logger = new Logger('Wallet Seeder');

export async function seedWallet(databaseUrl: string): Promise<void> {
  logger.info('Starting Wallet seeding');
  logger.info('Wallet has no seed data (empty by design)');
  logger.success('Wallet seeding completed successfully');
}
