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

  return (
    <div
      style={{
        height: '100vh',
        padding: '18px',
        background: 'var(--bg)',
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SearchBar />
        <HistoryList height={window.innerHeight - 120} onEntryClick={(entry) => setPreviewEntry(entry)} />
      </div>
      {previewEntry && <PreviewModal entry={previewEntry} onClose={() => setPreviewEntry(null)} />}
    </div>
  );
};

export default App;
