import { httpApi } from './http';
import { mockApi } from './mock';
import type { Api } from './types';

// La API real es el valor por defecto; el modo demostración solo se activa con VITE_USE_MOCK=true explícito.
export const isMock = import.meta.env.VITE_USE_MOCK === 'true';

export const api: Api = isMock ? mockApi : httpApi;

export * from './types';
