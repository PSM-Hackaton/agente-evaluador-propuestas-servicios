import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Ticket, Trash2, UserPlus } from 'lucide-react';
import { api, type Invitacion, type Rol } from '../api';
import { useAuth } from '../context/AuthContext';
import { date } from '../lib/format';
import { ROLES, ROL_LABEL } from '../lib/labels';
import { Alert, Badge, Button, Card, CardBody, Modal, Spinner } from '../components/ui';

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const qc = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<Rol>('revisor');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Invitaciones
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [invRol, setInvRol] = useState<Rol>('revisor');
  const [invEmail, setInvEmail] = useState('');
  const [invMaxUses, setInvMaxUses] = useState(1);
  const [invHours, setInvHours] = useState(72);
  const [invError, setInvError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<Invitacion | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [renderNowMs] = useState(() => Date.now());

  const { data: usuarios = [], isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: api.users.list,
  });

  const {
    data: invitaciones = [],
    isLoading: loadingInvites,
    error: invitesError,
  } = useQuery({
    queryKey: ['invitations'],
    queryFn: api.users.listInvitations,
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.users.create({
        nombre: nombre.trim(),
        email: email.trim(),
        rol,
        password,
      }),
    onSuccess: async () => {
      setModalOpen(false);
      setNombre('');
      setEmail('');
      setRol('revisor');
      setPassword('');
      setFormError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['users'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => {
      setFormError(e instanceof Error ? e.message : 'No se pudo crear el usuario');
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { rol?: Rol; activo?: boolean } }) =>
      api.users.update(id, data),
    onSuccess: async () => {
      setActionError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['users'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => {
      setActionError(e instanceof Error ? e.message : 'No se pudo actualizar el usuario');
    },
  });

  const createInviteMut = useMutation({
    mutationFn: () =>
      api.users.createInvitation({
        rol: invRol,
        email: invEmail.trim() || null,
        usos_maximos: invMaxUses,
        horas_vigencia: invHours,
      }),
    onSuccess: async (inv) => {
      setCreatedInvite(inv);
      setInvError(null);
      setInvEmail('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['invitations'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => {
      setInvError(e instanceof Error ? e.message : 'No se pudo generar el código de invitación');
    },
  });

  const revokeInviteMut = useMutation({
    mutationFn: (id: string) => api.users.revokeInvitation(id),
    onSuccess: async () => {
      setActionError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['invitations'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => {
      setActionError(e instanceof Error ? e.message : 'No se pudo revocar la invitación');
    },
  });

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!nombre.trim() || !email.trim() || password.length < 8) {
      setFormError('Completa nombre, correo y una contraseña de al menos 8 caracteres.');
      return;
    }
    createMut.mutate();
  };

  const handleCreateInvite = (e: FormEvent) => {
    e.preventDefault();
    setInvError(null);
    createInviteMut.mutate();
  };

  const copiarTexto = async (texto: string, key: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      setActionError('No se pudo copiar al portapapeles.');
    }
  };

  const inviteLink = createdInvite?.codigo
    ? `${window.location.origin}/login?invite=${encodeURIComponent(createdInvite.codigo)}`
    : '';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Usuarios y roles</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Control de acceso basado en funciones: carga, revisión, aprobación y auditoría
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setCreatedInvite(null);
              setInvError(null);
              setInviteModalOpen(true);
            }}
          >
            <Ticket className="h-4 w-4" />
            Generar invitación
          </Button>
          <Button onClick={() => setModalOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Nuevo usuario
          </Button>
        </div>
      </div>

      {actionError && <Alert tone="error">{actionError}</Alert>}

      {isLoading ? (
        <Spinner label="Cargando usuarios..." className="py-12" />
      ) : error ? (
        <Alert tone="error">{error instanceof Error ? error.message : 'Error al cargar usuarios'}</Alert>
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Creado</th>
                    <th className="text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {usuarios.map((u) => {
                    const esMismo = u.id === currentUser?.id;
                    return (
                      <tr key={u.id}>
                        <td className="font-medium text-slate-900">
                          {u.nombre}
                          {esMismo && (
                            <Badge tone="indigo" className="ml-2">
                              Tú
                            </Badge>
                          )}
                        </td>
                        <td className="text-slate-600">{u.email}</td>
                        <td>
                          <select
                            className="input py-1 text-xs w-52"
                            value={u.rol}
                            disabled={esMismo || updateMut.isPending}
                            onChange={(e) =>
                              updateMut.mutate({ id: u.id, data: { rol: e.target.value as Rol } })
                            }
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROL_LABEL[r]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <Badge tone={u.activo ? 'green' : 'slate'}>
                            {u.activo ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </td>
                        <td className="text-xs text-slate-500">{date(u.creado_en)}</td>
                        <td className="text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={esMismo || updateMut.isPending}
                            onClick={() =>
                              updateMut.mutate({ id: u.id, data: { activo: !u.activo } })
                            }
                          >
                            {u.activo ? 'Desactivar' : 'Activar'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Códigos de invitación */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Códigos de invitación</h2>
          <p className="text-xs text-slate-500">
            Permite que nuevos usuarios se registren desde la pantalla de acceso con un rol asignado.
          </p>
        </div>

        {loadingInvites ? (
          <Spinner label="Cargando invitaciones..." className="py-6" />
        ) : invitesError ? (
          <Alert tone="info">
            El módulo de códigos de invitación está listo en la interfaz, pero el backend aún no expone{' '}
            <code>/api/v1/auth/invitations</code>.
          </Alert>
        ) : invitaciones.length === 0 ? (
          <Card>
            <CardBody className="text-center text-sm text-slate-500 py-8">
              No hay códigos de invitación generados todavía.
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Rol</th>
                      <th>Correo restringido</th>
                      <th>Usos</th>
                      <th>Vence</th>
                      <th>Estado</th>
                      <th className="text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {invitaciones.map((inv) => {
                      const expirada = new Date(inv.expira_en).getTime() < renderNowMs;
                      const agotada = inv.usos_actuales >= inv.usos_maximos;
                      const inactiva = inv.revocada || expirada || agotada;
                      return (
                        <tr key={inv.id}>
                          <td className="font-mono text-xs font-semibold text-slate-900">
                            {inv.codigo ?? `${inv.codigo_prefijo}••••`}
                          </td>
                          <td>
                            <Badge tone="indigo">{ROL_LABEL[inv.rol]}</Badge>
                          </td>
                          <td className="text-xs text-slate-600">{inv.email || 'Abierto'}</td>
                          <td className="text-xs text-slate-600">
                            {inv.usos_actuales} / {inv.usos_maximos}
                          </td>
                          <td className="text-xs text-slate-500">{date(inv.expira_en)}</td>
                          <td>
                            <Badge tone={inactiva ? 'slate' : 'green'}>
                              {inv.revocada ? 'Revocada' : expirada ? 'Expirada' : agotada ? 'Agotada' : 'Activa'}
                            </Badge>
                          </td>
                          <td className="text-right">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={inactiva || revokeInviteMut.isPending}
                              onClick={() => revokeInviteMut.mutate(inv.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Revocar
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Crear nuevo usuario">
        <form onSubmit={handleCreate} className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          <div>
            <label htmlFor="users-campo-1" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Nombre completo *
            </label>
            <input
              id="users-campo-1"
              type="text"
              required
              className="input"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="users-campo-2" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Correo electrónico *
            </label>
            <input
              id="users-campo-2"
              type="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="users-campo-3" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Rol *
            </label>
            <select
              id="users-campo-3"
              className="input"
              value={rol}
              onChange={(e) => setRol(e.target.value as Rol)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROL_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="users-campo-4" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Contraseña inicial *
            </label>
            <input
              id="users-campo-4"
              type="password"
              required
              minLength={8}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={createMut.isPending}>
              Crear usuario
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        title="Generar código de invitación"
      >
        {createdInvite?.codigo ? (
          <div className="space-y-4">
            <Alert tone="success">
              Código generado correctamente. Compártelo ahora: por seguridad no volverá a mostrarse completo.
            </Alert>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Código</p>
              <p className="mt-1 font-mono text-xl font-bold tracking-widest text-indigo-700">
                {createdInvite.codigo}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Rol: <span className="font-medium">{ROL_LABEL[createdInvite.rol]}</span> · Usos:{' '}
                {createdInvite.usos_maximos} · Vence: {date(createdInvite.expira_en)}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
              <Button
                variant="secondary"
                onClick={() => copiarTexto(createdInvite.codigo || '', 'code')}
              >
                {copiedKey === 'code' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiedKey === 'code' ? 'Código copiado' : 'Copiar código'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => copiarTexto(inviteLink, 'link')}
              >
                {copiedKey === 'link' ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                {copiedKey === 'link' ? 'Enlace copiado' : 'Copiar enlace'}
              </Button>
              <Button onClick={() => setInviteModalOpen(false)}>Listo</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreateInvite} className="space-y-4">
            {invError && <Alert tone="error">{invError}</Alert>}
            <div>
              <label htmlFor="inv-rol" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Rol asignado *
              </label>
              <select
                id="inv-rol"
                className="input"
                value={invRol}
                onChange={(e) => setInvRol(e.target.value as Rol)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROL_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="inv-email" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Restringir a correo específico (opcional)
              </label>
              <input
                id="inv-email"
                type="email"
                className="input"
                placeholder="usuario@institucion.gob.ve"
                value={invEmail}
                onChange={(e) => setInvEmail(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="inv-uses" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Usos máximos
                </label>
                <input
                  id="inv-uses"
                  type="number"
                  min={1}
                  max={100}
                  className="input"
                  value={invMaxUses}
                  onChange={(e) => setInvMaxUses(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <div>
                <label htmlFor="inv-hours" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Vigencia (horas)
                </label>
                <input
                  id="inv-hours"
                  type="number"
                  min={1}
                  max={720}
                  className="input"
                  value={invHours}
                  onChange={(e) => setInvHours(Math.max(1, Number(e.target.value) || 24))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <Button variant="secondary" onClick={() => setInviteModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={createInviteMut.isPending}>
                Generar código
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
