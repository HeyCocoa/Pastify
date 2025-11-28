# Repository Guidelines

## Project Structure & Module Organization
- `src/` — React + TypeScript frontend (`components/`, `hooks/`, `store/`, `styles/global.css`, `types.ts`). Entry is `main.tsx`, layout in `App.tsx`.
- `src-tauri/` — Tauri + Rust backend (`src/main.rs`), app config `tauri.conf.json`, app icons in `icons/`.
- `public/` — static assets copied by Vite; `dist/` — build output.

## Build, Test, and Development Commands
- `npm install` — install JS deps (requires Node ≥ 20.19).
- `npm run dev` — Vite dev server at `http://localhost:5173/`.
- `npm run tauri` — start Tauri dev: runs Vite, then launches the desktop window.
- `npm run build` — production web build (used by `tauri build`).
- `npm run tauri:build` — produce release binaries (Windows-focused).

## Coding Style & Naming Conventions
- TypeScript strict mode enabled (`tsconfig.json`); prefer type-safe props and explicit return types for hooks/store.
- 2-space indentation, single quotes, semicolons; keep JSX inline styles minimal or move shared styles to `styles/global.css`.
- Components: PascalCase filenames (`HistoryList.tsx`); hooks: `useX.ts` in `hooks/`; global state in `store/clipboardStore.ts`.
- Rust: keep functions in `src-tauri/src/main.rs`; follow Rustfmt defaults.

## Testing Guidelines
- No automated tests yet; if adding, prefer Vitest + Testing Library for React units and small integration tests under `src/__tests__/`.
- Name tests `{Component}.test.tsx` and keep them colocated or in `src/__tests__`.
- For Rust additions, add lightweight tests inside `src-tauri/src/main.rs` modules using `#[cfg(test)]`.

## Commit & Pull Request Guidelines
- 提交信息请使用中文，简洁有力，推荐加 Conventional Commit 前缀（如 `feat:`, `fix:`, `chore:`）。
- PR 需包含：改动摘要、影响范围（前端/Rust）、验证步骤（运行过的命令），UI 变更尽量附前后截图。

## Windows Development Tips
- Use Node ≥ 20.19.0 and latest stable Rust; install Tauri prerequisites (MSVC build tools + WebView2 runtime).
- If the window does not appear, ensure `npm run tauri` is run from a fresh terminal after switching Node versions with nvm-windows.
