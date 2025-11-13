import { PimTestDatabase } from './pim-test-database';

// Jest global teardown
export default async (): Promise<void> => {
  console.log('🧹 Tearing down PIM test environment...');

  try {
    await PimTestDatabase.teardown();
    console.log('✅ PIM test environment cleaned up');
  } catch (error) {
    console.error('❌ Failed to teardown PIM test environment:', error);
    // Don't throw error in teardown to avoid masking test failures
  }
};

