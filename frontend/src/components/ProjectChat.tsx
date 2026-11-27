import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, FileText, Paperclip, Send, Trash2, User, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/cn';
import { time } from '../lib/format';
import { can } from '../lib/roles';
import { Alert, Button, Card, CardBody, CardHeader, Spinner } from './ui';

export interface DocumentoAdjuntableChat {
  id: string;
  label: string;
  tipo: 'project' | 'proposal';
}

const SUGERENCIAS = [
  '¿Cuál es la propuesta recomendada?',
  '¿Qué propuestas se descartaron y por qué?',
  '¿Qué proveedor ofrece mejor garantía?',
  '¿Qué costos ocultos se encontraron?',
];

/** Las respuestas del backend usan **negritas** de Markdown; se muestran sin los asteriscos. */
function conNegritas(texto: string) {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith('**') && parte.endsWith('**') ? <strong key={i}>{parte.slice(2, -2)}</strong> : parte,
  );
}

export function ProjectChat({
  projectId,
  documentos = [],
}: {
  projectId: string;
  documentos?: DocumentoAdjuntableChat[];
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [adjuntosIds, setAdjuntosIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: mensajes = [], isLoading } = useQuery({
    queryKey: ['chat', projectId],
    queryFn: () => api.chat.history(projectId),
  });

  const mut = useMutation({
    mutationFn: ({ contenido, documentIds }: { contenido: string; documentIds?: string[] }) =>
      api.chat.send(projectId, contenido, documentIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat', projectId] });
    },
  });

  const clearMut = useMutation({
    mutationFn: () => api.chat.clear(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat', projectId] });
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes.length, mut.isPending]);

  const toggleAdjunto = (docId: string) => {
    setAdjuntosIds((prev) =>
      prev.includes(docId) ? prev.filter((x) => x !== docId) : [...prev, docId],
    );
  };

  const adjuntosSeleccionados = documentos.filter((d) => adjuntosIds.includes(d.id));

  const enviar = (contenido: string) => {
    const clean = contenido.trim();
    if (!clean || mut.isPending) return;
    const docsToSend = adjuntosIds.length > 0 ? [...adjuntosIds] : undefined;
    setTexto('');
    setAdjuntosIds([]);
    setPickerOpen(false);
    mut.mutate({ contenido: clean, documentIds: docsToSend });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    enviar(texto);
  };

  return (
    <Card>
      <CardHeader
        title="Consulta sobre los documentos del proyecto"
        subtitle="Respuestas basadas únicamente en los documentos cargados y la evaluación del proyecto"
        action={
          mensajes.length > 0 && can(user?.rol, 'revision.confirmar') ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => clearMut.mutate()}
              loading={clearMut.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Limpiar chat
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {SUGERENCIAS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => enviar(s)}
              disabled={mut.isPending}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        <div
          role="log"
          aria-live="polite"
          aria-label="Conversación sobre el proyecto"
          className="h-96 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-4"
        >
          {isLoading ? (
            <Spinner label="Cargando conversación..." className="py-12" />
          ) : mensajes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-slate-500">
              <Bot className="h-8 w-8 text-slate-400" />
              <p className="mt-2 font-medium text-slate-700">Haz una pregunta sobre este proceso</p>
              <p className="mt-1 max-w-md text-xs">
                Puedes preguntar por garantías, costos ocultos en notas al margen, motivos de descarte o adjuntar un documento específico con el botón 📎.
              </p>
            </div>
          ) : (
            mensajes.map((m) => {
              const esUser = m.rol === 'user';
              return (
                <div key={m.id} className={cn('flex gap-2.5', esUser ? 'justify-end' : 'justify-start')}>
                  {!esUser && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm',
                      esUser
                        ? 'bg-indigo-600 text-white'
                        : 'border border-slate-200 bg-white text-slate-800',
                    )}
                  >
                    <p className="whitespace-pre-line break-words">{conNegritas(m.contenido)}</p>
                    {m.citas && m.citas.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.citas.map((c, idx) => (
                          <span
                            key={`${c.fuente}-${idx}`}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                              esUser
                                ? 'bg-indigo-500/40 text-indigo-50'
                                : c.tipo === 'attachment'
                                  ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
                                  : 'bg-slate-100 text-slate-600',
                            )}
                          >
                            <FileText className="h-2.5 w-2.5" />
                            {c.fuente}
                          </span>
                        ))}
                      </div>
                    )}
                    <p
                      className={cn(
                        'mt-1 text-[10px]',
                        esUser ? 'text-right text-indigo-200' : 'text-slate-500',
                      )}
                    >
                      {time(m.fecha)}
                    </p>
                  </div>
                  {esUser && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-700">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              );
            })
          )}
          {mut.isPending && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Spinner />
              <span>Consultando documentos cargados...</span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {mut.isError && (
          <Alert tone="error">
            {mut.error instanceof Error ? mut.error.message : 'No se pudo enviar la consulta'}
          </Alert>
        )}

        {adjuntosSeleccionados.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Documentos adjuntos">
            {adjuntosSeleccionados.map((doc) => (
              <span
                key={doc.id}
                className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200"
              >
                <FileText className="h-3 w-3" />
                {doc.label}
                <button
                  type="button"
                  onClick={() => toggleAdjunto(doc.id)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-indigo-100"
                  aria-label={`Quitar ${doc.label}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative">
          {pickerOpen && documentos.length > 0 && (
            <div className="absolute bottom-full left-0 z-20 mb-2 w-80 max-w-full rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-xs font-semibold text-slate-600">
                  Adjuntar documento del proyecto
                </span>
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Cerrar selector de documentos"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <ul className="max-h-52 space-y-1 overflow-y-auto">
                {documentos.map((doc) => {
                  const activo = adjuntosIds.includes(doc.id);
                  return (
                    <li key={doc.id}>
                      <button
                        type="button"
                        onClick={() => toggleAdjunto(doc.id)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition',
                          activo
                            ? 'bg-indigo-50 font-semibold text-indigo-700'
                            : 'text-slate-700 hover:bg-slate-50',
                        )}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <FileText className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{doc.label}</span>
                        </span>
                        <span className="ml-2 shrink-0 text-[10px] uppercase text-slate-400">
                          {doc.tipo === 'project' ? 'Proyecto' : 'Propuesta'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex gap-2">
            {documentos.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPickerOpen((o) => !o)}
                disabled={mut.isPending}
                title="Adjuntar documento del proyecto a la consulta"
                aria-label="Adjuntar documento del proyecto"
                aria-expanded={pickerOpen}
              >
                <Paperclip className="h-4 w-4" />
                {adjuntosIds.length > 0 && (
                  <span className="text-xs font-semibold">{adjuntosIds.length}</span>
                )}
              </Button>
            )}
            <input
              type="text"
              aria-label="Pregunta sobre el proyecto"
              className="input flex-1"
              placeholder="Escribe una pregunta sobre las propuestas o el dictamen..."
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              disabled={mut.isPending}
            />
            <Button type="submit" loading={mut.isPending} disabled={!texto.trim()}>
              <Send className="h-4 w-4" />
              Enviar
            </Button>
          </form>
        </div>
      </CardBody>
    </Card>
  );
}
