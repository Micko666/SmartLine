import { STATUS_COLORS } from './shared';

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border capitalize ${STATUS_COLORS[status] ?? 'bg-muted'}`}>
      {status}
    </span>
  );
}
