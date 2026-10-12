package io.github.garries420.violetwire;

import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.text.ParsePosition;
import java.util.Locale;
import java.util.TimeZone;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;
import javax.net.ssl.HttpsURLConnection;

/** Kick replay uses five-second UTC windows; its returned cursor goes backwards. */
final class KickVodNetwork {
    private static SimpleDateFormat utcFormat() {
        SimpleDateFormat format=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'",Locale.ROOT);format.setTimeZone(TimeZone.getTimeZone("UTC"));format.setLenient(false);return format;
    }
    static long parseUtc(String value) throws java.io.IOException {
        java.util.regex.Matcher stamp=java.util.regex.Pattern.compile("(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2})(?:\\.(\\d{1,9}))?Z").matcher(value);
        if(!stamp.matches())throw new java.io.IOException("Invalid Kick UTC timestamp.");
        String base=stamp.group(1)+"Z";ParsePosition position=new ParsePosition(0);java.util.Date date=utcFormat().parse(base,position);
        if(date==null||position.getIndex()!=base.length())throw new java.io.IOException("Invalid Kick recording date.");
        String fraction=stamp.group(2);long millis=fraction==null?0:Long.parseLong((fraction+"000").substring(0,3));return date.getTime()+millis;
    }
    static JSONObject comments(JSONObject video, int offset) throws Exception {
        String channel = video.optString("replayChannelId");
        if(!video.optString("channel").matches("kick:[A-Za-z0-9_-]+") || !channel.matches("[0-9]{1,20}") || !VodDownloads.validId(video.optString("id"))) throw new java.io.IOException("Kick replay metadata is unavailable for this video.");
        long origin;
        try { origin=parseUtc(video.getString("recordedAt")); } catch(Exception error) { throw new java.io.IOException("Kick did not provide this video's recording time."); }
        if(offset<0)throw new java.io.IOException("Invalid Kick replay position.");
        String stamp=utcFormat().format(new java.util.Date(origin+offset*1000L));
        HttpsURLConnection connection=(HttpsURLConnection)new URL("https://kick.com/api/v2/channels/"+channel+"/messages?start_time="+URLEncoder.encode(stamp,"UTF-8")).openConnection();
        connection.setConnectTimeout(15000);connection.setReadTimeout(20000);connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("User-Agent","VioletWire-Android/0.3.4");connection.setRequestProperty("Referer","https://kick.com/");
        try {
            if(connection.getResponseCode()!=200)throw new java.io.IOException("Kick chat replay could not load ("+connection.getResponseCode()+"). Retry chat.");
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            try(java.io.InputStream input=connection.getInputStream()) { byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){if(bytes.size()+count>1024*1024)throw new java.io.IOException("Kick chat response is too large.");bytes.write(buffer,0,count);} }
            return normalize(new JSONObject(bytes.toString("UTF-8")),origin,offset,video.optDouble("downloadEnd",video.optDouble("duration")));
        } finally { connection.disconnect(); }
    }
    static JSONObject normalize(JSONObject payload, long origin, int offset, double duration) throws Exception {
        JSONArray messages=payload.getJSONObject("data").getJSONArray("messages"),edges=new JSONArray();
        for(int i=0;i<messages.length();i++) {
            JSONObject message=messages.getJSONObject(i),sender=message.optJSONObject("sender");
            double at=(parseUtc(message.getString("created_at"))-origin)/1000d;
            // Refuse a provider response which ignored start_time and returned live chat.
            if(at<offset||at>offset+5)throw new java.io.IOException("Kick returned chat outside the requested replay window. Retry chat.");
            if(at>duration)continue;
            JSONObject identity=sender==null?null:sender.optJSONObject("identity");String text=message.optString("content");
            JSONArray fragments=new JSONArray();java.util.regex.Matcher emote=java.util.regex.Pattern.compile("\\[emote:([0-9]+):([^\\]]+)\\]").matcher(text);int end=0;
            while(emote.find()){if(emote.start()>end)fragments.put(new JSONObject().put("text",text.substring(end,emote.start())));fragments.put(new JSONObject().put("text",emote.group(2)).put("emote",new JSONObject().put("emoteID",emote.group(1)).put("imageUrl","https://files.kick.com/emotes/"+emote.group(1)+"/fullsize").put("provider","kick")));end=emote.end();}
            if(end<text.length())fragments.put(new JSONObject().put("text",text.substring(end)));
            JSONArray badgeAssets=new JSONArray();JSONArray badges=identity==null?null:identity.optJSONArray("badges_v2");
            if(badges!=null)for(int j=0;j<badges.length();j++){JSONObject badge=badges.optJSONObject(j);if(badge!=null&&EmoteImageCache.allowed(badge.optString("image_url")))badgeAssets.put(new JSONObject().put("key",badge.optString("name")).put("title",badge.optString("name")).put("imageUrl",badge.optString("image_url")));}
            JSONObject node=new JSONObject().put("id",message.getString("id")).put("contentOffsetSeconds",at).put("createdAt",message.getString("created_at")).put("commenter",new JSONObject().put("login",sender==null?"":sender.optString("slug")).put("displayName",sender==null?"Deleted user":sender.optString("username","Kick user"))).put("message",new JSONObject().put("fragments",fragments).put("userColor",identity==null?"":identity.optString("color")).put("badgeAssets",badgeAssets));
            edges.put(new JSONObject().put("node",node));
        }
        double next=Math.min(offset+5,duration);
        return new JSONObject().put("edges",edges).put("nextOffset",next).put("pageInfo",new JSONObject().put("hasNextPage",next<duration));
    }
}
