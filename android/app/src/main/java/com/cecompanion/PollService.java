package com.cecompanion;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

// Foreground service that watches the account in native code, independent of the
// WebView. Each poll: events (ETag) -> notify new; status,cooldowns -> detect
// cooldown/jail/hospital/vitals transitions live; and, while the app is
// backgrounded, one enabled chat channel (round-robin) -> notify new messages.
// Polls adaptively (fast active / slow quiet / slowest under Doze). Chat is
// gated to background so it never collides with the foreground chat viewer, and
// only one channel is polled per cycle so it stays under the 3/min chat limit.
//
// IMPORTANT: the package above must match your app's applicationId.
public class PollService extends Service {

    public static final String ACTION_START = "com.cecompanion.POLL_START";
    public static final String ACTION_STOP = "com.cecompanion.POLL_STOP";

    private static final String PREFS = "ce_poller_prefs";
    private static final String CH_SERVICE = "ce_service";
    private static final String CH_EVENTS = "ce_events_bg";
    private static final int FG_ID = 4201;

    private static final String BASE = "https://cartelempire.online/api";
    private static final String DESC = "CE Companion by Cinyx";
    private static final int SEEN_CAP = 300;

    private static final long HOUR = 3600;
    private static final long MIN = 60;
    private static final long[] COOLDOWN_STEPS = { 20 * HOUR, 15 * HOUR, 10 * HOUR, 5 * HOUR, 1 * HOUR, 15 * MIN };
    private static final long[] CONFINE_STEPS = { 10 * MIN, 5 * MIN, 2 * MIN };
    private static final long[] NO_STEPS = {};

    // App foreground state, set by the plugin. Chat is polled only while false.
    private static volatile boolean appForeground = true;

    public static void setAppForeground(boolean fg) {
        appForeground = fg;
    }

    private HandlerThread thread;
    private Handler handler;
    private volatile boolean running = false;

    private String apiKey;
    private boolean muteJobs = true;
    private long intervalActiveMs = 10000;
    private long intervalIdleMs = 30000;
    private long intervalDozeMs = 60000;
    private long lastNewEventAt = 0;
    private int notifId = 5000;

    private android.os.PowerManager.WakeLock wakeLock;

    private String[] chatChannels = new String[0];
    private int chatIndex = 0;
    private boolean cartelChatForbidden = false;
    private final ArrayDeque<Long> chatHits = new ArrayDeque<>();

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopPolling();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (intent != null && intent.hasExtra("key")) {
            apiKey = intent.getStringExtra("key");
            muteJobs = intent.getBooleanExtra("muteJobs", true);
            intervalActiveMs = intent.getIntExtra("intervalActive", 30000);
            intervalIdleMs = intent.getIntExtra("intervalIdle", 120000);

            String chatCfg = intent.getStringExtra("chatChannels");
            if (chatCfg == null) chatCfg = "";
            chatChannels = chatCfg.isEmpty() ? new String[0] : chatCfg.split(",");
            chatIndex = 0;
            cartelChatForbidden = false;

            // Reset baseline only for channels newly added, so an already-watched
            // channel keeps its seen-set (no re-blast) while a newly enabled one
            // does not dump its history.
            String prevCfg = p.getString("chat_cfg", "");
            Set<String> prev = new HashSet<>(Arrays.asList(prevCfg.isEmpty() ? new String[0] : prevCfg.split(",")));
            SharedPreferences.Editor ce = p.edit();
            for (String c : chatChannels) {
                if (!prev.contains(c)) ce.remove("chat_seen_" + c).remove("chat_base_" + c);
            }
            ce.putString("chat_cfg", chatCfg);

            ce.putString("key", apiKey)
                .putBoolean("muteJobs", muteJobs)
                .putLong("intervalActive", intervalActiveMs)
                .putLong("intervalIdle", intervalIdleMs)
                .putBoolean("baselined", false)
                .putBoolean("timers_baselined", false)
                .apply();
        } else {
            apiKey = p.getString("key", null);
            muteJobs = p.getBoolean("muteJobs", true);
            intervalActiveMs = p.getLong("intervalActive", 30000);
            intervalIdleMs = p.getLong("intervalIdle", 120000);
            String chatCfg = p.getString("chat_cfg", "");
            chatChannels = chatCfg.isEmpty() ? new String[0] : chatCfg.split(",");
        }

        createChannels();
        startForegroundCompat();

        if (apiKey == null || apiKey.isEmpty()) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        startPolling();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopPolling();
        super.onDestroy();
    }

    private void startForegroundCompat() {
        Notification n = buildServiceNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(FG_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(FG_ID, n);
        }
    }

    private void startPolling() {
        if (running) return;
        running = true;
        lastNewEventAt = System.currentTimeMillis();
        acquireWakeLock();
        thread = new HandlerThread("ce-poller");
        thread.start();
        handler = new Handler(thread.getLooper());
        handler.post(pollRunnable);
    }

    private void stopPolling() {
        running = false;
        if (handler != null) {
            handler.removeCallbacksAndMessages(null);
            handler = null;
        }
        if (thread != null) {
            thread.quitSafely();
            thread = null;
        }
        releaseWakeLock();
    }

    // A foreground service keeps the process alive but does NOT keep the CPU
    // awake, so without this the polling loop stalls whenever the screen is off
    // (postDelayed uses uptime, which pauses in sleep). A partial wake lock keeps
    // the CPU running enough to poll. This is the main cost of frequent polling.
    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "cecompanion:poller");
        wakeLock.setReferenceCounted(false);
        try {
            wakeLock.acquire();
        } catch (Exception e) {
            // ignore
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception e) {
                // ignore
            }
        }
        wakeLock = null;
    }

    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            try {
                pollEvents();
            } catch (Exception e) {
                // ignore
            }
            try {
                pollTimers();
            } catch (Exception e) {
                // ignore
            }
            if (!appForeground) {
                try {
                    pollChat();
                } catch (Exception e) {
                    // ignore
                }
            }
            long next = computeInterval();
            if (running && handler != null) handler.postDelayed(this, next);
        }
    };

    private long computeInterval() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        boolean idle = false;
        boolean save = false;
        if (pm != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) idle = pm.isDeviceIdleMode();
            save = pm.isPowerSaveMode();
        }
        if (idle || save) return intervalDozeMs;
        long quietFor = System.currentTimeMillis() - lastNewEventAt;
        if (quietFor < 5 * 60 * 1000) return intervalActiveMs;
        return intervalIdleMs;
    }

    // ---- Events ----

    private void pollEvents() throws Exception {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        String etag = p.getString("etag", null);

        String url = BASE + "/user?type=events&desc=" + enc(DESC) + "&key=" + enc(apiKey);
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        conn.setRequestMethod("GET");
        if (etag != null) conn.setRequestProperty("If-None-Match", etag);

        int code = conn.getResponseCode();
        if (code == 304) {
            conn.disconnect();
            return;
        }
        if (code != 200) {
            conn.disconnect();
            return;
        }

        String newEtag = conn.getHeaderField("ETag");
        String body = readBody(conn);
        conn.disconnect();

        JSONArray arr;
        if (body.startsWith("[")) {
            arr = new JSONArray(body);
        } else {
            JSONObject o = new JSONObject(body);
            arr = o.optJSONArray("events");
            if (arr == null) arr = new JSONArray();
        }

        Set<String> seen = loadStrSet(p, "seen");
        boolean baselined = p.getBoolean("baselined", false);
        Set<String> updated = new LinkedHashSet<>(seen);
        boolean anyNew = false;

        for (int i = arr.length() - 1; i >= 0; i--) {
            JSONObject e = arr.optJSONObject(i);
            if (e == null) continue;
            String id = e.optString("id", "");
            if (id.isEmpty() || seen.contains(id)) continue;
            updated.add(id);
            if (!baselined) continue;
            String category = e.optString("category", "");
            if (muteJobs && "Jobs".equalsIgnoreCase(category)) continue;
            String text = stripHtml(e.optString("description", ""));
            if (text.isEmpty()) text = "New event";
            notify("Cartel Empire", text);
            anyNew = true;
        }

        if (anyNew) lastNewEventAt = System.currentTimeMillis();

        Set<String> trimmed = trim(updated, SEEN_CAP);
        SharedPreferences.Editor ed = p.edit();
        ed.putString("seen", new JSONArray(new ArrayList<>(trimmed)).toString());
        ed.putBoolean("baselined", true);
        if (newEtag != null) ed.putString("etag", newEtag);
        ed.apply();
    }

    // ---- Timers (cooldowns / jail / hospital / vitals) ----

    private void pollTimers() throws Exception {
        String url = BASE + "/user?type=status,cooldowns&desc=" + enc(DESC) + "&key=" + enc(apiKey);
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        conn.setRequestMethod("GET");

        int code = conn.getResponseCode();
        if (code != 200) {
            conn.disconnect();
            return;
        }
        String body = readBody(conn);
        conn.disconnect();

        JSONObject o = new JSONObject(body);
        long now = System.currentTimeMillis() / 1000;
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        boolean baseline = !p.getBoolean("timers_baselined", false);

        long drug = epochSec(o.optString("drugCooldown", "0"));
        long medical = epochSec(o.optString("medicalCooldown", "0"));
        long booster = epochSec(o.optString("boosterCooldown", "0"));
        long hosp = epochSec(o.optString("hospitalRelease", "0"));
        long jail = epochSec(o.optString("jailRelease", "0"));

        detectTimer(p, "drug", "Drug cooldown", "Drug cooldown is ready", drug, NO_STEPS, false, now, baseline);
        detectTimer(p, "medical", "Medical cooldown", "Medical cooldown is ready", medical, COOLDOWN_STEPS, false, now, baseline);
        detectTimer(p, "booster", "Booster cooldown", "Booster cooldown is ready", booster, COOLDOWN_STEPS, false, now, baseline);
        detectTimer(p, "hospital", "hospital", "You are out of hospital", hosp, CONFINE_STEPS, true, now, baseline);
        detectTimer(p, "jail", "jail", "You are out of jail", jail, CONFINE_STEPS, true, now, baseline);

        int curLife = o.optInt("currentLife", 0);
        int maxLife = o.optInt("maxLife", 0);
        int curEn = o.optInt("currentEnergy", 0);
        int maxEn = o.optInt("maxEnergy", 0);
        boolean full = maxLife > 0 && curLife >= maxLife && maxEn > 0 && curEn >= maxEn;
        boolean wasFull = p.getBoolean("timer_vitalsFull", false);
        if (!baseline && full && !wasFull) notify("CE Companion", "Life and energy are full");

        p.edit().putBoolean("timer_vitalsFull", full).putBoolean("timers_baselined", true).apply();
    }

    private void detectTimer(SharedPreferences p, String prefix, String reminderName, String doneMsg,
                             long readyAt, long[] thresholds, boolean isConf, long now, boolean baseline) {
        boolean prevActive = p.getBoolean("t_" + prefix + "_act", false);
        long prevReady = p.getLong("t_" + prefix + "_rdy", -1);
        Set<String> fired = loadStrSet(p, "t_" + prefix + "_fired");
        if (readyAt != prevReady && readyAt > now) fired = new LinkedHashSet<>();

        boolean active = readyAt > now;
        if (active) {
            long remaining = readyAt - now;
            for (long t : thresholds) {
                String tk = String.valueOf(t);
                if (remaining <= t && !fired.contains(tk)) {
                    if (!baseline) notify("Cartel Empire", reminderText(reminderName, t, isConf));
                    fired.add(tk);
                }
            }
        } else {
            if (prevActive && !baseline) notify("Cartel Empire", doneMsg);
        }

        p.edit()
            .putBoolean("t_" + prefix + "_act", active)
            .putLong("t_" + prefix + "_rdy", readyAt)
            .putString("t_" + prefix + "_fired", new JSONArray(new ArrayList<>(fired)).toString())
            .apply();
    }

    // ---- Chat (background only, one channel per cycle) ----

    private void pollChat() throws Exception {
        if (chatChannels.length == 0 || !chatCanRequest()) return;

        String ch = null;
        for (int tries = 0; tries < chatChannels.length; tries++) {
            String cand = chatChannels[Math.floorMod(chatIndex, chatChannels.length)];
            chatIndex++;
            if ("cartel".equals(cand) && cartelChatForbidden) continue;
            ch = cand;
            break;
        }
        if (ch == null) return;

        String wrap = "global".equals(ch) ? "globalChat" : "trade".equals(ch) ? "tradeChat" : "cartelChat";
        String label = "global".equals(ch) ? "Global chat" : "trade".equals(ch) ? "Trade chat" : "Cartel chat";

        String url = BASE + "/chat?type=" + enc(ch) + "&from=1&limit=50&desc=" + enc(DESC) + "&key=" + enc(apiKey);
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        conn.setRequestMethod("GET");
        noteChatRequest();

        int code = conn.getResponseCode();
        if (code == 403) {
            if ("cartel".equals(ch)) cartelChatForbidden = true;
            conn.disconnect();
            return;
        }
        if (code == 400) {
            conn.disconnect();
            return;
        }
        if (code != 200) {
            conn.disconnect();
            return;
        }
        String body = readBody(conn);
        conn.disconnect();

        JSONObject o = new JSONObject(body);
        JSONArray arr = o.optJSONArray(wrap);
        if (arr == null) arr = new JSONArray();

        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        String seenKey = "chat_seen_" + ch;
        String baseKey = "chat_base_" + ch;
        Set<String> seen = loadStrSet(p, seenKey);
        boolean baselined = p.getBoolean(baseKey, false);
        Set<String> updated = new LinkedHashSet<>(seen);

        // from=1 returns newest-first, so fresh messages sit at the top.
        List<JSONObject> fresh = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject m = arr.optJSONObject(i);
            if (m == null) continue;
            String id = String.valueOf(m.opt("id"));
            if (id.equals("null")) continue;
            if (seen.contains(id)) continue;
            updated.add(id);
            if (baselined) fresh.add(m);
        }

        if (baselined && !fresh.isEmpty()) {
            int cap = Math.min(3, fresh.size());
            if (fresh.size() > cap) notify(label, (fresh.size() - cap) + " earlier new messages");
            List<JSONObject> newest = new ArrayList<>(fresh.subList(0, cap));
            Collections.reverse(newest); // oldest of the batch first
            for (JSONObject m : newest) {
                String name = m.optString("name", "");
                String text = m.optString("message", "");
                notify(label, (name.isEmpty() ? "" : name + ": ") + text);
            }
        }

        Set<String> trimmed = trim(updated, SEEN_CAP);
        p.edit().putString(seenKey, new JSONArray(new ArrayList<>(trimmed)).toString()).putBoolean(baseKey, true).apply();
    }

    private boolean chatCanRequest() {
        long now = System.currentTimeMillis();
        while (!chatHits.isEmpty() && now - chatHits.peekFirst() >= 60000) chatHits.pollFirst();
        return chatHits.size() < 3;
    }

    private void noteChatRequest() {
        chatHits.addLast(System.currentTimeMillis());
    }

    private String reminderText(String name, long seconds, boolean isConf) {
        if (isConf) return "Out of " + name + " in " + remainingText(seconds);
        return name + ": " + remainingText(seconds) + " left";
    }

    private String remainingText(long seconds) {
        if (seconds >= HOUR) {
            long h = Math.round(seconds / 3600.0);
            return h + (h == 1 ? " hour" : " hours");
        }
        long m = Math.round(seconds / 60.0);
        return m + (m == 1 ? " minute" : " minutes");
    }

    // ---- Helpers ----

    private String readBody(HttpURLConnection conn) throws Exception {
        StringBuilder sb = new StringBuilder();
        BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
        String line;
        while ((line = r.readLine()) != null) sb.append(line);
        r.close();
        return sb.toString().trim();
    }

    private long epochSec(String v) {
        try {
            long n = Long.parseLong(v.trim());
            if (n <= 0) return 0;
            return n > 100000000000L ? n / 1000 : n;
        } catch (Exception e) {
            return 0;
        }
    }

    private Set<String> loadStrSet(SharedPreferences p, String key) {
        Set<String> set = new LinkedHashSet<>();
        try {
            JSONArray a = new JSONArray(p.getString(key, "[]"));
            for (int i = 0; i < a.length(); i++) set.add(a.getString(i));
        } catch (Exception e) {
            // start fresh
        }
        return set;
    }

    private Set<String> trim(Set<String> set, int cap) {
        if (set.size() <= cap) return set;
        List<String> list = new ArrayList<>(set);
        return new LinkedHashSet<>(list.subList(list.size() - cap, list.size()));
    }

    private String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    private String stripHtml(String html) {
        if (html == null) return "";
        String s = html.replaceAll("(?i)<br\\s*/?>", " ");
        s = s.replaceAll("<[^>]+>", "");
        s = s.replaceAll("\\s+", " ").trim();
        return s;
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel svc = new NotificationChannel(CH_SERVICE, "Background service", NotificationManager.IMPORTANCE_MIN);
            svc.setShowBadge(false);
            nm.createNotificationChannel(svc);
            NotificationChannel ev = new NotificationChannel(CH_EVENTS, "Cartel Empire alerts", NotificationManager.IMPORTANCE_HIGH);
            nm.createNotificationChannel(ev);
        }
    }

    private PendingIntent launchIntent(int req) {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(this, req, open, flags);
    }

    private Notification buildServiceNotification() {
        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            ? new Notification.Builder(this, CH_SERVICE)
            : new Notification.Builder(this);
        return b
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("CE Companion")
            .setContentText("Watching for cartel activity")
            .setOngoing(true)
            .setContentIntent(launchIntent(1))
            .build();
    }

    private void notify(String title, String text) {
        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            ? new Notification.Builder(this, CH_EVENTS)
            : new Notification.Builder(this);
        Notification n = b
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new Notification.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setContentIntent(launchIntent(2))
            .build();
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (notifId > 100000) notifId = 5000;
        nm.notify(notifId++, n);
    }
}
