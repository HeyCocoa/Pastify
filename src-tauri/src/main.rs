#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{path::PathBuf, sync::Arc, thread, time::Duration};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use arboard::Clipboard;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::{Duration as ChronoDuration, Local};
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
use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY, KEYBD_EVENT_FLAGS, VK_CONTROL, VK_V};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

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
    Ok(serde_json::from_str(&json).unwrap_or_else(|_| SETTINGS_DEFAULT.clone()))
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

fn foreground_process_name() -> Option<String> {
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
        // To reduce Windows API surface issues, skip resolving exe path here.
        // Future improvement: use psapi::GetModuleBaseNameW or QueryFullProcessImageNameW with proper bindings.
        None
    }
}

fn read_clipboard(db_path: &PathBuf, state: &AppState) -> Result<Option<ClipboardDto>, AppError> {
    let settings = state.settings.lock().clone();
    let source_app = foreground_process_name();
    if let Some(app) = &source_app {
        if settings.blacklist.iter().any(|b| b.eq_ignore_ascii_case(app)) {
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
            source_app,
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
                source_app,
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
        "INSERT INTO clipboard_items (content_type, text_content, image_data, source_app, created_at, is_pinned, usage_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
        params![
            item.content_type,
            item.text_content,
            item.image_data,
            item.source_app,
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
    let image_thumb = item.image_data.as_ref().map(|bytes| format!("data:image/png;base64,{}", BASE64.encode(bytes)));
    ClipboardDto {
        id: item.id,
        content_type: item.content_type,
        text_content: item.text_content,
        image_thumb,
        source_app: item.source_app,
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
    let mut sql = String::from("SELECT id, content_type, text_content, image_data, source_app, created_at, is_pinned, usage_count FROM clipboard_items WHERE 1=1");
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
        match tf.as_str() {
            "today" => {
                let start = now
                    .date_naive()
                    .and_hms_opt(0, 0, 0)
                    .unwrap()
                    .and_utc()
                    .timestamp_millis();
                sql.push_str(" AND created_at >= ?");
                params_vec.push(Box::new(start));
            }
            "yesterday" => {
                let start = (now.date_naive() - ChronoDuration::days(1))
                    .and_hms_opt(0, 0, 0)
                    .unwrap()
                    .and_utc()
                    .timestamp_millis();
                let end = now
                    .date_naive()
                    .and_hms_opt(0, 0, 0)
                    .unwrap()
                    .and_utc()
                    .timestamp_millis();
                sql.push_str(" AND created_at >= ? AND created_at < ?");
                params_vec.push(Box::new(start));
                params_vec.push(Box::new(end));
            }
            "earlier" => {
                let cutoff = (now.date_naive() - ChronoDuration::days(1))
                    .and_hms_opt(0, 0, 0)
                    .unwrap()
                    .and_utc()
                    .timestamp_millis();
                sql.push_str(" AND created_at < ?");
                params_vec.push(Box::new(cutoff));
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
            created_at: row.get(5).map_err(|e| e.to_string())?,
            is_pinned: row.get::<_, i32>(6).map_err(|e| e.to_string())? != 0,
            usage_count: row.get(7).map_err(|e| e.to_string())?,
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
            "SELECT id, content_type, text_content, image_data, source_app, created_at, is_pinned, usage_count FROM clipboard_items WHERE id = ?1",
            params![id],
            |row| {
                Ok(ClipboardItem {
                    id: row.get(0)?,
                    content_type: row.get(1)?,
                    text_content: row.get(2)?,
                    image_data: row.get(3)?,
                    source_app: row.get(4)?,
                    created_at: row.get(5)?,
                    is_pinned: row.get::<_, i32>(6)? != 0,
                    usage_count: row.get(7)?,
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
        simulate_paste().map_err(|e| e.to_string())?;
    }

    conn.execute(
        "UPDATE clipboard_items SET usage_count = usage_count + 1 WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

unsafe fn simulate_paste() -> Result<(), AppError> {
    let inputs = [
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
    save_settings(&state.db_path, &settings).map_err(|e| e.to_string())?;
    *state.settings.lock() = settings.clone();
    register_hotkey(&app, &settings.hotkey)?;
    Ok(settings)
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
            get_settings,
            update_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
