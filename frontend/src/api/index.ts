import { httpApi } from './http';
import { mockApi } from './mock';
import type { Api } from './types';

export const isMock = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false';

export const api: Api = isMock ? mockApi : httpApi;

export * from './types';
