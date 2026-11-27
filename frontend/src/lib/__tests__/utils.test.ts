import { describe, expect, it } from 'vitest';
import type { EstadoProyecto, Rol } from '../../api/types';
import { validarRif } from '../../components/SupplierFormModal';
import {
  codigoDesdeArchivo,
  detectarTipo,
  esPermitido,
  EXT_PERMITIDAS,
  proveedorDesdeCodigo,
} from '../files';
import { can, puedeTransicionar, transicionesPermitidas, type Permiso } from '../roles';

const ALL_PERMISOS: Permiso[] = [
  'proyecto.crear',
  'propuesta.cargar',
  'evaluacion.ejecutar',
  'revision.nota',
  'revision.confirmar',
  'revision.aprobar',
  'auditoria.ver',
  'usuarios.admin',
  'chat.usar',
  'proveedor.crear',
  'proveedor.editar',
  'bcv.fijar',
];

const EXPECTED_MATRIX: Record<Rol, Permiso[]> = {
  admin: ALL_PERMISOS,
  cargador: ['proyecto.crear', 'propuesta.cargar', 'chat.usar', 'proveedor.crear'],
  revisor: [
    'proyecto.crear',
    'propuesta.cargar',
    'evaluacion.ejecutar',
    'revision.nota',
    'revision.confirmar',
    'chat.usar',
    'proveedor.crear',
    'proveedor.editar',
  ],
  aprobador: [
    'evaluacion.ejecutar',
    'revision.nota',
    'revision.aprobar',
    'chat.usar',
    'proveedor.editar',
    'bcv.fijar',
  ],
  auditor: ['auditoria.ver', 'chat.usar'],
};

describe('roles y permisos (roles.ts)', () => {
  it('can() evalúa correctamente los 12 permisos para los 5 roles y devuelve false para null/undefined', () => {
    const roles: Rol[] = ['admin', 'cargador', 'revisor', 'aprobador', 'auditor'];

    for (const rol of roles) {
      const expected = new Set(EXPECTED_MATRIX[rol]);
      for (const permiso of ALL_PERMISOS) {
        expect(can(rol, permiso), `${rol} -> ${permiso}`).toBe(expected.has(permiso));
      }
    }

    for (const permiso of ALL_PERMISOS) {
      expect(can(null, permiso)).toBe(false);
      expect(can(undefined, permiso)).toBe(false);
    }
  });

  it('transicionesPermitidas() filtra por estado y rol', () => {
    const estados: EstadoProyecto[] = [
      'EN_RECEPCION',
      'EN_EVALUACION',
      'EN_REVISION_COMITE',
      'ADJUDICADO',
      'CERRADO',
    ];

    for (const estado of estados) {
      expect(transicionesPermitidas(estado, null)).toEqual([]);
      expect(transicionesPermitidas(estado, undefined)).toEqual([]);
      expect(transicionesPermitidas(estado, 'cargador')).toEqual([]);
      expect(transicionesPermitidas(estado, 'auditor')).toEqual([]);
    }

    expect(transicionesPermitidas('CERRADO', 'admin')).toEqual([]);
    expect(transicionesPermitidas('CERRADO', 'aprobador')).toEqual([]);

    expect(transicionesPermitidas('EN_RECEPCION', 'revisor').map((t) => t.a)).toEqual(['EN_EVALUACION']);
    expect(transicionesPermitidas('EN_RECEPCION', 'aprobador').map((t) => t.a)).toEqual([
      'EN_EVALUACION',
      'CERRADO',
    ]);
    expect(transicionesPermitidas('EN_EVALUACION', 'revisor').map((t) => t.a)).toEqual([
      'EN_RECEPCION',
      'EN_REVISION_COMITE',
    ]);
    expect(transicionesPermitidas('EN_REVISION_COMITE', 'aprobador').map((t) => t.a)).toEqual([
      'EN_EVALUACION',
      'ADJUDICADO',
      'CERRADO',
    ]);
    expect(transicionesPermitidas('ADJUDICADO', 'admin').map((t) => t.a)).toEqual(['CERRADO']);
  });

  it('puedeTransicionar() valida transiciones concretas por rol', () => {
    expect(puedeTransicionar('EN_EVALUACION', 'EN_REVISION_COMITE', 'revisor')).toBe(true);
    expect(puedeTransicionar('EN_REVISION_COMITE', 'ADJUDICADO', 'revisor')).toBe(false);

    expect(puedeTransicionar('EN_REVISION_COMITE', 'ADJUDICADO', 'aprobador')).toBe(true);
    expect(puedeTransicionar('EN_EVALUACION', 'EN_REVISION_COMITE', 'aprobador')).toBe(false);
    expect(puedeTransicionar('ADJUDICADO', 'CERRADO', 'aprobador')).toBe(true);

    expect(puedeTransicionar('EN_RECEPCION', 'EN_EVALUACION', 'admin')).toBe(true);
    expect(puedeTransicionar('CERRADO', 'EN_RECEPCION', 'admin')).toBe(false);

    expect(puedeTransicionar('EN_RECEPCION', 'EN_EVALUACION', 'cargador')).toBe(false);
    expect(puedeTransicionar('EN_RECEPCION', 'EN_EVALUACION', 'auditor')).toBe(false);
  });
});

describe('utilidades de archivos (files.ts)', () => {
  it('detectarTipo() clasifica extensiones sin importar mayúsculas/minúsculas', () => {
    expect(detectarTipo('Propuesta_923.pdf')).toBe('pdf');
    expect(detectarTipo('PROPUESTA.PDF')).toBe('pdf');

    for (const ext of ['xlsx', 'xlsm', 'xls', 'csv', 'tsv']) {
      expect(detectarTipo(`datos.${ext}`)).toBe('xlsx');
    }

    for (const ext of ['docx', 'txt', 'md']) {
      expect(detectarTipo(`pliego.${ext}`)).toBe('documento');
    }

    expect(detectarTipo('chat_captura.png')).toBe('captura');
    expect(detectarTipo('CHAT.PNG')).toBe('captura');

    for (const ext of ['jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif']) {
      expect(detectarTipo(`escaneo.${ext}`)).toBe('imagen');
    }
    expect(detectarTipo('sin_extension')).toBe('imagen');
  });

  it('esPermitido() acepta las 16 extensiones soportadas y rechaza las no permitidas', () => {
    expect(EXT_PERMITIDAS).toHaveLength(16);
    for (const ext of EXT_PERMITIDAS) {
      expect(esPermitido(`archivo.${ext}`)).toBe(true);
      expect(esPermitido(`ARCHIVO.${ext.toUpperCase()}`)).toBe(true);
    }

    for (const bad of ['script.exe', 'comprimido.zip', 'pagina.html', 'codigo.js', 'sin_extension', '.']) {
      expect(esPermitido(bad)).toBe(false);
    }
  });

  it('codigoDesdeArchivo() remueve la última extensión o conserva nombres sin extensión válida', () => {
    expect(codigoDesdeArchivo('Propuesta_923_Grupo_Digital_Miranda_CA.pdf')).toBe(
      'Propuesta_923_Grupo_Digital_Miranda_CA',
    );
    expect(codigoDesdeArchivo('presupuesto.v2.final.xlsx')).toBe('presupuesto.v2.final');
    expect(codigoDesdeArchivo('sin_extension')).toBe('sin_extension');
    expect(codigoDesdeArchivo('.gitignore')).toBe('.gitignore');
  });

  it('proveedorDesdeCodigo() extrae y formatea el nombre del proveedor', () => {
    expect(proveedorDesdeCodigo('Propuesta_923_Grupo_Digital_Miranda_CA')).toBe(
      'Grupo Digital Miranda C.A.',
    );
    expect(proveedorDesdeCodigo('Propuesta_841_Avila_Hardware__Redes_CA')).toBe(
      'Avila Hardware Redes C.A.',
    );
    expect(proveedorDesdeCodigo('propuesta_101_alfa_ca')).toBe('alfa C.A.');
    expect(proveedorDesdeCodigo('Servicios_Integrales_CA')).toBe('Servicios Integrales C.A.');
    expect(proveedorDesdeCodigo('Distribuidora_Andina_SRL')).toBe('Distribuidora Andina SRL');
  });
});

describe('validación de RIF (SupplierFormModal.tsx)', () => {
  it('permite RIF vacío o con formato válido y rechaza formatos inválidos', () => {
    expect(validarRif('')).toBe(true);
    expect(validarRif('   ')).toBe(true);

    expect(validarRif('J-12345678-9')).toBe(true);
    expect(validarRif('V-1234567-0')).toBe(true);
    expect(validarRif('E-123456-7')).toBe(true);
    expect(validarRif('G-200001234-5')).toBe(true);
    expect(validarRif('P-9876543-1')).toBe(true);
    expect(validarRif('  j-12345678-9  ')).toBe(true);

    expect(validarRif('X-12345678-9')).toBe(false);
    expect(validarRif('J123456789')).toBe(false);
    expect(validarRif('J-12345-9')).toBe(false);
    expect(validarRif('J-1234567890-9')).toBe(false);
    expect(validarRif('J-12345678-99')).toBe(false);
    expect(validarRif('J-1234ABCD-9')).toBe(false);
  });
});
