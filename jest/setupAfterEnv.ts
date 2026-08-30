/**
 * Runs after the test framework is installed.
 *
 * @testing-library/react-native v13 registers its matchers automatically, so
 * there is nothing to import for `toBeOnTheScreen` and friends.
 */
afterEach(() => {
  jest.clearAllMocks();
});

export {};
