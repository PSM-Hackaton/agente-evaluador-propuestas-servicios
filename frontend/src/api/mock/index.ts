// API simulada: misma interfaz que la real (types.ts › Api), sin backend.
// Persiste en localStorage y simula la ejecución del agente con trazas en vivo.
import { ApiError, getToken } from '../session';
import type {
  AlertaProveedor,
  Api,
  EstadoProyecto,
  Evaluacion,
  MensajeChat,
  PasoAgente,
  Propuesta,
  ProveedorDetalle,
  Participacion,
  Proyecto,
  TrazaAgente,
  Usuario,
} from '../types';
import { can, puedeTransicionar, type Permiso } from '../../lib/roles';
import { MOTIVO_LABEL, TIPO_LABEL, CONCEPTO_LABEL } from '../../lib/labels';
import { money, pct } from '../../lib/format';
import { codigoDesdeArchivo, detectarTipo, esPermitido, proveedorDesdeCodigo } from '../../lib/files';
import { evaluacionToCSV, evaluacionToExcelHtml, evaluacionToMarkdown, slug } from '../../lib/export';
import { cargarDB, construirResultado, guardarDB, ordenarResultados, reiniciarDB, round2, specDe, uid, type DB, type ProyectoRow } from './db';
import { DEMO_PASSWORD, calcularItems } from './specs';

let db: DB = cargarDB();
const persist = () => guardarDB(db);
const delay = (ms = 160) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function resetMockData() {
  db = reiniciarDB();
}

// ── Utilidades ───────────────────────────────────────────────────────────────
function usuarioActual(): Usuario {
  const token = getToken();
  const user = token ? db.usuarios.find((u) => `mock-${u.id}` === token) : undefined;
  if (!user || !user.activo) throw new ApiError(401, 'Sesión no válida');
  return user;
}

function exigir(permiso: Permiso): Usuario {
  const u = usuarioActual();
  if (!can(u.rol, permiso)) throw new ApiError(403, 'No tiene permisos para esta acción');
  return u;
}

function registrar(usuario: string, accion: string, entidad: string, entidad_id: string | null, cambios: Record<string, unknown> | null = null) {
  db.auditoria.unshift({ id: uid(), usuario, accion, entidad, entidad_id, cambios, ip: '127.0.0.1', fecha: now() });
}

function proyectoRow(id: string): ProyectoRow {
  const p = db.proyectos.find((x) => x.id === id);
  if (!p) throw new ApiError(404, 'Proyecto no encontrado');
  return p;
}

function aProyecto(row: ProyectoRow): Proyecto {
  return { ...row, total_propuestas: db.propuestas.filter((p) => p.proyecto_id === row.id).length };
}

function cambiarEstado(row: ProyectoRow, nuevo: EstadoProyecto, usuario: string, nota: string | null) {
  if (row.estado === nuevo) return;
  db.historial.push({ id: uid(), proyecto_id: row.id, estado_anterior: row.estado, estado_nuevo: nuevo, usuario, fecha: now(), nota });
  registrar(usuario, 'proyecto.estado', 'proyecto', row.id, { de: row.estado, a: nuevo });
  row.estado = nuevo;
}

function ultimaEvaluacion(projectId: string): Evaluacion | undefined {
  return db.evaluaciones
    .filter((e) => e.proyecto_id === projectId)
    .sort((a, b) => b.inicio.localeCompare(a.inicio))[0];
}

// ── Simulación del agente ───────────────────────────────────────────────────
interface Runner {
  listeners: Set<(t: TrazaAgente) => void>;
  doneListeners: Set<(e: Evaluacion) => void>;
}
const runners = new Map<string, Runner>();

type Paso = Omit<TrazaAgente, 'id' | 'ts'>;

function planDeTrazas(proyecto: ProyectoRow, propuestas: Propuesta[]): Paso[] {
  const pasos: Paso[] = [];
  const add = (paso: PasoAgente, mensaje: string, nivel: TrazaAgente['nivel'] = 'info', p?: Propuesta, datos?: Record<string, unknown>) =>
    pasos.push({ paso, mensaje, nivel, propuesta_id: p?.id ?? null, codigo: p?.codigo ?? null, datos });

  add('inicio', `Iniciando evaluación de ${propuestas.length} propuestas para "${proyecto.nombre}" (${proyecto.ubicacion})`);
  add('lectura', `Leyendo documento del proyecto ${proyecto.archivo_proyecto ?? ''}: 11 equipos completos (10 estudiantes + 1 docente), gama media-alta, entrega e instalación en sitio`);
  add('normalizacion', `Tasa BCV obtenida: Bs. ${db.tasa.usd_ves} por USD`);

  for (const p of propuestas) {
    const s = specDe(p);
    const { items, totalDeclaradoUsd } = calcularItems(s);
    const metodo: Record<string, string> = {
      pdf: 'extracción de texto y tablas + revisión de texto oculto o diminuto',
      pdf_escaneado: 'PDF sin capa de texto → visión por página',
      xlsx: 'lectura de hojas, fórmulas, comentarios y celdas ocultas',
      imagen: 'preprocesado + visión: transcripción incluyendo notas al margen y sellos',
      captura: 'visión: lectura de la conversación y condiciones mencionadas',
    };
    add('lectura', `Leyendo ${p.archivo_nombre} (${TIPO_LABEL[s.tipo]}): ${metodo[s.tipo]}`, 'info', p);
    add('extraccion', `${s.proveedor} · ${items.length} ítems · total declarado ${money(s.moneda === 'VES' ? totalDeclaradoUsd * db.tasa.usd_ves : totalDeclaradoUsd, s.moneda)}`, 'info', p);
    if (s.moneda === 'VES') add('normalizacion', `Montos en bolívares convertidos a USD (tasa ${db.tasa.usd_ves}) → ${money(totalDeclaradoUsd)}`, 'info', p);

    const errItem = items.find((i) => Math.abs(i.subtotal_declarado - i.subtotal_calculado) > 0.009);
    if (errItem) {
      add('aritmetica', `Discrepancia: ${errItem.cantidad} × ${money(errItem.precio_unitario)} = ${money(errItem.subtotal_calculado)}, pero declara ${money(errItem.subtotal_declarado)}`, 'alerta', p, {
        calculado: errItem.subtotal_calculado,
        declarado: errItem.subtotal_declarado,
      });
    } else {
      add('aritmetica', `Cantidad × precio y suma de subtotales verificadas con código: ${money(totalDeclaradoUsd)} ✓`, 'ok', p);
    }

    add('alcance', s.hallazgos?.alcance ?? 'Cubre los 11 equipos completos (gabinete, monitor, teclado, ratón, protección) e instalación', s.hallazgos?.alcance ? 'alerta' : 'ok', p);
    add('compatibilidad', s.hallazgos?.compatibilidad ?? 'Componentes compatibles (socket, memoria, fuente y protección eléctrica)', s.hallazgos?.compatibilidad ? 'alerta' : 'ok', p);

    const item0 = items[0];
    add(
      'mercado',
      `Búsqueda web: "${s.estudiante.desc.split('·').slice(1, 4).join(' ').trim()} precio USD" → referencia ${money(item0.precio_mercado)} · ofertado ${money(item0.precio_unitario)} (${pct(item0.sobreprecio_pct)})`,
      (item0.sobreprecio_pct ?? 0) > 40 ? 'alerta' : 'ok',
      p,
    );

    if (s.ajustes.length) {
      for (const a of s.ajustes) {
        const monto = a.monto ?? ((a.porcentaje ?? 0) / 100) * totalDeclaradoUsd;
        add('logistica', `${CONCEPTO_LABEL[a.concepto]} detectado: ${a.fuente_texto} → +${money(round2(monto))}`, 'alerta', p);
      }
    } else if (s.hallazgos?.logistica) {
      add('logistica', s.hallazgos.logistica, 'alerta', p);
    } else {
      add('logistica', 'Sin costos ocultos ni condiciones especiales en notas o letra pequeña', 'ok', p);
    }

    add('inyeccion', s.hallazgos?.inyeccion ?? 'Sin instrucciones ocultas dirigidas al sistema', s.hallazgos?.inyeccion ? 'alerta' : 'ok', p);
    add(
      'dictamen',
      s.valida ? `Válida · puntaje técnico ${s.puntaje}/100` : `Descartada: ${s.motivos.map((m) => MOTIVO_LABEL[m]).join(', ')}`,
      s.valida ? 'ok' : 'alerta',
      p,
    );
  }
  return pasos;
}

function finalizar(evId: string) {
  const ev = db.evaluaciones.find((e) => e.id === evId);
  if (!ev || ev.estado !== 'en_curso') return ev;
  const proyecto = proyectoRow(ev.proyecto_id);
  const props = db.propuestas.filter((p) => p.proyecto_id === ev.proyecto_id);
  const resultados = ordenarResultados(props.map((p) => construirResultado(p, specDe(p), ev.tasa_bcv_usada)));

  for (const r of resultados) {
    const p = db.propuestas.find((x) => x.id === r.propuesta_id)!;
    p.estado = 'procesada';
    p.moneda = r.moneda;
    p.total_declarado = r.total_declarado;
    if (!r.valida && p.proveedor_id) {
      const prov = db.proveedores.find((x) => x.id === p.proveedor_id);
      if (prov) {
        prov.alerta = true;
        prov.motivo_alerta = `Descartado en "${proyecto.nombre}": ${r.motivos_descarte.map((m) => MOTIVO_LABEL[m]).join(', ')}`;
      }
    }
  }

  const validas = resultados.filter((r) => r.valida);
  ev.resultados = resultados;
  ev.ranking = resultados.map((r) => r.codigo);
  ev.recomendada_id = validas[0]?.propuesta_id ?? null;
  ev.estado = 'completada';
  ev.fin = now();

  const cierre: TrazaAgente[] = [
    {
      id: uid(),
      ts: now(),
      paso: 'ranking',
      propuesta_id: null,
      codigo: null,
      nivel: 'info',
      mensaje: `${validas.length} válidas y ${resultados.length - validas.length} descartadas. Orden por calidad técnica y cumplimiento global.`,
    },
    {
      id: uid(),
      ts: now(),
      paso: 'dictamen',
      propuesta_id: validas[0]?.propuesta_id ?? null,
      codigo: validas[0]?.codigo ?? null,
      nivel: 'ok',
      mensaje: validas[0]
        ? `Propuesta recomendada: ${validas[0].codigo} (${validas[0].proveedor}) · costo real ${money(validas[0].total_ajustado_usd)}`
        : 'Ninguna propuesta cumple los requisitos',
    },
  ];
  (db.trazas[ev.id] ??= []).push(...cierre);
  cambiarEstado(proyecto, 'EN_REVISION_COMITE', 'Agente IA', 'Evaluación automática completada');
  registrar('Agente IA', 'evaluacion.completada', 'evaluacion', ev.id, { recomendada: validas[0]?.codigo ?? null });
  persist();

  const runner = runners.get(ev.id);
  if (runner) {
    cierre.forEach((t) => runner.listeners.forEach((l) => l(t)));
    runner.doneListeners.forEach((l) => l(clone(ev)));
    runners.delete(ev.id);
  }
  return ev;
}

function ejecutar(ev: Evaluacion, pasos: Paso[]) {
  runners.set(ev.id, { listeners: new Set(), doneListeners: new Set() });
  let i = 0;
  const tick = () => {
    if (i >= pasos.length) {
      finalizar(ev.id);
      return;
    }
    const t: TrazaAgente = { ...pasos[i++], id: uid(), ts: now() };
    (db.trazas[ev.id] ??= []).push(t);
    persist();
    runners.get(ev.id)?.listeners.forEach((l) => l(t));
    setTimeout(tick, 90 + Math.random() * 170);
  };
  setTimeout(tick, 300);
}

// Si se recargó la página en plena evaluación, se completa de inmediato.
db.evaluaciones.filter((e) => e.estado === 'en_curso').forEach((e) => finalizar(e.id));

// ── Chat basado en los documentos y resultados ─────────────────────────────
function responderChat(projectId: string, pregunta: string): string {
  const q = pregunta.toLowerCase();
  const ev = ultimaEvaluacion(projectId);
  const props = db.propuestas.filter((p) => p.proyecto_id === projectId);
  if (!props.length) return 'Este proyecto aún no tiene propuestas cargadas.';

  const mencionada = props.find((p) => {
    const num = p.codigo.split('_')[1];
    const nombre = (p.proveedor_nombre ?? '').toLowerCase();
    const primera = nombre.split(' ')[0];
    return (num && q.includes(num)) || (nombre && q.includes(nombre)) || (primera.length > 3 && q.includes(primera));
  });

  if (!ev || ev.estado !== 'completada') {
    if (/garant/.test(q)) {
      return 'Garantías declaradas en los documentos:\n' + props.map((p) => `• ${p.proveedor_nombre}: ${specDe(p).garantia}`).join('\n');
    }
    return `Aún no se ha ejecutado la evaluación. Hay ${props.length} propuestas cargadas:\n` + props.map((p) => `• ${p.codigo} (${TIPO_LABEL[p.tipo]})`).join('\n');
  }

  const res = ev.resultados;
  if (mencionada) {
    const r = res.find((x) => x.propuesta_id === mencionada.id);
    if (r) {
      const extra = r.ajustes.length ? `\nCostos ocultos incorporados: ${r.ajustes.map((a) => `${CONCEPTO_LABEL[a.concepto]} ${money(a.monto_usd)} ("${a.fuente_texto}")`).join('; ')}.` : '';
      return `${r.codigo} — ${r.proveedor}\nResultado: ${r.valida ? `válida, posición ${r.posicion}` : `descartada (${r.motivos_descarte.map((m) => MOTIVO_LABEL[m]).join(', ')})`}.\nDeclarado ${money(r.total_declarado, r.moneda)} → costo real ${money(r.total_ajustado_usd)}.${extra}\n\n${r.dictamen}\n\nGarantía: ${specDe(mencionada).garantia}.`;
    }
  }
  if (/garant/.test(q)) {
    const lista = props.map((p) => `• ${p.proveedor_nombre}: ${specDe(p).garantia}`).join('\n');
    return `Garantías según los documentos cargados:\n${lista}\n\nLa mejor garantía local la ofrece Grupo Digital Miranda C.A. (24 meses con soporte presencial en Caracas).`;
  }
  if (/recomend|mejor|ganador|elegid/.test(q)) {
    const r = res.find((x) => x.propuesta_id === ev.recomendada_id);
    return r ? `La propuesta recomendada es ${r.codigo} (${r.proveedor}), con un costo real de ${money(r.total_ajustado_usd)}.\n\n${r.dictamen}` : 'Ninguna propuesta resultó válida.';
  }
  if (/descart/.test(q)) {
    return 'Propuestas descartadas:\n' + res.filter((r) => !r.valida).map((r) => `• ${r.codigo}: ${r.motivos_descarte.map((m) => MOTIVO_LABEL[m]).join(', ')}`).join('\n');
  }
  if (/flete|oculto|letra|recargo|iva|envío|envio/.test(q)) {
    const con = res.filter((r) => r.ajustes.length);
    if (!con.length) return 'No se detectaron costos ocultos.';
    return 'Costos encontrados en notas y letra pequeña:\n' + con.map((r) => `• ${r.proveedor}: ${r.ajustes.map((a) => `${CONCEPTO_LABEL[a.concepto]} +${money(a.monto_usd)}`).join(', ')}`).join('\n');
  }
  if (/barat|econ[oó]mic|menor costo|precio m[aá]s bajo/.test(q)) {
    const v = res.filter((r) => r.valida).sort((a, b) => a.total_ajustado_usd - b.total_ajustado_usd)[0];
    return v ? `Entre las válidas, la de menor costo real es ${v.codigo} (${v.proveedor}) con ${money(v.total_ajustado_usd)}. El ranking no se basa solo en precio: pondera calidad técnica y cumplimiento.` : 'No hay propuestas válidas.';
  }
  return 'Puedo responder sobre las propuestas cargadas y el resultado de la evaluación. Por ejemplo: "¿Por qué se descartó la 841?", "¿Qué proveedor ofrece mejor garantía?", "¿Qué costos ocultos se encontraron?" o "¿Cuál es la propuesta recomendada?".';
}

// ── Implementación del contrato Api ─────────────────────────────────────────
export const mockApi: Api = {
  auth: {
    async login(email, password) {
      await delay(300);
      const user = db.usuarios.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
      if (!user || password !== DEMO_PASSWORD) throw new ApiError(401, 'Correo o contraseña incorrectos');
      if (!user.activo) throw new ApiError(403, 'Usuario desactivado');
      registrar(user.nombre, 'auth.login', 'usuario', user.id);
      persist();
      return { token: `mock-${user.id}`, refreshToken: `mock-rt-${user.id}`, user: clone(user) };
    },
    async refresh(refreshToken) {
      await delay(80);
      const user = db.usuarios.find((u) => `mock-rt-${u.id}` === refreshToken);
      if (!user || !user.activo) throw new ApiError(401, 'Sesión expirada');
      return { token: `mock-${user.id}`, refreshToken };
    },
    async me() {
      await delay(50);
      return clone(usuarioActual());
    },
  },

  dashboard: {
    async stats() {
      await delay(80);
      usuarioActual();
      const alertas = db.proveedores.filter((p) => p.alerta).length;
      const inyecciones = db.evaluaciones.reduce(
        (sum, ev) => sum + ev.resultados.filter((r) => r.motivos_descarte.includes('inyeccion')).length,
        0,
      );
      return {
        active_supplier_alerts: alertas,
        prompt_injections_blocked: inyecciones,
        encryption_at_rest: 'AES-256-GCM (demo)',
        db_encrypted: false,
        storage_encrypted: false,
        tls_enabled: false,
        tls_min_version: 'TLS 1.2 / TLS 1.3',
        audit_log_entries: db.auditoria.length,
        llm_provider: 'demo',
      };
    },
  },

  projects: {
    async list() {
      await delay();
      usuarioActual();
      return db.proyectos.map(aProyecto).sort((a, b) => b.creado_en.localeCompare(a.creado_en));
    },
    async get(id) {
      await delay(80);
      usuarioActual();
      return aProyecto(proyectoRow(id));
    },
    async create(data, archivo) {
      await delay(300);
      const u = exigir('proyecto.crear');
      if (!data.nombre.trim()) throw new ApiError(422, 'El nombre es obligatorio');
      const row: ProyectoRow = {
        id: uid(),
        ...data,
        estado: 'EN_RECEPCION',
        archivo_proyecto: archivo?.name ?? null,
        creado_por: u.nombre,
        creado_en: now(),
      };
      db.proyectos.push(row);
      db.historial.push({ id: uid(), proyecto_id: row.id, estado_anterior: null, estado_nuevo: 'EN_RECEPCION', usuario: u.nombre, fecha: now(), nota: 'Proyecto creado' });
      registrar(u.nombre, 'proyecto.crear', 'proyecto', row.id, { nombre: row.nombre });
      persist();
      return aProyecto(row);
    },
    async changeState(id, estado, nota, propuestaAdjudicadaId) {
      await delay();
      const u = usuarioActual();
      const row = proyectoRow(id);
      if (!puedeTransicionar(row.estado, estado, u.rol)) throw new ApiError(403, 'Transición de estado no permitida para su rol');
      if (propuestaAdjudicadaId) row.propuesta_adjudicada_id = propuestaAdjudicadaId;
      if (nota) row.nota_adjudicacion = nota;
      cambiarEstado(row, estado, u.nombre, nota ?? null);
      persist();
      return aProyecto(row);
    },
    async history(id) {
      await delay(80);
      return db.historial.filter((h) => h.proyecto_id === id).sort((a, b) => a.fecha.localeCompare(b.fecha));
    },
    documentUrl: async () => null,
  },

  proposals: {
    async list(projectId) {
      await delay(100);
      return db.propuestas.filter((p) => p.proyecto_id === projectId).sort((a, b) => a.codigo.localeCompare(b.codigo));
    },
    async upload(projectId, files) {
      await delay(500);
      const u = exigir('propuesta.cargar');
      const row = proyectoRow(projectId);
      if (!['EN_RECEPCION', 'EN_EVALUACION'].includes(row.estado)) throw new ApiError(409, 'Solo se pueden cargar propuestas en recepción o evaluación');
      const nuevas: Propuesta[] = [];
      for (const f of files) {
        if (!esPermitido(f.name)) continue;
        const codigo = codigoDesdeArchivo(f.name);
        const nombreProv = proveedorDesdeCodigo(codigo);
        let prov = db.proveedores.find((p) => p.nombre.toLowerCase() === nombreProv.toLowerCase());
        if (!prov) {
          prov = { id: uid(), nombre: nombreProv, rif: null, ubicacion: null, telefono: null, email: null, alerta: false, motivo_alerta: null };
          db.proveedores.push(prov);
        }
        db.propuestas = db.propuestas.filter((p) => !(p.proyecto_id === projectId && p.codigo === codigo));
        const p: Propuesta = {
          id: uid(),
          codigo,
          proyecto_id: projectId,
          proveedor_id: prov.id,
          proveedor_nombre: prov.nombre,
          archivo_nombre: f.name,
          tipo: detectarTipo(f.name),
          moneda: null,
          total_declarado: null,
          estado: 'cargada',
          subido_en: now(),
        };
        db.propuestas.push(p);
        nuevas.push(p);
      }
      registrar(u.nombre, 'propuesta.cargar', 'proyecto', projectId, { archivos: nuevas.map((p) => p.archivo_nombre) });
      persist();
      return nuevas;
    },
    async remove(id) {
      await delay();
      const u = exigir('propuesta.cargar');
      const p = db.propuestas.find((x) => x.id === id);
      if (!p) throw new ApiError(404, 'Propuesta no encontrada');
      db.propuestas = db.propuestas.filter((x) => x.id !== id);
      registrar(u.nombre, 'propuesta.eliminar', 'propuesta', id, { codigo: p.codigo });
      persist();
    },
    downloadUrl: async () => null,
  },

  evaluations: {
    async start(projectId, params) {
      await delay(250);
      const u = exigir('evaluacion.ejecutar');
      const row = proyectoRow(projectId);
      if (['ADJUDICADO', 'CERRADO'].includes(row.estado)) throw new ApiError(409, 'El proceso ya está adjudicado o cerrado');
      const props = db.propuestas.filter((p) => p.proyecto_id === projectId);
      if (props.length < 3) throw new ApiError(422, 'Se requieren al menos 3 propuestas para evaluar');
      if (ultimaEvaluacion(projectId)?.estado === 'en_curso') throw new ApiError(409, 'Ya hay una evaluación en curso');

      const ev: Evaluacion = {
        id: uid(),
        proyecto_id: projectId,
        estado: 'en_curso',
        inicio: now(),
        fin: null,
        recomendada_id: null,
        ranking: [],
        tasa_bcv_usada: params?.bcv_rate_override || db.tasa.usd_ves,
        ejecutada_por: u.nombre,
        resultados: [],
      };
      db.evaluaciones.push(ev);
      db.trazas[ev.id] = [];
      cambiarEstado(row, 'EN_EVALUACION', u.nombre, 'Evaluación automática iniciada');
      registrar(u.nombre, 'evaluacion.ejecutar', 'proyecto', projectId, {
        propuestas: props.length,
        tasa_bcv: ev.tasa_bcv_usada,
        busqueda_web: params?.enable_web_search ?? true,
        iva_pct: Math.round((params?.iva_rate ?? 0.16) * 100),
      });
      persist();
      ejecutar(ev, planDeTrazas(row, props));
      return clone(ev);
    },
    async list(projectId) {
      await delay(80);
      return db.evaluaciones
        .filter((e) => e.proyecto_id === projectId)
        .sort((a, b) => b.inicio.localeCompare(a.inicio))
        .map((e) => ({
          id: e.id,
          proyecto_id: e.proyecto_id,
          estado: e.estado,
          inicio: e.inicio,
          fin: e.fin,
          tasa_bcv_usada: e.tasa_bcv_usada,
          recomendada_codigo:
            e.resultados.find((r) => r.propuesta_id === e.recomendada_id)?.codigo ?? e.ranking[0] ?? null,
          ejecutada_por: e.ejecutada_por,
        }));
    },
    async latest(projectId) {
      await delay(80);
      const ev = ultimaEvaluacion(projectId);
      return ev ? clone(ev) : null;
    },
    async get(id) {
      await delay(80);
      const ev = db.evaluaciones.find((e) => e.id === id);
      if (!ev) throw new ApiError(404, 'Evaluación no encontrada');
      return clone(ev);
    },
    async trazas(id) {
      await delay(60);
      return clone(db.trazas[id] ?? []);
    },
    stream(id, onEvent, onDone) {
      const ev = db.evaluaciones.find((e) => e.id === id);
      const runner = runners.get(id);
      (db.trazas[id] ?? []).forEach((t) => onEvent(clone(t)));
      if (!ev || !runner) {
        setTimeout(() => onDone(ev ? clone(ev) : null), 0);
        return () => {};
      }
      runner.listeners.add(onEvent);
      runner.doneListeners.add(onDone);
      return () => {
        runner.listeners.delete(onEvent);
        runner.doneListeners.delete(onDone);
      };
    },
    async exportFile(id, formato) {
      await delay(200);
      const ev = db.evaluaciones.find((e) => e.id === id);
      if (!ev) throw new ApiError(404, 'Evaluación no encontrada');
      const proyecto = aProyecto(proyectoRow(ev.proyecto_id));
      const base = slug(proyecto.nombre) || 'evaluacion';
      if (formato === 'xlsx') {
        return {
          blob: new Blob([evaluacionToExcelHtml(ev)], { type: 'application/vnd.ms-excel' }),
          filename: `Comparativa_${base}.xls`,
        };
      }
      if (formato === 'csv') {
        return {
          blob: new Blob([evaluacionToCSV(ev)], { type: 'text/csv;charset=utf-8' }),
          filename: `Comparativa_${base}.csv`,
        };
      }
      if (formato === 'markdown') {
        return {
          blob: new Blob([evaluacionToMarkdown(ev, proyecto)], { type: 'text/markdown;charset=utf-8' }),
          filename: `Informe_${base}.md`,
        };
      }
      if (formato === 'salida-json') {
        const props = db.propuestas.filter((p) => p.proyecto_id === ev.proyecto_id);
        const payload = {
          reto: 'propuesta_servicios',
          repositorio: 'PSM-Hackaton/agente-evaluador-propuestas-servicios',
          commit: '0000000000000000000000000000000000000000',
          inicio: ev.inicio,
          fin: ev.fin ?? ev.inicio,
          procesados: props.map((p) => ({ archivo: p.archivo_nombre, hora: ev.fin ?? ev.inicio })),
          ranking: ev.ranking,
        };
        return {
          blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }),
          filename: 'salida.json',
        };
      }
      throw new ApiError(501, 'En modo demo el PDF se genera con la impresión del navegador');
    },
  },

  reviews: {
    async list(evaluacionId) {
      await delay(80);
      return db.revisiones.filter((r) => r.evaluacion_id === evaluacionId).sort((a, b) => a.fecha.localeCompare(b.fecha));
    },
    async add(evaluacionId, accion, comentario, opts) {
      await delay(200);
      const permiso: Permiso = accion === 'nota' ? 'revision.nota' : accion === 'confirmar' ? 'revision.confirmar' : 'revision.aprobar';
      const u = exigir(permiso);
      const ev = db.evaluaciones.find((e) => e.id === evaluacionId);
      if (!ev) throw new ApiError(404, 'Evaluación no encontrada');
      const row = proyectoRow(ev.proyecto_id);
      if ((accion === 'aprobar' || accion === 'rechazar') && row.estado !== 'EN_REVISION_COMITE') {
        throw new ApiError(409, 'El proyecto debe estar en revisión del comité');
      }
      const targetId = opts?.propuesta_adjudicada_id ?? ev.recomendada_id;
      const esAnulacion = Boolean(
        accion === 'aprobar' && opts?.propuesta_adjudicada_id && opts.propuesta_adjudicada_id !== ev.recomendada_id,
      );
      const rev = {
        id: uid(),
        evaluacion_id: evaluacionId,
        propuesta_evaluacion_id: opts?.propuesta_evaluacion_id ?? null,
        propuesta_adjudicada_id: esAnulacion ? targetId : null,
        es_anulacion: esAnulacion,
        usuario: u.nombre,
        rol: u.rol,
        accion,
        comentario,
        fecha: now(),
      };
      db.revisiones.push(rev);
      registrar(u.nombre, `revision.${accion}`, 'evaluacion', evaluacionId, {
        ...(comentario ? { comentario } : {}),
        ...(opts?.propuesta_evaluacion_id ? { propuesta_evaluacion_id: opts.propuesta_evaluacion_id } : {}),
        ...(esAnulacion ? { propuesta_adjudicada_id: targetId, anulacion: true } : {}),
      });
      if (accion === 'aprobar') {
        const rec = ev.resultados.find((r) => r.propuesta_id === targetId);
        row.propuesta_adjudicada_id = targetId ?? null;
        row.nota_adjudicacion = comentario || (rec ? `Adjudicado a ${rec.proveedor}` : 'Adjudicado');
        cambiarEstado(row, 'ADJUDICADO', u.nombre, row.nota_adjudicacion);
      }
      if (accion === 'rechazar') cambiarEstado(row, 'EN_EVALUACION', u.nombre, comentario || 'Devuelto por el comité');
      persist();
      return rev;
    },
  },

  suppliers: {
    async list() {
      await delay();
      return db.proveedores
        .map((p) => {
          const activas = (db.alertas ?? []).filter((a) => a.proveedor_id === p.id && !a.resuelta);
          return {
            ...p,
            alerta: activas.length > 0 || (db.alertas == null && p.alerta),
            motivo_alerta: activas[0]?.resumen ?? (activas.length === 0 && db.alertas != null ? null : p.motivo_alerta),
            total_participaciones: db.propuestas.filter((x) => x.proveedor_id === p.id).length,
          };
        })
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
    },
    async get(id) {
      await delay();
      const p = db.proveedores.find((x) => x.id === id);
      if (!p) throw new ApiError(404, 'Proveedor no encontrado');
      const alertasProv: AlertaProveedor[] = (db.alertas ?? [])
        .filter((a) => a.proveedor_id === id)
        .sort((a, b) => b.fecha.localeCompare(a.fecha));
      const activas = alertasProv.filter((a) => !a.resuelta);
      const participaciones: Participacion[] = db.propuestas
        .filter((x) => x.proveedor_id === id)
        .map((prop) => {
          const proyecto = db.proyectos.find((x) => x.id === prop.proyecto_id)!;
          const ev = db.evaluaciones
            .filter((e) => e.proyecto_id === prop.proyecto_id && e.estado === 'completada')
            .sort((a, b) => b.inicio.localeCompare(a.inicio))[0];
          const r = ev?.resultados.find((x) => x.propuesta_id === prop.id);
          let resultado: Participacion['resultado'] = 'pendiente';
          if (r) resultado = !r.valida ? 'descartada' : proyecto.estado === 'ADJUDICADO' && proyecto.propuesta_adjudicada_id === prop.id ? 'adjudicada' : 'valida';
          return {
            proyecto_id: proyecto.id,
            proyecto_nombre: proyecto.nombre,
            propuesta_codigo: prop.codigo,
            fecha: prop.subido_en,
            resultado,
            posicion: r?.posicion ?? null,
            motivos_descarte: r?.motivos_descarte ?? [],
            total_ajustado_usd: r?.total_ajustado_usd ?? null,
          };
        })
        .sort((a, b) => b.fecha.localeCompare(a.fecha));
      const detalle: ProveedorDetalle = {
        ...p,
        alerta: activas.length > 0,
        motivo_alerta: activas[0]?.resumen ?? null,
        total_participaciones: participaciones.length,
        alertas: clone(alertasProv),
        participaciones,
      };
      return detalle;
    },
    async create(data) {
      await delay();
      const u = exigir('proveedor.crear');
      const rifNorm = data.rif?.trim() ? data.rif.trim().toUpperCase() : null;
      if (rifNorm && db.proveedores.some((x) => x.rif?.toUpperCase() === rifNorm)) {
        throw new ApiError(409, 'Ya existe un proveedor con ese RIF');
      }
      const row = {
        id: uid(),
        nombre: data.nombre.trim(),
        rif: rifNorm,
        ubicacion: data.ubicacion?.trim() || null,
        representante: data.representante?.trim() || null,
        telefono: data.telefono?.trim() || null,
        email: data.email?.trim() || null,
        notas: data.notas?.trim() || null,
        alerta: false,
        motivo_alerta: null,
      };
      db.proveedores.push(row);
      registrar(u.nombre, 'proveedor.crear', 'proveedor', row.id, { nombre: row.nombre, rif: row.rif });
      persist();
      return { ...row, total_participaciones: 0 };
    },
    async update(id, data) {
      await delay();
      const u = exigir('proveedor.editar');
      const target = db.proveedores.find((x) => x.id === id);
      if (!target) throw new ApiError(404, 'Proveedor no encontrado');
      const rifNorm = data.rif !== undefined ? (data.rif?.trim() ? data.rif.trim().toUpperCase() : null) : target.rif;
      if (rifNorm && db.proveedores.some((x) => x.id !== id && x.rif?.toUpperCase() === rifNorm)) {
        throw new ApiError(409, 'Ya existe otro proveedor con ese RIF');
      }
      if (data.nombre !== undefined) target.nombre = data.nombre.trim();
      if (data.rif !== undefined) target.rif = rifNorm;
      if (data.ubicacion !== undefined) target.ubicacion = data.ubicacion?.trim() || null;
      if (data.representante !== undefined) target.representante = data.representante?.trim() || null;
      if (data.telefono !== undefined) target.telefono = data.telefono?.trim() || null;
      if (data.email !== undefined) target.email = data.email?.trim() || null;
      if (data.notas !== undefined) target.notas = data.notas?.trim() || null;
      registrar(u.nombre, 'proveedor.actualizar', 'proveedor', id, { nombre: target.nombre, rif: target.rif });
      persist();
      return { ...clone(target), total_participaciones: db.propuestas.filter((x) => x.proveedor_id === id).length };
    },
    async resolveAlert(alertId) {
      await delay();
      const u = exigir('proveedor.editar');
      const lista = (db.alertas ??= []);
      const alerta = lista.find((a) => a.id === alertId);
      if (!alerta) throw new ApiError(404, 'Alerta no encontrada');
      alerta.resuelta = true;
      const prov = db.proveedores.find((x) => x.id === alerta.proveedor_id);
      if (prov) {
        const restantes = lista.filter((a) => a.proveedor_id === prov.id && !a.resuelta);
        prov.alerta = restantes.length > 0;
        prov.motivo_alerta = restantes[0]?.resumen ?? null;
      }
      registrar(u.nombre, 'proveedor.alerta_revisada', 'alerta', alertId, { proveedor_id: alerta.proveedor_id });
      persist();
      return clone(alerta);
    },
  },

  audit: {
    async list() {
      await delay();
      exigir('auditoria.ver');
      return clone(db.auditoria);
    },
  },

  users: {
    async list() {
      await delay();
      exigir('usuarios.admin');
      return clone(db.usuarios);
    },
    async create(data) {
      await delay();
      const u = exigir('usuarios.admin');
      if (db.usuarios.some((x) => x.email.toLowerCase() === data.email.toLowerCase())) throw new ApiError(409, 'Ya existe un usuario con ese correo');
      const nuevo: Usuario = { id: uid(), nombre: data.nombre, email: data.email, rol: data.rol, activo: true, creado_en: now() };
      db.usuarios.push(nuevo);
      registrar(u.nombre, 'usuario.crear', 'usuario', nuevo.id, { email: nuevo.email, rol: nuevo.rol });
      persist();
      return nuevo;
    },
    async update(id, data) {
      await delay();
      const u = exigir('usuarios.admin');
      const target = db.usuarios.find((x) => x.id === id);
      if (!target) throw new ApiError(404, 'Usuario no encontrado');
      Object.assign(target, data);
      registrar(u.nombre, 'usuario.actualizar', 'usuario', id, data as Record<string, unknown>);
      persist();
      return clone(target);
    },
  },

  currency: {
    async bcv(refresh = false) {
      await delay(60);
      if (refresh) {
        db.tasa = { ...db.tasa, fecha: now() };
        persist();
      }
      return clone(db.tasa);
    },
    async history() {
      await delay(60);
      return clone(db.tasaHistorial ?? []);
    },
    async override(usdToVes, nota) {
      await delay(80);
      const u = exigir('bcv.fijar');
      const fecha = now();
      const origen = `manual_override:${nota?.trim() || 'comite'}`;
      db.tasa = { fecha, usd_ves: round2(usdToVes), fuente: 'manual', origen };
      (db.tasaHistorial ??= []).unshift({
        id: uid(),
        usd_ves: db.tasa.usd_ves,
        fuente: origen,
        es_manual: true,
        registrada_por: u.email,
        fecha,
      });
      registrar(u.nombre, 'finanzas.bcv_manual', 'bcv', 'tasa-bcv', { usd_ves: db.tasa.usd_ves, nota: nota || null });
      persist();
      return clone(db.tasa);
    },
  },

  chat: {
    async history(projectId) {
      await delay(60);
      return clone(db.chat[projectId] ?? []);
    },
    async send(projectId, contenido) {
      const u = exigir('chat.usar');
      (db.chat[projectId] ??= []).push({ id: uid(), rol: 'user', contenido, fecha: now() });
      persist();
      await delay(700);
      const resp: MensajeChat = { id: uid(), rol: 'assistant', contenido: responderChat(projectId, contenido), fecha: now() };
      db.chat[projectId].push(resp);
      registrar(u.nombre, 'chat.consulta', 'proyecto', projectId, { pregunta: contenido.slice(0, 120) });
      persist();
      return resp;
    },
    async clear(projectId) {
      await delay(80);
      exigir('revision.confirmar');
      delete db.chat[projectId];
      persist();
    },
  },
};
