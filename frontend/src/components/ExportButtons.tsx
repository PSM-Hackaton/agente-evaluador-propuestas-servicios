import { useState } from 'react';
import { FileDown, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { api, isMock, type Evaluacion, type Proyecto } from '../api';
import {
  downloadBlob,
  downloadText,
  evaluacionToCSV,
  evaluacionToMarkdown,
  slug,
} from '../lib/export';
import { Button } from './ui';

interface ExportButtonsProps {
  evaluacion: Evaluacion;
  proyecto: Proyecto;
}

export function ExportButtons({ evaluacion, proyecto }: ExportButtonsProps) {
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseName = slug(proyecto.nombre) || 'evaluacion';

  const handlePDF = async () => {
    if (isMock) {
      window.print();
      return;
    }
    setBusy('pdf');
    try {
      const blob = await api.evaluations.exportFile(evaluacion.id, 'pdf');
      downloadBlob(blob, `Informe_${baseName}.pdf`);
    } catch {
      window.print();
    } finally {
      setBusy(null);
    }
  };

  const handleExcel = async () => {
    setBusy('xlsx');
    setError(null);
    try {
      const blob = await api.evaluations.exportFile(evaluacion.id, 'xlsx');
      const ext = isMock ? 'xls' : 'xlsx';
      downloadBlob(blob, `Comparativa_${baseName}.${ext}`);
    } catch (e) {
      setError(e instanceof Error ? `No se pudo generar el Excel: ${e.message}` : 'No se pudo generar el Excel');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button variant="secondary" size="sm" onClick={handlePDF} loading={busy === 'pdf'}>
        <Printer className="h-4 w-4" />
        PDF
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          downloadText(evaluacionToMarkdown(evaluacion, proyecto), `Informe_${baseName}.md`, 'text/markdown')
        }
      >
        <FileText className="h-4 w-4" />
        Markdown
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => downloadText(evaluacionToCSV(evaluacion), `Comparativa_${baseName}.csv`, 'text/csv')}
      >
        <FileDown className="h-4 w-4" />
        CSV
      </Button>
      <Button variant="secondary" size="sm" onClick={handleExcel} loading={busy === 'xlsx'}>
        <FileSpreadsheet className="h-4 w-4" />
        Excel
      </Button>
      {error && (
        <p role="alert" className="w-full text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
