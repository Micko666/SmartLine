import { useRef } from 'react';
import { Download, ExternalLink, X, Copy } from 'lucide-react';
import { motion } from 'framer-motion';
import QRCode from 'react-qr-code';
import type { Table } from '@/domain/types';
import { toast } from 'sonner';
import { makeQrDownloader } from './shared';

// ─── QrSheet (full-screen modal) ──────────────────────────────────────────────

export default function QrSheet({ table, url, restaurantName, onClose }: {
  table: Table; url: string; restaurantName: string; onClose: () => void;
}) {
  const qrRef = useRef<HTMLDivElement>(null);
  const fileName = `qr-${table.name.replace(/\s+/g, '-').toLowerCase()}`;
  const downloadQr = makeQrDownloader(qrRef, fileName);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-card border border-border rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{restaurantName}</p>
            <h2 className="font-display font-bold text-xl mt-0.5">{table.name}</h2>
            {table.zone && <p className="text-xs text-muted-foreground">{table.zone}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div ref={qrRef} className="mx-5 bg-white rounded-2xl p-6 flex justify-center">
          <QRCode value={url} size={228} />
        </div>
        <button
          onClick={() => { navigator.clipboard.writeText(url); toast.success('URL copied'); }}
          className="mx-5 mt-3 flex items-center gap-2 w-[calc(100%-40px)] bg-muted rounded-xl px-3 py-2 hover:bg-muted/70 transition-colors"
        >
          <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-[11px] text-muted-foreground font-mono truncate">{url}</span>
        </button>
        <div className="p-5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => downloadQr('svg')} className="flex items-center justify-center gap-1.5 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              <Download className="w-4 h-4" /> SVG
            </button>
            <button onClick={() => downloadQr('png')} className="flex items-center justify-center gap-1.5 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              <Download className="w-4 h-4" /> PNG
            </button>
          </div>
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 h-10 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            <ExternalLink className="w-4 h-4" /> Open customer menu
          </a>
        </div>
      </motion.div>
    </motion.div>
  );
}
