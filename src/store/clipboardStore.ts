import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { ClipboardEntry, Settings, TimeFilter, TypeFilter } from '../types';
import { subDays, startOfDay } from 'date-fns';

interface State {
  entries: ClipboardEntry[];
  selectedIndex: number;
  hoveredIndex?: number;
  query: string;
  typeFilter: TypeFilter;
  timeFilter: TimeFilter;
  sourceFilter?: string;
  settings?: Settings;
  loading: boolean;
  error?: string;
  ready: boolean;
  fetchHistory: () => Promise<void>;
  setQuery: (q: string) => void;
  setTypeFilter: (t: TypeFilter) => void;
  setTimeFilter: (t: TimeFilter) => void;
  setSourceFilter: (s?: string) => void;
  moveSelection: (delta: number) => void;
  setHovered: (idx?: number) => void;
  deleteSelected: () => Promise<void>;
  pasteSelected: (plain: boolean) => Promise<void>;
  togglePin: () => Promise<void>;
  loadSettings: () => Promise<void>;
  updateSettings: (settings: Partial<Settings>) => Promise<void>;
}

const withinTime = (timestamp: number, filter: TimeFilter) => {
  const date = new Date(timestamp);
  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const yesterdayStart = startOfDay(subDays(now, 1)).getTime();
  switch (filter) {
    case 'today':
      return timestamp >= todayStart;
    case 'yesterday':
      return timestamp >= yesterdayStart && timestamp < todayStart;
    case 'earlier':
      return timestamp < yesterdayStart;
    default:
      return true;
  }
};

export const useClipboardStore = create<State>((set, get) => ({
  entries: [],
  selectedIndex: 0,
  hoveredIndex: undefined,
  query: '',
  typeFilter: 'all',
  timeFilter: 'all',
  sourceFilter: undefined,
  loading: false,
  ready: false,
  async fetchHistory() {
    set({ loading: true, error: undefined });
    try {
      const { query, typeFilter, timeFilter, sourceFilter } = get();
      const rows: ClipboardEntry[] = await invoke('get_history', {
        query,
        typeFilter,
        timeFilter,
        sourceFilter,
      });
      set({ entries: rows, loading: false, ready: true, selectedIndex: 0, hoveredIndex: undefined });
    } catch (error: any) {
      set({ error: error?.message ?? '加载失败', loading: false, ready: true });
    }
  },
  setQuery(q) {
    set({ query: q, selectedIndex: 0 });
    // debounce handled outside
  },
  setTypeFilter(t) {
    set({ typeFilter: t, selectedIndex: 0 });
  },
  setTimeFilter(t) {
    set({ timeFilter: t, selectedIndex: 0 });
  },
  setSourceFilter(s) {
    set({ sourceFilter: s, selectedIndex: 0 });
  },
  setHovered(idx) {
    set({ hoveredIndex: idx });
  },
  moveSelection(delta) {
    const { entries, selectedIndex } = get();
    if (!entries.length) return;
    const next = Math.min(entries.length - 1, Math.max(0, selectedIndex + delta));
    set({ selectedIndex: next, hoveredIndex: undefined });
  },
  async deleteSelected() {
    const { entries, selectedIndex, fetchHistory } = get();
    const entry = entries[selectedIndex];
    if (!entry) return;
    await invoke('delete_entry', { id: entry.id });
    await fetchHistory();
  },
  async pasteSelected(plain) {
    const { entries, selectedIndex } = get();
    const entry = entries[selectedIndex];
    if (!entry) return;
    await invoke('paste_entry', { id: entry.id, plain });
  },
  async togglePin() {
    const { entries, selectedIndex, fetchHistory } = get();
    const entry = entries[selectedIndex];
    if (!entry) return;
    await invoke('toggle_pin', { id: entry.id });
    await fetchHistory();
  },
  async loadSettings() {
    const settings: Settings = await invoke('get_settings');
    set({ settings: { ...settings, record_images: true } });
  },
  async updateSettings(partial) {
    const current = get().settings ?? {
      max_history: 1000,
      record_images: true,
      hotkey: 'Ctrl+Shift+V',
      blacklist: [],
    };
    const merged = { ...current, ...partial, record_images: true };
    const saved: Settings = await invoke('update_settings', { settings: merged });
    set({ settings: saved });
  },
}));

// start listening for backend new item events once
listen<ClipboardEntry>('clipboard://new', (event) => {
  const entry = event.payload;
  const { entries } = useClipboardStore.getState();
useClipboardStore.setState({ entries: [entry, ...entries], selectedIndex: 0, hoveredIndex: undefined });
});
