import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 text-sm text-slate-500', className)}>
      <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
      {label && <span>{label}</span>}
    </div>
  );
}
