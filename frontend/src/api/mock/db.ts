// Base de datos simulada en localStorage (solo modo demo).
// Mismas entidades que las tablas del backend (docs/PLAN_DE_TRABAJO.md §3.2).
import type {
  Evaluacion,
  HistorialEstado,
  MensajeChat,
  Propuesta,
  Proveedor,
  Proyecto,
  RegistroAuditoria,
  ResultadoPropuesta,
  Revision,
  TasaCambio,
  TrazaAgente,
  Usuario,
} from '../types';
import { DEMO_SPECS, TASA_DEMO, calcularItems, specGenerica, type DemoSpec } from './specs';

export type ProyectoRow = Omit<Proyecto, 'total_propuestas'>;
export type ProveedorRow = Omit<Proveedor, 'total_participaciones'>;

export interface DB {
  version: number;
  usuarios: Usuario[];
  proyectos: ProyectoRow[];
  historial: HistorialEstado[];
  proveedores: ProveedorRow[];
  propuestas: Propuesta[];
  evaluaciones: Evaluacion[];
  trazas: Record<string, TrazaAgente[]>;
  revisiones: Revision[];
  auditoria: RegistroAuditoria[];
  chat: Record<string, MensajeChat[]>;
  tasa: TasaCambio;
}

const KEY = 'aeps.mockdb';
const VERSION = 1;

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Propuestas del proyecto histórico (para mostrar historial y alertas) ──
const HIST_SPECS: Record<string, DemoSpec> = {
  Propuesta_412_Grupo_Digital_Miranda_CA: {
    ...DEMO_SPECS.Propuesta_923_Grupo_Digital_Miranda_CA,
    estudiante: { desc: 'Laptop ejecutiva · Core i5 · 16 GB · 512 GB', unit: 890, mercado: 870 },
    docente: { desc: 'Equipo de videoconferencia 4K', unit: 1450, mercado: 1400 },
    perifericos: { desc: 'Ratón inalámbrico y maletín', unit: 0 },
    envio: 0,
    instalacion: 150,
    extra: undefined,
    puntaje: 90,
    dictamen: 'Adjudicada. Mejor relación calidad/precio y garantía local de 24 meses.',
  },
  Propuesta_419_Avila_Hardware__Redes_CA: {
    ...DEMO_SPECS.Propuesta_841_Avila_Hardware__Redes_CA,
    estudiante: { desc: 'Laptop ejecutiva · Ryzen 5 · 16 GB · 512 GB', unit: 860, mercado: 870 },
    docente: { desc: 'Equipo de videoconferencia 1080p', unit: 1200, mercado: 1250 },
    perifericos: { desc: 'Ratón inalámbrico', unit: 0 },
    valida: true,
    motivos: [],
    puntaje: 80,
    hallazgos: {},
    dictamen: 'Válida. Segunda opción: menor costo pero cámara de videoconferencia de menor resolución.',
  },
  Propuesta_415_Ofertas_Express_Digital_CA: {
    ...DEMO_SPECS.Propuesta_975_Ofertas_Express_Digital_CA,
    estudiante: { desc: 'Laptop ejecutiva · Core i5 · 8 GB · 256 GB', unit: 790, mercado: 760 },
    docente: { desc: 'Equipo de videoconferencia 1080p', unit: 1100, mercado: 1250 },
    perifericos: { desc: 'Ratón', unit: 0 },
    ajustes: [
      {
        concepto: 'recargo',
        descripcion: 'Recargo por envío desde Maracaibo (45 %)',
        porcentaje: 45,
        fuente_texto: 'Nota al pie: "Envío desde Maracaibo con recargo del 45%"',
      },
    ],
    dictamen: 'Descartada por recargo de envío desmedido (45 % sobre la factura).',
  },
};

export function specDe(p: Pick<Propuesta, 'codigo' | 'proveedor_nombre' | 'tipo'>): DemoSpec {
  return DEMO_SPECS[p.codigo] ?? HIST_SPECS[p.codigo] ?? specGenerica(p.codigo, p.proveedor_nombre ?? p.codigo, p.tipo);
}

export function construirResultado(p: Propuesta, spec: DemoSpec, tasa: number): ResultadoPropuesta {
  const { items, totalDeclaradoUsd } = calcularItems(spec);
  const ajustes = spec.ajustes.map((a) => ({
    concepto: a.concepto,
    descripcion: a.descripcion,
    porcentaje: a.porcentaje ?? null,
    monto_usd: round2(a.monto ?? ((a.porcentaje ?? 0) / 100) * totalDeclaradoUsd),
    fuente_texto: a.fuente_texto,
  }));
  const totalAjustado = round2(totalDeclaradoUsd + ajustes.reduce((s, a) => s + a.monto_usd, 0));
  return {
    propuesta_id: p.id,
    codigo: p.codigo,
    proveedor: spec.proveedor,
    tipo: spec.tipo,
    posicion: 0,
    valida: spec.valida,
    motivos_descarte: spec.motivos,
    moneda: spec.moneda,
    total_declarado: spec.moneda === 'VES' ? round2(totalDeclaradoUsd * tasa) : totalDeclaradoUsd,
    total_declarado_usd: totalDeclaradoUsd,
    ajustes,
    total_ajustado_usd: totalAjustado,
    puntaje_tecnico: spec.puntaje,
    dictamen: spec.dictamen,
    items,
  };
}

/** Válidas por puntaje técnico (desc) y luego las descartadas. */
export function ordenarResultados(rs: ResultadoPropuesta[]): ResultadoPropuesta[] {
  const validas = rs.filter((r) => r.valida).sort((a, b) => b.puntaje_tecnico - a.puntaje_tecnico);
  const descartadas = rs.filter((r) => !r.valida);
  return [...validas, ...descartadas].map((r, i) => ({ ...r, posicion: i + 1 }));
}

function crearSeed(): DB {
  const usuarios: Usuario[] = [
    { id: 'u-admin', nombre: 'Ana Administradora', email: 'admin@demo.ve', rol: 'admin', activo: true, creado_en: '2026-10-01T08:00:00-04:00' },
    { id: 'u-carga', nombre: 'Carlos Carga', email: 'carga@demo.ve', rol: 'cargador', activo: true, creado_en: '2026-10-01T08:05:00-04:00' },
    { id: 'u-rev', nombre: 'Rosa Revisora', email: 'revisor@demo.ve', rol: 'revisor', activo: true, creado_en: '2026-10-01T08:10:00-04:00' },
    { id: 'u-apro', nombre: 'Alberto Aprobador', email: 'aprobador@demo.ve', rol: 'aprobador', activo: true, creado_en: '2026-10-01T08:15:00-04:00' },
    { id: 'u-aud', nombre: 'Aurora Auditora', email: 'auditor@demo.ve', rol: 'auditor', activo: true, creado_en: '2026-10-01T08:20:00-04:00' },
  ];

  const proyectos: ProyectoRow[] = [
    {
      id: 'p-hoyada',
      nombre: 'Dotación de Laboratorio de Computación',
      descripcion:
        'Instituto Educativo Nacional Bicentenario. Adquisición de 11 computadoras completas (10 estudiantes + 1 docente) de gama media-alta para clases de programación, diseño 3D y edición de video con software open source. Incluye gabinete, monitor, teclado, ratón y protector eléctrico, entrega, instalación y verificación.',
      ubicacion: 'La Hoyada, Municipio Libertador, Caracas',
      presupuesto_ref: null,
      moneda_ref: 'USD',
      estado: 'EN_RECEPCION',
      archivo_proyecto: 'proyecto.pdf',
      creado_por: 'Carlos Carga',
      creado_en: '2026-11-25T09:00:00-04:00',
    },
    {
      id: 'p-chacao',
      nombre: 'Equipos para sala de reuniones',
      descripcion: 'Adquisición de 10 laptops ejecutivas y 1 equipo de videoconferencia para la sala de reuniones de la sede administrativa.',
      ubicacion: 'Sede Chacao, Caracas',
      presupuesto_ref: 12000,
      moneda_ref: 'USD',
      estado: 'ADJUDICADO',
      archivo_proyecto: 'requerimiento_sala_reuniones.pdf',
      creado_por: 'Carlos Carga',
      creado_en: '2026-10-05T10:00:00-04:00',
    },
  ];

  const proveedores: ProveedorRow[] = Object.entries(DEMO_SPECS).map(([codigo, s]) => ({
    id: `prov-${codigo.split('_')[1]}`,
    nombre: s.proveedor,
    rif: s.rif,
    ubicacion: s.ubicacion,
    telefono: s.telefono,
    email: null,
    alerta: false,
    motivo_alerta: null,
  }));
  const provPorNombre = (n: string) => proveedores.find((p) => p.nombre === n)!;
  const ofertas = provPorNombre('Ofertas Express Digital C.A.');
  ofertas.alerta = true;
  ofertas.motivo_alerta = 'Descartado en "Equipos para sala de reuniones" (oct. 2026): Costos o condiciones abusivas';

  const propuestas: Propuesta[] = Object.entries(DEMO_SPECS).map(([codigo, s], i) => ({
    id: `prop-${codigo.split('_')[1]}`,
    codigo,
    proyecto_id: 'p-hoyada',
    proveedor_id: provPorNombre(s.proveedor).id,
    proveedor_nombre: s.proveedor,
    archivo_nombre: `${codigo}.${s.ext}`,
    tipo: s.tipo,
    moneda: null,
    total_declarado: null,
    estado: 'cargada',
    subido_en: new Date(Date.parse('2026-11-25T10:00:00-04:00') + i * 7 * 60000).toISOString(),
  }));

  const histProps: Propuesta[] = Object.entries(HIST_SPECS).map(([codigo, s], i) => {
    const { totalDeclaradoUsd } = calcularItems(s);
    return {
      id: `prop-${codigo.split('_')[1]}`,
      codigo,
      proyecto_id: 'p-chacao',
      proveedor_id: provPorNombre(s.proveedor).id,
      proveedor_nombre: s.proveedor,
      archivo_nombre: `${codigo}.${s.ext}`,
      tipo: s.tipo,
      moneda: s.moneda,
      total_declarado: totalDeclaradoUsd,
      estado: 'procesada',
      subido_en: new Date(Date.parse('2026-10-06T09:00:00-04:00') + i * 3600000).toISOString(),
    };
  });
  propuestas.push(...histProps);

  const resultadosHist = ordenarResultados(histProps.map((p) => construirResultado(p, specDe(p), TASA_DEMO)));
  const evaluaciones: Evaluacion[] = [
    {
      id: 'ev-chacao',
      proyecto_id: 'p-chacao',
      estado: 'completada',
      inicio: '2026-10-08T14:00:00-04:00',
      fin: '2026-10-08T14:02:31-04:00',
      recomendada_id: resultadosHist[0].propuesta_id,
      ranking: resultadosHist.map((r) => r.codigo),
      tasa_bcv_usada: TASA_DEMO,
      ejecutada_por: 'Rosa Revisora',
      resultados: resultadosHist,
    },
  ];

  const trazas: Record<string, TrazaAgente[]> = {
    'ev-chacao': [
      { id: uid(), ts: '2026-10-08T14:00:00-04:00', paso: 'inicio', propuesta_id: null, codigo: null, nivel: 'info', mensaje: 'Iniciando evaluación de 3 propuestas' },
      { id: uid(), ts: '2026-10-08T14:01:10-04:00', paso: 'logistica', propuesta_id: 'prop-415', codigo: 'Propuesta_415_Ofertas_Express_Digital_CA', nivel: 'alerta', mensaje: 'Letra pequeña: recargo del 45 % por envío desde Maracaibo' },
      { id: uid(), ts: '2026-10-08T14:02:31-04:00', paso: 'dictamen', propuesta_id: null, codigo: null, nivel: 'ok', mensaje: 'Recomendada: Propuesta_412_Grupo_Digital_Miranda_CA' },
    ],
  };

  const historial: HistorialEstado[] = [
    { id: uid(), proyecto_id: 'p-chacao', estado_anterior: null, estado_nuevo: 'EN_RECEPCION', usuario: 'Carlos Carga', fecha: '2026-10-05T10:00:00-04:00', nota: 'Proyecto creado' },
    { id: uid(), proyecto_id: 'p-chacao', estado_anterior: 'EN_RECEPCION', estado_nuevo: 'EN_EVALUACION', usuario: 'Rosa Revisora', fecha: '2026-10-08T14:00:00-04:00', nota: 'Evaluación automática iniciada' },
    { id: uid(), proyecto_id: 'p-chacao', estado_anterior: 'EN_EVALUACION', estado_nuevo: 'EN_REVISION_COMITE', usuario: 'Agente IA', fecha: '2026-10-08T14:02:31-04:00', nota: 'Evaluación automática completada' },
    { id: uid(), proyecto_id: 'p-chacao', estado_anterior: 'EN_REVISION_COMITE', estado_nuevo: 'ADJUDICADO', usuario: 'Alberto Aprobador', fecha: '2026-10-12T11:30:00-04:00', nota: 'Adjudicado a Grupo Digital Miranda C.A.' },
    { id: uid(), proyecto_id: 'p-hoyada', estado_anterior: null, estado_nuevo: 'EN_RECEPCION', usuario: 'Carlos Carga', fecha: '2026-11-25T09:00:00-04:00', nota: 'Proyecto creado' },
  ];

  const revisiones: Revision[] = [
    { id: uid(), evaluacion_id: 'ev-chacao', usuario: 'Rosa Revisora', rol: 'revisor', accion: 'confirmar', comentario: 'Verifiqué el recargo de Ofertas Express en el documento original. Coincido con el ranking.', fecha: '2026-10-09T09:15:00-04:00' },
    { id: uid(), evaluacion_id: 'ev-chacao', usuario: 'Alberto Aprobador', rol: 'aprobador', accion: 'aprobar', comentario: 'Se aprueba la adjudicación a Grupo Digital Miranda C.A.', fecha: '2026-10-12T11:30:00-04:00' },
  ];

  const auditoria: RegistroAuditoria[] = [
    { id: uid(), usuario: 'Carlos Carga', accion: 'propuesta.cargar', entidad: 'proyecto', entidad_id: 'p-hoyada', cambios: { archivos: propuestas.filter((p) => p.proyecto_id === 'p-hoyada').length }, ip: '10.0.0.12', fecha: '2026-11-25T11:05:00-04:00' },
    { id: uid(), usuario: 'Carlos Carga', accion: 'proyecto.crear', entidad: 'proyecto', entidad_id: 'p-hoyada', cambios: { nombre: 'Dotación de Laboratorio de Computación' }, ip: '10.0.0.12', fecha: '2026-11-25T09:00:00-04:00' },
    { id: uid(), usuario: 'Alberto Aprobador', accion: 'revision.aprobar', entidad: 'evaluacion', entidad_id: 'ev-chacao', cambios: { estado: 'ADJUDICADO' }, ip: '10.0.0.30', fecha: '2026-10-12T11:30:00-04:00' },
    { id: uid(), usuario: 'Rosa Revisora', accion: 'revision.confirmar', entidad: 'evaluacion', entidad_id: 'ev-chacao', cambios: null, ip: '10.0.0.21', fecha: '2026-10-09T09:15:00-04:00' },
    { id: uid(), usuario: 'Rosa Revisora', accion: 'evaluacion.ejecutar', entidad: 'proyecto', entidad_id: 'p-chacao', cambios: null, ip: '10.0.0.21', fecha: '2026-10-08T14:00:00-04:00' },
  ];

  return {
    version: VERSION,
    usuarios,
    proyectos,
    historial,
    proveedores,
    propuestas,
    evaluaciones,
    trazas,
    revisiones,
    auditoria,
    chat: {},
    tasa: { fecha: new Date().toISOString(), usd_ves: TASA_DEMO, fuente: 'manual' },
  };
}

export function cargarDB(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed.version === VERSION) return parsed;
    }
  } catch {
    /* datos corruptos: se regenera */
  }
  const db = crearSeed();
  localStorage.setItem(KEY, JSON.stringify(db));
  return db;
}

export function guardarDB(db: DB) {
  localStorage.setItem(KEY, JSON.stringify(db));
}

export function reiniciarDB(): DB {
  const db = crearSeed();
  guardarDB(db);
  return db;
}
