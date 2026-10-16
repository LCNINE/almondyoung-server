module.exports = {
  rootDir: '../..',
  testMatch: ['<rootDir>/scripts/night-maintenance/src/**/*.spec.ts'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/scripts/night-maintenance/tsconfig.json' }],
  },
};
