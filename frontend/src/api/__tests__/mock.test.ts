import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

let mockApi: typeof import('../mock').mockApi;
let resetMockData: typeof import('../mock').resetMockData;
let constantTimeEqual: typeof import('../mock').constantTimeEqual;
let uid: typeof import('../mock/db').uid;
let DEMO_PASSWORD: typeof import('../mock/specs').DEMO_PASSWORD;
let saveSession: typeof import('../session').saveSession;

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('mock API y utilidades de seguridad', () => {
  beforeAll(async () => {
    const ls = createMemoryStorage();
    const ss = createMemoryStorage();
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('window', {
      sessionStorage: ss,
      localStorage: ls,
      location: { origin: 'http://localhost', assign: vi.fn() },
    });

    const mockMod = await import('../mock');
    const dbMod = await import('../mock/db');
    const specsMod = await import('../mock/specs');
    const sessionMod = await import('../session');

    mockApi = mockMod.mockApi;
    resetMockData = mockMod.resetMockData;
    constantTimeEqual = mockMod.constantTimeEqual;
    uid = dbMod.uid;
    DEMO_PASSWORD = specsMod.DEMO_PASSWORD;
    saveSession = sessionMod.saveSession;

    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    const ls = createMemoryStorage();
    const ss = createMemoryStorage();
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('window', {
      sessionStorage: ss,
      localStorage: ls,
      location: { origin: 'http://localhost', assign: vi.fn() },
    });
    resetMockData();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('constantTimeEqual compara cadenas idénticas, longitudes distintas, bytes distintos y vacías', () => {
    expect(constantTimeEqual('demo1234', 'demo1234')).toBe(true);
    expect(constantTimeEqual('áéíóú-seguro', 'áéíóú-seguro')).toBe(true);
    expect(constantTimeEqual('', '')).toBe(true);

    expect(constantTimeEqual('', 'a')).toBe(false);
    expect(constantTimeEqual('a', '')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('abcd', 'abc')).toBe(false);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('demo1234', 'demo1235')).toBe(false);
  });

  it('uid() genera UUIDs v4 únicos sin invocar Math.random() (incluyendo respaldo getRandomValues)', () => {
    const mathRandomSpy = vi.spyOn(Math, 'random');

    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const id = uid();
      expect(id).toMatch(UUID_V4_RE);
      ids.add(id);
    }
    expect(ids.size).toBe(20);

    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
    });

    for (let i = 0; i < 10; i++) {
      const fallbackId = uid();
      expect(fallbackId).toMatch(UUID_V4_RE);
      ids.add(fallbackId);
    }
    expect(ids.size).toBe(30);
    expect(mathRandomSpy).not.toHaveBeenCalled();
  });

  it('mockApi.projects.uploadDocument() añade el documento a un proyecto creado sin él y permite reemplazarlo', async () => {
    vi.useFakeTimers();

    const loginPromise = mockApi.auth.login('admin@demo.ve', DEMO_PASSWORD);
    await vi.runAllTimersAsync();
    const { token, user, refreshToken } = await loginPromise;
    saveSession(token, user, refreshToken);

    const createPromise = mockApi.projects.create(
      { nombre: 'Proyecto sin documento', descripcion: '', ubicacion: 'Caracas', presupuesto_ref: null, moneda_ref: 'USD' },
      null,
    );
    await vi.runAllTimersAsync();
    const proyecto = await createPromise;
    expect(proyecto.archivo_proyecto).toBeNull();

    const subida = mockApi.projects.uploadDocument(proyecto.id, new File(['pdf'], 'proyecto.pdf', { type: 'application/pdf' }));
    await vi.runAllTimersAsync();
    expect((await subida).archivo_proyecto).toBe('proyecto.pdf');

    const reemplazo = mockApi.projects.uploadDocument(proyecto.id, new File(['md'], 'terminos-v2.md', { type: 'text/markdown' }));
    await vi.runAllTimersAsync();
    expect((await reemplazo).archivo_proyecto).toBe('terminos-v2.md');
    vi.useRealTimers();
  });

  it('mockApi.suppliers.get() marca como adjudicada la propuesta alternativa de reviews.add y como valida la recomendada original', async () => {
    vi.useFakeTimers();

    const loginPromise = mockApi.auth.login('admin@demo.ve', DEMO_PASSWORD);
    await vi.runAllTimersAsync();
    const { token, user, refreshToken } = await loginPromise;
    saveSession(token, user, refreshToken);

    const createPromise = mockApi.projects.create(
      {
        nombre: 'Proyecto Adjudicación Alternativa',
        descripcion: 'Prueba de adjudicación alternativa en modo mock',
        ubicacion: 'Caracas',
        presupuesto_ref: 25000,
        moneda_ref: 'USD',
      },
      null,
    );
    await vi.runAllTimersAsync();
    const proyecto = await createPromise;

    const uploadPromise = mockApi.proposals.upload(proyecto.id, [
      new File(['pdf'], 'Propuesta_923_Grupo_Digital_Miranda_CA.pdf', { type: 'application/pdf' }),
      new File(['xlsx'], 'Propuesta_638_TecnoAndes_Soluciones_CA.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      new File(['png'], 'Propuesta_602_Krypton_Ingenieria_CA.png', { type: 'image/png' }),
    ]);
    await vi.runAllTimersAsync();
    const propuestas = await uploadPromise;

    const prop923 = propuestas.find((p) => p.codigo === 'Propuesta_923_Grupo_Digital_Miranda_CA');
    const prop638 = propuestas.find((p) => p.codigo === 'Propuesta_638_TecnoAndes_Soluciones_CA');
    expect(prop923).toBeDefined();
    expect(prop638).toBeDefined();

    const startPromise = mockApi.evaluations.start(proyecto.id);
    await vi.runAllTimersAsync();
    const evaluacionIniciada = await startPromise;
    await vi.runAllTimersAsync();

    const getEvalPromise = mockApi.evaluations.get(evaluacionIniciada.id);
    await vi.runAllTimersAsync();
    const evaluacion = await getEvalPromise;

    expect(evaluacion.estado).toBe('completada');
    expect(evaluacion.recomendada_id).toBe(prop923!.id);
    expect(prop638!.id).not.toBe(evaluacion.recomendada_id);

    const reviewPromise = mockApi.reviews.add(
      evaluacion.id,
      'aprobar',
      'Se selecciona TecnoAndes por disponibilidad inmediata en región andina.',
      { propuesta_adjudicada_id: prop638!.id },
    );
    await vi.runAllTimersAsync();
    const review = await reviewPromise;

    expect(review.es_anulacion).toBe(true);
    expect(review.propuesta_adjudicada_id).toBe(prop638!.id);

    const sup638Promise = mockApi.suppliers.get('prov-638');
    await vi.runAllTimersAsync();
    const sup638 = await sup638Promise;

    const sup923Promise = mockApi.suppliers.get('prov-923');
    await vi.runAllTimersAsync();
    const sup923 = await sup923Promise;

    const part638 = sup638.participaciones.find((p) => p.proyecto_id === proyecto.id);
    const part923 = sup923.participaciones.find((p) => p.proyecto_id === proyecto.id);

    expect(part638?.resultado).toBe('adjudicada');
    expect(part923?.resultado).toBe('valida');
  });
});
