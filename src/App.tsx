import React from 'react';
import SearchBar from './components/SearchBar';
import HistoryList from './components/HistoryList';
import PreviewModal from './components/PreviewModal';
import { useClipboardStore } from './store/clipboardStore';
import { ClipboardEntry } from './types';
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
  } = useClipboardStore();
  const [previewEntry, setPreviewEntry] = React.useState<ClipboardEntry | null>(null);
  const [viewportHeight, setViewportHeight] = React.useState(() => window.innerHeight);

  React.useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
        if (previewEntry) {
          e.preventDefault();
          setPreviewEntry(null);
          return;
        }
        appWindow.hide();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [moveSelection, pasteSelected, deleteSelected, togglePin, previewEntry]);

  React.useEffect(() => {
    if (!previewEntry) return;
    const latest = entries.find((e) => e.id === previewEntry.id);
    if (!latest) {
      setPreviewEntry(null);
      return;
    }
    if (
      latest.text_content !== previewEntry.text_content ||
      latest.image_thumb !== previewEntry.image_thumb ||
      latest.is_pinned !== previewEntry.is_pinned ||
      latest.usage_count !== previewEntry.usage_count
    ) {
      setPreviewEntry(latest);
    }
  }, [entries, previewEntry]);

  const panelHeight = Math.max(520, Math.min(580, viewportHeight - 80));
  const listHeight = Math.max(280, panelHeight - 72 - 56 - 40 - 42); // toolbar + filters + status + paddings/gaps

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '28px 32px',
      }}
    >
      <div
        style={{
          width: 'min(960px, 94vw)',
          height: `${panelHeight}px`,
          background: 'var(--panel)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-panel)',
          display: 'flex',
          flexDirection: 'column',
          padding: '18px 20px 14px',
          gap: 12,
          position: 'relative',
        }}
      >
        <SearchBar />
        <HistoryList height={listHeight} onEntryClick={(entry) => setPreviewEntry(entry)} />
        <div
          style={{
            height: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 6px',
            color: 'var(--text-sub)',
            fontSize: 12,
            borderTop: '1px solid var(--border)',
          }}
        >
          <span>{`共 ${entries.length} 条记录 · 单击预览`}</span>
          <span>Enter 粘贴</span>
        </div>
      </div>
      {previewEntry && <PreviewModal entry={previewEntry} onClose={() => setPreviewEntry(null)} />}
    </div>
  );
};

export default App;
