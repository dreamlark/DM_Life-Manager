// P0 骨架：仅最小窗口。
// 引擎（TypeScript）以 sidecar Node 进程模式运行在 127.0.0.1:14570（见计划 §8），
// webview 通过 /trpc 与 /events 与引擎通信，dev/prod 单一真相源。
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running DM_life");
}
