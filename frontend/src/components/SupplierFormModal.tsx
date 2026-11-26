import { useState, type FormEvent } from 'react';
import type { Proveedor, ProveedorInput } from '../api/types';
import { Alert, Button, Modal } from './ui';

const RIF_REGEX = /^[JVEGP]-\d{6,9}-\d$/i;

interface SupplierFormModalProps {
  open: boolean;
  onClose: () => void;
  initial?: Proveedor | null;
  saving?: boolean;
  serverError?: string | null;
  onSubmit: (data: ProveedorInput) => Promise<void> | void;
}

export function validarRif(rif: string): boolean {
  const limpio = rif.trim();
  return !limpio || RIF_REGEX.test(limpio);
}

export function SupplierFormModal({
  open,
  onClose,
  initial = null,
  saving = false,
  serverError = null,
  onSubmit,
}: SupplierFormModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Editar ficha del proveedor' : 'Registrar nuevo proveedor'}
      size="lg"
    >
      {open && (
        <SupplierFormBody
          key={initial?.id ?? 'new'}
          onClose={onClose}
          initial={initial}
          saving={saving}
          serverError={serverError}
          onSubmit={onSubmit}
        />
      )}
    </Modal>
  );
}

function SupplierFormBody({
  onClose,
  initial,
  saving,
  serverError,
  onSubmit,
}: Omit<SupplierFormModalProps, 'open'>) {
  const [nombre, setNombre] = useState(initial?.nombre ?? '');
  const [rif, setRif] = useState(initial?.rif ?? '');
  const [ubicacion, setUbicacion] = useState(initial?.ubicacion ?? '');
  const [representante, setRepresentante] = useState(initial?.representante ?? '');
  const [telefono, setTelefono] = useState(initial?.telefono ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [notas, setNotas] = useState(initial?.notas ?? '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (nombre.trim().length < 2) {
      setError('Ingresa el nombre o razón social del proveedor (mínimo 2 caracteres).');
      return;
    }
    const rifLimpio = rif.trim().toUpperCase();
    if (rifLimpio && !RIF_REGEX.test(rifLimpio)) {
      setError('Formato de RIF inválido. Ejemplo válido: J-12345678-9 (prefijo J, V, E, G o P).');
      return;
    }
    setError(null);
    await onSubmit({
      nombre: nombre.trim(),
      rif: rifLimpio || null,
      ubicacion: ubicacion.trim() || null,
      representante: representante.trim() || null,
      telefono: telefono.trim() || null,
      email: email.trim() || null,
      notas: notas.trim() || null,
    });
  };

  const errMsg = error ?? serverError;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {errMsg && (
        <div role="alert">
          <Alert tone="error">{errMsg}</Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sup-nombre" className="mb-1 block text-xs font-semibold text-slate-700">
            Razón social *
          </label>
          <input
            id="sup-nombre"
            className="input"
            required
            minLength={2}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej. Servicios Tecnológicos Caracas C.A."
          />
        </div>

        <div>
          <label htmlFor="sup-rif" className="mb-1 block text-xs font-semibold text-slate-700">
            RIF
          </label>
          <input
            id="sup-rif"
            className="input font-mono"
            value={rif}
            onChange={(e) => setRif(e.target.value)}
            placeholder="J-12345678-9"
          />
        </div>

        <div>
          <label htmlFor="sup-ubicacion" className="mb-1 block text-xs font-semibold text-slate-700">
            Ubicación
          </label>
          <input
            id="sup-ubicacion"
            className="input"
            value={ubicacion}
            onChange={(e) => setUbicacion(e.target.value)}
            placeholder="Caracas, Miranda"
          />
        </div>

        <div>
          <label htmlFor="sup-representante" className="mb-1 block text-xs font-semibold text-slate-700">
            Representante legal / contacto
          </label>
          <input
            id="sup-representante"
            className="input"
            value={representante}
            onChange={(e) => setRepresentante(e.target.value)}
            placeholder="Nombre completo"
          />
        </div>

        <div>
          <label htmlFor="sup-telefono" className="mb-1 block text-xs font-semibold text-slate-700">
            Teléfono
          </label>
          <input
            id="sup-telefono"
            className="input"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="0212-555-0100"
          />
        </div>

        <div>
          <label htmlFor="sup-email" className="mb-1 block text-xs font-semibold text-slate-700">
            Correo electrónico
          </label>
          <input
            id="sup-email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ventas@proveedor.com"
          />
        </div>
      </div>

      <div>
        <label htmlFor="sup-notas" className="mb-1 block text-xs font-semibold text-slate-700">
          Notas u observaciones
        </label>
        <textarea
          id="sup-notas"
          rows={2}
          className="input"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Referencias comerciales, especialidad o condiciones particulares..."
        />
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" loading={saving}>
          {initial ? 'Guardar cambios' : 'Registrar proveedor'}
        </Button>
      </div>
    </form>
  );
}
