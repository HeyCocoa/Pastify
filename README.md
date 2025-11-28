# Pastify

一款针对 Windows 的键盘优先剪贴板管理器，基于 **Tauri + Rust + React + SQLite**。目标是让“呼出 → 找到 → 粘贴”< 1 秒，支持文本与图片历史、搜索、过滤与纯文本粘贴。

## 功能概要（MVP）
- 后台监听剪贴板（文本/图片），写入本地 SQLite，自动淘汰超额历史（默认 1000）
- 全局快捷键呼出（默认 `Ctrl+Shift+V`），ESC 关闭
- 搜索/过滤：关键词、类型（文本/图片）、时间分组（今天/昨天/更早）
- 键盘操作：↑↓ 选中、Enter 粘贴、Ctrl+Enter 纯文本粘贴、Delete 删除、Ctrl+P 置顶
- 设置：最大历史条数、是否记录图片、黑名单应用、全局快捷键

## 技术栈
- 前端：Vite + React + TypeScript + Zustand + @tanstack/react-virtual
- 桌面壳：Tauri
- 后端：Rust（剪贴板监听、SQLite DAO、Win32 粘贴模拟、全局快捷键）
- 数据库：SQLite（本地 `%APPDATA%/com.pastify.app/pastify.db`）

## 环境准备（Windows）
1) Node.js 18+（含 npm/pnpm）
2) Rust stable (`rustup`)
3) WebView2 Runtime（Win11 通常自带，如无请安装）
4) VS Build Tools：安装 “Desktop development with C++” 工作负载（含 Windows 10/11 SDK）

## 安装与运行
```bash
# 安装依赖
npm install

# 开发模式（启动 Vite + Tauri）
npm run tauri

# 仅前端构建
npm run build

# 生成安装包（.msi/.exe 在 src-tauri/target/release/）
npm run tauri:build
```

## 使用速查
- 呼出：`Ctrl+Shift+V`
- 关闭：`Esc`
- 列表导航：`↑ / ↓`
- 粘贴保留格式：`Enter`
- 纯文本粘贴：`Ctrl+Enter`
- 删除条目：`Delete`
- 置顶切换：`Ctrl+P`

## 目录结构
```
.
├── src/                # 前端 React 源码
│   ├── components/     # UI 组件（搜索、列表、设置）
│   ├── store/          # Zustand 状态 & Tauri 通信
│   ├── styles/         # 全局样式
│   └── App.tsx         # 主界面
├── src-tauri/          # Rust 后端与 Tauri 配置
│   ├── src/main.rs     # 剪贴板监听、SQLite、命令、快捷键
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json        # 前端与 Tauri CLI 脚本
├── vite.config.ts
└── README.md
```

## 已知限制
- 仅针对 Windows；Linux/macOS 未适配
- 依赖 Win32 API 模拟粘贴，少数受保护窗口可能拦截

## 许可
MIT
