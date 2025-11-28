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
  const { entries, selectedIndex, hoveredIndex, query, moveSelection, setHovered, copyEntry, deleteEntry } = useClipboardStore();
  const parentRef = useRef<HTMLDivElement>(null);
  const [openActionId, setOpenActionId] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (openActionId === null) return;
    const handleClickAway = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const inMenu = target.closest('[data-action-menu="true"]');
      const inTrigger = target.closest('[data-action-trigger="true"]');
      if (inMenu || inTrigger) return;
      setOpenActionId(null);
    };
    window.addEventListener('mousedown', handleClickAway);
    return () => window.removeEventListener('mousedown', handleClickAway);
  }, [openActionId]);

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
      onScroll={() => setOpenActionId(null)}
      style={{
        height,
        overflow: 'auto',
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: '#f8fafc',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
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
                  padding: '8px 14px 2px',
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--text-sub)',
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: 0.15,
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
            setOpenActionId(null);
            moveSelection(entryIndex - selectedIndex);
            onEntryClick?.(entry, entryIndex);
          };
          const handlePreview = (e?: React.MouseEvent) => {
            e?.stopPropagation();
            moveSelection(entryIndex - selectedIndex);
            onEntryClick?.(entry, entryIndex);
            setOpenActionId(null);
          };
          const handleCopy = async (e: React.MouseEvent) => {
            e.stopPropagation();
            await copyEntry(entry.id);
            setOpenActionId(null);
          };
          const handleDelete = async (e: React.MouseEvent) => {
            e.stopPropagation();
            await deleteEntry(entry.id);
            setOpenActionId(null);
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
                padding: '4px 12px',
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
                    borderRadius: 10,
                    border: '1px solid ' + (isActive ? '#d8ddff' : 'var(--border)'),
                    background: isActive ? 'var(--accent-soft)' : 'var(--card)',
                    boxShadow: isActive ? 'var(--shadow-card)' : isHover ? 'var(--shadow-card)' : 'none',
                    padding: '10px 12px',
                    display: 'grid',
                    gridTemplateColumns: '44px 1fr auto',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: 'pointer',
                    transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease, background 140ms ease',
                    transform: isHover ? 'translateY(-1px)' : 'none',
                    position: 'relative',
                    zIndex: openActionId === entry.id ? 3 : 1,
                    overflow: 'visible',
                  }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: 'var(--accent-soft)',
                    color: '#4338ca',
                    display: 'grid',
                    placeItems: 'center',
                    textTransform: 'uppercase',
                    overflow: 'hidden',
                    border: '1px solid #e5e7eb',
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
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600, color: 'var(--text)' }}>
                    {highlight(summarize(entry), query)}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-sub)',
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    <span>{humanTime(entry.created_at)}</span>
                    <span>· {entry.source_app || '未知来源'}</span>
                    {entry.usage_count > 0 && <span>· 使用 {entry.usage_count} 次</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      background: '#e5e7eb',
                      color: '#4b5563',
                      fontSize: 12,
                    }}
                  >
                    {entry.content_type === 'image' ? '图片' : '文本'}
                  </span>
                  {entry.is_pinned && <span style={{ color: 'var(--accent)' }}>📌</span>}
                  <button
                    type="button"
                    aria-label="更多操作"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenActionId((prev) => (prev === entry.id ? null : entry.id));
                    }}
                    data-action-trigger="true"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: '#fff',
                      cursor: 'pointer',
                      color: '#6b7280',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 700,
                      lineHeight: 1,
                      boxShadow: '0 8px 14px rgba(15,23,42,0.06)',
                    }}
                  >
                    ⋯
                  </button>
                </div>
                {openActionId === entry.id && (
                  <div
                    data-action-menu="true"
                    style={{
                      position: 'absolute',
                      top: 12,
                      right: 12,
                      background: '#fff',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      boxShadow: '0 16px 40px rgba(15,23,42,0.12)',
                      padding: '8px',
                      minWidth: 150,
                      zIndex: 10,
                      display: 'grid',
                      gap: 6,
                    }}
                  >
                    <button
                      type="button"
                      onClick={handlePreview}
                      style={{
                        textAlign: 'left',
                        padding: '9px 10px',
                        borderRadius: 10,
                        border: '1px solid transparent',
                        background: 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      预览
                    </button>
                    <button
                      type="button"
                      onClick={handleCopy}
                      style={{
                        textAlign: 'left',
                        padding: '9px 10px',
                        borderRadius: 10,
                        border: '1px solid transparent',
                        background: 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      复制
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      style={{
                        textAlign: 'left',
                        padding: '9px 10px',
                        borderRadius: 10,
                        border: '1px solid transparent',
                        background: 'transparent',
                        color: '#dc2626',
                        cursor: 'pointer',
                      }}
                    >
                      删除
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default HistoryList;
