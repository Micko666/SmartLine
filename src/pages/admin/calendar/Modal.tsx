import { X } from 'lucide-react';

// ─── Shared Modal ─────────────────────────────────────────────────────────────

export default function Modal({ title, subtitle, onClose, wide, children }: {
  title: string; subtitle?: string; onClose: () => void; wide?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 bg-foreground/30 backdrop-blur-sm overflow-y-auto">
      <div className={`bg-card rounded-2xl shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} mb-8`}>
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border">
          <div>
            <h2 className="font-display font-bold text-lg leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground shrink-0 ml-3">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
