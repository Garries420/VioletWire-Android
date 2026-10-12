package io.github.garries420.violetwire;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.annotation.OptIn;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.database.DatabaseProvider;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.NoOpCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadCursor;
import androidx.media3.exoplayer.offline.DownloadManager;
import androidx.media3.exoplayer.offline.DownloadRequest;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.HashSet;
import java.util.Set;

/** Durable segment downloads and independently checkpointed chat in app storage. */
@OptIn(markerClass = UnstableApi.class)
final class VodDownloads {
    private static VodDownloads instance;
    static synchronized VodDownloads get(Context context) { if (instance == null) instance = new VodDownloads(context.getApplicationContext()); return instance; }
    final DownloadManager manager;
    private final SimpleCache cache;
    private final Context context;
    private final SharedPreferences records;
    private final File root;
    private final android.database.sqlite.SQLiteDatabase db;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Set<String> running = new HashSet<>();
    interface ReplayTransport { JSONObject comments(String id, String cursor, int offset) throws Exception; }
    private final ReplayTransport replay;
    private final java.util.concurrent.ConcurrentHashMap<String, EmoteImageCache> artwork = new java.util.concurrent.ConcurrentHashMap<>();
    private static final class Database extends android.database.sqlite.SQLiteOpenHelper implements DatabaseProvider {
        Database(Context context, String name) { super(context, name + ".db", null, 1); }
        @Override public void onCreate(android.database.sqlite.SQLiteDatabase db) {}
        @Override public void onUpgrade(android.database.sqlite.SQLiteDatabase db, int oldVersion, int newVersion) {}
    }
    private VodDownloads(Context context) { this(context, "saved-vods", new DefaultHttpDataSource.Factory().setConnectTimeoutMs(15000).setReadTimeoutMs(15000), (id, cursor, offset) -> VodNetwork.comments(context, id, cursor, offset)); }
    VodDownloads(Context context, String namespace, androidx.media3.datasource.DataSource.Factory network, ReplayTransport replay) {
        this.context = context; this.replay = replay; records = context.getSharedPreferences(namespace + "-records", Context.MODE_PRIVATE); root = new File(context.getFilesDir(), namespace); root.mkdirs();
        Database database = new Database(context, namespace);
        db = database.getWritableDatabase();
        db.execSQL("CREATE TABLE IF NOT EXISTS VioletVodChat (id TEXT NOT NULL, at INTEGER NOT NULL, size INTEGER NOT NULL, first REAL NOT NULL, last REAL NOT NULL, PRIMARY KEY(id, at))");
        cache = new SimpleCache(new File(root, "video-cache"), new NoOpCacheEvictor(), database);
        manager = new DownloadManager(context, database, cache, network, Runnable::run);
        manager.setMaxParallelDownloads(2); manager.setMinRetryCount(3);
        manager.pauseDownloads();
        manager.addListener(new DownloadManager.Listener() {
            @Override public void onInitialized(DownloadManager manager) {
                if (namespace.equals("saved-vods") && hasWork()) VodDownloadService.start(context);
            }
            @Override public void onDownloadChanged(DownloadManager manager, Download download, Exception error) {
                if (error != null) { JSONObject record = read(download.request.id); if (record != null) { put(record, "error", "Video download failed. Check storage and connection, then resume."); write(download.request.id, record); } }
            }
            @Override public void onDownloadRemoved(DownloadManager manager, Download download) {
                String id = download.request.id; worker.execute(() -> { chatFile(id).delete(); db.delete("VioletVodChat", "id=?", new String[]{id}); EmoteImageCache pictures = artwork.remove(id); if (pictures != null) { try { pictures.clear(); } catch (Exception ignored) {} } File folder = new File(root, id + "-artwork"); File[] files = folder.listFiles(); if (files != null) for (File file : files) file.delete(); folder.delete(); }); records.edit().remove(id).commit();
            }
        });
    }
    static boolean validId(String id) { return id != null && id.matches("[0-9]{1,20}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"); }
    static boolean mediaUrl(String address) {
        Uri uri = Uri.parse(address); String host = uri.getHost();
        return "https".equals(uri.getScheme()) && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443) && host != null &&
            (host.equals("stream.kick.com") || host.equals("ttvnw.net") || host.endsWith(".ttvnw.net") || host.endsWith(".cloudfront.net"));
    }
    synchronized JSONObject read(String id) { try { String value = records.getString(id, null); return value == null ? null : new JSONObject(value); } catch (Exception ignored) { return null; } }
    private synchronized void write(String id, JSONObject record) { if (!records.edit().putString(id, record.toString()).commit()) throw new IllegalStateException("Download metadata could not be saved."); }
    private static void put(JSONObject record, String key, Object value) { try { record.put(key, value); } catch (Exception error) { throw new IllegalStateException(error); } }
    void add(String id, String url, JSONObject video, String quality, boolean chat, JSONObject assets) throws Exception {
        add(id, url, video, quality, chat, assets, null);
    }
    void cacheClip(String id, VodClipPlaylist clip) throws Exception {
        byte[] bytes = clip.text.getBytes(StandardCharsets.UTF_8);
        androidx.media3.datasource.DataSource data = new CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(() -> new androidx.media3.datasource.ByteArrayDataSource(bytes)).createDataSource();
        try { data.open(new androidx.media3.datasource.DataSpec(Uri.parse(clipAddress(id)))); byte[] buffer = new byte[8192]; while(data.read(buffer,0,buffer.length)!=androidx.media3.common.C.RESULT_END_OF_INPUT) {} } finally { data.close(); }
    }
    private static String clipAddress(String id) { return "https://downloads.violetwire.invalid/" + id + "/index.m3u8"; }
    void add(String id, String url, JSONObject video, String quality, boolean chat, JSONObject assets, VodClipPlaylist clip) throws Exception {
        if (!validId(id) || !mediaUrl(url)) throw new IllegalArgumentException("Invalid VOD download.");
        if (read(id) != null) throw new IllegalArgumentException("This VOD is already in Downloads. Resume or delete it there.");
        if (root.getUsableSpace() < 256L * 1024 * 1024) throw new IllegalArgumentException("Free at least 256 MB of phone storage before downloading.");
        JSONObject record = new JSONObject(); record.put("video", video); record.put("quality", quality); record.put("paused", false); record.put("chatState", chat ? "queued" : "disabled"); record.put("chatPercent", chat ? 0 : 100); record.put("chatBytes", 0); record.put("assets", assets);
        if(clip != null) { record.put("clipStart",clip.start);record.put("clipEnd",clip.end); }
        write(id, record); manager.addDownload(new DownloadRequest.Builder(id, Uri.parse(clip == null ? url : clipAddress(id))).setMimeType(MimeTypes.APPLICATION_M3U8).build()); manager.resumeDownloads(); pumpChat();
    }
    void control(String id, String action) throws Exception {
        JSONObject record = read(id); if (!validId(id) || record == null) throw new IllegalArgumentException("Saved VOD was not found.");
        if (action.equals("delete")) { put(record, "paused", true); put(record, "deleting", true); write(id, record); manager.removeDownload(id); return; }
        boolean paused = action.equals("pause"); if (!paused && !action.equals("resume")) throw new IllegalArgumentException("Invalid download action.");
        put(record, "paused", paused); if (!paused) { record.remove("error"); if (record.optString("chatState").equals("error")) put(record, "chatState", "queued"); }
        write(id, record); manager.setStopReason(id, paused ? 1 : 0); if (!paused) { Download current = manager.getDownloadIndex().getDownload(id); if (current != null && current.state == Download.STATE_FAILED) manager.addDownload(current.request); manager.resumeDownloads(); pumpChat(); }
    }
    JSObject list() throws Exception {
        JSArray items = new JSArray();
        try (DownloadCursor cursor = manager.getDownloadIndex().getDownloads()) {
            while (cursor.moveToNext()) {
                Download download = cursor.getDownload(); JSONObject record = read(download.request.id); if (record == null) continue;
                String state = download.state == Download.STATE_REMOVING ? "deleting" : record.optBoolean("paused") ? "paused" : download.state == Download.STATE_COMPLETED ? "completed" : download.state == Download.STATE_FAILED ? "error" : download.state == Download.STATE_DOWNLOADING ? "downloading" : "queued";
                JSObject item = new JSObject(record.toString()); item.remove("pages"); item.remove("cursor"); item.remove("assets"); item.put("id", download.request.id); item.put("state", state);
                item.put("videoPercent", download.state == Download.STATE_COMPLETED ? 100 : download.getPercentDownloaded()); item.put("bytes", download.getBytesDownloaded() + record.optLong("chatBytes") + pictures(download.request.id).usage()[0]); items.put(item);
            }
        }
        return new JSObject().put("items", items).put("freeBytes", root.getUsableSpace());
    }
    Download completed(String id) throws Exception { Download download = manager.getDownloadIndex().getDownload(id); if (download == null || download.state != Download.STATE_COMPLETED) throw new IllegalArgumentException("Wait for the video download to finish before playing offline."); return download; }
    CacheDataSource.Factory offlineFactory() { return new CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(null).setCacheWriteDataSinkFactory(null); }
    synchronized void pumpChat() {
        for (String id : records.getAll().keySet()) {
            JSONObject record = read(id); if (record == null || record.optBoolean("paused") || record.optBoolean("deleting") || !chatPending(record) || !running.add(id)) continue;
            worker.execute(() -> downloadChat(id));
        }
    }
    private File chatFile(String id) { if (!validId(id)) throw new IllegalArgumentException("Invalid VOD id"); return new File(root, id + "-chat.jsonl"); }
    private double lastChatOffset(String id, JSONObject record) {
        if (record.has("chatOffset")) return record.optDouble("chatOffset");
        try (android.database.Cursor row = db.rawQuery("SELECT MAX(last) FROM VioletVodChat WHERE id=? AND at<?", new String[]{id, String.valueOf(record.optLong("chatBytes"))})) { return row.moveToFirst() && !row.isNull(0) ? row.getDouble(0) : record.getJSONObject("video").optDouble("downloadStart",0); } catch(Exception error) { return 0; }
    }
    private String replayCheckpoint(String id, JSONObject record) throws Exception {
        String cursor = record.optString("cursor", ""); if (cursor.isEmpty()) return cursor;
        if (cursor.startsWith("offset:") && cursor.substring(7).chars().filter(c -> c == ':').count() >= 2) return cursor;
        String identity = record.optString("chatLastId");
        if (identity.isEmpty()) try (android.database.Cursor row = db.rawQuery("SELECT at,size FROM VioletVodChat WHERE id=? AND at<? ORDER BY at DESC LIMIT 1", new String[]{id, String.valueOf(record.optLong("chatBytes"))}); RandomAccessFile source = new RandomAccessFile(chatFile(id), "r")) { if (row.moveToFirst() && row.getInt(1) <= 1024 * 1024) { byte[] bytes = new byte[row.getInt(1)]; source.seek(row.getLong(0)); source.readFully(bytes); JSONArray nodes = new JSONArray(new String(bytes, StandardCharsets.UTF_8)); if (nodes.length() > 0) identity = nodes.getJSONObject(nodes.length() - 1).optString("id"); } }
        if (cursor.startsWith("offset:")) cursor = cursor.substring(cursor.indexOf(':', 7) + 1);
        return "offset:" + (long) lastChatOffset(id, record) + ":" + java.net.URLEncoder.encode(identity, "UTF-8") + ":" + cursor;
    }
    private static boolean chatPending(JSONObject record) { String state = record.optString("chatState"); return state.equals("queued") || state.equals("downloading"); }
    private EmoteImageCache pictures(String id) { if (!validId(id)) throw new IllegalArgumentException("Invalid VOD id"); return artwork.computeIfAbsent(id, key -> new EmoteImageCache(new File(root, key + "-artwork"), 32L * 1024 * 1024)); }
    EmoteImageCache.Image savedImage(String id, String address) throws Exception { return read(id) == null ? null : pictures(id).savedImage(address); }
    private void saveImages(String id, JSONArray nodes, JSONObject assets) {
        if (assets != null && !assets.optBoolean("saveArtwork", true)) return;
        java.util.Set<String> urls = new java.util.HashSet<>();
        for(int i=0;i<nodes.length();i++){JSONObject current=nodes.optJSONObject(i);JSONObject msg=current==null?null:current.optJSONObject("message");JSONArray badges=msg==null?null:msg.optJSONArray("badgeAssets");if(badges!=null)for(int j=0;j<badges.length();j++){JSONObject badge=badges.optJSONObject(j);if(badge!=null)urls.add(badge.optString("imageUrl"));}}
        java.util.Set<String> words = new java.util.HashSet<>(), usedBadges = new java.util.HashSet<>();
        for (int i = 0; i < nodes.length(); i++) { JSONObject node = nodes.optJSONObject(i); JSONObject message = node == null ? null : node.optJSONObject("message"); if (message == null) continue; JSONArray fragments = message.optJSONArray("fragments"), badges = message.optJSONArray("userBadges"); if (fragments != null) for (int j = 0; j < fragments.length(); j++) { JSONObject fragment = fragments.optJSONObject(j); if (fragment != null) java.util.Collections.addAll(words, fragment.optString("text").split("\\s+")); } if (badges != null) for (int j = 0; j < badges.length(); j++) { JSONObject badge = badges.optJSONObject(j); if (badge != null) usedBadges.add(badge.optString("setID") + "/" + badge.optString("version")); } }
        if (assets != null) {
            JSONArray badges = assets.optJSONArray("badges"); if (badges != null) for (int i = 0; i < badges.length(); i++) { JSONObject badge = badges.optJSONObject(i); if (badge != null && usedBadges.contains(badge.optString("key"))) urls.add(badge.optString("imageUrl")); }
            JSONArray sets = assets.optJSONArray("providerSets"); if (sets != null) for (int i = 0; i < sets.length(); i++) { JSONObject set = sets.optJSONObject(i); JSONArray emotes = set == null ? null : set.optJSONArray("emotes"); if (emotes == null) continue; for (int j = 0; j < emotes.length(); j++) { JSONObject emote = emotes.optJSONObject(j); if (emote == null || !words.contains(emote.optString("name"))) continue; JSONArray variants = emote.optJSONArray("variants"); if (variants != null && variants.length() > 0) { JSONObject variant = variants.optJSONObject(0); if (variant != null) urls.add(variant.optString("url")); } } }
        }
        for (int i = 0; i < nodes.length(); i++) { JSONObject node = nodes.optJSONObject(i); if (node == null) continue; JSONObject message = node.optJSONObject("message"); JSONArray fragments = message == null ? null : message.optJSONArray("fragments"); if (fragments == null) continue; for (int j = 0; j < fragments.length(); j++) { JSONObject fragment = fragments.optJSONObject(j); JSONObject emote = fragment == null ? null : fragment.optJSONObject("emote"); if (emote != null && emote.optString("emoteID").matches("[A-Za-z0-9_-]{1,100}")) urls.add(emote.optString("provider").equals("kick") ? "https://files.kick.com/emotes/" + emote.optString("emoteID") + "/fullsize" : "https://static-cdn.jtvnw.net/emoticons/v2/" + emote.optString("emoteID") + "/default/dark/2.0"); } }
        for (String url : urls) { JSONObject record = read(id); if (record == null || record.optBoolean("paused") || record.optBoolean("deleting")) return; if (!EmoteImageCache.allowed(url)) continue; try { EmoteImageCache.Image image = pictures(id).image(url); image.stream.close(); } catch (Exception ignored) { /* Unavailable artwork cannot discard otherwise valid chat text. */ } }
    }
    private void downloadChat(String id) {
        try {
            while (true) {
                JSONObject record = read(id); if (record == null || record.optBoolean("paused") || record.optBoolean("deleting")) break;
                if (root.getUsableSpace() < 128L * 1024 * 1024) throw new java.io.IOException("Phone storage is nearly full.");
                JSONObject video = record.getJSONObject("video"); boolean kick=video.optString("channel").startsWith("kick:");
                JSONObject comments = kick ? KickVodNetwork.comments(video,(int)lastChatOffset(id,record)) : replay.comments(id, replayCheckpoint(id, record), (int) lastChatOffset(id, record));
                JSONArray edges = comments.getJSONArray("edges"), nodes = new JSONArray(); double first = Double.MAX_VALUE, last = 0; String lastId = "";
                for (int i = 0; i < edges.length(); i++) { JSONObject node = edges.getJSONObject(i).optJSONObject("node"); if (node == null) continue; nodes.put(node); double offset = node.optDouble("contentOffsetSeconds", 0); first = Math.min(first, offset); if (offset >= last) { last = offset; lastId = node.optString("id"); } }
                double rangeStart = video.optDouble("downloadStart",0), rangeEnd = video.optDouble("downloadEnd",Double.MAX_VALUE);
                JSONArray kept = new JSONArray(); for(int i=0;i<nodes.length();i++){JSONObject node=nodes.getJSONObject(i);double at=node.optDouble("contentOffsetSeconds");if(at>=rangeStart&&at<=rangeEnd)kept.put(node);} nodes=kept;
                saveImages(id, nodes, record.optJSONObject("assets"));
                if(kick){first=lastChatOffset(id,record);last=comments.getDouble("nextOffset");}
                String next = kick ? String.valueOf(last) : edges.length() == 0 ? "" : edges.getJSONObject(edges.length() - 1).optString("cursor", "");
                boolean more = comments.getJSONObject("pageInfo").optBoolean("hasNextPage");
                if(last >= rangeEnd) more=false;
                if (more && (next.isEmpty() || next.equals(record.optString("cursor")))) throw new java.io.IOException("Twitch chat replay could not advance. Resume to retry.");
                if (more && !kick) next = "offset:" + (long) Math.floor(last) + ":" + java.net.URLEncoder.encode(lastId, "UTF-8") + ":" + next;
                if (more && next.equals(record.optString("cursor"))) throw new java.io.IOException("Twitch chat replay could not advance. Resume to retry.");
                synchronized (this) {
                    record = read(id); if (record == null || record.optBoolean("paused") || record.optBoolean("deleting")) break;
                    long offset = record.optLong("chatBytes"); byte[] line = (nodes.toString() + "\n").getBytes(StandardCharsets.UTF_8);
                    try (RandomAccessFile file = new RandomAccessFile(chatFile(id), "rw")) { file.setLength(offset); file.seek(offset); file.write(line); file.getFD().sync(); }
                    db.delete("VioletVodChat", "id=? AND at>=?", new String[]{id, String.valueOf(offset)});
                    android.content.ContentValues page = new android.content.ContentValues(); page.put("id", id); page.put("at", offset); page.put("size", line.length); page.put("first", first == Double.MAX_VALUE ? 0 : first); page.put("last", last); db.insertOrThrow("VioletVodChat", null, page);
                    put(record, "chatBytes", offset + line.length); put(record, "cursor", next); put(record, "chatOffset", last); put(record, "chatLastId", lastId);
                    double duration = record.getJSONObject("video").optDouble("duration", 0); put(record, "chatPercent", more ? duration > 0 ? Math.max(0,Math.min(99, (last-rangeStart) * 100 / duration)) : 0 : 100); put(record, "chatState", more ? "downloading" : "completed"); write(id, record);
                }
                if (!more) break;
            }
        } catch (Exception error) {
            synchronized (this) { JSONObject record = read(id); if (record != null && !record.optBoolean("deleting")) { put(record, "chatState", "error"); put(record, "error", error.getMessage() == null ? "Chat replay download failed. Resume to retry." : error.getMessage()); write(id, record); } }
        } finally { synchronized (this) { running.remove(id); } }
    }
    JSObject chatWindow(String id, double position) throws Exception {
        JSONObject record = read(id); if (record == null) throw new IllegalArgumentException("Saved VOD was not found.");
        JSONArray result = new JSONArray(); File source = chatFile(id); if (!source.isFile()) return new JSObject().put("nodes", result);
        try (RandomAccessFile file = new RandomAccessFile(source, "r"); android.database.Cursor pages = db.rawQuery("SELECT at,size FROM VioletVodChat WHERE id=? AND last>=? AND first<=? AND at<? ORDER BY at LIMIT 30", new String[]{id, String.valueOf(position - 5), String.valueOf(position + 60), String.valueOf(record.optLong("chatBytes"))})) {
            while (pages.moveToNext() && result.length() < 1500) {
                int size = pages.getInt(1); if (size > 1024 * 1024) continue; byte[] bytes = new byte[size]; file.seek(pages.getLong(0)); file.readFully(bytes);
                JSONArray nodes = new JSONArray(new String(bytes, StandardCharsets.UTF_8));
                for (int j = 0; j < nodes.length() && result.length() < 1500; j++) { JSONObject node = nodes.getJSONObject(j); double offset = node.optDouble("contentOffsetSeconds"); if (offset >= position - 5 && offset <= position + 60) result.put(node); }
            }
        }
        return new JSObject().put("nodes", result);
    }
    boolean hasWork() {
        if (!manager.isIdle()) return true;
        for (Download download : manager.getCurrentDownloads()) if (download.stopReason == 0 && download.state != Download.STATE_FAILED && download.state != Download.STATE_COMPLETED) return true;
        synchronized (this) { if (!running.isEmpty()) return true; }
        for (String id : records.getAll().keySet()) { JSONObject record = read(id); if (record != null && !record.optBoolean("paused") && chatPending(record)) return true; }
        return false;
    }
    void timeout() { for (String id : records.getAll().keySet()) { try { control(id, "pause"); } catch (Exception ignored) {} } }
    void closeForTest() { manager.release(); worker.shutdownNow(); cache.release(); }
}
