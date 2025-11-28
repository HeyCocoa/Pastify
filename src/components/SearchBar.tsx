import React from 'react';
import { useClipboardStore } from '../store/clipboardStore';
import { TypeFilter, TimeFilter } from '../types';
import SettingsPanel from './SettingsPanel';
import { listen } from '@tauri-apps/api/event';

const pillStyle = (active: boolean) => ({
  padding: '6px 10px',
  borderRadius: 999,
  border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
  background: active ? 'var(--accent-soft)' : '#fff',
  color: active ? '#4338ca' : 'var(--text)',
  cursor: 'pointer',
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

  // debounce query
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder="搜索内容…"
          style={{
            flex: 1,
            padding: '12px 14px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            boxShadow: 'inset 0 1px 0 rgba(0,0,0,0.02)',
            outline: 'none',
            fontSize: 15,
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') fetchHistory();
          }}
        />
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>Enter 粘贴 · Ctrl+Enter 纯文本 · ESC 关闭</div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>类型</span>
          {(['all', 'text', 'image'] as TypeFilter[]).map((t) => (
            <button key={t} style={pillStyle(t === typeFilter)} onClick={() => updateType(t)}>
              {t === 'all' ? '全部' : t === 'text' ? '文本' : '图片'}
            </button>
          ))}
          <span style={{ marginLeft: 12, color: 'var(--muted)', fontSize: 12 }}>时间</span>
          {(['all', 'today', 'yesterday', 'earlier'] as TimeFilter[]).map((t) => (
            <button key={t} style={pillStyle(t === timeFilter)} onClick={() => updateTime(t)}>
              {t === 'all' ? '全部' : t === 'today' ? '今天' : t === 'yesterday' ? '昨天' : '更早'}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative' }}>
          <button
            ref={settingsBtnRef}
            onClick={() => setSettingsOpen((v) => !v)}
            style={{
              border: '1px solid var(--border)',
              background: '#fff',
              borderRadius: 10,
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              boxShadow: '0 6px 18px rgba(15,23,42,0.08)',
            }}
          >
            <span style={{ fontSize: 16 }}>⚙️</span>
            <span>设置</span>
          </button>
          {settingsOpen && (
            <div
              id="settings-popover"
              style={{
                position: 'absolute',
                top: 44,
                right: 0,
                zIndex: 20,
                boxShadow: '0 20px 50px rgba(15,23,42,0.16)',
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
  );
};

export default SearchBar;
