package de.marc.tagebuch;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Wird zur geplanten Zeit, nach einem Neustart und nach App-Updates aufgerufen. */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent.getAction();
        if (Reminder.ACTION.equals(a)) {
            Reminder.prefs(c).edit().remove("naechste").apply();
            if (Reminder.isOn(c) && !Reminder.writtenToday(c)) Reminder.show(c);
            Reminder.markShownToday(c);
        }
        Reminder.schedule(c);
    }
}
