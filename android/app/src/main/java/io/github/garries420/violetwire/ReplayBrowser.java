package io.github.garries420.violetwire;

import android.app.Activity;
import android.app.Dialog;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Button;
import org.json.JSONObject;
import java.util.Map;
import java.util.function.Consumer;

/** Obtain Twitch's own short-lived replay request headers from its website.
 * Provider pages never receive the application bridge. Account cookies are retained. */
final class ReplayBrowser {
    private final Activity activity;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Dialog dialog;
    private WebView browser;
    private Consumer<String> completion;
    ReplayBrowser(Activity activity) { this.activity = activity; }
    static JSONObject saved(android.content.Context context) throws Exception {
        String raw = new SecureTokenStore(context).read("twitch-replay");
        if (raw == null) return null;
        JSONObject data = new JSONObject(raw);
        return data.optLong("expires") > System.currentTimeMillis() ? data.getJSONObject("headers") : null;
    }
    static JSONObject captured(String url, Map<String, String> requestHeaders, String userAgent) throws Exception {
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme()) || !"gql.twitch.tv".equals(uri.getHost()) || !"/gql".equals(uri.getPath()) || uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return null;
        JSONObject headers = new JSONObject();
        for (Map.Entry<String, String> entry : requestHeaders.entrySet()) {
            for (String name : new String[]{"Client-Integrity", "X-Device-Id", "Client-ID", "Client-Version", "Client-Session-Id", "X-Kpsdk-Ct", "X-Kpsdk-St", "X-Kpsdk-V", "Sec-Fetch-Site", "Sec-Fetch-Mode", "Sec-Fetch-Dest", "Sec-CH-UA", "Sec-CH-UA-Mobile", "Sec-CH-UA-Platform", "Accept", "Accept-Language", "User-Agent", "Origin", "Referer"}) {
                if (name.equalsIgnoreCase(entry.getKey()) && entry.getValue().length() < 16384) headers.put(name, entry.getValue());
            }
        }
        if (headers.optString("Client-Integrity").isEmpty() || headers.optString("X-Device-Id").isEmpty()) return null;
        if (!headers.has("User-Agent")) headers.put("User-Agent", userAgent);
        if (!headers.has("Origin")) headers.put("Origin", "https://www.twitch.tv");
        if (!headers.has("Referer")) headers.put("Referer", "https://www.twitch.tv/");
        return headers;
    }
    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    void open(boolean refresh, Consumer<String> done) {
        if (completion != null) { done.accept("Twitch replay connection is already open."); return; }
        try { if (!refresh && saved(activity) != null) { done.accept(null); return; } } catch (Exception ignored) {}
        completion = done;
        browser = new WebView(activity); WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); settings.setMediaPlaybackRequiresUserGesture(true);
        final String userAgent = settings.getUserAgentString();
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !AccountBrowser.allowed(request.getUrl().toString(), "twitch"); }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                try {
                    JSONObject headers = captured(request.getUrl().toString(), request.getRequestHeaders(), userAgent);
                    if (headers != null) handler.post(() -> {
                        if (completion == null) return;
                        try { new SecureTokenStore(activity).write("twitch-replay", new JSONObject().put("expires", System.currentTimeMillis() + 6 * 60 * 60 * 1000L).put("headers", headers).toString()); finish(null); }
                        catch (Exception error) { finish("Twitch replay connection could not be saved."); }
                    });
                } catch (Exception ignored) {}
                return null;
            }
        });
        LinearLayout root = new LinearLayout(activity); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(0xff121015);
        LinearLayout heading = new LinearLayout(activity); TextView title = new TextView(activity); title.setText("Connect Twitch chat replay"); title.setTextColor(0xffffffff); title.setTextSize(16); title.setPadding(16, 16, 0, 16); heading.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        Button close = new Button(activity); close.setText("Close"); close.setOnClickListener(v -> finish("Twitch chat replay connection was cancelled.")); heading.addView(close); root.addView(heading);
        TextView explanation = new TextView(activity); explanation.setText("Loading Twitch · this window closes automatically when replay chat is ready."); explanation.setTextColor(0xffc4a7ff); explanation.setPadding(16, 8, 16, 8); root.addView(explanation); root.addView(browser, new LinearLayout.LayoutParams(-1, 0, 1));
        dialog = new Dialog(activity); dialog.setContentView(root); dialog.setOnDismissListener(d -> finish("Twitch chat replay connection was cancelled.")); dialog.show(); dialog.getWindow().setLayout(-1, -1);
        browser.loadUrl("https://www.twitch.tv/login");
        handler.postDelayed(() -> finish("Twitch replay connection timed out. Try again with a working connection."), 45000);
    }
    private void finish(String error) {
        Consumer<String> done = completion; completion = null; handler.removeCallbacksAndMessages(null);
        if (dialog != null) { dialog.setOnDismissListener(null); dialog.dismiss(); dialog = null; }
        if (browser != null) { browser.stopLoading(); browser.destroy(); browser = null; }
        if (done != null) done.accept(error);
    }
    void close() { finish("Twitch replay connection was closed."); }
}
