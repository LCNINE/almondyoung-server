module.exports = {
  displayName: 'user-service',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '../../',
  testMatch: ['<rootDir>/apps/user-service/**/*.spec.ts'],
  moduleNameMapper: {
    '^@app/([^/]+)$': '<rootDir>/libs/$1/src',
    '^@app/([^/]+)/(.*)$': '<rootDir>/libs/$1/src/$2',
    '^@packages/(.*)$': '<rootDir>/packages/$1',
    '^apps/(.*)$': '<rootDir>/apps/$1',
  },
  collectCoverageFrom: [
    'apps/user-service/src/**/*.ts',
    '!apps/user-service/src/**/*.spec.ts',
    '!apps/user-service/src/**/*.e2e-spec.ts',
    '!apps/user-service/src/main.ts',
  ],
  coverageDirectory: '<rootDir>/coverage/user-service',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { isolatedModules: true }],
  },
  testTimeout: 30000,
};
