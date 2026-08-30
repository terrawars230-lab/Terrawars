import {
  createLogger,
  redactContext,
  setCrashReporter,
  type CrashReporter,
} from '@core/logger/logger';

/**
 * The redaction tests are not stylistic — they are a privacy control.
 *
 * doc 06 §4 puts continuous precise location among the most sensitive data
 * there is, and a lat/lng in a log line becomes a home address in a crash
 * report. These tests are what stop a future `logger.info('claim', {ring})`
 * from quietly shipping someone's route to a third-party sink.
 */
describe('redactContext', () => {
  it('redacts coordinate fields', () => {
    const redacted = redactContext({lat: 31.5204, lng: 74.3587, walkId: 'abc'});

    expect(redacted.lat).toBe('[redacted:location]');
    expect(redacted.lng).toBe('[redacted:location]');
    // Non-location context survives, or the logs would be useless.
    expect(redacted.walkId).toBe('abc');
  });

  it.each([
    'lat',
    'lng',
    'latitude',
    'longitude',
    'coordinates',
    'ring',
    'path',
    'points',
    'geom',
    'geometry',
    'centroid',
    'bbox',
    'bounds',
  ])('redacts the %s key', key => {
    expect(redactContext({[key]: 'sensitive'})[key]).toBe('[redacted:location]');
  });

  it('reports the length of a redacted array without its contents', () => {
    const redacted = redactContext({
      points: [
        {lat: 1, lng: 2},
        {lat: 3, lng: 4},
      ],
    });

    expect(redacted.points).toBe('[redacted:location] (2 items)');
    expect(JSON.stringify(redacted)).not.toContain('"lat"');
  });

  it('redacts nested coordinates', () => {
    const redacted = redactContext({
      claim: {areaM2: 41_000, geometry: {type: 'Polygon', coordinates: [[1, 2]]}},
    });

    const claim = redacted.claim as Record<string, unknown>;
    expect(claim.areaM2).toBe(41_000);
    expect(claim.geometry).toBe('[redacted:location]');
  });

  it('never lets a coordinate survive at any depth it inspects', () => {
    const redacted = redactContext({a: {b: {c: {lat: 31.5204}}}});
    expect(JSON.stringify(redacted)).not.toContain('31.5204');
  });

  it('stops recursing on a deeply nested object rather than hanging', () => {
    // A cycle would otherwise recurse until the stack blows. Depth is capped,
    // and the cap must degrade to dropping data — never to leaking it.
    const cyclic: Record<string, unknown> = {walkId: 'abc'};
    cyclic.self = cyclic;

    expect(() => redactContext(cyclic)).not.toThrow();
    expect(JSON.stringify(redactContext(cyclic))).not.toContain('31.5204');
  });

  it('leaves an empty context empty', () => {
    expect(redactContext({})).toEqual({});
  });
});

describe('createLogger', () => {
  afterEach(() => {
    setCrashReporter(null);
  });

  it('forwards warnings and errors to the crash reporter', () => {
    const reporter: CrashReporter = {
      captureMessage: jest.fn(),
      captureException: jest.fn(),
    };
    setCrashReporter(reporter);

    const logger = createLogger('test-scope');
    logger.warn('something odd', {walkId: 'abc'});

    expect(reporter.captureMessage).toHaveBeenCalledWith(
      'test-scope: something odd',
      'warn',
      expect.objectContaining({walkId: 'abc'}),
    );
  });

  it('does not forward debug or info to the crash reporter', () => {
    const reporter: CrashReporter = {
      captureMessage: jest.fn(),
      captureException: jest.fn(),
    };
    setCrashReporter(reporter);

    const logger = createLogger('test-scope');
    logger.debug('noise');
    logger.info('routine');

    expect(reporter.captureMessage).not.toHaveBeenCalled();
  });

  it('redacts location before it reaches the crash reporter', () => {
    const reporter: CrashReporter = {
      captureMessage: jest.fn(),
      captureException: jest.fn(),
    };
    setCrashReporter(reporter);

    createLogger('walk').warn('claim preview', {lat: 31.5204, lng: 74.3587});

    const context = (reporter.captureMessage as jest.Mock).mock.calls[0]![2];
    expect(JSON.stringify(context)).not.toContain('31.5204');
  });

  it('serialises an Error rather than logging an empty object', () => {
    const reporter: CrashReporter = {
      captureMessage: jest.fn(),
      captureException: jest.fn(),
    };
    setCrashReporter(reporter);

    const failure = new Error('boom');
    createLogger('walk').error('it broke', failure);

    const context = (reporter.captureMessage as jest.Mock).mock.calls[0]![2] as Record<
      string,
      unknown
    >;
    expect(context.error).toEqual(expect.objectContaining({name: 'Error', message: 'boom'}));
    expect(reporter.captureException).toHaveBeenCalledWith(failure, expect.anything());
  });

  it('works with no crash reporter attached', () => {
    setCrashReporter(null);
    expect(() => createLogger('test').error('no sink', new Error('x'))).not.toThrow();
  });
});
