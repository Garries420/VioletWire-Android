package io.github.garries420.violetwire;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.RectF;
import android.graphics.Region;
import android.util.AttributeSet;
import android.view.MotionEvent;
import androidx.media3.ui.PlayerView;

/** A texture surface lets WebView chat popups cover only their own area. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class PopupPlayerView extends PlayerView {
    private RectF[] occlusions = new RectF[0];
    public PopupPlayerView(Context context, AttributeSet attrs) { super(context, attrs); }
    void occlusions(RectF[] values) { occlusions = values; invalidate(); }
    @Override @SuppressWarnings("deprecation") public void draw(Canvas canvas) {
        int save = canvas.save();
        for (RectF rect : occlusions) canvas.clipRect(rect, Region.Op.DIFFERENCE);
        super.draw(canvas); canvas.restoreToCount(save);
    }
    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        for (RectF rect : occlusions) if (rect.contains(event.getX(), event.getY())) return false;
        return super.dispatchTouchEvent(event);
    }
}
