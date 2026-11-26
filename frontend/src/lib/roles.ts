import type { EstadoProyecto, Rol } from '../api/types';

export type Permiso =
  | 'proyecto.crear'
  | 'propuesta.cargar'
  | 'evaluacion.ejecutar'
  | 'revision.nota'
  | 'revision.confirmar'
  | 'revision.aprobar'
  | 'auditoria.ver'
  | 'usuarios.admin'
  | 'chat.usar';

const PERMISOS: Record<Permiso, Rol[]> = {
  // Alineado con los conjuntos ROLES_UPLOAD / ROLES_EVALUATE del backend (app/core/security.py)
  'proyecto.crear': ['admin', 'cargador', 'revisor'],
  'propuesta.cargar': ['admin', 'cargador', 'revisor'],
  'evaluacion.ejecutar': ['admin', 'revisor', 'aprobador'],
  'revision.nota': ['admin', 'revisor', 'aprobador'],
  'revision.confirmar': ['admin', 'revisor'],
  'revision.aprobar': ['admin', 'aprobador'],
  'auditoria.ver': ['admin', 'auditor'],
  'usuarios.admin': ['admin'],
  'chat.usar': ['admin', 'cargador', 'revisor', 'aprobador', 'auditor'],
};

export function can(rol: Rol | undefined | null, permiso: Permiso): boolean {
  return !!rol && PERMISOS[permiso].includes(rol);
}

export interface Transicion {
  de: EstadoProyecto;
  a: EstadoProyecto;
  roles: Rol[];
  label: string;
}

export const TRANSICIONES: Transicion[] = [
  { de: 'EN_RECEPCION', a: 'EN_EVALUACION', roles: ['admin', 'revisor', 'aprobador'], label: 'Pasar a evaluación' },
  { de: 'EN_EVALUACION', a: 'EN_RECEPCION', roles: ['admin', 'revisor', 'aprobador'], label: 'Volver a recepción' },
  { de: 'EN_EVALUACION', a: 'EN_REVISION_COMITE', roles: ['admin', 'revisor'], label: 'Enviar al comité' },
  { de: 'EN_REVISION_COMITE', a: 'EN_EVALUACION', roles: ['admin', 'revisor', 'aprobador'], label: 'Devolver a evaluación' },
  { de: 'EN_REVISION_COMITE', a: 'ADJUDICADO', roles: ['admin', 'aprobador'], label: 'Adjudicar' },
  { de: 'ADJUDICADO', a: 'CERRADO', roles: ['admin', 'aprobador'], label: 'Cerrar proceso' },
  { de: 'EN_RECEPCION', a: 'CERRADO', roles: ['admin', 'aprobador'], label: 'Cancelar proceso' },
  { de: 'EN_EVALUACION', a: 'CERRADO', roles: ['admin', 'aprobador'], label: 'Cancelar proceso' },
  { de: 'EN_REVISION_COMITE', a: 'CERRADO', roles: ['admin', 'aprobador'], label: 'Cancelar proceso' },
];

export function transicionesPermitidas(estado: EstadoProyecto, rol: Rol | undefined | null): Transicion[] {
  if (!rol) return [];
  return TRANSICIONES.filter((t) => t.de === estado && t.roles.includes(rol));
}

export function puedeTransicionar(de: EstadoProyecto, a: EstadoProyecto, rol: Rol): boolean {
  return TRANSICIONES.some((t) => t.de === de && t.a === a && t.roles.includes(rol));
}
