import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { api, type Rol } from '../api';
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

  const { data: usuarios = [], isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: api.users.list,
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

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!nombre.trim() || !email.trim() || password.length < 6) {
      setFormError('Completa nombre, correo y una contraseña de al menos 6 caracteres.');
      return;
    }
    createMut.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Usuarios y roles</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Control de acceso basado en funciones: carga, revisión, aprobación y auditoría
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <UserPlus className="h-4 w-4" />
          Nuevo usuario
        </Button>
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
              minLength={6}
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
    </div>
  );
}
