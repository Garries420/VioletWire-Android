package io.github.garries420.violetwire;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
/** Selects HLS segments covering the requested interval, retaining key/map context. */
final class VodClipPlaylist {
 final String text; final double origin, start, end;
 private VodClipPlaylist(String text,double origin,double start,double end){this.text=text;this.origin=origin;this.start=start;this.end=end;}
 static VodClipPlaylist select(String text,String address,double start,double end)throws Exception{
  if(!Double.isFinite(start)||!Double.isFinite(end)||start<0||end<=start)throw new IllegalArgumentException("Invalid download time range.");
  URI base=new URI(address);String[] lines=text.split("\\r?\\n");List<String> header=new ArrayList<>(),selected=new ArrayList<>(),pending=new ArrayList<>();String key="",map="";double time=0,duration=-1,origin=-1;long sequence=0,index=0,first=0;boolean complete=false;
  for(String raw:lines){String line=raw.trim();if(line.isEmpty())continue;
   if(line.equals("#EXT-X-ENDLIST")){complete=true;continue;}
   if(line.startsWith("#EXT-X-MEDIA-SEQUENCE:")){sequence=Long.parseLong(line.substring(22));continue;}
   if(line.startsWith("#EXT-X-KEY:")){key=absolute(line,base);continue;}
   if(line.startsWith("#EXT-X-MAP:")){map=absolute(line,base);continue;}
   if(line.startsWith("#EXTINF:")){duration=Double.parseDouble(line.substring(8).split(",")[0]);if(!Double.isFinite(duration)||duration<=0)throw new IllegalArgumentException("Invalid HLS segment duration.");pending.add(line);continue;}
   if(line.startsWith("#")){if(duration>=0||line.startsWith("#EXT-X-DISCONTINUITY")||line.startsWith("#EXT-X-PROGRAM-DATE-TIME"))pending.add(line);else if(!line.startsWith("#EXT-X-START")&&!line.startsWith("#EXT-X-DATERANGE"))header.add(line);continue;}
   if(duration<0)throw new IllegalArgumentException("Choose a video quality, not a master playlist.");
   if(time+duration>start&&time<end){if(origin<0){origin=time;first=index;if(!key.isEmpty())selected.add(key);if(!map.isEmpty())selected.add(map);}else{if(!key.isEmpty())selected.add(key);if(!map.isEmpty())selected.add(map);}for(String tag:pending){if(tag.startsWith("#EXT-X-BYTERANGE:")&&!tag.contains("@"))throw new IllegalArgumentException("This video uses unsupported relative byte ranges.");selected.add(tag);}String segment=base.resolve(line).toString();if(!VodDownloads.mediaUrl(segment))throw new IllegalArgumentException("Invalid VOD segment address.");selected.add(segment);}
   time+=duration;index++;duration=-1;pending.clear();
  }
  if(!complete||origin<0||end>time+0.5)throw new IllegalArgumentException("This time range is outside the available VOD.");
  header.add("#EXT-X-MEDIA-SEQUENCE:"+(sequence+first));header.addAll(selected);header.add("#EXT-X-ENDLIST");return new VodClipPlaylist(String.join("\n",header)+"\n",origin,start-origin,end-origin);
 }
 private static String absolute(String tag,URI base)throws Exception{java.util.regex.Matcher m=java.util.regex.Pattern.compile("URI=\"([^\"]+)\"").matcher(tag);StringBuffer result=new StringBuffer();while(m.find()){String address=base.resolve(m.group(1)).toString();if(!VodDownloads.mediaUrl(address))throw new IllegalArgumentException("Invalid VOD key address.");m.appendReplacement(result,java.util.regex.Matcher.quoteReplacement("URI=\""+address+"\""));}m.appendTail(result);return result.toString();}
}
