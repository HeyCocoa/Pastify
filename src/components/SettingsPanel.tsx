import React from 'react';
import { useClipboardStore } from '../store/clipboardStore';

const SettingsPanel: React.FC = () => {
  const { settings, updateSettings } = useClipboardStore();
  if (!settings) return null;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 16, background: '#fff', width: 320 }}>
      <div style={{ marginBottom: 12, fontSize: 15, fontWeight: 600 }}>设置</div>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ color: 'var(--text-sub)', fontSize: 13 }}>全局快捷键</div>
          <input
            value={settings.hotkey}
            onChange={(e) => updateSettings({ hotkey: e.target.value })}
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: '#f9fafb',
              minWidth: 140,
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ color: 'var(--text-sub)', fontSize: 13 }}>最大历史条数</div>
          <input
            type="number"
            min={100}
            max={5000}
            value={settings.max_history}
            onChange={(e) => updateSettings({ max_history: Number(e.target.value) })}
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: '#f9fafb',
              width: 120,
            }}
          />
        </div>
      </div>
      <div style={{ marginTop: 12, color: 'var(--text-sub)', fontSize: 12, lineHeight: 1.6 }}>
        所有数据仅保存在本地，不会上传到服务器。
      </div>
    </div>
  );
};

export default SettingsPanel;
