import { Target } from 'lucide-react';

interface Props {
  selectionCount: number;
}

export default function ContextIndicator({ selectionCount }: Props) {
  if (selectionCount === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: 'var(--figma-color-bg-secondary)', borderRadius: '4px', fontSize: '0.75rem', marginBottom: '12px' }}>
        <Target size={14} style={{ opacity: 0.5 }} />
        <span style={{ opacity: 0.7 }}>Context: Global (No selection)</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: 'var(--figma-color-bg-brand-tertiary, #e5f4ff)', color: 'var(--figma-color-text-brand)', borderRadius: '4px', fontSize: '0.75rem', marginBottom: '12px', fontWeight: 500 }}>
      {/* Fallback to #e5f4ff if figma-color-bg-brand-tertiary is missing */}
      <Target size={14} />
      <span>
        Context: {selectionCount} item{selectionCount !== 1 ? 's' : ''} selected
      </span>
    </div>
  );
}
