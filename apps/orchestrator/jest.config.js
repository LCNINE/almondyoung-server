module.exports = {
  displayName: 'Orchestrator Tests',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
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

  // Module path mapping
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/../../libs/$1/src',
  },

  // Clear mocks between tests
  clearMocks: true,

  // Verbose output for better debugging
  verbose: true,
};
