import type { Express } from 'express';
import { inject, type Response as InjectResponse } from 'light-my-request';
import { createApp } from '../src/app';

export const app: Express = createApp();

export interface TestUser {
  name: string;
  email: string;
  password: string;
}

export const demoUser: TestUser = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'Sup3rSecret!',
};

export async function registerRequest(overrides: Partial<TestUser> = {}): Promise<InjectResponse> {
  return inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: { ...demoUser, ...overrides },
  });
}

export async function loginRequest(
  email: string = demoUser.email,
  password: string = demoUser.password,
): Promise<InjectResponse> {
  return inject(app, { method: 'POST', url: '/api/auth/login', payload: { email, password } });
}

export async function registerAndGetToken(overrides: Partial<TestUser> = {}): Promise<string> {
  const res = await registerRequest(overrides);
  const body = res.json<{ data: { token: string } }>();
  return body.data.token;
}

export function parseJson<T>(res: InjectResponse): T {
  return res.json<T>();
}
