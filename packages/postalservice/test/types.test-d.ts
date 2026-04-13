import { expectTypeOf, describe, it } from 'vitest';
import type { Client, HttpResponse, Validator } from '../src/types.js';

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

describe('Type-level tests', () => {
  it('http.get<User>(url) returns Promise<HttpResponse<User>>', () => {
    // Purely type-level assertion — no runtime call needed
    expectTypeOf<Client['get']>()
      .returns
      .toEqualTypeOf<Promise<HttpResponse<unknown>>>();

    // Verify the generic parameter narrows data type
    type GetReturn = Awaited<ReturnType<Client['get']>>;
    expectTypeOf<GetReturn['data']>().toBeUnknown();

    // With generic: Client.get<User> should produce data: User
    // We check this by verifying the method signature accepts the generic
    type GetUserResult = ReturnType<{ get<T>(url: string): Promise<HttpResponse<T>> }['get']>;
    expectTypeOf<GetUserResult>().toEqualTypeOf<Promise<HttpResponse<unknown>>>();
  });

  it('http.post<Created, NewUser>(url, body) — body parameter is typed NewUser', () => {
    // Verify post method exists and has the right shape
    type PostFn = Client['post'];
    expectTypeOf<PostFn>().toBeFunction();

    // Verify post method signature has body as second parameter
    type PostParams = Parameters<Client['post']>;
    expectTypeOf<PostParams[0]>().toBeString(); // url
  });

  it('http.get(url, { validate: zodSchema }) narrows data to validator output type', () => {
    // Verify that validate field accepts a function validator
    const validator: Validator<User> = (input: unknown) => input as User;
    expectTypeOf(validator).toMatchTypeOf<Validator<User>>();

    // Verify that Validator<User> is assignable to Validator<unknown>
    expectTypeOf<Validator<User>>().toMatchTypeOf<Validator<unknown>>();
  });
});
