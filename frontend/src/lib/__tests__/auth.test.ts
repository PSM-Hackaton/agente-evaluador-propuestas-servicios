import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOGIN_DOMAIN,
  DEMO_LOGIN_DOMAIN,
  normalizeLoginIdentifier,
} from '../auth';

describe('normalizeLoginIdentifier', () => {
  it('completa usuarios cortos con el dominio por defecto', () => {
    expect(normalizeLoginIdentifier('admin')).toBe(`admin@${DEFAULT_LOGIN_DOMAIN}`);
    expect(normalizeLoginIdentifier('  Revisor  ')).toBe(`revisor@${DEFAULT_LOGIN_DOMAIN}`);
    expect(normalizeLoginIdentifier('CARGADOR')).toBe(`cargador@${DEFAULT_LOGIN_DOMAIN}`);
  });

  it('conserva correos completos normalizados a minúsculas', () => {
    expect(normalizeLoginIdentifier('  Usuario@Institucion.VE ')).toBe('usuario@institucion.ve');
  });

  it('soporta dominio de demostración y entradas vacías', () => {
    expect(normalizeLoginIdentifier('admin', DEMO_LOGIN_DOMAIN)).toBe(`admin@${DEMO_LOGIN_DOMAIN}`);
    expect(normalizeLoginIdentifier('   ')).toBe('');
  });
});
