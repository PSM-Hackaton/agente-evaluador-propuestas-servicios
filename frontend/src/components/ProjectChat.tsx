import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Send, Trash2, User } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/cn';
import { time } from '../lib/format';
import { can } from '../lib/roles';
import { Alert, Button, Card, CardBody, CardHeader, Spinner } from './ui';

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

export function ProjectChat({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const { data: mensajes = [], isLoading } = useQuery({
    queryKey: ['chat', projectId],
    queryFn: () => api.chat.history(projectId),
  });

  const mut = useMutation({
    mutationFn: (contenido: string) => api.chat.send(projectId, contenido),
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

  const enviar = (contenido: string) => {
    const clean = contenido.trim();
    if (!clean || mut.isPending) return;
    setTexto('');
    mut.mutate(clean);
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

        <div role="log" aria-live="polite" aria-label="Conversación sobre el proyecto" className="h-96 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
          {isLoading ? (
            <Spinner label="Cargando conversación..." className="py-12" />
          ) : mensajes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-slate-500">
              <Bot className="h-8 w-8 text-slate-400" />
              <p className="mt-2 font-medium text-slate-700">Haz una pregunta sobre este proceso</p>
              <p className="mt-1 max-w-md text-xs">
                Puedes preguntar por garantías, costos ocultos en notas al margen, motivos de descarte o comparar proveedores.
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
                    <p
                      className={cn(
                        'mt-1 text-[10px]',
                        esUser ? 'text-indigo-200 text-right' : 'text-slate-500',
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

        <form onSubmit={handleSubmit} className="flex gap-2">
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
      </CardBody>
    </Card>
  );
}
