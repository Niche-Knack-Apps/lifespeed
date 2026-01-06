package com.nicheknack.atthespeedoflife;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FolderPickerPlugin.class);
        super.onCreate(savedInstanceState);

        // Show keyboard after WebView is ready (300ms delay for focus)
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            showKeyboard();
        }, 300);
    }

    private void showKeyboard() {
        try {
            // Access WebView through the Capacitor Bridge
            if (getBridge() != null && getBridge().getWebView() != null) {
                View webView = getBridge().getWebView();
                webView.requestFocus();
                InputMethodManager imm = getSystemService(InputMethodManager.class);
                if (imm != null) {
                    imm.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
