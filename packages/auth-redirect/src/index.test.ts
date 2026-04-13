// ---------------------------------------------------------------------------
// @postalservice/auth-redirect — tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuthRedirect } from './index.js';
import type { AuthRedirectOptions } from './index.js';
import { HttpError } from 'postalservice';
import type { RequestConfig } from 'postalservice';

// ---- Helpers ---------------------------------------------------------------

/** Minimal config for constructing test HttpError instances. */
const dummyConfig: RequestConfig = { url: '/test' };

function makeHttpError(status: number): HttpError {
  return new HttpError(`Request failed with status ${status}`, {
    code: 'ERR_HTTP_STATUS',
    status,
    config: dummyConfig,
  });
}

function makeNonStatusError(): HttpError {
  return new HttpError('Network error', {
    code: 'ERR_NETWORK',
    config: dummyConfig,
  });
}

// ---- Window stub helpers ---------------------------------------------------

let hrefSetter: ReturnType<typeof vi.fn>;
let capturedHref: string;

function stubWindow(initialHref = 'https://app.example.com/dashboard') {
  capturedHref = initialHref;
  hrefSetter = vi.fn((value: string) => {
    capturedHref = value;
  });

  const locationObj = {
    get href() {
      return capturedHref;
    },
    set href(value: string) {
      hrefSetter(value);
    },
  };

  vi.stubGlobal('window', { location: locationObj });
}

function unstubWindow() {
  vi.unstubAllGlobals();
}

// ---- Test suite ------------------------------------------------------------

describe('createAuthRedirect', () => {
  beforeEach(() => {
    stubWindow();
  });

  afterEach(() => {
    unstubWindow();
    vi.restoreAllMocks();
  });

  // -- Status code triggers --------------------------------------------------

  it('redirects on 401 with default options', () => {
    const redirect = createAuthRedirect({ loginUrl: '/login' });

    expect(() => redirect.response.rejected!(makeHttpError(401))).toThrow();
    expect(hrefSetter).toHaveBeenCalledTimes(1);
    expect(hrefSetter.mock.calls[0]![0]).toContain('/login');
  });

  it('redirects on 403 when included in the default on list', () => {
    const redirect = createAuthRedirect({ loginUrl: '/login' });

    expect(() => redirect.response.rejected!(makeHttpError(403))).toThrow();
    expect(hrefSetter).toHaveBeenCalledTimes(1);
    expect(hrefSetter.mock.calls[0]![0]).toContain('/login');
  });

  it('does NOT redirect on 500 (not in the on list)', () => {
    const redirect = createAuthRedirect({ loginUrl: '/login' });

    expect(() => redirect.response.rejected!(makeHttpError(500))).toThrow();
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it('does NOT redirect on non-ERR_HTTP_STATUS errors', () => {
    const redirect = createAuthRedirect({ loginUrl: '/login' });

    expect(() => redirect.response.rejected!(makeNonStatusError())).toThrow();
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it('does NOT redirect on plain Error instances', () => {
    const redirect = createAuthRedirect({ loginUrl: '/login' });

    expect(() =>
      redirect.response.rejected!(new Error('something else')),
    ).toThrow();
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it('honors custom on status codes', () => {
    const redirect = createAuthRedirect({ loginUrl: '/login', on: [418] });

    expect(() => redirect.response.rejected!(makeHttpError(401))).toThrow();
    expect(hrefSetter).not.toHaveBeenCalled();

    expect(() => redirect.response.rejected!(makeHttpError(418))).toThrow();
    expect(hrefSetter).toHaveBeenCalledTimes(1);
  });

  // -- preserveReturnTo ------------------------------------------------------

  it('appends ?return_to=<encoded-path> when preserveReturnTo is true (default)', () => {
    stubWindow('https://app.example.com/settings?tab=profile');
    const redirect = createAuthRedirect({ loginUrl: '/login' });

    expect(() => redirect.response.rejected!(makeHttpError(401))).toThrow();
    expect(hrefSetter).toHaveBeenCalledTimes(1);

    const url = hrefSetter.mock.calls[0]![0] as string;
    expect(url).toBe(
      '/login?return_to=' +
        encodeURIComponent('https://app.example.com/settings?tab=profile'),
    );
  });

  it('does NOT append return_to when preserveReturnTo is false', () => {
    const redirect = createAuthRedirect({
      loginUrl: '/login',
      preserveReturnTo: false,
    });

    expect(() => redirect.response.rejected!(makeHttpError(401))).toThrow();
    expect(hrefSetter).toHaveBeenCalledWith('/login');
  });

  // -- Custom returnToParam --------------------------------------------------

  it('uses a custom returnToParam name', () => {
    stubWindow('https://app.example.com/page');
    const redirect = createAuthRedirect({
      loginUrl: '/auth',
      returnToParam: 'next',
    });

    expect(() => redirect.response.rejected!(makeHttpError(401))).toThrow();
    const url = hrefSetter.mock.calls[0]![0] as string;
    expect(url).toMatch(/^\/auth\?next=/);
    expect(url).toContain(
      'next=' + encodeURIComponent('https://app.example.com/page'),
    );
  });

  // -- shouldRedirect predicate ----------------------------------------------

  it('suppresses redirect when shouldRedirect returns false', () => {
    const redirect = createAuthRedirect({
      loginUrl: '/login',
      shouldRedirect: () => false,
    });

    expect(() => redirect.response.rejected!(makeHttpError(401))).toThrow();
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it('allows redirect when shouldRedirect returns true', () => {
    const predicate = vi.fn(() => true);
    const redirect = createAuthRedirect({
      loginUrl: '/login',
      shouldRedirect: predicate,
    });

    const err = makeHttpError(401);
    expect(() => redirect.response.rejected!(err)).toThrow();
    expect(predicate).toHaveBeenCalledWith(err);
    expect(hrefSetter).toHaveBeenCalledTimes(1);
  });

  // -- loginUrl as a function ------------------------------------------------

  it('calls loginUrl as a function, receives the error, and uses the return value', () => {
    const loginUrlFn = vi.fn((err: HttpError) => `/login/${err.status}`);
    const redirect = createAuthRedirect({
      loginUrl: loginUrlFn,
      preserveReturnTo: false,
    });

    const err = makeHttpError(401);
    expect(() => redirect.response.rejected!(err)).toThrow();
    expect(loginUrlFn).toHaveBeenCalledWith(err);
    expect(hrefSetter).toHaveBeenCalledWith('/login/401');
  });

  // -- Cooldown --------------------------------------------------------------

  it('suppresses a second redirect within cooldownMs, allows after cooldown', () => {
    const now = 1000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const redirect = createAuthRedirect({
      loginUrl: '/login',
      preserveReturnTo: false,
      cooldownMs: 500,
    });

    // First redirect
    expect(() => redirect.response.rejected!(makeHttpError(401))).toThrow();
    expect(hrefSetter).toHaveBeenCalledTimes(1);

    // Second within cooldown (at +200ms)
    vi.spyOn(Date, 'now').mockReturnValue(now + 200);
    expect(() => redirect.response.rejected!(makeHttpError(401))).toThrow();
    expect(hrefSetter).toHaveBeenCalledTimes(1); // still 1

    // Third after cooldown (at +500ms)
    vi.spyOn(Date, 'now').mockReturnValue(now + 500);
    expect(() => redirect.response.rejected!(makeHttpError(401))).toThrow();
    expect(hrefSetter).toHaveBeenCalledTimes(2); // now 2
  });

  // -- Non-browser runtime ---------------------------------------------------

  describe('non-browser runtime', () => {
    beforeEach(() => {
      unstubWindow();
      // Remove window entirely
      vi.stubGlobal('window', undefined);
    });

    it('does NOT redirect and emits a one-shot console.warn', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const redirect = createAuthRedirect({ loginUrl: '/login' });

      // First call — warn emitted
      expect(() => redirect.response.rejected!(makeHttpError(401))).toThrow();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        '[@postalservice/auth-redirect] ignored in non-browser runtime',
      );

      // Second call — no additional warn
      expect(() => redirect.response.rejected!(makeHttpError(401))).toThrow();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('rethrows the original error even when window is absent', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const redirect = createAuthRedirect({ loginUrl: '/login' });
      const err = makeHttpError(401);

      expect(() => redirect.response.rejected!(err)).toThrow(err);
    });
  });

  // -- Error rethrow guarantee -----------------------------------------------

  it('always rethrows the original error (never swallows)', () => {
    const redirect = createAuthRedirect({ loginUrl: '/login' });
    const err = makeHttpError(401);

    let caught: unknown;
    try {
      redirect.response.rejected!(err);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(err);
  });

  it('rethrows even for non-matching status codes', () => {
    const redirect = createAuthRedirect({ loginUrl: '/login' });
    const err = makeHttpError(500);

    let caught: unknown;
    try {
      redirect.response.rejected!(err);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(err);
  });

  // -- install() convenience -------------------------------------------------

  it('install() attaches the rejected handler via client.interceptors.response.use', () => {
    const useSpy = vi.fn();
    const fakeClient = {
      interceptors: {
        response: { use: useSpy },
      },
    } as unknown as import('postalservice').Client;

    const redirect = createAuthRedirect({ loginUrl: '/login' });
    redirect.install(fakeClient);

    expect(useSpy).toHaveBeenCalledTimes(1);
    expect(useSpy).toHaveBeenCalledWith(undefined, redirect.response.rejected);
  });

  // -- loginUrl with existing query params -----------------------------------

  it('appends return_to with & when loginUrl already has a query string', () => {
    stubWindow('https://app.example.com/page');
    const redirect = createAuthRedirect({
      loginUrl: '/login?mode=sso',
    });

    expect(() => redirect.response.rejected!(makeHttpError(401))).toThrow();
    const url = hrefSetter.mock.calls[0]![0] as string;
    expect(url).toMatch(/^\/login\?mode=sso&return_to=/);
  });
});
