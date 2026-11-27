import { useState } from 'react';
import { FileDown, FileJson, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { api, isMock, type Evaluacion, type FormatoExport, type Proyecto } from '../api';
import { downloadBlob, slug } from '../lib/export';
import { Button } from './ui';

interface ExportButtonsProps {
  evaluacion: Evaluacion;
  proyecto: Proyecto;
}

export function ExportButtons({ evaluacion, proyecto }: ExportButtonsProps) {
  const [busy, setBusy] = useState<FormatoExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseName = slug(proyecto.nombre) || 'evaluacion';

  const descargar = async (formato: FormatoExport, fallbackName: string) => {
    setError(null);
    if (formato === 'pdf' && isMock) {
      window.print();
      return;
    }
    setBusy(formato);
    try {
      const { blob, filename } = await api.evaluations.exportFile(evaluacion.id, formato);
      downloadBlob(blob, filename ?? fallbackName);
    } catch (e) {
      if (formato === 'pdf') {
        window.print();
      } else {
        setError(e instanceof Error ? `No se pudo generar (${formato}): ${e.message}` : `No se pudo generar (${formato})`);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => descargar('pdf', `Informe_${baseName}.pdf`)}
        loading={busy === 'pdf'}
      >
        <Printer className="h-4 w-4" />
        PDF
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => descargar('markdown', `Informe_${baseName}.md`)}
        loading={busy === 'markdown'}
      >
        <FileText className="h-4 w-4" />
        Markdown
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => descargar('csv', `Comparativa_${baseName}.csv`)}
        loading={busy === 'csv'}
      >
        <FileDown className="h-4 w-4" />
        CSV
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => descargar('xlsx', `Comparativa_${baseName}.${isMock ? 'xls' : 'xlsx'}`)}
        loading={busy === 'xlsx'}
      >
        <FileSpreadsheet className="h-4 w-4" />
        Excel
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => descargar('salida-json', 'salida.json')}
        loading={busy === 'salida-json'}
      >
        <FileJson className="h-4 w-4" />
        salida.json
      </Button>
      {error && (
        <p role="alert" className="w-full text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
