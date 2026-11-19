using System;using System.IO;using System.Text.RegularExpressions;using System.Collections.Generic;
namespace ContourWatch {
 public static class AgentLog {
  static readonly object Gate=new object();static readonly Dictionary<string,string> Last=new Dictionary<string,string>();
  static readonly Queue<Dictionary<string,object>> Recent=new Queue<Dictionary<string,object>>();
  public static object[] NetworkEvents(System.Collections.IEnumerable rows){
   var result=new List<object>();
   if(rows==null)return result.ToArray();
   foreach(var item in rows){
    var row=item as Dictionary<string,object>;
    if(row==null)continue;
    string component=Agent.Get(row,"component"),code=Agent.Get(row,"event"),level=Agent.Get(row,"level");
    DateTime time;
    if(!Regex.IsMatch(component,@"\A(?:agent|service|diagnostics|delivery|control|updater|collector\.(?:ram|volume|sensors|gpu|smart))\z")||
       !Regex.IsMatch(code,@"\A(?:metric\.state|collector\.empty|snapshot\.failed|update\.failed|recovery\.configure\.failed|diagnostic|state\.changed|retry\.scheduled)\z")||
       (level!="info"&&level!="warning"&&level!="error")||!DateTime.TryParse(Agent.Get(row,"time"),null,System.Globalization.DateTimeStyles.RoundtripKind,out time))continue;
    result.Add(Agent.Obj("time",time.ToUniversalTime().ToString("o"),"component",component,"level",level,"event",code));
    if(result.Count==24)break;
   }
   return result.ToArray();
  }
  public static object[] Snapshot(){lock(Gate)return NetworkEvents(Recent);}
  public static string Clean(string value){if(value==null)return "";value=Regex.Replace(value,@"(?i)[""']?(token|secret|authorization|password)[""']?\s*[:=]\s*(?:""[^""]*""|'[^']*'|(?:Bearer\s+)?[^\s,;]+)","$1=[REDACTED]");value=value.Replace('\r',' ').Replace('\n',' ');return value.Length>400?value.Substring(0,400):value;}
  public static void Write(string level,string component,string code,string message,params object[] fields){lock(Gate){try{
   var record=Agent.Obj("time",Agent.Iso(),"level",level,"component",component,"event",code,"message",Clean(message),"version",Agent.Version);
   Recent.Enqueue(Agent.Obj("time",record["time"],"level",level,"component",component,"event",code));
   while(Recent.Count>24)Recent.Dequeue();
   var safe=new Dictionary<string,object>();for(int i=0;i+1<fields.Length;i+=2){string name=Convert.ToString(fields[i]);if(!new List<string>{"queue","retrySeconds","httpStatus","collector","state","elapsedMs","metricCount","errorType","metricId","metricName","source"}.Contains(name))continue;object value=fields[i+1];safe[name]=value is string?(object)Clean((string)value):value;}record["fields"]=safe;
   Directory.CreateDirectory(Agent.Root);string file=Path.Combine(Agent.Root,"agent.log");if(File.Exists(file)&&new FileInfo(file).Length>1048576){for(int i=2;i>=1;i--){string from=file+"."+i,to=file+"."+(i+1);if(File.Exists(to))File.Delete(to);if(File.Exists(from))File.Move(from,to);}File.Move(file,file+".1");}
   File.AppendAllText(file,Agent.Json.Serialize(record)+Environment.NewLine);
   string publicDir=Path.Combine(Agent.Root,"public");Directory.CreateDirectory(publicDir);string publicLog=Path.Combine(publicDir,"diagnostics.log");if(File.Exists(publicLog)&&new FileInfo(publicLog).Length>262144){for(int i=2;i>=1;i--){string from=publicLog+"."+i,to=publicLog+"."+(i+1);if(File.Exists(to))File.Delete(to);if(File.Exists(from))File.Move(from,to);}if(File.Exists(publicLog+".1"))File.Delete(publicLog+".1");File.Move(publicLog,publicLog+".1");}File.AppendAllText(publicLog,Agent.Json.Serialize(record)+Environment.NewLine);
  }catch{}}}
  public static void Transition(string component,string state,string message){lock(Gate){string old;if(Last.TryGetValue(component,out old)&&old==state)return;Last[component]=state;Write(state=="ok"?"info":"warning",component,"state.changed",message,"state",state);}}
 }
}
