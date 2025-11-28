import React from 'react';
import { useClipboardStore } from '../store/clipboardStore';

const SettingsPanel: React.FC = () => {
  const { settings, updateSettings } = useClipboardStore();
  if (!settings) return null;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, background: '#fff', width: 320 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>设置</div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>全局快捷键</span>
        <input
          value={settings.hotkey}
          onChange={(e) => updateSettings({ hotkey: e.target.value })}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>最大历史条数</span>
        <input
          type="number"
          min={100}
          max={5000}
          value={settings.max_history}
          onChange={(e) => updateSettings({ max_history: Number(e.target.value) })}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={settings.record_images}
          onChange={(e) => updateSettings({ record_images: e.target.checked })}
        />
        <span>记录图片</span>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>黑名单应用（逗号分隔）</span>
        <input
          value={settings.blacklist.join(',')}
          onChange={(e) => updateSettings({ blacklist: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
        />
      </label>
    </div>
  );
};

export default SettingsPanel;
