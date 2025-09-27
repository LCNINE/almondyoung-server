import { WmsTestDatabase } from './wms-test-database';

// This runs before each test file
beforeAll(async () => {
  // Ensure database is ready
  if (!WmsTestDatabase['isInitialized']) {
    await WmsTestDatabase.setup();
  }
});

// This runs before each individual test
beforeEach(async () => {
  // Clear all data between tests for clean slate
  await WmsTestDatabase.clearAllTables();
  await WmsTestDatabase.resetSequences();
});

// This runs after each test to help with debugging
afterEach(async () => {
  // Optional: Log table counts for debugging failed tests
  if (process.env.TEST_DEBUG === 'true') {
    const counts = await WmsTestDatabase.getTableCounts();
    console.log('📊 Table counts after test:', counts);
  }
});