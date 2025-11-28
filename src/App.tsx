import React from 'react';
import SearchBar from './components/SearchBar';
import HistoryList from './components/HistoryList';
import SettingsPanel from './components/SettingsPanel';
import { useClipboardStore } from './store/clipboardStore';
import { appWindow } from '@tauri-apps/api/window';

const App: React.FC = () => {
  const {
    fetchHistory,
    moveSelection,
    pasteSelected,
    deleteSelected,
    togglePin,
    loadSettings,
    entries,
    selectedIndex,
    hoveredIndex,
    ready,
  } = useClipboardStore();

  React.useEffect(() => {
    loadSettings();
    fetchHistory();
  }, [fetchHistory, loadSettings]);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelection(-1);
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        const plain = e.ctrlKey || e.metaKey;
        appWindow.hide().then(() => {
          // give focus a beat to return to上一个应用，再执行模拟粘贴
          window.setTimeout(() => pasteSelected(plain), 80);
        });
      } else if (e.key === 'Delete') {
        e.preventDefault();
        deleteSelected();
      } else if (e.key.toLowerCase() === 'p' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        togglePin();
      } else if (e.key === 'Escape') {
        appWindow.hide();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [moveSelection, pasteSelected, deleteSelected, togglePin]);

  const active = entries[selectedIndex];
  const hovered = hoveredIndex !== undefined ? entries[hoveredIndex] : undefined;

  return (
    <div
      style={{
        height: '100vh',
        padding: '18px',
        background: 'var(--bg)',
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SearchBar />
        <HistoryList height={window.innerHeight - 120} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SettingsPanel />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: '#fff' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>当前选中</div>
            {active ? (
              <>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{(active.text_content || '[图片]').slice(0, 80)}</div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>来源：{active.source_app || '未知'}</div>
              </>
            ) : ready ? (
              <div style={{ color: 'var(--muted)' }}>暂无数据</div>
            ) : (
              <div style={{ color: 'var(--muted)' }}>加载中…</div>
            )}
          </div>
          <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: '#fff' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>预览</div>
            {hovered ? (
              <>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{(hovered.text_content || '[图片]').slice(0, 80)}</div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>来源：{hovered.source_app || '未知'}</div>
              </>
            ) : (
              <div style={{ color: 'var(--muted)' }}>悬停列表项以预览</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
