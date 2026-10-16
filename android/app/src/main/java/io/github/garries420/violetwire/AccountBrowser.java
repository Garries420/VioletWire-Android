package io.github.garries420.violetwire;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Provider pages have no Capacitor bridge or JavaScript interface. Only native
 * cookie reads and narrowly scoped Kick API requests cross this boundary. */
final class AccountBrowser {
    interface Completion { void complete(String token); }
    interface Response { void complete(JSObject result); void fail(String message); }
    private final Activity activity;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Dialog dialog;
    private WebView loginView, kickView;
    private Completion completion;
    private Runnable cookiePoll;
    private boolean kickReady;
    private TextView status;
    private String browserHeading;

    AccountBrowser(Activity activity) { this.activity = activity; }
    static boolean allowed(String address, String provider) {
        Uri uri = Uri.parse(address); String host = uri.getHost();
        if (!"https".equals(uri.getScheme()) || host == null || uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return false;
        String domain = provider.equals("kick") ? "kick.com" : "twitch.tv";
        return host.equals(domain) || host.endsWith("." + domain);
    }
    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private WebView browser(String provider) {
        WebView view = new WebView(activity);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
        view.setBackgroundColor(activity.getSharedPreferences("image-cache", android.content.Context.MODE_PRIVATE).getBoolean("oledMode", false) ? Color.BLACK : 0xff0e0e10);
        view.setWebChromeClient(new WebChromeClient());
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Keep provider authorization in this window. Never invoke an
                // installed Twitch/Kick app via an intent:// or deep link.
                boolean reject = !allowed(request.getUrl().toString(), provider);
                if (reject && dialog != null) android.widget.Toast.makeText(activity,
                    "Use the provider's email/password sign-in in this window.", android.widget.Toast.LENGTH_LONG).show();
                return reject;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (view == kickView) kickReady = false;
                if (view == loginView && status != null) { status.setText(browserHeading != null ? "Loading channel points…" : "Loading sign-in…"); status.setVisibility(android.view.View.VISIBLE); }
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (view == loginView && status != null && (status.getText().toString().equals("Loading sign-in…") || status.getText().toString().equals("Loading channel points…"))) status.setVisibility(android.view.View.GONE);
                if (view == kickView) kickReady = kickOrigin(url);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && view == loginView && status != null) { status.setText("Sign-in could not load. Close this window and try again after checking your connection."); status.setVisibility(android.view.View.VISIBLE); }
            }
        });
        return view;
    }
    void open(String provider, String url, boolean capture, Completion done) {
        open(provider, url, capture, done, null);
    }
    void open(String provider, String url, boolean capture, Completion done, String headingText) {
        close(); completion = done; browserHeading = headingText;
        loginView = provider.equals("kick") ? getKickView() : browser("twitch");
        if (headingText != null) {
            // Twitch's complete reward center is its desktop popout route.
            // Preserve this WebView's actual Chrome version while removing the
            // mobile markers that otherwise redirect it to the mobile site.
            String agent = WebSettings.getDefaultUserAgent(activity).replaceFirst("\\([^)]*\\)", "(X11; Linux x86_64)")
                .replace(" Mobile", "").replace(" Version/4.0", "");
            loginView.getSettings().setUserAgentString(agent);
        }
        if (loginView.getParent() != null) ((ViewGroup) loginView.getParent()).removeView(loginView);
        LinearLayout root = new LinearLayout(activity); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(activity.getSharedPreferences("image-cache", android.content.Context.MODE_PRIVATE).getBoolean("oledMode", false) ? Color.BLACK : 0xff121015);
        LinearLayout heading = new LinearLayout(activity); heading.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(activity); title.setText(headingText != null ? headingText : provider.equals("kick") ? "Sign in to Kick · id.kick.com" : "Sign in to Twitch · twitch.tv");
        title.setTextColor(Color.WHITE); title.setTextSize(15); title.setPadding(16, 12, 0, 12);
        heading.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        Button close = new Button(activity); close.setText("Close"); close.setContentDescription(headingText != null ? "Close channel points" : "Close sign-in"); close.setOnClickListener(v -> close()); heading.addView(close);
        root.addView(heading);
        status = new TextView(activity); status.setTextColor(0xffc4a7ff); status.setTextSize(13); status.setPadding(16, 8, 16, 8); status.setText(headingText != null ? "Loading channel points…" : "Loading sign-in…"); root.addView(status);
        root.addView(loginView, new LinearLayout.LayoutParams(-1, 0, 1));
        dialog = new Dialog(activity); dialog.setContentView(root); dialog.setOnDismissListener(d -> finish(null));
        dialog.show(); dialog.getWindow().setLayout(-1, -1);
        loginView.loadUrl(url);
        if (capture) {
            cookiePoll = new Runnable() {
                public void run() {
                    if (dialog == null) return;
                    String token = cookie(provider.equals("kick") ? "https://kick.com" : "https://www.twitch.tv", provider.equals("kick") ? "session_token" : "auth-token");
                    if (token != null && !token.isEmpty()) { CookieManager.getInstance().flush(); finish(token); }
                    else handler.postDelayed(this, 1000);
                }
            };
            handler.postDelayed(cookiePoll, 1000);
        }
    }
    private void finish(String token) {
        Completion done = completion; completion = null;
        if (cookiePoll != null) handler.removeCallbacks(cookiePoll); cookiePoll = null;
        Dialog old = dialog; dialog = null;
        if (old != null) { old.setOnDismissListener(null); old.dismiss(); }
        if (loginView != null && loginView.getParent() != null) ((ViewGroup) loginView.getParent()).removeView(loginView);
        if (loginView != null && loginView != kickView) { loginView.stopLoading(); loginView.destroy(); }
        // The session cookie may be set on id.kick.com before its redirect.
        // Relative account API requests must wait for the actual Kick origin.
        if (token != null && loginView == kickView && !kickOrigin(kickView.getUrl())) {
            kickReady = false; kickView.loadUrl("https://kick.com/");
        }
        loginView = null;
        status = null;
        if (done != null) done.complete(token);
    }
    void close() { finish(null); }
    private WebView getKickView() {
        if (kickView == null) { kickView = browser("kick"); kickView.loadUrl("https://kick.com/"); }
        return kickView;
    }
    static boolean kickOrigin(String address) {
        if (address == null || !allowed(address, "kick")) return false;
        String host = Uri.parse(address).getHost();
        return "kick.com".equals(host) || "www.kick.com".equals(host);
    }
    static String cookie(String url, String name) {
        String cookies = CookieManager.getInstance().getCookie(url);
        if (cookies == null) return null;
        for (String entry : cookies.split(";")) {
            String[] pair = entry.trim().split("=", 2);
            if (pair.length == 2 && name.equals(pair[0])) {
                try { return URLDecoder.decode(pair[1], StandardCharsets.UTF_8.name()); } catch (Exception ignored) { return null; }
            }
        }
        return null;
    }
    void clear(String provider) {
        close();
        String[] hosts = provider.equals("kick") ? new String[]{"kick.com", "www.kick.com", "id.kick.com"} : new String[]{"twitch.tv", "www.twitch.tv", "id.twitch.tv"};
        CookieManager jar = CookieManager.getInstance();
        for (String host : hosts) {
            android.webkit.WebStorage.getInstance().deleteOrigin("https://" + host);
            String cookies = jar.getCookie("https://" + host);
            if (cookies == null) continue;
            for (String entry : cookies.split(";")) {
                String name = entry.trim().split("=", 2)[0];
                for (String domain : new String[]{host, "." + host, provider.equals("kick") ? ".kick.com" : ".twitch.tv"})
                    jar.setCookie("https://" + host, name + "=; Max-Age=0; Path=/; Secure; Domain=" + domain);
                jar.setCookie("https://" + host, name + "=; Max-Age=0; Path=/; Secure");
            }
        }
        jar.flush();
        if (provider.equals("kick") && kickView != null) { kickView.destroy(); kickView = null; kickReady = false; }
    }
    void kickRequest(String path, String method, String body, String token, Response callback) {
        WebView view = getKickView(); String key = "vw_" + UUID.randomUUID().toString().replace("-", "");
        long deadline = android.os.SystemClock.elapsedRealtime() + 20000;
        Runnable start = new Runnable() {
            public void run() {
                if (view != kickView) { callback.fail("Kick session changed. Retry the request."); return; }
                if (!kickReady || !kickOrigin(view.getUrl())) {
                    if (android.os.SystemClock.elapsedRealtime() >= deadline) { callback.fail("Kick could not load. Check your connection and try signing in again."); return; }
                    handler.postDelayed(this, 250); return;
                }
                // JSON quoting protects all message text, slugs, and credentials.
                String script = "(()=>{const key=" + JSONObject.quote(key) + ";window[key]=null;fetch(" + JSONObject.quote((path.equals("/viewer/v1/token") ? "https://websockets.kick.com" : "https://kick.com") + path) +
                    ",{method:" + JSONObject.quote(method) + ",credentials:'include',redirect:'error',headers:{Accept:'application/json','Content-Type':'application/json','x-app-platform':'web'" +
                    (path.equals("/viewer/v1/token") ? ",\"X-CLIENT-TOKEN\":\"e1393935a959b4020a4491574f6490129f678acdaa92760471263db43487f823\"" : "") +
                    (token.isEmpty() ? "" : ",Authorization:" + JSONObject.quote("Bearer " + token)) + "},body:" + (body == null ? "undefined" : JSONObject.quote(body)) +
                    "}).then(async r=>{window[key]=JSON.stringify({status:r.status,data:await r.text()})}).catch(()=>{window[key]=JSON.stringify({status:0,data:''})})})()";
                view.evaluateJavascript(script, ignored -> pollResult(view, key, deadline, callback));
            }
        };
        handler.post(start);
    }
    private void pollResult(WebView view, String key, long deadline, Response callback) {
        if (view != kickView) { callback.fail("Kick session changed. Retry the request."); return; }
        if (android.os.SystemClock.elapsedRealtime() >= deadline) { view.evaluateJavascript("delete window[" + JSONObject.quote(key) + "]", null); callback.fail("Kick request timed out."); return; }
        view.evaluateJavascript("window[" + JSONObject.quote(key) + "]", value -> {
            if ("null".equals(value) || value == null) { handler.postDelayed(() -> pollResult(view, key, deadline, callback), 200); return; }
            try {
                String json = (String) new org.json.JSONTokener(value).nextValue();
                JSObject result = new JSObject(json); view.evaluateJavascript("delete window[" + JSONObject.quote(key) + "]", null);
                callback.complete(result);
            } catch (Exception error) { callback.fail("Kick returned an invalid response."); }
        });
    }
    void destroy() { close(); if (kickView != null) { kickView.destroy(); kickView = null; } }
}
