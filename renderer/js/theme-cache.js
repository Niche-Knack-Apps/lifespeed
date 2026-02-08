/**
 * Theme Cache - Apply saved theme instantly before async settings load.
 * Prevents dark-to-light flash on Tauri (where IPC is async).
 * Must load BEFORE any other scripts.
 */
(function() {
    var t = localStorage.getItem('lifespeed-theme');
    var f = localStorage.getItem('lifespeed-font-size');
    if (t) document.documentElement.setAttribute('data-theme', t);
    if (f) document.documentElement.setAttribute('data-font-size', f);
})();
