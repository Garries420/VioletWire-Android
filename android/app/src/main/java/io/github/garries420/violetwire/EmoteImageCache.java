package io.github.garries420.violetwire;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.Semaphore;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;

/** Private, reclaimable disk artwork store. Network work never holds the store lock. */
final class EmoteImageCache {
    static final long LIMIT_BYTES = 100L * 1024 * 1024;
    static final int MAX_IMAGE_BYTES = 4 * 1024 * 1024;
    private final File directory;
    private final long limit;
    private final Semaphore downloads = new Semaphore(4, true);
    private final Map<String, CompletableFuture<byte[]>> inFlight = new ConcurrentHashMap<>();
    interface Downloader { byte[] download(String address) throws Exception; }
    private final Downloader downloader;
    private final Map<String, Entry> entries = new HashMap<>();
    private long bytes;
    private long generation;
    private boolean scanned;
    private boolean dataSaver;
    private static final Set<String> HOSTS = new HashSet<>(Arrays.asList(
        "cdn.7tv.app", "cdn.betterttv.net", "cdn.frankerfacez.com", "static-cdn.jtvnw.net", "files.kick.com", "ext.cdn.kick.com"));
    private static final class Entry {
        final File file;
        final long size;
        long used;
        Entry(File file) { this.file = file; size = file.length(); used = file.lastModified(); }
    }
    static final class Image {
        final InputStream stream;
        final String mime;
        Image(InputStream stream, String mime) { this.stream = stream; this.mime = mime; }
    }
    EmoteImageCache(File directory) { this(directory, LIMIT_BYTES); }
    EmoteImageCache(File directory, long limit) { this(directory, limit, EmoteImageCache::download); }
    EmoteImageCache(File directory, long limit, Downloader downloader) {
        this.directory = directory; this.limit = limit; this.downloader = downloader;
    }
    static boolean allowed(String address) {
        try {
            URI uri = new URI(address);
            return "https".equals(uri.getScheme()) && uri.getUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443) && HOSTS.contains(uri.getHost());
        } catch (Exception error) { return false; }
    }
    static String key(String address) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(address.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte value : digest) result.append(String.format(Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
    private synchronized void scan() throws IOException {
        if (scanned) return;
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cache directory unavailable");
        File[] files = directory.listFiles();
        if (files == null) throw new IOException("Cache directory unreadable");
        for (File file : files) {
            if (file.getName().matches("[a-f0-9]{64}") && file.isFile()) {
                Entry entry = new Entry(file); entries.put(file.getName(), entry); bytes += entry.size;
            } else if (file.getName().endsWith(".part") && !file.delete()) throw new IOException("Incomplete cache file could not be removed");
        }
        prune(limit);
        scanned = true;
    }
    synchronized long[] usage() throws IOException { scan(); return new long[]{bytes, entries.size()}; }
    synchronized void dataSaver(boolean enabled) { if (dataSaver != enabled) generation++; dataSaver = enabled; }
    synchronized void clear() throws IOException {
        generation++; scan();
        Iterator<Entry> items = entries.values().iterator();
        while (items.hasNext()) {
            Entry entry = items.next();
            if (entry.file.exists() && !entry.file.delete()) throw new IOException("Cached image could not be removed");
            bytes -= entry.size; items.remove();
        }
    }
    private void prune(long target) throws IOException {
        ArrayList<Map.Entry<String, Entry>> oldest = new ArrayList<>(entries.entrySet());
        oldest.sort(Comparator.comparingLong(item -> item.getValue().used));
        for (Map.Entry<String, Entry> item : oldest) {
            if (bytes <= target) break;
            Entry entry = item.getValue();
            if (entry.file.exists() && !entry.file.delete()) throw new IOException("Cache limit could not be enforced");
            bytes -= entry.size; entries.remove(item.getKey());
        }
    }
    private synchronized Image cached(String name) throws IOException {
        scan(); Entry entry = entries.get(name);
        if (entry == null) return null;
        if (!entry.file.isFile()) { entries.remove(name); bytes -= entry.size; return null; }
        String mime;
        try (FileInputStream input = new FileInputStream(entry.file)) { byte[] head = new byte[32]; int count = input.read(head); mime = mime(head, count); }
        if (mime == null) { if (!entry.file.delete()) throw new IOException("Invalid cache file could not be removed"); entries.remove(name); bytes -= entry.size; return null; }
        entry.used = System.currentTimeMillis();
        if (!entry.file.setLastModified(entry.used)) { /* In-memory LRU still applies during this process. */ }
        return new Image(new FileInputStream(entry.file), mime);
    }
    /** Testing seam also used by the network path; clear/toggle invalidates old downloads. */
    synchronized void keep(String address, byte[] content, long requestGeneration) throws Exception {
        if (dataSaver || requestGeneration != generation || content.length > MAX_IMAGE_BYTES || content.length > limit) return;
        if (!allowed(address) || mime(content, content.length) == null) return;
        scan(); String name = key(address);
        if (entries.containsKey(name)) return;
        // Prune before writing: retained files never exceed the configured ceiling.
        prune(limit - content.length);
        File part = File.createTempFile(name, ".part", directory);
        try {
            try (FileOutputStream output = new FileOutputStream(part)) { output.write(content); }
            File file = new File(directory, name);
            if (!part.renameTo(file)) throw new IOException("Cached image could not be committed");
            Entry entry = new Entry(file); entries.put(name, entry); bytes += entry.size;
        } finally { if (part.exists() && !part.delete()) part.deleteOnExit(); }
    }
    Image image(String address) throws Exception {
        if (!allowed(address)) throw new IOException("Unsupported image address");
        String name = key(address);
        // A disk hit never waits for an unrelated image's network request. The old
        // 32 striped locks made even cached images wait on colliding slow URLs.
        Image saved = cached(name); if (saved != null) return saved;
        CompletableFuture<byte[]> request = new CompletableFuture<>();
        CompletableFuture<byte[]> existing = inFlight.putIfAbsent(name, request);
        if (existing != null) {
            try {
                byte[] content = existing.get();
                return new Image(new ByteArrayInputStream(content), mime(content, content.length));
            } catch (ExecutionException error) {
                if (error.getCause() instanceof Exception) throw (Exception) error.getCause();
                throw new IOException("Image request failed", error.getCause());
            }
        }
        try {
            // A previous owner may have completed between the first disk lookup
            // and claiming this URL. Check again before starting a network request.
            saved = cached(name);
            if (saved != null) {
                byte[] content;
                try (InputStream input = saved.stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    content = output.toByteArray();
                }
                request.complete(content);
                return new Image(new ByteArrayInputStream(content), saved.mime);
            }
            long requestGeneration;
            synchronized (this) { requestGeneration = generation; }
            downloads.acquire();
            try {
                byte[] content = downloader.download(address);
                String mime = mime(content, content.length);
                if (mime == null) throw new IOException("Unsupported image content");
                try { keep(address, content, requestGeneration); } catch (IOException ignored) { /* Drawing still works if storage is full. */ }
                request.complete(content);
                return new Image(new ByteArrayInputStream(content), mime);
            } finally { downloads.release(); }
        } catch (Exception error) {
            request.completeExceptionally(error); throw error;
        } finally { inFlight.remove(name, request); }
    }
    Image savedImage(String address) throws Exception { return allowed(address) ? cached(key(address)) : null; }
    private static byte[] download(String address) throws Exception {
        for (int redirects = 0; redirects <= 3; redirects++) {
            if (!allowed(address)) throw new IOException("Unsupported image redirect");
            HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
            connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
            connection.setConnectTimeout(10000); connection.setReadTimeout(15000);
            connection.setRequestProperty("Accept", "image/avif,image/webp,image/png,image/gif,image/jpeg");
            try {
                int status = connection.getResponseCode();
                if (status >= 300 && status <= 399) {
                    String location = connection.getHeaderField("Location");
                    if (location == null) throw new IOException("Invalid image redirect");
                    address = new URL(new URL(address), location).toString(); continue;
                }
                if (status != 200 || connection.getContentLengthLong() > MAX_IMAGE_BYTES) throw new IOException("Image request refused");
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] chunk = new byte[8192]; int count;
                    while ((count = input.read(chunk)) != -1) {
                        if (output.size() + count > MAX_IMAGE_BYTES) throw new IOException("Image is too large");
                        output.write(chunk, 0, count);
                    }
                    return output.toByteArray();
                }
            } finally { connection.disconnect(); }
        }
        throw new IOException("Too many image redirects");
    }
    static String mime(byte[] content, int count) {
        if (count < 12) return null;
        String head = new String(content, 0, Math.min(count, 32), StandardCharsets.ISO_8859_1);
        if (head.startsWith("RIFF") && head.substring(8, 12).equals("WEBP")) return "image/webp";
        if (content[0] == (byte) 0x89 && head.substring(1, 4).equals("PNG")) return "image/png";
        if (head.startsWith("GIF8")) return "image/gif";
        if (content[0] == (byte) 0xff && content[1] == (byte) 0xd8) return "image/jpeg";
        if (head.substring(4, 8).equals("ftyp") && (head.substring(8, 12).equals("avif") || head.substring(8, 12).equals("avis"))) return "image/avif";
        return null;
    }
}
