#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    // Fix heavy/uneven text rendering on Linux hybrid GPU systems (Intel+NVIDIA).
    // WebKitGTK's DMA-BUF renderer causes font weight artifacts; SHM fallback is fine.
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    lifespeed_lib::run();
}
