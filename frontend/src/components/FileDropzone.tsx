import { useRef, useState, type DragEvent } from 'react';
import { FileUp, Trash2, UploadCloud } from 'lucide-react';
import { ACCEPT_PROPUESTAS, detectarTipo, esPermitido } from '../lib/files';
import { fileSize } from '../lib/format';
import { TIPO_LABEL } from '../lib/labels';
import { cn } from '../lib/cn';
import { Alert, Badge, Button } from './ui';

interface FileDropzoneProps {
  accept?: string;
  multiple?: boolean;
  onUpload: (files: File[]) => Promise<void> | void;
  disabled?: boolean;
  uploading?: boolean;
  validateProposals?: boolean;
}

export function FileDropzone({
  accept = ACCEPT_PROPUESTAS,
  multiple = true,
  onUpload,
  disabled = false,
  uploading = false,
  validateProposals = true,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<File[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);

  const addFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    if (!arr.length) return;
    const valid: File[] = [];
    const invalid: string[] = [];
    for (const f of arr) {
      if (!validateProposals || esPermitido(f.name)) valid.push(f);
      else invalid.push(f.name);
    }
    setRejected(invalid);
    if (!valid.length) return;
    setQueue((prev) => {
      if (!multiple) return [valid[0]];
      const map = new Map(prev.map((x) => [x.name, x]));
      valid.forEach((f) => map.set(f.name, f));
      return Array.from(map.values());
    });
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled || uploading) return;
    addFiles(e.dataTransfer.files);
  };

  const handleUpload = async () => {
    if (!queue.length || disabled || uploading) return;
    await onUpload(queue);
    setQueue([]);
    setRejected([]);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !uploading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => {
          if (!disabled && !uploading) inputRef.current?.click();
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled && !uploading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={disabled || uploading ? -1 : 0}
        aria-disabled={disabled || uploading}
        aria-label="Seleccionar archivos de propuestas (PDF, XLSX, JPG, PNG y otros formatos admitidos)"
        className={cn(
          'flex cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
          dragging
            ? 'border-indigo-500 bg-indigo-50/70'
            : 'border-slate-300 bg-slate-50/60 hover:border-indigo-400 hover:bg-slate-50',
          (disabled || uploading) && 'cursor-not-allowed opacity-60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled || uploading}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
          }}
        />
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
          <UploadCloud className="h-6 w-6" />
        </div>
        <p className="mt-3 text-sm font-medium text-slate-800">
          Arrastra aquí las propuestas o haz clic para seleccionar archivos
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Formatos admitidos: PDF (digital o escaneado), hojas de cálculo (.xlsx, .xls, .csv), imágenes o manuscritos (.jpg, .png, .webp, .tiff), capturas de chat y documentos (.docx, .txt). De 3 a 20 o más archivos.
        </p>
      </div>

      {rejected.length > 0 && (
        <Alert tone="warning" title="Archivos omitidos por formato no admitido">
          {rejected.join(', ')}
        </Alert>
      )}

      {queue.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {queue.length} {queue.length === 1 ? 'archivo listo' : 'archivos listos'} para cargar
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setQueue([])} disabled={uploading}>
                Limpiar
              </Button>
              <Button size="sm" onClick={handleUpload} loading={uploading} disabled={disabled}>
                <FileUp className="h-4 w-4" />
                Subir {queue.length} {queue.length === 1 ? 'archivo' : 'archivos'}
              </Button>
            </div>
          </div>
          <ul className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
            {queue.map((f) => (
              <li key={f.name} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="truncate font-medium text-slate-800">{f.name}</span>
                  <Badge tone="indigo">{TIPO_LABEL[detectarTipo(f.name)]}</Badge>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-slate-500">{fileSize(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => setQueue((q) => q.filter((x) => x.name !== f.name))}
                    disabled={uploading}
                    className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Quitar ${f.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
