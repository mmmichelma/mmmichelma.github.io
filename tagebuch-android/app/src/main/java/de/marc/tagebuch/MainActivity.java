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
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int PICK = 42;
    private WebView web;
    private ValueCallback<Uri[]> pending;
    private String pendingImport = null;

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
        // Erlaubt der lokalen App-Seite, mit Firebase im Internet zu sprechen
        s.setAllowUniversalAccessFromFileURLs(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView v, String url) {
                v.evaluateJavascript("window.checkImport&&checkImport()", null);
            }
        });
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
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
        web.evaluateJavascript("window.checkImport&&checkImport()", null);
    }

    // Liest eine geöffnete/geteilte Sync-Datei ein
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null) {
                String t = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (t != null && t.contains("unser-tagebuch")) pendingImport = t;
                return;
            }
        }
        if (uri == null) return;
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[65536];
            int n;
            while ((n = in.read(b)) > 0) buf.write(b, 0, n);
            pendingImport = buf.toString("UTF-8");
        } catch (Exception e) {
            pendingImport = null;
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == PICK && pending != null) {
            pending.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            pending = null;
        }
    }

    private boolean saveJpeg(String name, String dataUrl, String folder) {
        try {
            byte[] bytes = Base64.decode(dataUrl.substring(dataUrl.indexOf(',') + 1), Base64.DEFAULT);
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + folder);
                Uri u = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (u == null) return false;
                try (OutputStream o = getContentResolver().openOutputStream(u)) { o.write(bytes); }
            } else {
                File dir = new File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), folder);
                dir.mkdirs();
                try (FileOutputStream o = new FileOutputStream(new File(dir, name))) { o.write(bytes); }
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    class Bridge {
        // Foto in die Galerie speichern (Bilder/Unser Tagebuch)
        @JavascriptInterface
        public String saveImage(String name, String dataUrl) {
            return saveJpeg(name, dataUrl, "Unser Tagebuch") ? "Bilder/Unser Tagebuch" : "";
        }

        // Tageskarte speichern (Bilder/Unser Tagebuch Tageskarten)
        @JavascriptInterface
        public boolean saveCard(String name, String dataUrl) {
            return saveJpeg(name, dataUrl, "Unser Tagebuch Tageskarten");
        }

        @JavascriptInterface
        public String takeImport() {
            String t = pendingImport;
            pendingImport = null;
            return t == null ? "" : t;
        }

        // Sync-Datei erstellen und über das Teilen-Menü (z. B. WhatsApp) verschicken
        @JavascriptInterface
        public boolean shareFile(String name, String content) {
            try {
                File dir = new File(getCacheDir(), "shared");
                dir.mkdirs();
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                File f = new File(dir, name);
                try (FileOutputStream o = new FileOutputStream(f)) {
                    o.write(content.getBytes(StandardCharsets.UTF_8));
                }
                final Uri u = FileProvider.getUriForFile(MainActivity.this, "de.marc.tagebuch.files", f);
                runOnUiThread(() -> {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("application/json");
                    i.putExtra(Intent.EXTRA_STREAM, u);
                    i.putExtra(Intent.EXTRA_TEXT, "📖 Neue Einträge aus unserem Tagebuch – tipp auf die Datei und öffne sie mit „Unser Tagebuch“.");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(i, "Tagebuch an Luna schicken"));
                });
                return true;
            } catch (Exception e) {
                return false;
            }
        }

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
