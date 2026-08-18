package com.cecompanion;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Capacitor bridge for the background poller. JS calls start()/stop(); this
// starts or stops the PollService foreground service. setForeground() lets the
// app tell the service whether it is in the foreground, which gates chat
// polling (chat alerts fire only while backgrounded).
//
// IMPORTANT: the package above must match your app's applicationId.
@CapacitorPlugin(name = "BackgroundPoller")
public class BackgroundPoller extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("missing key");
            return;
        }
        boolean muteJobs = Boolean.TRUE.equals(call.getBoolean("muteJobs", true));
        String chatChannels = call.getString("chatChannels", "");
        String notifCategories = call.getString("notifCategories", "events,drug,medical,booster,jail,hospital,vitals");
        boolean cooldownReadyOnly = Boolean.TRUE.equals(call.getBoolean("cooldownReadyOnly", true));
        int intervalActive = call.getInt("intervalActive", 30000);
        int intervalIdle = call.getInt("intervalIdle", 120000);

        Intent i = new Intent(getContext(), PollService.class);
        i.setAction(PollService.ACTION_START);
        i.putExtra("key", key);
        i.putExtra("muteJobs", muteJobs);
        i.putExtra("chatChannels", chatChannels);
        i.putExtra("notifCategories", notifCategories);
        i.putExtra("cooldownReadyOnly", cooldownReadyOnly);
        i.putExtra("intervalActive", intervalActive);
        i.putExtra("intervalIdle", intervalIdle);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(i);
        } else {
            getContext().startService(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent i = new Intent(getContext(), PollService.class);
        i.setAction(PollService.ACTION_STOP);
        getContext().startService(i);
        call.resolve();
    }

    @PluginMethod
    public void setForeground(PluginCall call) {
        boolean fg = Boolean.TRUE.equals(call.getBoolean("foreground", true));
        PollService.setAppForeground(fg);
        call.resolve();
    }
}
