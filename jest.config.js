export default {
  testEnvironment: 'node',
  transform: {},
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'server.js',
    'config-manager.js',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!**/test/**',
  ],
  testMatch: [
    '**/test/**/*.test.js'
  ],
};
