/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/../test/backend'],
  modulePaths: ['<rootDir>/node_modules'],
  moduleNameMapper: {
    '^uuid$': '<rootDir>/../test/backend/__mocks__/uuid.js',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
};
