package io.github.garries420.violetwire;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.util.Collections;
import android.os.Bundle;
import android.content.res.Configuration;
import android.os.Build;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private boolean playerFullscreen;
    private boolean keyboardAnimating;
    private int keyboardBottom;
    private boolean keyboardVisible;
    private Insets safeInsets = Insets.NONE;
    private EmoteImageCache emoteCache;
    EmoteImageCache emoteCache() { return emoteCache; }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VioletNativePlugin.class);
        super.onCreate(savedInstanceState);
        emoteCache = new EmoteImageCache(new File(getCacheDir(), "emote-images"));
        emoteCache.dataSaver(getSharedPreferences("image-cache", MODE_PRIVATE).getBoolean("dataSaver", false));
        // Emotes have their own bounded store. Prevent a second, unmeasurable
        // HTTP cache from retaining the same artwork or stream thumbnails.
        getBridge().getWebView().getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
                android.net.Uri origin = android.net.Uri.parse(getBridge().getLocalUrl());
                if (origin.getScheme().equals(request.getUrl().getScheme()) && origin.getAuthority().equals(request.getUrl().getAuthority())
                    && "/__emote".equals(request.getUrl().getPath())) {
                    try {
                        if (!"GET".equals(request.getMethod())) throw new java.io.IOException("Invalid image method");
                        String address = request.getUrl().getQueryParameter("src");
                        VioletNativePlugin player = nativePlayer();
                        EmoteImageCache.Image image = player == null ? null : player.savedArtwork(address);
                        if (image == null) image = emoteCache.image(address);
                        return new WebResourceResponse(image.mime, null, 200, "OK", Collections.singletonMap("Cache-Control", "no-store"), image.stream);
                    } catch (Exception error) {
                        return new WebResourceResponse("text/plain", "UTF-8", 404, "Image unavailable", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(new byte[0]));
                    }
                }
                return super.shouldInterceptRequest(webView, request);
            }
        });
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        // Android 11+ reports every IME frame. Move the WebView with that frame
        // rather than jumping straight to its final height before the keyboard slides.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            ViewCompat.setWindowInsetsAnimationCallback(getWindow().getDecorView(),
                new WindowInsetsAnimationCompat.Callback(WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                    @Override public void onPrepare(WindowInsetsAnimationCompat animation) {
                        if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) keyboardAnimating = true;
                    }
                    @Override public WindowInsetsCompat onProgress(WindowInsetsCompat insets, List<WindowInsetsAnimationCompat> animations) {
                        if (keyboardAnimating) applyWindowPadding(insets.getInsets(WindowInsetsCompat.Type.ime()).bottom);
                        return insets;
                    }
                    @Override public void onEnd(WindowInsetsAnimationCompat animation) {
                        if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) {
                            keyboardAnimating = false; applyWindowPadding(keyboardBottom);
                        }
                    }
                });
        }
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (decor, insets) -> {
            Insets safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            safeInsets = safe;
            Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean nextKeyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            if (keyboardVisible != nextKeyboardVisible) {
                keyboardVisible = nextKeyboardVisible;
                VioletNativePlugin plugin = nativePlayer();
                if (plugin != null) plugin.keyboardVisibilityChanged(keyboardVisible);
            }
            keyboardBottom = keyboard.bottom;
            if (!keyboardAnimating) applyWindowPadding(keyboardBottom);
            VioletNativePlugin plugin = nativePlayer();
            if (plugin != null) plugin.windowInsetsChanged();
            // Insets are applied here once, rather than also shrinking the WebView.
            return new WindowInsetsCompat.Builder(insets).setInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime(), Insets.NONE).build();
        });
    }
    private void applyWindowPadding(int imeBottom) {
        var decor = getWindow().getDecorView();
        decor.setPadding(playerFullscreen ? 0 : safeInsets.left, playerFullscreen ? 0 : safeInsets.top,
            playerFullscreen ? 0 : safeInsets.right, Math.max(playerFullscreen ? 0 : safeInsets.bottom, imeBottom));
        VioletNativePlugin plugin = nativePlayer();
        if (plugin != null) plugin.windowInsetsChanged();
    }
    Insets playerSafeInsets() { return playerFullscreen ? safeInsets : Insets.NONE; }

    void setPlayerFullscreen(boolean active) {
        playerFullscreen = active;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = active
                ? Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            getWindow().setAttributes(attributes);
        }
        ViewCompat.requestApplyInsets(getWindow().getDecorView());
    }

    private VioletNativePlugin nativePlayer() {
        var handle = getBridge() == null ? null : getBridge().getPlugin("VioletNative");
        return handle == null ? null : (VioletNativePlugin) handle.getInstance();
    }

    @Override public void onUserLeaveHint() {
        super.onUserLeaveHint();
        var plugin = nativePlayer();
        if (plugin != null) plugin.leaveForPictureInPicture();
    }

    @Override public void onPictureInPictureModeChanged(boolean active, Configuration config) {
        super.onPictureInPictureModeChanged(active, config);
        var plugin = nativePlayer();
        if (plugin != null) plugin.pictureInPictureChanged(active);
    }
}
