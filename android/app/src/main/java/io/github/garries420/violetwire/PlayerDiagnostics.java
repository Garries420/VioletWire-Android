package io.github.garries420.violetwire;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.ImageButton;
import android.widget.ScrollView;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

/** Diagnostics are sampled from the actual Android player while the dialog is open. */
final class PlayerDiagnostics {
    private final Dialog dialog;
    private final Handler handler = new Handler(Looper.getMainLooper());
    PlayerDiagnostics(Activity activity, Supplier<Map<String, String>> values) {
        dialog = new Dialog(activity);
        float density = activity.getResources().getDisplayMetrics().density;
        LinearLayout root = new LinearLayout(activity); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(Math.round(12 * density), Math.round(8 * density), Math.round(12 * density), Math.round(8 * density)); root.setBackgroundColor(0xff121017);
        LinearLayout heading = new LinearLayout(activity); heading.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(activity); title.setText("VIDEO PLAYER STATS"); title.setTextColor(Color.WHITE); title.setTextSize(14);
        heading.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        ImageButton close = new ImageButton(activity); close.setImageResource(android.R.drawable.ic_menu_close_clear_cancel); close.setColorFilter(Color.WHITE); close.setBackgroundColor(Color.TRANSPARENT); close.setContentDescription("Close video player stats"); close.setOnClickListener(v -> dialog.dismiss()); heading.addView(close, new LinearLayout.LayoutParams(Math.round(44 * density), Math.round(44 * density))); root.addView(heading);
        Map<String, TextView> rows = new LinkedHashMap<>();
        for (String label : values.get().keySet()) {
            LinearLayout row = new LinearLayout(activity); row.setPadding(0, 5, 0, 5);
            TextView name = new TextView(activity); name.setText(label); name.setTextColor(0xffa6a0af); name.setTextSize(13); row.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
            TextView value = new TextView(activity); value.setTextColor(Color.WHITE); value.setTextSize(13); row.addView(value); rows.put(label, value); root.addView(row);
        }
        ScrollView scroll = new ScrollView(activity); scroll.addView(root); dialog.setContentView(scroll); dialog.setOnDismissListener(d -> handler.removeCallbacksAndMessages(null)); dialog.show();
        int width = Math.min(Math.round(360 * activity.getResources().getDisplayMetrics().density), activity.getResources().getDisplayMetrics().widthPixels - 32);
        dialog.getWindow().setLayout(width, -2); dialog.getWindow().setGravity(Gravity.CENTER);
        Runnable tick = new Runnable() { public void run() { if (!dialog.isShowing()) return; Map<String, String> sample = values.get(); for (Map.Entry<String, TextView> row : rows.entrySet()) row.getValue().setText(sample.get(row.getKey())); handler.postDelayed(this, 1000); } }; tick.run();
    }
    void close() { dialog.dismiss(); }
}
