import { Target } from 'lucide-react';
import type { SelectionInfo } from '../shared/protocol';

interface Props {
  selection: SelectionInfo;
  contextSvgChars: number;
  screenshotEnabled: boolean;
}

const bytesLabel = (chars: number) => {
  if (chars <= 0) {
    return 'none';
  }
  const kb = chars / 1024;
  return `${kb.toFixed(1)}kb`;
};

export default function ContextIndicator({
  selection,
  contextSvgChars,
  screenshotEnabled
}: Props) {
  if (!selection.hasSelection) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: 'var(--figma-color-bg-secondary)', borderRadius: '4px', fontSize: '0.75rem', marginBottom: '12px' }}>
        <Target size={14} style={{ opacity: 0.5 }} />
        <span style={{ opacity: 0.7 }}>
          Context: global | SVG {bytesLabel(contextSvgChars)} | screenshot {screenshotEnabled ? 'on' : 'off'}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: 'var(--figma-color-bg-brand-tertiary, #e5f4ff)', color: 'var(--figma-color-text-brand)', borderRadius: '4px', fontSize: '0.75rem', marginBottom: '12px', fontWeight: 500 }}>
      <Target size={14} />
      <span>
        Context: {selection.count} item{selection.count !== 1 ? 's' : ''} selected | SVG {bytesLabel(contextSvgChars)} | screenshot {screenshotEnabled ? 'on' : 'off'}
      </span>
    </div>
  );
}
