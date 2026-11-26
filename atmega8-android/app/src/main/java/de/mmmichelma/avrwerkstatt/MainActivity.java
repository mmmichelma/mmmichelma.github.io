package de.mmmichelma.avrwerkstatt;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * AVR-Werkstatt: ATmega8-Entwicklungsumgebung mit Schrittmotor-Simulation.
 * Die Web-App liegt komplett in den Assets (www/) und läuft offline.
 */
public class MainActivity extends Activity {

    private static final int REQ_SAVE = 1;
    private static final int REQ_OPEN = 2;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingSaveText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#14171D"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "AndroidApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("file".equals(u.getScheme())) return false;
                // externe Links im Browser öffnen
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "C-Datei öffnen"), REQ_OPEN);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl("file:///android_asset/www/index.html");
    }

    /** Schnittstelle für JavaScript: window.AndroidApp */
    private class Bridge {
        @JavascriptInterface
        public void saveFile(String name, String text) {
            runOnUiThread(() -> {
                pendingSaveText = text;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TITLE, name);
                try {
                    startActivityForResult(i, REQ_SAVE);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Speichern nicht möglich", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void keepScreenOn(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_OPEN) {
            if (fileCallback != null) {
                Uri u = (res == RESULT_OK && data != null) ? data.getData() : null;
                fileCallback.onReceiveValue(u != null ? new Uri[]{u} : null);
                fileCallback = null;
            }
        } else if (req == REQ_SAVE) {
            String text = pendingSaveText;
            pendingSaveText = null;
            if (res != RESULT_OK || data == null || data.getData() == null || text == null) return;
            try (OutputStream os = getContentResolver().openOutputStream(data.getData(), "wt")) {
                os.write(text.getBytes(StandardCharsets.UTF_8));
                Toast.makeText(this, "Datei gespeichert", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Fehler beim Speichern: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    public void onBackPressed() {
        // erst offene Dialoge in der Web-App schließen
        web.evaluateJavascript("window.avrBack ? avrBack() : false", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.evaluateJavascript("window.avrApp && avrApp.state === 'run' && avrApp.pause && avrApp.pause()", null);
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
