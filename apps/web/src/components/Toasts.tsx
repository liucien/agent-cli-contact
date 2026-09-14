import type { Toast } from '../store';

export function Toasts({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.level === 'warn' ? ' warn' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
