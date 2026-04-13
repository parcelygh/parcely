import { expectTypeOf, describe, it } from 'vitest';
import type {
  Client,
  HttpResponse,
  Validator,
  ValidatorOutput,
} from '../src/types.js';

interface User {
  id: string;
  name: string;
}

interface NewUser {
  name: string;
}

interface Created {
  id: string;
  name: string;
  createdAt: string;
}

// Stand-in that satisfies Standard Schema v1 — no Zod runtime needed in
// type-level tests. Vendor + version + validate signature match the spec.
type FakeStandardSchema<O> = {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => { value: O; issues?: undefined };
    readonly types?: { readonly input: unknown; readonly output: O };
  };
};

declare const http: Client;

describe('Client type-level tests', () => {
  // ---- Generic overload: explicit <T> -------------------------------------

  it('http.get<User>(url) returns Promise<HttpResponse<User>>', () => {
    const result = http.get<User>('/users/me');
    expectTypeOf(result).toEqualTypeOf<Promise<HttpResponse<User>>>();
  });

  it('http.post<Created, NewUser>(url, body) returns Promise<HttpResponse<Created>>', () => {
    const result = http.post<Created, NewUser>('/users', { name: 'mickey' });
    expectTypeOf(result).toEqualTypeOf<Promise<HttpResponse<Created>>>();
  });

  it('http.post body parameter is constrained by the generic B', () => {
    // Should compile — body matches NewUser
    http.post<Created, NewUser>('/users', { name: 'ok' });

    // @ts-expect-error — body must conform to NewUser, missing `name`
    http.post<Created, NewUser>('/users', { wrong: true });
  });

  // ---- Validating overload: data narrows from validator -------------------

  it('http.get with a function validator narrows data to the function return type', () => {
    const validator = (input: unknown): User => input as User;

    const result = http.get('/u', { validate: validator });
    expectTypeOf(result).resolves.toEqualTypeOf<HttpResponse<User>>();

    // And specifically `data` is User, not unknown.
    type Data = Awaited<typeof result>['data'];
    expectTypeOf<Data>().toEqualTypeOf<User>();
    expectTypeOf<Data>().not.toBeUnknown();
  });

  it('http.get with a `.parse` object validator narrows data to .parse return type', () => {
    const validator = { parse: (input: unknown): User => input as User };

    const result = http.get('/u', { validate: validator });
    expectTypeOf(result).resolves.toEqualTypeOf<HttpResponse<User>>();

    type Data = Awaited<typeof result>['data'];
    expectTypeOf<Data>().toEqualTypeOf<User>();
  });

  it('http.get with a Standard Schema validator narrows data to the schema output', () => {
    const schema: FakeStandardSchema<User> = {
      '~standard': {
        version: 1,
        vendor: 'fake',
        validate: (value: unknown) => ({ value: value as User }),
      },
    };

    const result = http.get('/u', { validate: schema });

    type Data = Awaited<typeof result>['data'];
    expectTypeOf<Data>().toEqualTypeOf<User>();
    expectTypeOf<Data>().not.toBeUnknown();
  });

  it('http.post with validate narrows the response, body remains the B generic', () => {
    const validator = (input: unknown): Created => input as Created;
    const result = http.post('/users', { name: 'mickey' } as NewUser, { validate: validator });

    type Data = Awaited<typeof result>['data'];
    expectTypeOf<Data>().toEqualTypeOf<Created>();
  });

  it('http.delete and http.put narrow via validate too', () => {
    const validator = (input: unknown): User => input as User;

    expectTypeOf(http.delete('/u/1', { validate: validator })).resolves.toEqualTypeOf<
      HttpResponse<User>
    >();

    expectTypeOf(
      http.put('/u/1', { name: 'x' } as NewUser, { validate: validator }),
    ).resolves.toEqualTypeOf<HttpResponse<User>>();
  });

  // ---- ValidatorOutput conditional type isolation -------------------------

  it('ValidatorOutput<V> picks the right branch for each validator shape', () => {
    type FromFn = ValidatorOutput<(input: unknown) => User>;
    expectTypeOf<FromFn>().toEqualTypeOf<User>();

    type FromParse = ValidatorOutput<{ parse(input: unknown): User }>;
    expectTypeOf<FromParse>().toEqualTypeOf<User>();

    type FromStandard = ValidatorOutput<FakeStandardSchema<User>>;
    expectTypeOf<FromStandard>().toEqualTypeOf<User>();

    type FromUnknown = ValidatorOutput<unknown>;
    expectTypeOf<FromUnknown>().toBeUnknown();
  });

  // ---- Validator union still works as before ------------------------------

  it('Validator<T> accepts all three shapes assignably', () => {
    const fn: Validator<User> = (i: unknown) => i as User;
    const parseObj: Validator<User> = { parse: (i: unknown) => i as User };
    const std: Validator<User> = {
      '~standard': {
        version: 1,
        vendor: 'fake',
        validate: (v) => ({ value: v as User }),
      },
    };

    expectTypeOf(fn).toMatchTypeOf<Validator<User>>();
    expectTypeOf(parseObj).toMatchTypeOf<Validator<User>>();
    expectTypeOf(std).toMatchTypeOf<Validator<User>>();
  });
});
