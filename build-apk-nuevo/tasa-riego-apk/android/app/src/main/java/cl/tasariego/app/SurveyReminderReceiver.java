package cl.tasariego.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.util.Calendar;
import java.util.TimeZone;

public class SurveyReminderReceiver extends BroadcastReceiver {
    static final String PREFS = "mantos_reminder";
    static final String ACTION = "cl.tasariego.app.SURVEY_REMINDER";
    static final String CHANNEL = "survey_reminders";
    static final int ID = 800;

    static boolean enabled(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("enabled", false);
    }

    static PendingIntent alarmIntent(Context context) {
        Intent intent = new Intent(context, SurveyReminderReceiver.class).setAction(ACTION);
        return PendingIntent.getBroadcast(context, ID, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean exactAllowed(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms();
    }

    static void schedule(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (!enabled(context)) {
            manager.cancel(alarmIntent(context));
            return;
        }
        Calendar next = Calendar.getInstance(TimeZone.getTimeZone("America/Santiago"));
        next.set(Calendar.HOUR_OF_DAY, 8);
        next.set(Calendar.MINUTE, 0);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        if (next.getTimeInMillis() <= System.currentTimeMillis()) next.add(Calendar.DATE, 1);
        try {
            if (exactAllowed(context)) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), alarmIntent(context));
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), alarmIntent(context));
            }
        } catch (SecurityException error) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), alarmIntent(context));
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION.equals(intent.getAction()) && enabled(context)) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) {
                manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Recordatorios de encuestas", NotificationManager.IMPORTANCE_DEFAULT));
            }
            Intent openApp = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent content = PendingIntent.getActivity(context, ID, openApp, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            String text = "Recuerda completar tus encuestas antes de iniciar la jornada.";
            try {
                NotificationManagerCompat.from(context).notify(ID, new NotificationCompat.Builder(context, CHANNEL)
                    .setSmallIcon(R.drawable.ic_survey_reminder)
                    .setContentTitle("Mantos Group | Encuestas")
                    .setContentText(text)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                    .setContentIntent(content).setAutoCancel(true).build());
            } catch (SecurityException ignored) {
            }
        }
        schedule(context);
    }
}
