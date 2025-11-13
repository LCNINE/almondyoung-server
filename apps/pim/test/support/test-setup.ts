import { PimTestDatabase } from './pim-test-database';

// This runs before each test file
beforeAll(async () => {
  // Ensure database is ready
  if (!PimTestDatabase['isInitialized']) {
    await PimTestDatabase.setup();
  }
});

// This runs before each individual test
beforeEach(async () => {
  // Clear all data between tests for clean slate
  await PimTestDatabase.clearAllTables();
  await PimTestDatabase.resetSequences();
});

// This runs after each test to help with debugging
afterEach(async () => {
  // Optional: Log table counts for debugging failed tests
  if (process.env.TEST_DEBUG === 'true') {
    const counts = await PimTestDatabase.getTableCounts();
    console.log('📊 Table counts after test:', counts);
  }
});

