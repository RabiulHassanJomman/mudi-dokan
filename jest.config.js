/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  // pure-TS tests only (parser, db migrations); the RN app is not run under Jest
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { strict: true, noUncheckedIndexedAccess: true, esModuleInterop: true, module: 'commonjs', target: 'ES2022', types: ['jest', 'node'] } }] },
};
