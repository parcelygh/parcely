// ---------------------------------------------------------------------------
// parcely — validator runner
// ---------------------------------------------------------------------------

import type { Validator, RequestConfig } from './types.js';
import { HttpError } from './errors.js';

/**
 * Run a validator against data. Resolution order:
 * 1. Standard Schema v1 (detect `'~standard'` property)
 * 2. `.parse()` method
 * 3. Call-as-function
 *
 * On failure, throw HttpError with code ERR_VALIDATION.
 */
export async function runValidator<T>(
  data: unknown,
  validator: Validator<T>,
  config: RequestConfig,
  response?: { data: unknown; status: number; statusText: string; headers: Headers },
): Promise<T> {
  try {
    // 1. Standard Schema v1: check for `~standard` property
    if (isStandardSchema(validator)) {
      const result = await validator['~standard'].validate(data);
      if ('issues' in result && result.issues) {
        throw new Error(
          `Validation failed: ${result.issues.map((i) => i.message).join(', ')}`,
        );
      }
      return (result as { value: T }).value;
    }

    // 2. `.parse()` method
    if (isParseValidator(validator)) {
      return validator.parse(data);
    }

    // 3. Call-as-function
    if (typeof validator === 'function') {
      return validator(data);
    }

    // Should never happen given the Validator type
    throw new Error('Invalid validator shape');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const errorOpts: import('./errors.js').HttpErrorOptions = {
      code: 'ERR_VALIDATION',
      config,
      cause: err,
    };
    if (response) {
      errorOpts.response = {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        config,
      };
    }
    throw new HttpError('Response validation failed', errorOpts);
  }
}

// ---- type guards ------------------------------------------------------------

function isStandardSchema(v: unknown): v is { '~standard': { validate: (data: unknown) => unknown } } {
  return (
    typeof v === 'object' &&
    v !== null &&
    '~standard' in v &&
    typeof (v as Record<string, unknown>)['~standard'] === 'object'
  );
}

function isParseValidator(v: unknown): v is { parse: (data: unknown) => unknown } {
  return (
    typeof v === 'object' &&
    v !== null &&
    'parse' in v &&
    typeof (v as Record<string, unknown>)['parse'] === 'function'
  );
}
