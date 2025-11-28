import React from 'react';
import { format } from 'date-fns';
import { ClipboardEntry } from '../types';

interface Props {
  entry: ClipboardEntry;
  onClose: () => void;
}

const PreviewModal: React.FC<Props> = ({ entry, onClose }) => {
  const timestamp = format(new Date(entry.created_at), 'yyyy/MM/dd HH:mm:ss');
  const hasText = Boolean(entry.text_content);
  const hasImage = Boolean(entry.image_thumb);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(880px, 94vw)',
          maxHeight: '86vh',
          background: '#fff',
          borderRadius: 18,
          border: '1px solid #e5e7eb',
          boxShadow: '0 18px 50px rgba(15, 23, 42, 0.18)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'fadeIn 140ms ease-out',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 18px',
            borderBottom: '1px solid #f1f5f9',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: '#eef2ff',
                color: '#4338ca',
                display: 'grid',
                placeItems: 'center',
                textTransform: 'uppercase',
                overflow: 'hidden',
                flexShrink: 0,
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
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {entry.source_app || '未知来源'}
              </div>
              <div style={{ color: '#6b7280', fontSize: 12 }}>{timestamp}</div>
            </div>
            <span
              style={{
                marginLeft: 'auto',
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(124,58,237,0.1)',
                color: '#6d28d9',
                fontSize: 12,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
              }}
            >
              {entry.content_type === 'image' ? '图片' : '文本'}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              border: '1px solid #e5e7eb',
              background: '#f8fafc',
              borderRadius: 10,
              padding: '8px 12px',
              cursor: 'pointer',
            }}
          >
            关闭
          </button>
        </div>
        <div
          style={{
            padding: '18px 18px 20px',
            overflowY: 'auto',
            maxHeight: 'calc(86vh - 72px)',
            background: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {hasText && (
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: 14 }}>
              <div style={{ fontSize: 13, color: '#374151', marginBottom: 10 }}>文本内容</div>
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  lineHeight: 1.6,
                  fontSize: 13.5,
                  color: '#0f172a',
                }}
              >
                {entry.text_content}
              </div>
            </div>
          )}
          {hasImage && (
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: 14 }}>
              <div style={{ fontSize: 13, color: '#374151', marginBottom: 10 }}>图片预览</div>
              <div
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 12,
                  padding: 8,
                  background: '#f9fafb',
                  display: 'grid',
                  placeItems: 'center',
                  maxHeight: '60vh',
                  overflow: 'auto',
                }}
              >
                <img
                  src={entry.image_thumb}
                  alt="剪贴板图片预览"
                  style={{
                    width: '100%',
                    height: '100%',
                    maxHeight: '56vh',
                    objectFit: 'contain',
                    borderRadius: 10,
                  }}
                />
              </div>
            </div>
          )}
          {!hasText && !hasImage && (
            <div
              style={{
                background: '#fff',
                borderRadius: 14,
                border: '1px dashed #d1d5db',
                padding: 18,
                color: '#6b7280',
                textAlign: 'center',
              }}
            >
              暂无可预览内容
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PreviewModal;
