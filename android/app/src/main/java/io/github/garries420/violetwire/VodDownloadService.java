package io.github.garries420.violetwire;
import android.app.Service;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.IBinder;
import androidx.core.content.ContextCompat;

/** Both jobs remain foreground work, including while only chat is downloading. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class VodDownloadService extends Service {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private VodDownloads downloads;
    static void start(Context context) { ContextCompat.startForegroundService(context, new Intent(context, VodDownloadService.class)); }
    @Override public void onCreate() {
        super.onCreate(); downloads = VodDownloads.get(this);
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel("vod-downloads", "VOD downloads", NotificationManager.IMPORTANCE_LOW));
        startForeground(8, notification());
        handler.postDelayed(new Runnable() { public void run() { downloads.pumpChat(); if (!downloads.hasWork()) { stopSelf(); return; } handler.postDelayed(this, 1000); } }, 1000);
    }
    private Notification notification() {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new androidx.core.app.NotificationCompat.Builder(this, "vod-downloads").setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("VioletWire VOD downloads").setContentText("Downloading video and chat replay · manage in Downloads").setOngoing(true).setContentIntent(open).build();
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) { downloads.manager.resumeDownloads(); downloads.pumpChat(); return START_STICKY; }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onTimeout(int startId, int type) { downloads.timeout(); stopSelf(); }
    @Override public void onDestroy() { handler.removeCallbacksAndMessages(null); super.onDestroy(); }
}
