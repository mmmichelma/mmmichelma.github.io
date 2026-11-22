package de.mmmichelma.livemikrofon;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Live-Mikrofon: liest das gewählte Mikrofon und spielt es sofort
 * über den gewählten Lautsprecher ab.
 */
public class MainActivity extends Activity {

    private static final int GREEN = 0xFF1A9B4B;
    private static final int RED = 0xFFE0245E;

    private AudioManager am;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private Spinner inSpin, outSpin;
    private final List<AudioDeviceInfo> inputs = new ArrayList<>();
    private final List<AudioDeviceInfo> outputs = new ArrayList<>();
    private int lastIn = 0, lastOut = 0;

    private Button toggle;
    private TextView status, volText, hint;
    private ProgressBar level;
    private CheckBox echoBox;

    private volatile boolean running = false;
    private volatile float gain = 1f;
    private Thread worker;
    private boolean scoStarted = false;
    private volatile int generation = 0;

    // ------------------------------------------------------------ Oberfläche

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        am = (AudioManager) getSystemService(AUDIO_SERVICE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int p = dp(18);
        root.setPadding(p, dp(28), p, dp(40));
        root.setBackgroundColor(0xFFF4F4F6);

        TextView title = new TextView(this);
        title.setText("🎤 Live-Mikrofon");
        title.setTextSize(26);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(0xFF1B1B1F);
        root.addView(title);

        TextView sub = text("Was du ins Mikro sprichst, kommt sofort aus dem gewählten Lautsprecher.", 15, 0xFF666666);
        sub.setPadding(0, dp(4), 0, dp(18));
        root.addView(sub);

        toggle = new Button(this);
        toggle.setTextSize(22);
        toggle.setTypeface(Typeface.DEFAULT_BOLD);
        toggle.setTextColor(Color.WHITE);
        toggle.setAllCaps(false);
        toggle.setPadding(0, dp(18), 0, dp(18));
        setToggle(false);
        toggle.setOnClickListener(v -> { if (running) stopAudio(); else startAudio(); });
        root.addView(toggle, new LinearLayout.LayoutParams(-1, -2));

        level = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        level.setMax(100);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(22));
        lp.topMargin = dp(14);
        root.addView(level, lp);

        status = text("Bereit.", 15, 0xFF444444);
        status.setPadding(0, dp(8), 0, dp(10));
        root.addView(status);

        root.addView(label("🔊 Lautsprecher (Ausgabe)"));
        outSpin = new Spinner(this);
        root.addView(outSpin, new LinearLayout.LayoutParams(-1, -2));

        root.addView(label("🎤 Mikrofon (Eingang)"));
        inSpin = new Spinner(this);
        root.addView(inSpin, new LinearLayout.LayoutParams(-1, -2));

        Button scan = new Button(this);
        scan.setText("🔄 Geräte neu suchen");
        scan.setAllCaps(false);
        scan.setOnClickListener(v -> { refreshDevices(); status("Geräte aktualisiert."); });
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-1, -2);
        sp.topMargin = dp(10);
        root.addView(scan, sp);

        volText = label("Lautstärke: 100 %");
        root.addView(volText);
        SeekBar vol = new SeekBar(this);
        vol.setMax(300);
        vol.setProgress(100);
        vol.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar s, int v, boolean u) { gain = v / 100f; volText.setText("Lautstärke: " + v + " %"); }
            public void onStartTrackingTouch(SeekBar s) {}
            public void onStopTrackingTouch(SeekBar s) {}
        });
        root.addView(vol, new LinearLayout.LayoutParams(-1, -2));

        echoBox = new CheckBox(this);
        echoBox.setText("Rückkopplungs-Schutz (gegen Pfeifen)");
        echoBox.setTextSize(15);
        echoBox.setOnCheckedChangeListener((c, on) -> restartIfRunning());
        LinearLayout.LayoutParams ep = new LinearLayout.LayoutParams(-2, -2);
        ep.topMargin = dp(10);
        root.addView(echoBox, ep);

        hint = text("", 14, 0xFF555555);
        hint.setPadding(dp(12), dp(12), dp(12), dp(12));
        GradientDrawable hb = new GradientDrawable();
        hb.setColor(0xFFFFF7E0);
        hb.setCornerRadius(dp(10));
        hint.setBackground(hb);
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(-1, -2);
        hp.topMargin = dp(16);
        root.addView(hint, hp);

        TextView tips = text(
                "Tipps:\n" +
                "• Erst Mikro-Empfänger einstecken und Lautsprecher verbinden, dann „Geräte neu suchen“.\n" +
                "• Pfeift es? Mikro weiter vom Lautsprecher weg, leiser drehen oder Rückkopplungs-Schutz an.\n" +
                "• Die App muss offen bleiben, solange du sprichst. Der Bildschirm bleibt dafür an.\n" +
                "• Die Handy-Lautstärke (Tasten am Rand) regelt zusätzlich die Lautstärke.", 14, 0xFF666666);
        tips.setPadding(0, dp(16), 0, 0);
        root.addView(tips);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(0xFFF4F4F6);
        scroll.addView(root);
        setContentView(scroll);

        AdapterView.OnItemSelectedListener sel = new AdapterView.OnItemSelectedListener() {
            public void onItemSelected(AdapterView<?> a, View v, int pos, long id) {
                boolean changed = (a == inSpin) ? pos != lastIn : pos != lastOut;
                if (a == inSpin) lastIn = pos; else lastOut = pos;
                updateHint();
                if (changed) restartIfRunning();
            }
            public void onNothingSelected(AdapterView<?> a) {}
        };
        inSpin.setOnItemSelectedListener(sel);
        outSpin.setOnItemSelectedListener(sel);

        am.registerAudioDeviceCallback(new AudioDeviceCallback() {
            public void onAudioDevicesAdded(AudioDeviceInfo[] d) { refreshDevices(); }
            public void onAudioDevicesRemoved(AudioDeviceInfo[] d) { refreshDevices(); }
        }, ui);

        askPermissions();
        refreshDevices();
    }

    @Override
    protected void onDestroy() {
        stopAudio();
        super.onDestroy();
    }

    private void askPermissions() {
        List<String> need = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.BLUETOOTH_CONNECT);
        if (!need.isEmpty()) requestPermissions(need.toArray(new String[0]), 1);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        refreshDevices();
    }

    // ------------------------------------------------------------ Geräte

    private void refreshDevices() {
        AudioDeviceInfo oldIn = selected(inSpin, inputs), oldOut = selected(outSpin, outputs);
        fill(inSpin, inputs, am.getDevices(AudioManager.GET_DEVICES_INPUTS), true, oldIn, "Automatisch (Standard-Mikrofon)");
        fill(outSpin, outputs, am.getDevices(AudioManager.GET_DEVICES_OUTPUTS), false, oldOut, "Automatisch (Standard-Lautsprecher)");
        lastIn = inSpin.getSelectedItemPosition();
        lastOut = outSpin.getSelectedItemPosition();
        updateHint();
    }

    private void fill(Spinner sp, List<AudioDeviceInfo> list, AudioDeviceInfo[] devs, boolean input,
                      AudioDeviceInfo keep, String auto) {
        list.clear();
        List<String> names = new ArrayList<>();
        names.add(auto);
        list.add(null);
        Set<String> seen = new HashSet<>();
        int keepPos = 0;
        for (AudioDeviceInfo d : devs) {
            String n = name(d, input);
            if (n == null || !seen.add(n)) continue;
            if (keep != null && (keep.getId() == d.getId() || n.equals(name(keep, input)))) keepPos = list.size();
            list.add(d);
            names.add(n);
        }
        ArrayAdapter<String> ad = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, names);
        ad.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        sp.setAdapter(ad);
        sp.setSelection(keepPos, false);
    }

    private static AudioDeviceInfo selected(Spinner sp, List<AudioDeviceInfo> list) {
        int i = sp.getSelectedItemPosition();
        return (i >= 0 && i < list.size()) ? list.get(i) : null;
    }

    /** Anzeigename, oder null wenn das Gerät nicht in die Liste soll. */
    private static String name(AudioDeviceInfo d, boolean input) {
        String kind;
        switch (d.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_MIC: kind = "Handy-Mikrofon"; break;
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: kind = "Handy-Lautsprecher"; break;
            case AudioDeviceInfo.TYPE_WIRED_HEADSET: kind = "Kabel-Headset"; break;
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: kind = "Kopfhörer (Kabel)"; break;
            case AudioDeviceInfo.TYPE_LINE_ANALOG: kind = "Klinke / Line"; break;
            case AudioDeviceInfo.TYPE_AUX_LINE: kind = "AUX"; break;
            case AudioDeviceInfo.TYPE_USB_DEVICE:
            case AudioDeviceInfo.TYPE_USB_ACCESSORY:
            case AudioDeviceInfo.TYPE_USB_HEADSET: kind = "USB"; break;
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP: kind = "Bluetooth"; break;
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO: kind = "Bluetooth (Sprach-Modus)"; break;
            case AudioDeviceInfo.TYPE_HEARING_AID: kind = "Hörgerät"; break;
            case AudioDeviceInfo.TYPE_HDMI: kind = "HDMI"; break;
            case 26: /* TYPE_BLE_HEADSET */ kind = "Bluetooth LE"; break;
            case 27: /* TYPE_BLE_SPEAKER */ kind = "Bluetooth-LE-Lautsprecher"; break;
            default: return null; // Hörmuschel, Telefonie, intern …
        }
        CharSequence pn = d.getProductName();
        String prod = pn == null ? "" : pn.toString().trim();
        if (prod.isEmpty() || prod.equals(Build.MODEL) || d.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC
                || d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) return kind;
        return kind + ": " + prod;
    }

    private static boolean isSco(AudioDeviceInfo d) {
        return d != null && d.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO;
    }

    private void updateHint() {
        AudioDeviceInfo in = selected(inSpin, inputs), out = selected(outSpin, outputs);
        String h;
        if (isSco(in) && out != null && out.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) {
            h = "Achtung: Ein Bluetooth-Mikrofon und ein Bluetooth-Lautsprecher gleichzeitig schaffen viele Handys nicht. " +
                "Klappt es nicht, nimm ein Mikro mit Empfänger (USB/Klinke) oder das Handy-Mikrofon.";
        } else if (isSco(in) || isSco(out)) {
            h = "Bluetooth im Sprach-Modus: Der Ton klingt etwas dumpfer, wie beim Telefonieren. Das ist bei Bluetooth-Mikros normal.";
        } else if (out == null) {
            h = "Tipp: Wähle oben deinen Lautsprecher aus, damit der Ton sicher dort herauskommt und nicht aus dem Handy oder dem Mikro-Empfänger.";
        } else if (out.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) {
            h = "Bluetooth-Lautsprecher haben immer eine kleine Verzögerung (meist 0,1 bis 0,3 Sekunden). Das lässt sich leider nicht ganz vermeiden.";
        } else {
            h = "";
        }
        hint.setText(h);
        hint.setVisibility(h.isEmpty() ? View.GONE : View.VISIBLE);
    }

    // ------------------------------------------------------------ Audio

    private void startAudio() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            status("Bitte erlaube der App den Zugriff aufs Mikrofon.");
            askPermissions();
            return;
        }
        final AudioDeviceInfo in = selected(inSpin, inputs);
        final AudioDeviceInfo out = selected(outSpin, outputs);
        final boolean echo = echoBox.isChecked();
        final int gen = ++generation;
        running = true;
        setToggle(true);
        status("Starte …");
        worker = new Thread(() -> loop(in, out, echo, gen), "LiveMikrofon");
        worker.start();
    }

    private void stopAudio() {
        running = false;
        Thread t = worker;
        worker = null;
        if (t != null) {
            try { t.join(1500); } catch (InterruptedException ignored) {}
        }
        setToggle(false);
        level.setProgress(0);
    }

    private void restartIfRunning() {
        if (!running) return;
        stopAudio();
        startAudio();
    }

    private void loop(AudioDeviceInfo in, AudioDeviceInfo out, boolean echo, int gen) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
        AudioRecord rec = null;
        AudioTrack track = null;
        AcousticEchoCanceler aec = null;
        NoiseSuppressor ns = null;
        boolean sco = isSco(in) || isSco(out);
        try {
            if (sco) startSco(in != null && isSco(in) ? in : out);

            int rate = 48000;
            String r = am.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE);
            if (r != null) try { rate = Integer.parseInt(r); } catch (NumberFormatException ignored) {}
            if (sco) rate = 16000;

            int minIn = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int minOut = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (minIn <= 0 || minOut <= 0) throw new IllegalStateException("Audio-Format wird nicht unterstützt");

            AudioFormat inFmt = new AudioFormat.Builder().setSampleRate(rate)
                    .setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build();
            AudioFormat outFmt = new AudioFormat.Builder().setSampleRate(rate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build();

            rec = new AudioRecord.Builder()
                    .setAudioSource(echo || sco ? MediaRecorder.AudioSource.VOICE_COMMUNICATION : MediaRecorder.AudioSource.MIC)
                    .setAudioFormat(inFmt)
                    .setBufferSizeInBytes(minIn * 2)
                    .build();
            if (rec.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("Mikrofon lässt sich nicht öffnen");
            if (in != null) rec.setPreferredDevice(in);

            if (echo) {
                if (AcousticEchoCanceler.isAvailable()) { aec = AcousticEchoCanceler.create(rec.getAudioSessionId()); if (aec != null) aec.setEnabled(true); }
                if (NoiseSuppressor.isAvailable()) { ns = NoiseSuppressor.create(rec.getAudioSessionId()); if (ns != null) ns.setEnabled(true); }
            }

            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(sco ? AudioAttributes.USAGE_VOICE_COMMUNICATION : AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
            AudioTrack.Builder tb = new AudioTrack.Builder()
                    .setAudioAttributes(attrs)
                    .setAudioFormat(outFmt)
                    .setBufferSizeInBytes(minOut)
                    .setTransferMode(AudioTrack.MODE_STREAM);
            if (Build.VERSION.SDK_INT >= 26) tb.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY);
            track = tb.build();
            if (track.getState() != AudioTrack.STATE_INITIALIZED) throw new IllegalStateException("Lautsprecher lässt sich nicht öffnen");
            if (out != null) track.setPreferredDevice(out);

            rec.startRecording();
            track.play();

            final AudioRecord recF = rec;
            final AudioTrack trackF = track;
            ui.postDelayed(() -> {
                if (!running || gen != generation) return;
                AudioDeviceInfo ri = recF.getRoutedDevice(), ro = trackF.getRoutedDevice();
                String s = "Läuft – sprich ins Mikrofon!";
                if (ri != null) s += "\nMikrofon: " + nameOr(ri, true);
                if (ro != null) s += "\nLautsprecher: " + nameOr(ro, false);
                status(s);
            }, 400);

            int frames = Math.max(64, rate / 200); // ca. 5 ms pro Block
            short[] buf = new short[frames];
            long lastUi = 0;
            int peak = 0;
            while (running) {
                int n = rec.read(buf, 0, buf.length);
                if (n <= 0) {
                    if (n < 0) throw new IllegalStateException("Mikrofon meldet Fehler " + n);
                    continue;
                }
                float g = gain;
                for (int i = 0; i < n; i++) {
                    int v = (int) (buf[i] * g);
                    if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
                    buf[i] = (short) v;
                    int a = Math.abs(v);
                    if (a > peak) peak = a;
                }
                track.write(buf, 0, n);
                long now = System.currentTimeMillis();
                if (now - lastUi > 60) {
                    final int pct = peak * 100 / 32767;
                    ui.post(() -> level.setProgress(pct));
                    peak = 0;
                    lastUi = now;
                }
            }
        } catch (Throwable e) {
            final String msg = e.getMessage() == null ? e.toString() : e.getMessage();
            if (gen == generation) {
                running = false;
                ui.post(() -> { setToggle(false); status("Fehler: " + msg); });
            }
        } finally {
            if (aec != null) aec.release();
            if (ns != null) ns.release();
            if (rec != null) { try { rec.stop(); } catch (Throwable ignored) {} rec.release(); }
            if (track != null) { try { track.stop(); } catch (Throwable ignored) {} track.release(); }
            if (sco) stopSco();
            ui.post(() -> { level.setProgress(0); if (status.getText().toString().startsWith("Läuft")) status("Gestoppt."); });
        }
    }

    private String nameOr(AudioDeviceInfo d, boolean input) {
        String n = name(d, input);
        return n != null ? n : "Standard";
    }

    @SuppressWarnings("deprecation")
    private void startSco(AudioDeviceInfo dev) throws InterruptedException {
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        if (Build.VERSION.SDK_INT >= 31) {
            CharSequence want = dev.getProductName();
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                if (d.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                        && (want == null || want.toString().contentEquals(d.getProductName()))) {
                    am.setCommunicationDevice(d);
                    break;
                }
            }
        } else {
            am.startBluetoothSco();
            am.setBluetoothScoOn(true);
        }
        scoStarted = true;
        Thread.sleep(1200); // Bluetooth braucht einen Moment zum Umschalten
    }

    @SuppressWarnings("deprecation")
    private void stopSco() {
        if (!scoStarted) return;
        scoStarted = false;
        if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice();
        else { am.setBluetoothScoOn(false); am.stopBluetoothSco(); }
        am.setMode(AudioManager.MODE_NORMAL);
    }

    // ------------------------------------------------------------ Helfer

    private void setToggle(boolean on) {
        toggle.setText(on ? "■  Stop" : "▶  Start");
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(on ? RED : GREEN);
        bg.setCornerRadius(dp(14));
        toggle.setBackground(bg);
    }

    private void status(String s) { status.setText(s); }

    private TextView text(String s, int size, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        t.setTextColor(color);
        return t;
    }

    private TextView label(String s) {
        TextView t = text(s, 16, 0xFF1B1B1F);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(16), 0, dp(4));
        t.setGravity(Gravity.START);
        return t;
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
