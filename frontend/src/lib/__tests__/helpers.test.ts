import { describe, expect, it } from 'vitest';
import { codigoDesdeArchivo, detectarTipo, esPermitido, proveedorDesdeCodigo } from '../files';
import { validarRif } from '../../components/SupplierFormModal';
import { can, puedeTransicionar } from '../roles';

describe('utilidades de interfaz', () => {
  it('valida extensiones y extrae código y proveedor del archivo', () => {
    expect(esPermitido('oferta.XLSX')).toBe(true);
    expect(esPermitido('oferta.exe')).toBe(false);
    expect(detectarTipo('captura.png')).toBe('captura');
    expect(codigoDesdeArchivo('Propuesta_602_Proveedor.xlsx')).toBe('Propuesta_602_Proveedor');
    expect(proveedorDesdeCodigo('Propuesta_602_Grupo_Digital_CA')).toBe('Grupo Digital C.A.');
  });

  it('valida RIF vacío, formato válido e inválido', () => {
    expect(validarRif('')).toBe(true);
    expect(validarRif(' J-12345678-9 ')).toBe(true);
    expect(validarRif('J-12-3')).toBe(false);
  });

  it('aplica permisos y transiciones por rol', () => {
    expect(can('auditor', 'auditoria.ver')).toBe(true);
    expect(can('auditor', 'evaluacion.ejecutar')).toBe(false);
    expect(puedeTransicionar('EN_REVISION_COMITE', 'ADJUDICADO', 'aprobador')).toBe(true);
    expect(puedeTransicionar('EN_REVISION_COMITE', 'ADJUDICADO', 'revisor')).toBe(false);
  });
});
