using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ContourWatch {
public static class AgentUpdater {
 static DateTime next=DateTime.MinValue;
 static Task job;
 public static volatile string Status="Автообновление выключено";

 static bool WithinWindow(Dictionary<string,object> policy){
  int start=Convert.ToInt32(policy["start"]),end=Convert.ToInt32(policy["end"]),hour=DateTime.UtcNow.Hour;
  return start<end?hour>=start&&hour<end:hour>=start||hour<end;
 }

 public static void Poll(Dictionary<string,object> config,Dictionary<string,object> policy){
  if(!policy.ContainsKey("enabled")||!Convert.ToBoolean(policy["enabled"])){
   Status="Автообновление выключено";
   return;
  }
  if(DateTime.UtcNow<next||(job!=null&&!job.IsCompleted))return;
  if(!WithinWindow(policy)){
   Status="Ожидание окна обновления";
   return;
  }
  next=DateTime.UtcNow.AddMinutes(60+new Random().Next(0,15));
  job=Task.Factory.StartNew(()=>Check(config,null));
 }

 public static string CheckManually(Func<string,bool> confirm){
  if(!File.Exists(Path.Combine(Agent.Root,"config.json")))return "Сначала настройте подключение к панели.";
  var config=Agent.Config();
  if(!config.ContainsKey("secret"))return "Дождитесь завершения регистрации агента на панели.";
  return Check(config,confirm);
 }

 static bool Available(Dictionary<string,object> reply){
  return reply.ContainsKey("available")&&Convert.ToBoolean(reply["available"]);
 }

 static string Check(Dictionary<string,object> config,Func<string,bool> confirm){
  bool manual=confirm!=null,launched=false;
  string stage=null;
  try{
   using(var mutex=new Mutex(false,@"Global\ContourWatchUpdate")){
    bool acquired;
    try{acquired=mutex.WaitOne(0);}catch(AbandonedMutexException){acquired=true;}
    if(!acquired)return "Проверка или установка обновления уже выполняется.";
    try{
     Status="Проверка выпуска";
     var request=manual?Agent.Obj("manual",true):Agent.Obj();
     var reply=Agent.Post(config,"/api/update/check",request);
     if(!Available(reply))return Status="Нет доступных выпусков. Панели более ранней версии требуется разрешение автообновления.";
     string text=Convert.ToString(reply["manifest"]),signature=Convert.ToString(reply["signature"]);
     var artifact=UpdateSecurity.Verify(text,signature,"windows-x64",Agent.Version);
     if(artifact==null)return Status="Установлена актуальная версия.";

     string updates=Path.Combine(Agent.Root,"updates");
     Directory.CreateDirectory(updates);
     string blocked=Path.Combine(updates,"blocked-release.txt");
     if(File.Exists(blocked)&&File.ReadAllText(blocked).Trim()==Convert.ToString(artifact["tag"])){
      return Status="Неудачный выпуск заблокирован: "+artifact["tag"];
     }
     if(new DirectoryInfo(updates).EnumerateFiles("*",SearchOption.AllDirectories).Sum(f=>f.Length)>300L*1024*1024){
      return Status="Нужно очистить архивы предыдущих обновлений.";
     }

     if(manual&&!confirm(Convert.ToString(artifact["version"])))return null;
     stage=Path.Combine(updates,"stage-"+Guid.NewGuid().ToString("N"));
     Directory.CreateDirectory(stage);
     Status="Загрузка версии "+artifact["version"];
     Download(artifact,Path.Combine(stage,Convert.ToString(artifact["name"])));

     if(!manual){
      var control=Agent.Post(config,"/api/control",Agent.Obj("version",Agent.Version));
      var policy=(Dictionary<string,object>)control["updates"];
      if(!Convert.ToBoolean(policy["enabled"])||!WithinWindow(policy))return Status="Установка отложена политикой.";
     }
     var again=Agent.Post(config,"/api/update/check",request);
     if(!Available(again)||Convert.ToString(again["manifest"])!=text)return Status="Выпуск изменился или стал недоступен.";

     File.WriteAllText(Path.Combine(stage,"manifest.json"),text,new UTF8Encoding(false));
     File.WriteAllText(Path.Combine(stage,"manifest.sig"),signature,new UTF8Encoding(false));
     string helper=Path.Combine(stage,"ContourUpdater.exe");
     File.Copy(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"ContourUpdater.exe"),helper);
     string args="\""+stage+"\"";
     if(manual)using(var process=Process.GetCurrentProcess()){args+=" "+process.Id;}
     Status="Проверено. Установка "+artifact["version"];
     using(var updater=Process.Start(new ProcessStartInfo(helper,args){UseShellExecute=false,CreateNoWindow=true})){
      launched=updater!=null;
     }
     return launched?null:(Status="Не удалось запустить установщик обновления.");
    }finally{mutex.ReleaseMutex();}
   }
  }catch(Exception e){
   Status="Обновление отложено: "+e.GetType().Name;
   AgentLog.Write("warning","updater","update.failed",e.GetType().Name);
   return Status;
  }finally{
   if(stage!=null&&!launched){
    try{
     string allowed=Path.GetFullPath(Path.Combine(Agent.Root,"updates"))+Path.DirectorySeparatorChar;
     if(Path.GetFullPath(stage).StartsWith(allowed,StringComparison.OrdinalIgnoreCase)&&(File.GetAttributes(stage)&FileAttributes.ReparsePoint)==0){
      Directory.Delete(stage,true);
     }
    }catch{}
   }
  }
 }

 static void Download(Dictionary<string,object> artifact,string path){
  var request=(HttpWebRequest)WebRequest.Create(UpdateSecurity.Url(artifact));
  request.Timeout=20000;
  request.ReadWriteTimeout=15000;
  request.Proxy=null;
  var clock=Stopwatch.StartNew();
  long size=0,expected=Convert.ToInt64(artifact["size"]);
  using(var response=(HttpWebResponse)request.GetResponse())
  using(var input=response.GetResponseStream())
  using(var output=File.Create(path)){
   var buffer=new byte[65536];
   int count;
   while((count=input.Read(buffer,0,buffer.Length))>0){
    size+=count;
    if(size>expected||clock.Elapsed>TimeSpan.FromMinutes(5))throw new IOException("update download limit");
    output.Write(buffer,0,count);
   }
  }
  if(size!=expected||UpdateSecurity.Digest(path)!=Convert.ToString(artifact["sha256"]))throw new IOException("update digest");
 }
}
}
