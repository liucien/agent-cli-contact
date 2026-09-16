// Tauri 壳：职责仅两项（PLAN §4 红线）——窗口管理 + Gateway sidecar 生命周期。
// 产品逻辑全部在 Gateway（bun 单二进制，随 .app 捆绑于 Contents/MacOS/）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct GatewayChild(Mutex<Option<CommandChild>>);

#[cfg(target_os = "macos")]
fn fix_macos_path() {
    let current_path = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();
    let local_bin = format!("{}/.local/bin", home);
    let cargo_bin = format!("{}/.cargo/bin", home);
    let candidates = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        local_bin.as_str(),
        cargo_bin.as_str(),
    ];
    let mut to_prepend = Vec::new();
    for c in candidates {
        if std::path::Path::new(c).is_dir() && !current_path.split(':').any(|p| p == c) {
            to_prepend.push(c);
        }
    }
    if !to_prepend.is_empty() {
        let new_path = format!("{}:{}", to_prepend.join(":"), current_path);
        std::env::set_var("PATH", new_path);
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    fix_macos_path();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let sidecar = app.shell().sidecar("gateway")?;
            let (mut rx, child) = sidecar.spawn()?;
            app.manage(GatewayChild(Mutex::new(Some(child))));
            // 持续排空 sidecar 输出，避免管道阻塞
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    if let CommandEvent::Stderr(line) | CommandEvent::Stdout(line) = event {
                        print!("[gateway] {}", String::from_utf8_lossy(&line));
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build tauri app")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<GatewayChild>() {
                    if let Some(child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
