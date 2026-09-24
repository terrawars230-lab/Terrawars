/**
 * RFC 4122 v4 UUID.
 *
 * Hand-rolled rather than pulling in `uuid`, which needs `react-native-get-
 * random-values` and a crypto polyfill. These ids are idempotency keys and
 * client-side correlation ids, never secrets — `Math.random` is the right tool
 * for the job and the wrong tool for anything security-bearing.
 */
export function generateUuid(): string {
  /* eslint-disable no-bitwise -- the RFC 4122 v4 layout is defined in bits */
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
  /* eslint-enable no-bitwise */
}
