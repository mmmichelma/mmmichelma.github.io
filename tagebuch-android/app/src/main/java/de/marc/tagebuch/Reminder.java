package de.marc.tagebuch;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.Random;

/** Tägliche Erinnerung zu einer zufälligen Zeit zwischen 18 und 22 Uhr. */
public class Reminder {
    static final String ACTION = "de.marc.tagebuch.ERINNERUNG";
    private static final String CHANNEL = "erinnerung";
    private static final int FROM_HOUR = 18, TO_HOUR = 22;
    private static final String[] TEXTE = {
            "Wie war dein Tag? ✍️ Ein Satz reicht schon.",
            "Zeit für euer Tagebuch 💛 Was war heute schön?",
            "Kurz innehalten: Was soll von heute nicht vergessen werden? 📖",
            "Euer Tagebuch wartet 😊 Foto + Satz – fertig!",
            "Hey! Schon geschrieben heute? 🔥 Haltet eure Serie am Leben."
    };

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("erinnerung", Context.MODE_PRIVATE);
    }

    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.GERMANY).format(new Date());
    }

    static boolean isOn(Context c) { return prefs(c).getBoolean("an", true); }

    static boolean writtenToday(Context c) {
        String t = today();
        return t.equals(prefs(c).getString("geschrieben", "")) || t.equals(prefs(c).getString("erinnert", ""));
    }

    static void markShownToday(Context c) { prefs(c).edit().putString("erinnert", today()).apply(); }

    static void setOn(Context c, boolean on) {
        prefs(c).edit().putBoolean("an", on).apply();
        if (on) schedule(c); else cancel(c);
    }

    static void markWritten(Context c, String date) {
        prefs(c).edit().putString("geschrieben", date).apply();
        if (isOn(c) && date.equals(today())) schedule(c); // heute nicht mehr erinnern
    }

    private static PendingIntent pending(Context c) {
        Intent i = new Intent(c, ReminderReceiver.class).setAction(ACTION);
        return PendingIntent.getBroadcast(c, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static long randomTimeOn(Calendar day) {
        Calendar t = (Calendar) day.clone();
        int minutes = new Random().nextInt((TO_HOUR - FROM_HOUR) * 60);
        t.set(Calendar.HOUR_OF_DAY, FROM_HOUR + minutes / 60);
        t.set(Calendar.MINUTE, minutes % 60);
        t.set(Calendar.SECOND, 0);
        t.set(Calendar.MILLISECOND, 0);
        return t.getTimeInMillis();
    }

    /** Plant die nächste Erinnerung (heute, falls noch möglich, sonst morgen). */
    static void schedule(Context c) {
        if (!isOn(c)) { cancel(c); return; }
        long now = System.currentTimeMillis();
        Calendar day = Calendar.getInstance();
        long t = -1;
        // gleiche Zeit behalten, wenn für heute schon eine geplant ist
        long planned = prefs(c).getLong("naechste", 0);
        if (planned > now + 60_000 && !writtenToday(c)) t = planned;
        if (t < 0) {
            Calendar end = Calendar.getInstance();
            end.set(Calendar.HOUR_OF_DAY, TO_HOUR); end.set(Calendar.MINUTE, 0); end.set(Calendar.SECOND, 0);
            if (!writtenToday(c) && now < end.getTimeInMillis() - 5 * 60_000) {
                long r = randomTimeOn(day);
                if (r <= now + 60_000) {
                    // es ist schon im Zeitfenster: irgendwann zwischen jetzt und 22 Uhr
                    long span = end.getTimeInMillis() - now - 2 * 60_000;
                    r = now + 2 * 60_000 + (long) (new Random().nextDouble() * Math.max(60_000, span));
                }
                t = r;
            } else {
                day.add(Calendar.DAY_OF_YEAR, 1);
                t = randomTimeOn(day);
            }
        }
        prefs(c).edit().putLong("naechste", t).apply();
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        am.cancel(pending(c));
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pending(c));
    }

    static void cancel(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(pending(c));
        prefs(c).edit().remove("naechste").apply();
    }

    static String nextText(Context c) {
        long t = prefs(c).getLong("naechste", 0);
        if (!isOn(c) || t <= 0) return "";
        Calendar n = Calendar.getInstance(), x = Calendar.getInstance();
        x.setTimeInMillis(t);
        String day = n.get(Calendar.DAY_OF_YEAR) == x.get(Calendar.DAY_OF_YEAR) ? "heute" : "morgen";
        return day + " zwischen 18 und 22 Uhr";
    }

    static void show(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Tägliche Erinnerung", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Erinnert abends ans Tagebuch-Schreiben");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String text = TEXTE[new Random().nextInt(TEXTE.length)];
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notif)
                .setColor(0xFF7A5C9E)
                .setContentTitle("Unser Tagebuch 📖")
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try { nm.notify(7, b.build()); } catch (SecurityException ignored) { }
    }
}
