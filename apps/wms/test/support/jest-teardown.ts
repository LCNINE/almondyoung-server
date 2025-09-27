import { WmsTestDatabase } from './wms-test-database';

// Jest global teardown
export default async (): Promise<void> => {
  console.log('🧹 Tearing down WMS test environment...');

  try {
    await WmsTestDatabase.teardown();
    console.log('✅ WMS test environment cleaned up');
  } catch (error) {
    console.error('❌ Failed to teardown WMS test environment:', error);
    // Don't throw error in teardown to avoid masking test failures
  }
};