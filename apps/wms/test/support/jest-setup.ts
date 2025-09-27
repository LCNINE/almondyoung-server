import { WmsTestDatabase } from './wms-test-database';

// Jest global setup
export default async (): Promise<void> => {
  console.log('🚀 Setting up WMS test environment...');

  try {
    await WmsTestDatabase.setup();
    console.log('✅ WMS test environment ready');
  } catch (error) {
    console.error('❌ Failed to setup WMS test environment:', error);
    throw error;
  }
};