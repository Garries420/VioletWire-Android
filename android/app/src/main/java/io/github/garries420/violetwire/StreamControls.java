package io.github.garries420.violetwire;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.ImageButton;

/** Touch controls above the native surface, never a permanent row beneath it. */
@android.annotation.SuppressLint("ViewConstructor") // Constructed only in code with required action callbacks.
final class StreamControls extends FrameLayout {
    interface Actions { void action(String action); void volume(int value); default void seek(long position) {} }
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable hide = () -> setVisibility(GONE);
    private final TextView title, viewers, uptime, latency;
    private final LinearLayout runtime;
    private long startedAt;
    private final Runnable tick = new Runnable() {
        public void run() { updateUptime(); if (getVisibility() == VISIBLE) handler.postDelayed(this, 1000); }
    };
    private final ImageButton follow, subscribe, pause, compressor, refresh, sizing, fullscreen, more;
    private final FrameLayout bottom;
    private final LinearLayout liveStats, seekRow;
    private final android.widget.SeekBar timeline;
    private final TextView positionLabel;
    private long duration;
    private boolean seeking;
    private boolean chatOnly;
    private boolean paused;
    private boolean chatVisible = true;
    private android.widget.PopupWindow optionsMenu;
    private int hideDelay = 5000;
    private final Actions actions;

    StreamControls(Context context, Actions callbacks) {
        super(context); actions = callbacks;
        LinearLayout top = row();
        top.addView(button(R.drawable.player_back, "Back to browsing", () -> actions.action("back")));
        title = text("", 14); title.setContentDescription("Open channel profile"); title.setOnClickListener(v -> actions.action("profile")); top.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));
        follow = button(R.drawable.player_heart_outline, "Follow channel", () -> actions.action("follow")); top.addView(follow);
        subscribe = button(R.drawable.player_subscribe, "Subscribe to channel", () -> actions.action("subscribe")); top.addView(subscribe);
        sizing = button(R.drawable.player_sizing, "Video size: Fit. Change video size", () -> actions.action("sizing")); top.addView(sizing);
        more = button(R.drawable.player_more, "More stream options", this::showOptions); top.addView(more);
        top.addView(button(R.drawable.player_settings, "Stream settings", () -> actions.action("settings")));
        LayoutParams topParams = new LayoutParams(-1, dp(48), Gravity.TOP); addView(top, topParams);
        bottom = new FrameLayout(context); bottom.setBackgroundColor(0xaa09090b);
        pause = button(R.drawable.player_pause, "Pause stream", () -> actions.action("pause")); bottom.addView(pause, bottomParams(44, Gravity.START, 0));
        compressor = button(R.drawable.player_compressor, "Enable audio compressor", () -> actions.action("compressor")); bottom.addView(compressor, bottomParams(44, Gravity.START, 44));
        refresh = button(R.drawable.player_refresh, "Refresh stream to live", () -> actions.action("refresh")); bottom.addView(refresh, bottomParams(44, Gravity.START, 88));
        LinearLayout stats = new LinearLayout(context); liveStats = stats; stats.setGravity(Gravity.CENTER);
        runtime = new LinearLayout(context); runtime.setGravity(Gravity.CENTER_VERTICAL);
        View dot = new View(context); GradientDrawable circle = new GradientDrawable(); circle.setShape(GradientDrawable.OVAL); circle.setColor(0xffff2424); dot.setBackground(circle);
        LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(dp(5), dp(5)); dotParams.setMarginEnd(dp(3)); runtime.addView(dot, dotParams);
        uptime = text("", 12); uptime.setTypeface(android.graphics.Typeface.MONOSPACE); runtime.addView(uptime);
        LinearLayout.LayoutParams runtimeParams = new LinearLayout.LayoutParams(-2, -2); runtimeParams.setMarginEnd(dp(6)); stats.addView(runtime, runtimeParams);
        android.widget.ImageView person = new android.widget.ImageView(context); person.setImageResource(R.drawable.player_viewer); person.setColorFilter(Color.WHITE);
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(dp(14), dp(14)); iconParams.setMarginEnd(dp(4)); stats.addView(person, iconParams);
        viewers = text("", 12); viewers.setGravity(Gravity.CENTER); stats.addView(viewers);
        LayoutParams statsParams = new LayoutParams(-1, dp(48)); statsParams.setMarginStart(dp(132)); statsParams.setMarginEnd(dp(108)); bottom.addView(stats, statsParams);
        LinearLayout latencyButton = new LinearLayout(context); latencyButton.setGravity(Gravity.CENTER); latencyButton.setFocusable(true);
        android.widget.ImageView gauge = new android.widget.ImageView(context); gauge.setImageResource(R.drawable.player_stats); latencyButton.addView(gauge, new LinearLayout.LayoutParams(dp(16), dp(16)));
        latency = text("—", 11); latency.setPadding(dp(4), 0, 0, 0); latencyButton.addView(latency);
        latencyButton.setContentDescription("Video player stats"); latencyButton.setOnClickListener(v -> { reveal(); actions.action("stats"); });
        LayoutParams latencyParams = new LayoutParams(dp(64), dp(48), Gravity.END); latencyParams.setMarginEnd(dp(44)); bottom.addView(latencyButton, latencyParams);
        fullscreen = button(R.drawable.player_fullscreen, "Fullscreen", () -> actions.action("fullscreen"));
        bottom.addView(fullscreen, bottomParams(44, Gravity.END, 0));
        addView(bottom, new LayoutParams(-1, dp(48), Gravity.BOTTOM));
        seekRow = new LinearLayout(context); seekRow.setGravity(Gravity.CENTER_VERTICAL); seekRow.setBackgroundColor(0xaa09090b);
        positionLabel = text("0:00:00", 11); positionLabel.setPadding(dp(8), 0, dp(4), 0); seekRow.addView(positionLabel);
        timeline = new android.widget.SeekBar(context); timeline.setMax(1000); timeline.setContentDescription("Seek in VOD");
        timeline.setProgressTintList(android.content.res.ColorStateList.valueOf(0xffa970ff)); timeline.setThumbTintList(android.content.res.ColorStateList.valueOf(0xffc4a7ff));
        seekRow.addView(timeline, new LinearLayout.LayoutParams(0, dp(44), 1));
        timeline.setOnSeekBarChangeListener(new android.widget.SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(android.widget.SeekBar bar, int value, boolean user) { if (user) positionLabel.setText(time(duration * value / 1000)); }
            public void onStartTrackingTouch(android.widget.SeekBar bar) { seeking = true; handler.removeCallbacks(hide); }
            public void onStopTrackingTouch(android.widget.SeekBar bar) { seeking = false; actions.seek(duration * bar.getProgress() / 1000); reveal(); }
        });
        LayoutParams seekParams = new LayoutParams(-1, dp(44), Gravity.BOTTOM); seekParams.bottomMargin = dp(48); addView(seekRow, seekParams); seekRow.setVisibility(GONE);
        setVisibility(GONE);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        super.onSizeChanged(width, height, oldWidth, oldHeight);
        int size = width < dp(400) ? 10 : 12;
        uptime.setTextSize(size); viewers.setTextSize(size);
    }
    private LinearLayout row() {
        LinearLayout row = new LinearLayout(getContext()); row.setGravity(Gravity.CENTER_VERTICAL);
        GradientDrawable shade = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{0xd909090b, 0xaa09090b});
        row.setBackground(shade); return row;
    }
    private TextView text(String value, int size) {
        TextView text = new TextView(getContext()); text.setText(value); text.setTextColor(Color.WHITE);
        text.setTextSize(size); text.setSingleLine(true); text.setGravity(Gravity.CENTER_VERTICAL);
        text.setEllipsize(android.text.TextUtils.TruncateAt.END); return text;
    }
    private LayoutParams bottomParams(int width, int gravity, int left) {
        LayoutParams params = new LayoutParams(dp(width), dp(48), gravity); params.setMarginStart(dp(left)); return params;
    }
    private ImageButton button(int icon, String label, Runnable click) {
        ImageButton button = new ImageButton(getContext()); button.setImageResource(icon); button.setBackgroundColor(Color.TRANSPARENT);
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(44), dp(48))); button.setPadding(dp(10), dp(12), dp(10), dp(12));
        button.setContentDescription(label); button.setFocusable(true);
        button.setOnClickListener(v -> { reveal(); click.run(); }); return button;
    }
    void chatVisible(boolean value) { chatVisible = value; }
    String chatActionLabel() { return chatVisible ? "Remove chat" : "Open chat"; }
    private void showOptions() {
        handler.removeCallbacks(hide);
        LinearLayout menu = new LinearLayout(getContext()); menu.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable background = new GradientDrawable(); background.setColor(0xff211929);
        background.setCornerRadius(dp(6)); background.setStroke(dp(1), 0xff493852); menu.setBackground(background);
        optionsMenu = new android.widget.PopupWindow(menu, dp(184), -2, true);
        optionsMenu.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        optionsMenu.setElevation(dp(8)); optionsMenu.setOutsideTouchable(true);
        TextView toggle = text(chatActionLabel(), 16); toggle.setPadding(dp(16), 0, dp(16), 0); toggle.setFocusable(true);
        toggle.setOnClickListener(v -> { optionsMenu.dismiss(); actions.action("chat-toggle"); });
        menu.addView(toggle, new LinearLayout.LayoutParams(-1, dp(48)));
        TextView viewers = text("Viewers list", 16); viewers.setPadding(dp(16), 0, dp(16), 0); viewers.setFocusable(true);
        viewers.setOnClickListener(v -> { optionsMenu.dismiss(); actions.action("viewers"); });
        menu.addView(viewers, new LinearLayout.LayoutParams(-1, dp(48)));
        optionsMenu.setOnDismissListener(this::scheduleHide);
        optionsMenu.showAsDropDown(more, 0, 0, Gravity.END);
    }
    void metadata(String channel, long count, boolean followed, boolean subscribed, boolean pending) {
        title.setText(channel); viewers.setText(java.text.NumberFormat.getIntegerInstance().format(count));
        viewers.setContentDescription(count + " viewers"); follow.setImageResource(followed ? R.drawable.player_heart : R.drawable.player_heart_outline);
        follow.setContentDescription(followed ? "Following channel" : "Follow channel"); follow.setEnabled(!pending);
        follow.setColorFilter(followed ? 0xffc4a7ff : Color.WHITE);
        subscribe.setImageResource(subscribed ? R.drawable.player_subscribed : R.drawable.player_subscribe);
        subscribe.setColorFilter(subscribed ? 0xff9147ff : Color.WHITE);
        subscribe.setContentDescription(subscribed ? "Subscribed to channel" : "Subscribe to channel");
    }
    void compression(boolean enabled) {
        compressor.setColorFilter(enabled ? 0xff9147ff : Color.WHITE);
        compressor.setSelected(enabled);
        compressor.setContentDescription(enabled ? "Disable audio compressor" : "Enable audio compressor");
    }
    void startedAt(long value) { startedAt = value; updateUptime(); }
    void latency(String value) { latency.setText(value); }
    private static String time(long millis) { long s = millis / 1000; return String.format(java.util.Locale.ROOT, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60); }
    void timeline(boolean vod, long position, long total) {
        duration = Math.max(0, total); seekRow.setVisibility(vod && !chatOnly ? VISIBLE : GONE); liveStats.setVisibility(vod ? GONE : VISIBLE);
        refresh.setVisibility(vod ? GONE : VISIBLE);
        if (!seeking) { timeline.setProgress(total > 0 ? (int) Math.min(1000, position * 1000 / total) : 0); positionLabel.setText(time(position) + " / " + time(duration)); }
    }
    private void updateUptime() {
        runtime.setVisibility(startedAt > 0 ? VISIBLE : GONE);
        long seconds = Math.max(0, (System.currentTimeMillis() - startedAt) / 1000);
        uptime.setText(String.format(java.util.Locale.ROOT, "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60));
        uptime.setContentDescription("Stream uptime " + uptime.getText());
    }
    void state(boolean paused, boolean muted, int value, boolean onlyChat) {
        boolean changed = this.paused != paused || chatOnly != onlyChat;
        this.paused = paused;
        pause.setImageResource(paused ? R.drawable.player_play : R.drawable.player_pause); pause.setContentDescription(paused ? "Play stream" : "Pause stream");
        chatOnly = onlyChat; bottom.setVisibility(onlyChat ? GONE : VISIBLE);
        if (changed && getVisibility() == VISIBLE) scheduleHide();
    }
    void fullscreen(boolean active) {
        fullscreen.setColorFilter(active ? 0xffc4a7ff : Color.WHITE);
        fullscreen.setContentDescription(active ? "Exit fullscreen" : "Enter fullscreen");
        fullscreen.setSelected(active);
    }
    void hideDelay(int value) {
        if (hideDelay == value) return;
        hideDelay = Math.max(1000, Math.min(10000, value));
        if (getVisibility() == VISIBLE) scheduleHide();
    }
    private void scheduleHide() {
        handler.removeCallbacks(hide);
        if (!chatOnly && !paused) handler.postDelayed(hide, hideDelay);
    }
    void sizing(String mode) {
        sizing.setContentDescription("Video size: " + mode + ". Change video size");
        sizing.setColorFilter("Fit".equals(mode) ? Color.WHITE : 0xffc4a7ff);
    }
    void reveal() { setVisibility(VISIBLE); scheduleHide(); handler.removeCallbacks(tick); tick.run(); }
    void toggle() { if (getVisibility() == VISIBLE && !chatOnly) { handler.removeCallbacks(hide); setVisibility(GONE); } else reveal(); }
    void dismiss() { if (optionsMenu != null) optionsMenu.dismiss(); handler.removeCallbacks(hide); handler.removeCallbacks(tick); setVisibility(GONE); }
    @Override protected void onDetachedFromWindow() { handler.removeCallbacks(hide); handler.removeCallbacks(tick); super.onDetachedFromWindow(); }
}
