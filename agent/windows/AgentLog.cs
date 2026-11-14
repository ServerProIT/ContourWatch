using System;using System.IO;using System.Text.RegularExpressions;using System.Collections.Generic;
namespace ContourWatch {
 public static class AgentLog {
  static readonly object Gate=new object();static readonly Queue<Dictionary<string,object>> Recent=new Queue<Dictionary<string,object>>();static readonly Dictionary<string,string> Last=new Dictionary<string,string>();
  public static string Clean(string value){if(value==null)return "";value=Regex.Replace(value,@"(?i)[""']?(token|secret|authorization|password)[""']?\s*[:=]\s*(?:""[^""]*""|'[^']*'|(?:Bearer\s+)?[^\s,;]+)","$1=[REDACTED]");value=value.Replace('\r',' ').Replace('\n',' ');return value.Length>400?value.Substring(0,400):value;}
  public static void Write(string level,string component,string code,string message,params object[] fields){lock(Gate){try{
   var record=Agent.Obj("time",Agent.Iso(),"level",level,"component",component,"event",code,"message",Clean(message),"version",Agent.Version);
   var safe=new Dictionary<string,object>();for(int i=0;i+1<fields.Length;i+=2){string name=Convert.ToString(fields[i]);if(!new List<string>{"queue","retrySeconds","httpStatus","collector","state","elapsedMs","metricCount","errorType"}.Contains(name))continue;object value=fields[i+1];safe[name]=value is string?(object)Clean((string)value):value;}record["fields"]=safe;
   Directory.CreateDirectory(Agent.Root);string file=Path.Combine(Agent.Root,"agent.log");if(File.Exists(file)&&new FileInfo(file).Length>1048576){for(int i=2;i>=1;i--){string from=file+"."+i,to=file+"."+(i+1);if(File.Exists(to))File.Delete(to);if(File.Exists(from))File.Move(from,to);}File.Move(file,file+".1");}
   File.AppendAllText(file,Agent.Json.Serialize(record)+Environment.NewLine);Recent.Enqueue(record);while(Recent.Count>24)Recent.Dequeue();
  }catch{}}}
  public static void Transition(string component,string state,string message){lock(Gate){string old;if(Last.TryGetValue(component,out old)&&old==state)return;Last[component]=state;Write(state=="ok"?"info":"warning",component,"state.changed",message,"state",state);}}
  public static object[] Snapshot(){lock(Gate)return Recent.ToArray();}
 }
}
