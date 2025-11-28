#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{ffi::c_void, os::windows::ffi::OsStrExt, path::{Path, PathBuf}, sync::Arc, thread, time::Duration};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use arboard::Clipboard;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::{Duration as ChronoDuration, Local, TimeZone};
use image::{ImageBuffer, Rgba};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use simplelog::{ColorChoice, ConfigBuilder, LevelFilter, TermLogger, TerminalMode};
use tauri::{AppHandle, Manager, State};
use tauri::GlobalShortcutManager;
use std::io;
use std::io::Cursor;
use thiserror::Error;
use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY, KEYBD_EVENT_FLAGS, VK_CONTROL, VK_SHIFT, VK_V};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId, GetWindowTextW, GetWindowTextLengthW, HICON, ICONINFO};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_NAME_FORMAT, QueryFullProcessImageNameW};
use windows::Win32::UI::Shell::{SHGetFileInfoW, SHGFI_DISPLAYNAME, SHGFI_ICON, SHGFI_LARGEICON, SHFILEINFOW};
use windows::Win32::Graphics::Gdi::{GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, GetDIBits, DIB_RGB_COLORS, GetDC, ReleaseDC, DeleteObject, HBITMAP};
use windows::Win32::UI::WindowsAndMessaging::{GetIconInfo, DestroyIcon};
use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
use windows::core::{PWSTR, PCWSTR};

static SETTINGS_DEFAULT: Lazy<Settings> = Lazy::new(|| Settings {
    max_history: 1000,
    record_images: true,
    hotkey: "Ctrl+Shift+V".to_string(),
    blacklist: vec![],
});

static SKIP_UNTIL_MS: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Error)]
enum AppError {
    #[error("db error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("clipboard error: {0}")]
    Clipboard(String),
    #[error("other: {0}")]
    Other(String),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ClipboardItem {
    id: i64,
    content_type: String,
    text_content: Option<String>,
    image_data: Option<Vec<u8>>, // png bytes
    source_app: Option<String>,
    source_path: Option<String>,
    source_icon: Option<Vec<u8>>, // png bytes
    created_at: i64,
    is_pinned: bool,
    usage_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClipboardDto {
    id: i64,
    content_type: String,
    text_content: Option<String>,
    image_thumb: Option<String>,
    source_app: Option<String>,
    source_icon: Option<String>,
    created_at: i64,
    is_pinned: bool,
    usage_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
    max_history: i64,
    record_images: bool,
    hotkey: String,
    blacklist: Vec<String>,
}

#[derive(Debug)]
#[derive(Clone)]
struct AppState {
    db_path: PathBuf,
    settings: Arc<Mutex<Settings>>,
}

#[derive(Clone, Debug)]
struct ProcessInfo {
    display: String,
    path: String,
    icon_png: Option<Vec<u8>>,
}

fn init_logger() {
    let config = ConfigBuilder::new().build();
    let _ = TermLogger::init(
        LevelFilter::Info,
        config,
        TerminalMode::Mixed,
        ColorChoice::Auto,
    );
}

fn ensure_db(db_path: &PathBuf) -> Result<(), AppError> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS clipboard_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content_type TEXT NOT NULL,
            text_content TEXT,
            image_data BLOB,
            source_app TEXT,
            source_path TEXT,
            source_icon BLOB,
            created_at INTEGER NOT NULL,
            is_pinned INTEGER DEFAULT 0,
            usage_count INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_clipboard_created_at ON clipboard_items(created_at DESC);
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )?;

    ensure_schema_updates(&conn)?;

    let settings_json: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'app'", [], |row| row.get(0))
        .optional()?;
    if settings_json.is_none() {
        let json = serde_json::to_string(&*SETTINGS_DEFAULT).unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings(key, value) VALUES('app', ?1)",
            params![json],
        )?;
    }
    Ok(())
}

fn load_settings(db_path: &PathBuf) -> Result<Settings, AppError> {
    let conn = Connection::open(db_path)?;
    let json: String = conn.query_row(
        "SELECT value FROM settings WHERE key = 'app'",
        [],
        |row| row.get(0),
    )?;
    let mut settings: Settings = serde_json::from_str(&json).unwrap_or_else(|_| SETTINGS_DEFAULT.clone());
    // 图片记录始终开启
    if !settings.record_images {
        settings.record_images = true;
        save_settings(db_path, &settings)?;
    }
    Ok(settings)
}

fn save_settings(db_path: &PathBuf, settings: &Settings) -> Result<(), AppError> {
    let conn = Connection::open(db_path)?;
    let json = serde_json::to_string(settings).unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES('app', ?1)",
        params![json],
    )?;
    Ok(())
}

fn enforce_limit(db_path: &PathBuf, max: i64) -> Result<(), AppError> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        "DELETE FROM clipboard_items
         WHERE id NOT IN (
            SELECT id FROM clipboard_items ORDER BY is_pinned DESC, created_at DESC LIMIT ?1
         ) AND is_pinned = 0",
        params![max],
    )?;
    Ok(())
}

fn ensure_schema_updates(conn: &Connection) -> Result<(), AppError> {
    let mut has_path = false;
    let mut has_icon = false;
    let mut stmt = conn.prepare("PRAGMA table_info(clipboard_items)")?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        match name.as_str() {
            "source_path" => has_path = true,
            "source_icon" => has_icon = true,
            _ => {}
        }
    }
    if !has_path {
        conn.execute("ALTER TABLE clipboard_items ADD COLUMN source_path TEXT", [])?;
    }
    if !has_icon {
        conn.execute("ALTER TABLE clipboard_items ADD COLUMN source_icon BLOB", [])?;
    }
    Ok(())
}

fn build_process_info(path: &str) -> ProcessInfo {
    let base = Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("?");
    let friendly_raw = friendly_name_from_path(path);
    let friendly = normalize_display_name(&friendly_raw);
    let display = if friendly.trim().is_empty() {
        map_known_app_name(base)
    } else if friendly.eq_ignore_ascii_case(base) {
        map_known_app_name(base)
    } else {
        friendly
    };
    let icon_png = extract_icon_png(path);
    ProcessInfo {
        display,
        path: path.to_string(),
        icon_png,
    }
}

fn window_title(hwnd: windows::Win32::Foundation::HWND) -> Option<String> {
    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len == 0 {
            return None;
        }
        let mut buf = vec![0u16; (len + 1) as usize];
        let written = GetWindowTextW(hwnd, &mut buf);
        if written == 0 {
            return None;
        }
        buf.truncate(written as usize);
        Some(String::from_utf16_lossy(&buf))
    }
}

fn friendly_name_from_path(path: &str) -> String {
    let wide: Vec<u16> = std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut sfi = SHFILEINFOW::default();
    unsafe {
        let _ = SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut sfi as *mut _),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_DISPLAYNAME,
        );
        let name_u16 = sfi.szDisplayName;
        let nul = name_u16.iter().position(|&c| c == 0).unwrap_or(name_u16.len());
        String::from_utf16_lossy(&name_u16[..nul])
    }
}

fn normalize_display_name(name: &str) -> String {
    let mut n = name.trim().to_string();
    if n.to_lowercase().ends_with(".exe") {
        n.truncate(n.len() - 4);
    }
    // simple title-case: first letter upper, rest as-is to avoid locale issues
    if let Some(first) = n.get(0..1) {
        n = format!("{}{}", first.to_uppercase(), n.get(1..).unwrap_or(""));
    }
    n
}

fn map_known_app_name(base: &str) -> String {
    let lower = base.to_lowercase();
    let mapped = match lower.as_str() {
        "msedge" | "edge" => "Microsoft Edge",
        "code" | "vscode" | "codehelper" => "VS Code",
        "weixin" | "wechat" => "WeChat",
        "wechatweb" => "WeChat",
        "notepad" => "Notepad",
        "chrome" => "Google Chrome",
        "firefox" => "Firefox",
        "explorer" => "File Explorer",
        _ => return normalize_display_name(base),
    };
    mapped.to_string()
}

fn extract_icon_png(path: &str) -> Option<Vec<u8>> {
    let wide: Vec<u16> = std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut sfi = SHFILEINFOW::default();
    unsafe {
        let res = SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut sfi as *mut _),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );
        if res == 0 || sfi.hIcon.0 == 0 {
            return None;
        }
        let icon = sfi.hIcon;
        let png = hicon_to_png(icon);
        let _ = DestroyIcon(icon);
        png
    }
}

fn hicon_to_png(icon: HICON) -> Option<Vec<u8>> {
    unsafe {
        let mut info = ICONINFO::default();
        if let Err(_) = GetIconInfo(icon, &mut info) {
            return None;
        }

        let color: HBITMAP = info.hbmColor;
        let mask: HBITMAP = info.hbmMask;
        let mut bmp = BITMAP::default();
        if GetObjectW(color, std::mem::size_of::<BITMAP>() as i32, Some(&mut bmp as *mut _ as *mut c_void)) == 0 {
            let _ = DeleteObject(color);
            let _ = DeleteObject(mask);
            return None;
        }

        let width = bmp.bmWidth;
        let height = bmp.bmHeight;
        if width == 0 || height == 0 {
            let _ = DeleteObject(color);
            let _ = DeleteObject(mask);
            return None;
        }

        let hdc = GetDC(None);
        let mut bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0 as u32,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default(); 1],
        };

        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let res = GetDIBits(
            hdc,
            color,
            0,
            height as u32,
            Some(pixels.as_mut_ptr() as *mut c_void),
            &mut bi,
            DIB_RGB_COLORS,
        );
        let _ = ReleaseDC(None, hdc);
        let _ = DeleteObject(color);
        let _ = DeleteObject(mask);
        if res == 0 {
            return None;
        }

        // GetDIBits returns BGRA; swap B/R to RGBA for image crate
        for px in pixels.chunks_exact_mut(4) {
            px.swap(0, 2);
        }

        let img = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_raw(width as u32, height as u32, pixels)?;
        let mut cursor = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut cursor, image::ImageOutputFormat::Png)
            .ok()?;
        Some(cursor.into_inner())
    }
}

fn process_info_from_foreground() -> Option<ProcessInfo> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0 == 0 {
            return None;
        }
        let mut pid = 0u32;
        // signature expects Option<*mut u32>
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(h) => h,
            Err(_) => return None,
        };

        let mut buf = [0u16; 260];
        let mut len = buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(handle);
        if result.is_err() || len == 0 {
            return None;
        }

        let path = String::from_utf16_lossy(&buf[..len as usize]);
        if path.is_empty() {
            return None;
        }

        let title = window_title(hwnd);
        let mut info = build_process_info(&path);
        if let Some(t) = title {
            // combine window title with app name for more context (e.g., webpage title)
            if !t.trim().is_empty() && t != info.display {
                info.display = format!("{} ({})", t, info.display);
            }
        }
        Some(info)
    }
}

fn read_clipboard(db_path: &PathBuf, state: &AppState) -> Result<Option<ClipboardDto>, AppError> {
    let settings = state.settings.lock().clone();
    let proc_info = process_info_from_foreground();
    if let Some(app) = &proc_info {
        if settings.blacklist.iter().any(|b| b.eq_ignore_ascii_case(&app.display)) {
            return Ok(None);
        }
    }

    let mut clipboard = Clipboard::new().map_err(|e| AppError::Clipboard(format!("{e}")))?;
    if let Ok(text) = clipboard.get_text() {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }
        let item = ClipboardItem {
            id: 0,
            content_type: "text".into(),
            text_content: Some(text.clone()),
            image_data: None,
            source_app: proc_info.as_ref().map(|p| p.display.clone()),
            source_path: proc_info.as_ref().map(|p| p.path.clone()),
            source_icon: proc_info.and_then(|p| p.icon_png),
            created_at: chrono::Utc::now().timestamp_millis(),
            is_pinned: false,
            usage_count: 0,
        };
        if !is_duplicate(db_path, &item)? {
            let saved = insert_item(db_path, item, settings.max_history)?;
            return Ok(Some(saved));
        }
        return Ok(None);
    }

    if settings.record_images {
        if let Ok(img) = clipboard.get_image() {
            let buffer: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(
                img.width as u32,
                img.height as u32,
                img.bytes.into_owned(),
            )
            .ok_or_else(|| AppError::Other("无法读取图片数据".into()))?;
            let mut cursor = Cursor::new(Vec::new());
            {
                let img_dyn = image::DynamicImage::ImageRgba8(buffer);
                img_dyn
                    .write_to(&mut cursor, image::ImageOutputFormat::Png)
                    .map_err(|e| AppError::Other(e.to_string()))?;
            }
            let png_bytes = cursor.into_inner();
            let item = ClipboardItem {
                id: 0,
                content_type: "image".into(),
            text_content: None,
            image_data: Some(png_bytes),
            source_app: proc_info.as_ref().map(|p| p.display.clone()),
            source_path: proc_info.as_ref().map(|p| p.path.clone()),
            source_icon: proc_info.and_then(|p| p.icon_png),
            created_at: chrono::Utc::now().timestamp_millis(),
            is_pinned: false,
            usage_count: 0,
        };
            if !is_duplicate(db_path, &item)? {
                let saved = insert_item(db_path, item, settings.max_history)?;
                return Ok(Some(saved));
            }
            return Ok(None);
        }
    }

    Ok(None)
}

fn insert_item(db_path: &PathBuf, mut item: ClipboardItem, max: i64) -> Result<ClipboardDto, AppError> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        "INSERT INTO clipboard_items (content_type, text_content, image_data, source_app, source_path, source_icon, created_at, is_pinned, usage_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
        params![
            item.content_type,
            item.text_content,
            item.image_data,
            item.source_app,
            item.source_path,
            item.source_icon,
            item.created_at,
            item.is_pinned as i32
        ],
    )?;
    item.id = conn.last_insert_rowid();
    enforce_limit(db_path, max)?;
    Ok(to_dto(item))
}

fn is_duplicate(db_path: &PathBuf, item: &ClipboardItem) -> Result<bool, AppError> {
    let conn = Connection::open(db_path)?;
    let last: Option<(String, Option<String>, Option<Vec<u8>>)> = conn
        .query_row(
            "SELECT content_type, text_content, image_data FROM clipboard_items ORDER BY created_at DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    if let Some((ctype, text, image)) = last {
        if ctype == item.content_type {
            if ctype == "text" {
                return Ok(text == item.text_content);
            } else {
                return Ok(image.as_ref().map(|v| v.len()) == item.image_data.as_ref().map(|v| v.len()));
            }
        }
    }
    Ok(false)
}

fn to_dto(item: ClipboardItem) -> ClipboardDto {
    let image_thumb = item
        .image_data
        .as_ref()
        .map(|bytes| format!("data:image/png;base64,{}", BASE64.encode(bytes)));
    let source_icon = item
        .source_icon
        .as_ref()
        .map(|bytes| format!("data:image/png;base64,{}", BASE64.encode(bytes)));
    ClipboardDto {
        id: item.id,
        content_type: item.content_type,
        text_content: item.text_content,
        image_thumb,
        source_app: item.source_app,
        source_icon,
        created_at: item.created_at,
        is_pinned: item.is_pinned,
        usage_count: item.usage_count,
    }
}

#[tauri::command]
fn get_history(
    state: State<AppState>,
    query: Option<String>,
    type_filter: Option<String>,
    time_filter: Option<String>,
    source_filter: Option<String>,
) -> Result<Vec<ClipboardDto>, String> {
    let db_path = &state.db_path;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut sql = String::from("SELECT id, content_type, text_content, image_data, source_app, source_path, source_icon, created_at, is_pinned, usage_count FROM clipboard_items WHERE 1=1");
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(q) = query.clone() {
        if !q.trim().is_empty() {
            sql.push_str(" AND text_content LIKE ?");
            params_vec.push(Box::new(format!("%{}%", q)));
        }
    }
    if let Some(t) = type_filter {
        if t == "text" || t == "image" {
            sql.push_str(" AND content_type = ?");
            params_vec.push(Box::new(t));
        }
    }
    if let Some(sf) = source_filter {
        if !sf.is_empty() {
            sql.push_str(" AND source_app = ?");
            params_vec.push(Box::new(sf));
        }
    }
    if let Some(tf) = time_filter {
        let now = Local::now();
        let today_local = now.date_naive();
        let today_start = Local
            .from_local_datetime(&today_local.and_hms_opt(0, 0, 0).unwrap())
            .single()
            .unwrap()
            .with_timezone(&chrono::Utc)
            .timestamp_millis();
        let yesterday_start = Local
            .from_local_datetime(&(today_local - ChronoDuration::days(1)).and_hms_opt(0, 0, 0).unwrap())
            .single()
            .unwrap()
            .with_timezone(&chrono::Utc)
            .timestamp_millis();
        match tf.as_str() {
            "today" => {
                sql.push_str(" AND created_at >= ?");
                params_vec.push(Box::new(today_start));
            }
            "yesterday" => {
                sql.push_str(" AND created_at >= ? AND created_at < ?");
                params_vec.push(Box::new(yesterday_start));
                params_vec.push(Box::new(today_start));
            }
            "earlier" => {
                sql.push_str(" AND created_at < ?");
                params_vec.push(Box::new(yesterday_start));
            }
            _ => {}
        }
    }

    sql.push_str(" ORDER BY is_pinned DESC, created_at DESC LIMIT 500");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params_from_iter(params_vec.iter().map(|v| &**v)))
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let item = ClipboardItem {
            id: row.get(0).map_err(|e| e.to_string())?,
            content_type: row.get(1).map_err(|e| e.to_string())?,
            text_content: row.get(2).map_err(|e| e.to_string())?,
            image_data: row.get(3).map_err(|e| e.to_string())?,
            source_app: row.get(4).map_err(|e| e.to_string())?,
            source_path: row.get(5).map_err(|e| e.to_string())?,
            source_icon: row.get(6).map_err(|e| e.to_string())?,
            created_at: row.get(7).map_err(|e| e.to_string())?,
            is_pinned: row.get::<_, i32>(8).map_err(|e| e.to_string())? != 0,
            usage_count: row.get(9).map_err(|e| e.to_string())?,
        };
        result.push(to_dto(item));
    }
    Ok(result)
}

#[tauri::command]
fn delete_entry(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = Connection::open(&state.db_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM clipboard_items WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn toggle_pin(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = Connection::open(&state.db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE clipboard_items SET is_pinned = CASE is_pinned WHEN 1 THEN 0 ELSE 1 END WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn paste_entry(state: State<AppState>, id: i64, plain: bool) -> Result<(), String> {
    let conn = Connection::open(&state.db_path).map_err(|e| e.to_string())?;
    let item: ClipboardItem = conn
        .query_row(
            "SELECT id, content_type, text_content, image_data, source_app, source_path, source_icon, created_at, is_pinned, usage_count FROM clipboard_items WHERE id = ?1",
            params![id],
            |row| {
                Ok(ClipboardItem {
                    id: row.get(0)?,
                    content_type: row.get(1)?,
                    text_content: row.get(2)?,
                    image_data: row.get(3)?,
                    source_app: row.get(4)?,
                    source_path: row.get(5)?,
                    source_icon: row.get(6)?,
                    created_at: row.get(7)?,
                    is_pinned: row.get::<_, i32>(8)? != 0,
                    usage_count: row.get(9)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    // Avoid recording this paste as a new history entry in watcher
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    SKIP_UNTIL_MS.store(now_ms + 1200, Ordering::SeqCst);
    if item.content_type == "text" {
        let text = item.text_content.unwrap_or_default();
        if plain {
            clipboard.set_text(text.clone()).map_err(|e| e.to_string())?;
        } else {
            clipboard.set_text(text.clone()).map_err(|e| e.to_string())?;
        }
    } else if let Some(img_bytes) = item.image_data {
        let png = image::load_from_memory(&img_bytes).map_err(|e| e.to_string())?;
        let rgba = png.to_rgba8();
        let (w, h) = rgba.dimensions();
        let img_data = arboard::ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(rgba.into_raw()),
        };
        clipboard.set_image(img_data).map_err(|e| e.to_string())?;
    }

    unsafe {
        simulate_paste(plain).map_err(|e| e.to_string())?;
    }

    conn.execute(
        "UPDATE clipboard_items SET usage_count = usage_count + 1 WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn copy_entry(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = Connection::open(&state.db_path).map_err(|e| e.to_string())?;
    let item: ClipboardItem = conn
        .query_row(
            "SELECT id, content_type, text_content, image_data, source_app, source_path, source_icon, created_at, is_pinned, usage_count FROM clipboard_items WHERE id = ?1",
            params![id],
            |row| {
                Ok(ClipboardItem {
                    id: row.get(0)?,
                    content_type: row.get(1)?,
                    text_content: row.get(2)?,
                    image_data: row.get(3)?,
                    source_app: row.get(4)?,
                    source_path: row.get(5)?,
                    source_icon: row.get(6)?,
                    created_at: row.get(7)?,
                    is_pinned: row.get::<_, i32>(8)? != 0,
                    usage_count: row.get(9)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    // Avoid duplicating the same item into history when we set clipboard ourselves
    SKIP_UNTIL_MS.store(now_ms + 1200, Ordering::SeqCst);

    if item.content_type == "text" {
        let text = item.text_content.unwrap_or_default();
        clipboard.set_text(text).map_err(|e| e.to_string())?;
    } else if let Some(img_bytes) = item.image_data {
        let png = image::load_from_memory(&img_bytes).map_err(|e| e.to_string())?;
        let rgba = png.to_rgba8();
        let (w, h) = rgba.dimensions();
        let img_data = arboard::ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(rgba.into_raw()),
        };
        clipboard.set_image(img_data).map_err(|e| e.to_string())?;
    }

    conn.execute(
        "UPDATE clipboard_items SET usage_count = usage_count + 1 WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

unsafe fn simulate_paste(_plain: bool) -> Result<(), AppError> {
    // 统一发送 Ctrl+V，由于我们已写入纯文本到剪贴板，目标应用会按文本粘贴
    let inputs = [
        // Ctrl down
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(VK_CONTROL.0 as u16),
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        // V down
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(VK_V.0 as u16),
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        // V up
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(VK_V.0 as u16),
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        // Ctrl up
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(VK_CONTROL.0 as u16),
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];
    let sent = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    if sent == 0 {
        return Err(AppError::Other("发送粘贴快捷键失败".into()));
    }
    Ok(())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<Settings, String> {
    load_settings(&state.db_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> Result<Settings, String> {
    let mut normalized = settings;
    normalized.record_images = true;
    save_settings(&state.db_path, &normalized).map_err(|e| e.to_string())?;
    *state.settings.lock() = normalized.clone();
    register_hotkey(&app, &normalized.hotkey)?;
    Ok(normalized)
}

fn spawn_clipboard_watcher(app: AppHandle, state: AppState) {
    let db_path = state.db_path.clone();
    let settings = state.settings.clone();
    thread::spawn(move || {
        let mut last_seq = unsafe { GetClipboardSequenceNumber() };
        loop {
            thread::sleep(Duration::from_millis(250));
            let seq = unsafe { GetClipboardSequenceNumber() };
            if seq == last_seq {
                continue;
            }
            last_seq = seq;
            let now_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            if now_ms < SKIP_UNTIL_MS.load(Ordering::SeqCst) {
                continue;
            }
            let snapshot = AppState {
                db_path: db_path.clone(),
                settings: settings.clone(),
            };
            match read_clipboard(&db_path, &snapshot) {
                Ok(Some(dto)) => {
                    let _ = app.emit_all("clipboard://new", dto);
                }
                Ok(None) => {}
                Err(err) => {
                    log::error!("clipboard watch error: {err}");
                }
            }
        }
    });
}

fn register_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let mut gsm = app.global_shortcut_manager();
    let _ = gsm.unregister_all();
    let hk = if hotkey.is_empty() { "Ctrl+Shift+V" } else { hotkey };
    let app_handle = app.clone();
    gsm
        .register(hk, move || {
            if let Some(win) = app_handle.get_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        })
        .map_err(|e| e.to_string())
}

fn main() {
    init_logger();
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app
                .path_resolver()
                .app_data_dir()
                .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "无法获取数据目录"))?;
            std::fs::create_dir_all(&app_dir)?;
            let db_path = app_dir.join("pastify.db");
            ensure_db(&db_path).map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
            let settings = load_settings(&db_path).map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
            let state = AppState {
                db_path: db_path.clone(),
                settings: Arc::new(Mutex::new(settings.clone())),
            };
            app.manage(state);
            register_hotkey(&app.app_handle(), &settings.hotkey).ok();
            if let Some(state) = app.try_state::<AppState>() {
                spawn_clipboard_watcher(app.app_handle(), state.inner().clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_history,
            delete_entry,
            toggle_pin,
            paste_entry,
            copy_entry,
            get_settings,
            update_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
