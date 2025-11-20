module.exports = {
  displayName: 'WMS Tests',
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
    '^@app/(.*)$': '<rootDir>/../../libs/$1/src',
  },

  // Setup files to run before each test
  setupFilesAfterEnv: [
    '<rootDir>/test/support/test-setup.ts'
  ],

  // Clear mocks between tests
  clearMocks: true,

  // Verbose output for better debugging
  verbose: false,

  // Transform @faker-js/faker ESM module
  transformIgnorePatterns: [
    'node_modules/(?!(@faker-js/faker)/)'
  ],

  // Force Jest to exit after tests complete
  forceExit: true,

  // Detect open handles for debugging
  detectOpenHandles: false,
};