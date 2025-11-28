import React from 'react';
import { useClipboardStore } from '../store/clipboardStore';
import { TypeFilter, TimeFilter } from '../types';
import SettingsPanel from './SettingsPanel';
import { listen } from '@tauri-apps/api/event';

const segmentedBtn = (active: boolean) => ({
  minWidth: 68,
  padding: '7px 12px',
  borderRadius: '10px',
  border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
  background: active ? 'var(--accent-soft)' : 'transparent',
  color: active ? 'var(--accent)' : 'var(--text-sub)',
  fontSize: 13,
  cursor: 'pointer',
  transition: 'all 140ms ease',
});

const SearchBar: React.FC = () => {
  const { query, setQuery, typeFilter, setTypeFilter, timeFilter, setTimeFilter, fetchHistory } = useClipboardStore();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const settingsBtnRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('tauri://focus', () => inputRef.current?.focus()).then((fn) => {
      unlisten = fn;
    });
    inputRef.current?.focus();
    return () => {
      unlisten?.();
    };
  }, []);

  const timer = React.useRef<number>();
  const onChange = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => fetchHistory(), 120);
  };

  const updateType = (t: TypeFilter) => {
    setTypeFilter(t);
    fetchHistory();
  };

  const updateTime = (t: TimeFilter) => {
    setTimeFilter(t);
    fetchHistory();
  };

  React.useEffect(() => {
    if (!settingsOpen) return;
    const onClickAway = (e: MouseEvent) => {
      if (!settingsBtnRef.current) return;
      const popover = document.getElementById('settings-popover');
      if (settingsBtnRef.current.contains(e.target as Node)) return;
      if (popover && popover.contains(e.target as Node)) return;
      setSettingsOpen(false);
    };
    window.addEventListener('mousedown', onClickAway);
    return () => window.removeEventListener('mousedown', onClickAway);
  }, [settingsOpen]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'relative' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          alignItems: 'center',
          gap: 14,
          minHeight: 72,
          padding: '4px 6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 180 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              background: 'linear-gradient(140deg, #e0e7ff, #f4f5ff)',
              display: 'grid',
              placeItems: 'center',
              color: '#4f46e5',
              fontWeight: 700,
              letterSpacing: 0.2,
            }}
          >
            P
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Pastify</div>
            <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>剪贴板时间机 · Everything you copied</div>
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            background: '#fff',
            borderRadius: '999px',
            border: '1px solid var(--border)',
            padding: '8px 12px 8px 14px',
            boxShadow: 'inset 0 1px 0 rgba(0,0,0,0.02)',
          }}
        >
          <span style={{ color: 'var(--muted)', marginRight: 8 }}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M9.25 15.5C12.7018 15.5 15.5 12.7018 15.5 9.25C15.5 5.79822 12.7018 3 9.25 3C5.79822 3 3 5.79822 3 9.25C3 12.7018 5.79822 15.5 9.25 15.5Z"
                stroke="#9ca3af"
                strokeWidth="1.3"
              />
              <path d="M15 15L17 17" stroke="#9ca3af" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </span>
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => onChange(e.target.value)}
            placeholder="搜索历史内容…"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: 15,
              background: 'transparent',
              color: 'var(--text)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') fetchHistory();
            }}
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                fetchHistory();
                inputRef.current?.focus();
              }}
              aria-label="清空搜索"
              style={{
                border: 'none',
                background: '#f3f4f6',
                borderRadius: '50%',
                width: 26,
                height: 26,
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
                color: '#6b7280',
              }}
            >
              ×
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end', minWidth: 230 }}>
          <div style={{ color: 'var(--text-sub)', fontSize: 12 }}>Enter 粘贴 · Ctrl+Enter 纯文本 · ESC 关闭</div>
          <div style={{ position: 'relative' }}>
            <button
              ref={settingsBtnRef}
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="打开设置"
              style={{
                width: 36,
                height: 36,
                borderRadius: '12px',
                border: '1px solid var(--border)',
                background: '#fff',
                display: 'grid',
                placeItems: 'center',
                boxShadow: '0 6px 18px rgba(15,23,42,0.08)',
                cursor: 'pointer',
                transition: 'transform 120ms ease, box-shadow 120ms ease, background 120ms ease',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M10.833 2.5L9.167 2.5L8.833 4.167C8.07664 4.32962 7.36973 4.64339 6.75 5.08333L5.16667 4.16667L4.16667 5.16667L5.08333 6.75C4.64339 7.36973 4.32962 8.07664 4.16667 8.833L2.5 9.167L2.5 10.833L4.16667 11.167C4.32962 11.9234 4.64339 12.6303 5.08333 13.25L4.16667 14.8333L5.16667 15.8333L6.75 14.9167C7.36973 15.3566 8.07664 15.6704 8.833 15.8333L9.167 17.5H10.833L11.167 15.8333C11.9234 15.6704 12.6303 15.3566 13.25 14.9167L14.8333 15.8333L15.8333 14.8333L14.9167 13.25C15.3566 12.6303 15.6704 11.9234 15.8333 11.167L17.5 10.833V9.16667L15.8333 8.833C15.6704 8.07664 15.3566 7.36973 14.9167 6.75L15.8333 5.16667L14.8333 4.16667L13.25 5.08333C12.6303 4.64339 11.9234 4.32962 11.167 4.16667L10.833 2.5Z"
                  stroke="#4b5563"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="10" cy="10" r="2.5" stroke="#4b5563" strokeWidth="1.2" />
              </svg>
            </button>
            {settingsOpen && (
              <div
                id="settings-popover"
                style={{
                  position: 'absolute',
                  top: 44,
                  right: 0,
                  zIndex: 30,
                  boxShadow: 'var(--shadow-elevated)',
                  borderRadius: 14,
                  border: '1px solid var(--border)',
                  background: '#fff',
                }}
              >
                <SettingsPanel />
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '0 6px',
        }}
      >
        <div style={{ display: 'flex', gap: 6, background: '#fff', borderRadius: '12px', padding: 4, border: '1px solid var(--border)' }}>
          {(['all', 'text', 'image'] as TypeFilter[]).map((t) => (
            <button key={t} style={segmentedBtn(t === typeFilter)} onClick={() => updateType(t)}>
              {t === 'all' ? '全部' : t === 'text' ? '文本' : '图片'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, background: '#fff', borderRadius: '12px', padding: 4, border: '1px solid var(--border)' }}>
          {(['all', 'today', 'yesterday', 'earlier'] as TimeFilter[]).map((t) => (
            <button key={t} style={segmentedBtn(t === timeFilter)} onClick={() => updateTime(t)}>
              {t === 'all' ? '全部' : t === 'today' ? '今天' : t === 'yesterday' ? '昨天' : '更早'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SearchBar;
