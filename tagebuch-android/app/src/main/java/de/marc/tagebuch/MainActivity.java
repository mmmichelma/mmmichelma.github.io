package de.marc.tagebuch;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int PICK = 42;
    private WebView web;
    private ValueCallback<Uri[]> pending;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#7A5C9E"));
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            // Foto- und Backup-Auswahl aus der Galerie / Dateien
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (pending != null) pending.onReceiveValue(null);
                pending = cb;
                try {
                    startActivityForResult(p.createIntent(), PICK);
                } catch (Exception e) {
                    pending = null;
                    return false;
                }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");
        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == PICK && pending != null) {
            pending.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            pending = null;
        }
    }

    class Bridge {
        @JavascriptInterface
        public boolean isDark() {
            int m = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            return m == Configuration.UI_MODE_NIGHT_YES;
        }

        @JavascriptInterface
        public void setDark(final boolean dark) {
            runOnUiThread(() -> {
                getWindow().setStatusBarColor(Color.parseColor(dark ? "#17141B" : "#7A5C9E"));
                web.setBackgroundColor(Color.parseColor(dark ? "#17141B" : "#F8F5FB"));
            });
        }

        // Backup in den Download-Ordner schreiben, gibt den Ort zurück
        @JavascriptInterface
        public String saveFile(String name, String content) {
            try {
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    try (OutputStream o = getContentResolver().openOutputStream(u)) { o.write(bytes); }
                    return "Downloads/" + name;
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    File f = new File(dir, name);
                    try (FileOutputStream o = new FileOutputStream(f)) { o.write(bytes); }
                    return f.getAbsolutePath();
                }
            } catch (Exception e) {
                return "";
            }
        }
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript(
            "(function(){var s=document.getElementById('show');if(s&&s.classList.contains('open')){endShow();return 1}"
          + "var o=document.querySelector('.sheet.open');if(o){o.classList.remove('open');return 1}return 0})()",
            r -> { if ("0".equals(r)) MainActivity.super.onBackPressed(); });
    }
}
