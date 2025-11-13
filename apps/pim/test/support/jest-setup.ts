import { PimTestDatabase } from './pim-test-database';

// Jest global setup
export default async (): Promise<void> => {
  console.log('🚀 Setting up PIM test environment...');

  try {
    await PimTestDatabase.setup();
    console.log('✅ PIM test environment ready');
  } catch (error) {
    console.error('❌ Failed to setup PIM test environment:', error);
    throw error;
  }
};

