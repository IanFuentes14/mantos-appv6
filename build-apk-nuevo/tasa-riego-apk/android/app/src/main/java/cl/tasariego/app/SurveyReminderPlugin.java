package cl.tasariego.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "SurveyReminder", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class SurveyReminderPlugin extends Plugin {
    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", SurveyReminderReceiver.enabled(getContext()));
        result.put("notificationsAllowed", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        result.put("exactAllowed", SurveyReminderReceiver.exactAllowed(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        if (Boolean.TRUE.equals(call.getBoolean("enabled", false)) && Build.VERSION.SDK_INT >= 33
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "permissionResult");
            return;
        }
        apply(call);
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("Permite las notificaciones para activar el recordatorio.");
            return;
        }
        apply(call);
    }

    private void apply(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (enabled && !NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {
            call.reject("Las notificaciones estan deshabilitadas en los ajustes del telefono.");
            return;
        }
        getContext().getSharedPreferences(SurveyReminderReceiver.PREFS, Context.MODE_PRIVATE).edit().putBoolean("enabled", enabled).apply();
        SurveyReminderReceiver.schedule(getContext());
        status(call);
    }

    @PluginMethod
    public void openExactSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
        }
        call.resolve();
    }
}
