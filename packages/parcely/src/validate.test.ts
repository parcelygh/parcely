import { describe, it, expect } from 'vitest';
import { runValidator } from './validate.js';
import { HttpError } from './errors.js';

describe('runValidator', () => {
  describe('Standard Schema path', () => {
    it('validates data using ~standard.validate and returns value', async () => {
      const validator = {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate: (input: unknown) => ({ value: input }),
        },
      };
      const result = await runValidator({ id: '1' }, validator, {});
      expect(result).toEqual({ id: '1' });
    });

    it('throws ERR_VALIDATION when ~standard.validate returns issues', async () => {
      const validator = {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate: () => ({
            issues: [{ message: 'bad field' }],
          }),
        },
      };
      try {
        await runValidator({ bad: true }, validator, {});
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).code).toBe('ERR_VALIDATION');
      }
    });

    it('supports async ~standard.validate', async () => {
      const validator = {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate: async (input: unknown) => ({ value: input }),
        },
      };
      const result = await runValidator('hello', validator, {});
      expect(result).toBe('hello');
    });
  });

  describe('.parse() path', () => {
    it('validates data using parse method', async () => {
      const validator = {
        parse: (input: unknown) => input as { name: string },
      };
      const result = await runValidator({ name: 'test' }, validator, {});
      expect(result).toEqual({ name: 'test' });
    });

    it('throws ERR_VALIDATION when parse throws', async () => {
      const validator = {
        parse: () => {
          throw new Error('parse failed');
        },
      };
      try {
        await runValidator({ bad: true }, validator, {});
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).code).toBe('ERR_VALIDATION');
        expect((e as HttpError).cause).toBeInstanceOf(Error);
      }
    });
  });

  describe('function path', () => {
    it('validates data by calling function', async () => {
      const validator = (input: unknown) => input as { id: number };
      const result = await runValidator({ id: 42 }, validator, {});
      expect(result).toEqual({ id: 42 });
    });

    it('throws ERR_VALIDATION when function throws', async () => {
      const validator = () => {
        throw new Error('bad input');
      };
      try {
        await runValidator('bad', validator, {});
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).code).toBe('ERR_VALIDATION');
      }
    });
  });
});
