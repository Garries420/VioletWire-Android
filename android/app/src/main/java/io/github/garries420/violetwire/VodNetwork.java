package io.github.garries420.violetwire;
import android.content.Context;
import org.json.JSONObject;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/** Requests replay from Twitch only. Never forwards account authorization to a CDN. */
final class VodNetwork {
    interface PageRequest { JSONObject request(String cursor, int offset) throws Exception; }
    static JSONObject comments(Context context, String id, String cursor, int offset) throws Exception {
        return page(cursor, offset, ReplayBrowser.saved(context) != null, (after, seconds) -> request(context, id, after, seconds));
    }
    static JSONObject page(String cursor, int offset, boolean connected, PageRequest request) throws Exception {
        boolean byOffset = false; String knownBoundaryId = "";
        if (cursor.startsWith("offset:")) {
            int separator = cursor.indexOf(':', 7); if (separator < 0) throw new java.io.IOException("Invalid replay checkpoint.");
            offset = Integer.parseInt(cursor.substring(7, separator)); cursor = cursor.substring(separator + 1);
            int identity = cursor.indexOf(':'); if (identity >= 0) { knownBoundaryId = java.net.URLDecoder.decode(cursor.substring(0, identity), "UTF-8"); cursor = cursor.substring(identity + 1); }
            byOffset = !connected;
        }
        JSONObject comments;
        try { comments = request.request(byOffset ? "" : cursor, offset); }
        catch (java.io.IOException error) {
            if (cursor.isEmpty() || !error.getMessage().toLowerCase(java.util.Locale.ROOT).contains("integrity")) throw error;
            // Re-read the boundary second using Twitch's public seek-by-time API.
            comments = request.request("", offset); byOffset = true;
        }
        if (byOffset) {
            org.json.JSONArray edges = comments.getJSONArray("edges");
            double last = edges.length() == 0 ? offset : edges.getJSONObject(edges.length() - 1).getJSONObject("node").optDouble("contentOffsetSeconds");
            if (comments.getJSONObject("pageInfo").optBoolean("hasNextPage") && Math.floor(last) <= offset) {
                String boundaryId = !knownBoundaryId.isEmpty() ? knownBoundaryId : edges.length() == 0 ? "" : edges.getJSONObject(edges.length() - 1).getJSONObject("node").optString("id");
                JSONObject following = request.request("", offset + 1); org.json.JSONArray nextEdges = following.getJSONArray("edges");
                boolean overlap = false; double nextLast = last;
                for (int i = 0; i < nextEdges.length(); i++) { JSONObject node = nextEdges.getJSONObject(i).getJSONObject("node"); if (!boundaryId.isEmpty() && boundaryId.equals(node.optString("id"))) overlap = true; nextLast = node.optDouble("contentOffsetSeconds"); }
                // Some offsets select the same server chunk. Moving a second
                // is safe only when that exact boundary message appears again.
                if (!overlap || Math.floor(nextLast) <= offset) throw new java.io.IOException("Twitch replay needs a website connection to continue this busy chat section. Resume and connect Twitch replay to retry.");
                for (int i = 0; i < nextEdges.length(); i++) edges.put(nextEdges.getJSONObject(i));
                comments.put("edges", edges); comments.put("pageInfo", following.getJSONObject("pageInfo"));
            }
            comments.put("offsetPaging", true);
        }
        return comments;
    }
    private static JSONObject request(Context context, String id, String cursor, int offset) throws Exception {
        JSONObject variables = new JSONObject().put("videoID", id).put("cursor", cursor.isEmpty() ? JSONObject.NULL : cursor).put("contentOffsetSeconds", cursor.isEmpty() ? offset : JSONObject.NULL);
        HttpsURLConnection connection = (HttpsURLConnection) new URL("https://gql.twitch.tv/gql").openConnection();
        connection.setConnectTimeout(15000); connection.setReadTimeout(20000); connection.setInstanceFollowRedirects(false); connection.setRequestMethod("POST"); connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json"); connection.setRequestProperty("Client-ID", "kimne78kx3ncx6brgo4mv6wki5h1ko");
        JSONObject replayHeaders = ReplayBrowser.saved(context);
        if (replayHeaders != null) { java.util.Iterator<String> keys = replayHeaders.keys(); while (keys.hasNext()) { String name = keys.next(); connection.setRequestProperty(name, replayHeaders.getString(name)); } }
        String saved = new SecureTokenStore(context).read("twitch-playback"); if (saved != null) connection.setRequestProperty("Authorization", "OAuth " + new JSONObject(saved).getString("token"));
        byte[] body = new JSONObject().put("operationName", "VideoCommentsByOffsetOrCursor").put("variables", variables).put("extensions", new JSONObject().put("persistedQuery", new JSONObject().put("version", 1).put("sha256Hash", "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a"))).toString().getBytes(StandardCharsets.UTF_8);
        try {
            try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body); }
            if (connection.getResponseCode() != 200) throw new java.io.IOException("Twitch chat replay refused the request (" + connection.getResponseCode() + "). Resume to retry.");
            ByteArrayOutputStream result = new ByteArrayOutputStream(); try (InputStream input = connection.getInputStream()) { byte[] bytes = new byte[8192]; int count; while ((count = input.read(bytes)) != -1) { if (result.size() + count > 1024 * 1024) throw new java.io.IOException("Chat replay response is too large."); result.write(bytes, 0, count); } }
            JSONObject payload = new JSONObject(result.toString(StandardCharsets.UTF_8.name()));
            if (payload.optJSONArray("errors") != null && payload.getJSONArray("errors").length() > 0) {
                String message = payload.getJSONArray("errors").getJSONObject(0).optString("message", "provider error");
                if (message.toLowerCase(java.util.Locale.ROOT).contains("integrity")) new SecureTokenStore(context).remove("twitch-replay");
                throw new java.io.IOException("Twitch chat replay is unavailable: " + message);
            }
            JSONObject video = payload.getJSONObject("data").optJSONObject("video"); if (video == null) throw new java.io.IOException("This Twitch VOD is unavailable.");
            JSONObject comments = video.optJSONObject("comments"); if (comments == null) return new JSONObject().put("edges", new org.json.JSONArray()).put("pageInfo", new JSONObject().put("hasNextPage", false));
            return comments;
        } finally { connection.disconnect(); }
    }
}
