module.exports = {
  displayName: 'PIM Tests',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: [
    '<rootDir>/test/**/*.test.ts',
    '<rootDir>/test/**/*.spec.ts'
  ],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
    '!src/**/index.ts',
    '!src/**/*.interface.ts',
    '!src/**/*.dto.ts',
    '!src/**/*.schema.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html'],

  // Global setup and teardown for testcontainers
  globalSetup: '<rootDir>/test/support/jest-setup.ts',
  globalTeardown: '<rootDir>/test/support/jest-teardown.ts',

  // Test timeout (testcontainers can be slow)
  testTimeout: 60000,

  // Run tests serially to avoid DB conflicts
  maxWorkers: 1,

  // Module path mapping
  moduleNameMapper: {
    '^@app/auth-core(|/.*)$': '<rootDir>/../../libs/auth-core/src/$1',
    '^@app/db(|/.*)$': '<rootDir>/../../libs/db/src/$1',
    '^@app/events(|/.*)$': '<rootDir>/../../libs/events/src/$1',
    '^@app/roles(|/.*)$': '<rootDir>/../../libs/roles/src/$1',
    '^@app/shared(|/.*)$': '<rootDir>/../../libs/shared/src/$1',
    '^@packages/(.*)$': '<rootDir>/../../packages/$1',
  },

  // Setup files to run before each test
  setupFilesAfterEnv: [
    '<rootDir>/test/support/test-setup.ts'
  ],

  // Clear mocks between tests
  clearMocks: true,

  // Verbose output for better debugging (set to false for cleaner output)
  verbose: false,
  
  // Suppress console.log during tests (show only errors)
  silent: true, // true to hide console.log, false to see all logs

  // Transform @faker-js/faker ESM module
  transformIgnorePatterns: [
    'node_modules/(?!(@faker-js/faker)/)'
  ],

  // Force Jest to exit after tests complete
  forceExit: true,

  // Detect open handles for debugging
  detectOpenHandles: false,
};

