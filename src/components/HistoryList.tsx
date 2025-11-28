import React, { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { format, isToday, isYesterday } from 'date-fns';
import { ClipboardEntry } from '../types';
import { useClipboardStore } from '../store/clipboardStore';

interface RowGroup {
  type: 'group';
  label: string;
}

interface RowItem {
  type: 'item';
  entry: ClipboardEntry;
  entryIndex: number;
}

type Row = RowGroup | RowItem;

const summarize = (entry: ClipboardEntry) => {
  if (entry.content_type === 'image') return '[图片]';
  return (entry.text_content ?? '').replace(/\s+/g, ' ').slice(0, 120) || '[空文本]';
};

const humanTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return format(date, 'HH:mm');
};

const groupTitle = (timestamp: number) => {
  const date = new Date(timestamp);
  if (isToday(date)) return '今天';
  if (isYesterday(date)) return '昨天';
  return '更早';
};

const highlight = (text: string, query: string) => {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: '#fef08a', color: 'inherit', padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
};

interface Props {
  height: number;
  onEntryClick?: (entry: ClipboardEntry, index: number) => void;
}

const HistoryList: React.FC<Props> = ({ height, onEntryClick }) => {
  const { entries, selectedIndex, hoveredIndex, query, moveSelection, setHovered } = useClipboardStore();
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const result: Row[] = [];
    let currentGroup = '';
    entries.forEach((entry, idx) => {
      const g = groupTitle(entry.created_at);
      if (g !== currentGroup) {
        result.push({ type: 'group', label: g });
        currentGroup = g;
      }
      result.push({ type: 'item', entry, entryIndex: idx });
    });
    return result;
  }, [entries]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 6,
    measureElement: React.useCallback((el: Element | null) => el?.getBoundingClientRect().height || 0, []),
  });

  React.useEffect(() => {
    const rowIndex = rows.findIndex((r) => r.type === 'item' && (r as RowItem).entryIndex === selectedIndex);
    if (rowIndex >= 0) rowVirtualizer.scrollToIndex(rowIndex, { align: 'auto' });
  }, [selectedIndex, rows, rowVirtualizer]);

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      style={{
        height,
        overflow: 'auto',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: 'var(--panel)',
      }}
    >
      <div
        style={{
          height: rowVirtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (row.type === 'group') {
            return (
              <div
                key={virtualRow.key}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: virtualRow.start,
                  left: 0,
                  width: '100%',
                  height: virtualRow.size,
                  padding: '0 12px',
                  display: 'flex',
                  alignItems: 'center',
                  color: '#4b5563',
                  background: '#f5f5f5',
                  borderBottom: '1px solid #e5e7eb',
                }}
              >
                {row.label}
              </div>
            );
          }
          const { entry, entryIndex } = row as RowItem;
          const isActive = entryIndex === selectedIndex;
          const isHover = entryIndex === hoveredIndex;
          const handleClick = () => {
            moveSelection(entryIndex - selectedIndex);
            onEntryClick?.(entry, entryIndex);
          };
          return (
            <div
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              style={{
                position: 'absolute',
                top: virtualRow.start,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                padding: '8px 12px',
              }}
              className="fade-in"
            >
              <div
                onClick={handleClick}
                onMouseEnter={() => setHovered(entryIndex)}
                onMouseLeave={() => setHovered(undefined)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleClick();
                  }
                }}
                style={{
                  height: '100%',
                  borderRadius: '8px',
                  border: isActive ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                  background: isActive
                    ? 'var(--accent-soft)'
                    : isHover
                      ? '#f8fafc'
                      : '#fff',
                  boxShadow: isActive ? '0 8px 20px rgba(124,58,237,0.12)' : 'none',
                  padding: '9px',
                  display: 'flex',
                  gap: '12px',
                  cursor: 'pointer',
                  transition: 'transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease',
                  transform: isHover ? 'translateY(-1px)' : 'none',
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: '#eef2ff',
                    color: '#4338ca',
                    display: 'grid',
                    placeItems: 'center',
                    textTransform: 'uppercase',
                    overflow: 'hidden',
                  }}
                >
                  {entry.source_icon ? (
                    <img
                      src={entry.source_icon}
                      alt={entry.source_app || 'app'}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    (entry.source_app || '?').slice(0, 1)
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {highlight(summarize(entry), query)}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span>{humanTime(entry.created_at)}</span>
                    <span>· {entry.source_app || '未知来源'}</span>
                    <span>· {entry.content_type === 'image' ? '图片' : '文本'}</span>
                    {entry.usage_count > 0 && <span>· 使用 {entry.usage_count} 次</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {entry.is_pinned && <span style={{ color: 'var(--accent)' }}>📌</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default HistoryList;
