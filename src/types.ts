export type ContentType = 'text' | 'image';

export interface ClipboardEntry {
  id: number;
  content_type: ContentType;
  text_content?: string;
  image_thumb?: string; // base64 preview
  created_at: number; // unix ms
  source_app?: string;
  is_pinned: boolean;
  usage_count: number;
}

export type TimeFilter = 'all' | 'today' | 'yesterday' | 'earlier';
export type TypeFilter = 'all' | 'text' | 'image';

export interface Settings {
  max_history: number;
  record_images: boolean;
  hotkey: string;
  blacklist: string[];
}
