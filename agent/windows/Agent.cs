using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Net;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.ServiceProcess;
using System.Web.Script.Serialization;
using Microsoft.Win32;
[assembly:System.Reflection.AssemblyVersion("0.1.1.0")]
namespace ContourWatch {
public class Agent : ServiceBase {
 public const string Version="0.1.1";
 public static JavaScriptSerializer Json { get { return new JavaScriptSerializer { MaxJsonLength=1048576,RecursionLimit=100 }; } }
 public static string Root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ContourWatch");
 Thread worker; readonly ManualResetEvent stop=new ManualResetEvent(false);
 public Agent(){ServiceName="ContourWatch";CanStop=true;AutoLog=false;}
 public static void ConfigureConsoleEncoding(){try{Console.OutputEncoding=new UTF8Encoding(false);}catch(IOException){}catch(System.Security.SecurityException){}}
 public static int Main(string[] args){try{if(args.Length>0)ConfigureConsoleEncoding();if(args.Contains("--test-sleep")){Thread.Sleep(30000);return 0;}ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
  if(args.Length>0&&args[0]=="--test-config"){Root=Path.GetFullPath(args[1]);Directory.CreateDirectory(Root);Endpoint(args[2],"/health",true);SaveConfig(Obj("server",args[2],"token",Protect(Environment.GetEnvironmentVariable("CW_TEST_TOKEN")),"localTest",true,"name","E2E-WINDOWS","group","Test"));return 0;}
  if(args.Length>0&&args[0]=="--collect"){Console.Write(Json.Serialize(Collectors.Read(args[1])));return 0;}
  if(args.Length>0&&args[0]=="--self-test")return SelfTest();
  if(args.Length>1&&args[0]=="--root")Root=Path.GetFullPath(args[1]);
  if(args.Contains("--once")){Directory.CreateDirectory(Root);var a=new Agent();a.Cycle(true);return 0;}
  if(args.Contains("--console")){var a=new Agent();Console.CancelKeyPress+=(s,e)=>{e.Cancel=true;a.stop.Set();};a.Loop();return 0;}
  ServiceBase.Run(new Agent());return 0;
 }catch(Exception e){try{Directory.CreateDirectory(Root);Log("startup "+e.GetType().Name+": "+e.Message);}catch{}try{Console.Error.WriteLine(e.GetType().Name+": "+e.Message);}catch{}return 1;}}
 protected override void OnStart(string[] args){worker=new Thread(Loop){IsBackground=true};worker.Start();}
 protected override void OnStop(){stop.Set();if(worker!=null)worker.Join(5000);}
 public static string Iso(){return DateTime.UtcNow.ToString("o");}
 public static Dictionary<string,object> Obj(params object[] a){var d=new Dictionary<string,object>();for(int i=0;i<a.Length;i+=2)d[(string)a[i]]=a[i+1];return d;}
 public static string Get(Dictionary<string,object> d,string k,string fallback=""){return d.ContainsKey(k)&&d[k]!=null?Convert.ToString(d[k]):fallback;}
 public static void Atomic(string path,string data){string tmp=path+"."+Guid.NewGuid().ToString("N")+".tmp";try{File.WriteAllText(tmp,data,new UTF8Encoding(false));if(File.Exists(path))File.Replace(tmp,path,null);else File.Move(tmp,path);}finally{if(File.Exists(tmp))File.Delete(tmp);}}
 public static Dictionary<string,object> Config(){return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(Root,"config.json")));}
 public static void SaveConfig(Dictionary<string,object> c){Atomic(Path.Combine(Root,"config.json"),Json.Serialize(c));}
 public static string Protect(string s){return Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(s),null,DataProtectionScope.LocalMachine));}
 public static string Unprotect(string s){return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(s),null,DataProtectionScope.LocalMachine));}
 public static Uri Endpoint(string server,string path,bool local){Uri u;if(!Uri.TryCreate(server,UriKind.Absolute,out u)||!String.IsNullOrEmpty(u.UserInfo)||u.AbsolutePath!="/"||!String.IsNullOrEmpty(u.Query)||!String.IsNullOrEmpty(u.Fragment)||(u.Scheme!="https"&&!(local&&u.Scheme=="http"&&u.IsLoopback)))throw new ArgumentException("Нужен HTTPS адрес сервера без пути и учётных данных");return new Uri(u,path);}
 public static Dictionary<string,object> Post(Dictionary<string,object> c,string path,object body){var uri=Endpoint(Get(c,"server"),path,Get(c,"localTest")=="True");var r=(HttpWebRequest)WebRequest.Create(uri);r.Method="POST";r.ContentType="application/json";r.Timeout=12000;r.ReadWriteTimeout=12000;r.AllowAutoRedirect=false;r.Proxy=null;
  if(c.ContainsKey("secret")){r.Headers["X-Device-Id"]=Get(c,"id");r.Headers["Authorization"]="Bearer "+Unprotect(Get(c,"secret"));}
  byte[] bytes=Encoding.UTF8.GetBytes(Json.Serialize(body));r.ContentLength=bytes.Length;using(var s=r.GetRequestStream())s.Write(bytes,0,bytes.Length);using(var response=(HttpWebResponse)r.GetResponse())using(var reader=new StreamReader(response.GetResponseStream()))return Json.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());}
 public static string Run(string exe,string args,int timeout,int max=700000){var p=new Process{StartInfo=new ProcessStartInfo(exe,args){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8}};
  using(p){p.Start();var output=Task.Factory.StartNew(()=>Capture(p.StandardOutput,max));var errors=Task.Factory.StartNew(()=>Capture(p.StandardError,32000));if(!p.WaitForExit(timeout)){try{p.Kill();}catch{}p.WaitForExit(1000);throw new System.TimeoutException("collector timeout");}if(!Task.WaitAll(new Task[]{output,errors},2000))throw new System.TimeoutException("output timeout");return output.Result;}}
 static string Capture(StreamReader r,int max){var b=new StringBuilder();var buf=new char[4096];int n;while((n=r.Read(buf,0,buf.Length))>0){if(b.Length+n>max)throw new IOException("collector output limit");b.Append(buf,0,n);}return b.ToString();}
 public static void Log(string text){try{var f=Path.Combine(Root,"agent.log");if(File.Exists(f)&&new FileInfo(f).Length>1048576){if(File.Exists(f+".1"))File.Delete(f+".1");File.Move(f,f+".1");}File.AppendAllText(f,Iso()+" "+text+Environment.NewLine);}catch{}}
 Dictionary<string,List<Dictionary<string,object>>> cache=new Dictionary<string,List<Dictionary<string,object>>>();
 Dictionary<string,DateTime> due=new Dictionary<string,DateTime>();Dictionary<string,Task<List<Dictionary<string,object>>>> jobs=new Dictionary<string,Task<List<Dictionary<string,object>>>>();
 Dictionary<string,object> settings=new Dictionary<string,object>();DateTime nextSend=DateTime.MinValue,nextDelivery=DateTime.MinValue;int failures;
 int Interval(string kind){string key=kind=="volume"?"volumeSeconds":kind=="smart"?"smartSeconds":"fastSeconds";int fallback=kind=="volume"?300:kind=="smart"?900:60,v;return settings.ContainsKey(key)&&Int32.TryParse(Convert.ToString(settings[key]),out v)?Math.Max(kind=="smart"?300:30,Math.Min(86400,v)):fallback;}
 void Loop(){Directory.CreateDirectory(Root);Directory.CreateDirectory(Path.Combine(Root,"public"));while(!stop.WaitOne(0)){try{Cycle(false);}catch(Exception e){Log("cycle "+e.GetType().Name);}stop.WaitOne(1000);}}
 void Cycle(bool once){
  foreach(string kind in new[]{"ram","volume","sensors","smart"}){
   if(once){try{cache[kind]=Collect(kind);}catch(Exception e){cache[kind]=new List<Dictionary<string,object>>{Collectors.Metric(kind+":collector",kind=="sensors"?"temperature":kind,kind,"error",null,"",e.GetType().Name)};}continue;}
   Task<List<Dictionary<string,object>>> job;if(jobs.TryGetValue(kind,out job)&&job.IsCompleted){if(job.Status==TaskStatus.RanToCompletion)cache[kind]=job.Result;else cache[kind]=new List<Dictionary<string,object>>{Collectors.Metric(kind+":collector",kind=="sensors"?"temperature":kind,kind,"error",null,"","timeout / collector error")};jobs.Remove(kind);due[kind]=DateTime.UtcNow.AddSeconds(Interval(kind));}
   if(!jobs.ContainsKey(kind)&&(!due.ContainsKey(kind)||due[kind]<=DateTime.UtcNow)){string k=kind;jobs[kind]=Task.Factory.StartNew(()=>Collect(k));}
  }
  if(once||DateTime.UtcNow>=nextSend){var metrics=cache.Values.SelectMany(m=>m).ToList();if(metrics.Count>0){var payload=Obj("batchId",Guid.NewGuid().ToString(),"measuredAt",Iso(),"version",Version,"metrics",metrics,"hardware",Obj("architecture",Environment.Is64BitOperatingSystem?"x64":"x86","virtual",Collectors.IsVirtual()),"updateStatus","Автообновление: требуется подписанный канал выпуска; автоматическая установка пока не реализована");Enqueue(Json.Serialize(payload));}nextSend=DateTime.UtcNow.AddSeconds(Interval("ram"));}
  if(once){Console.WriteLine("Собрано: "+cache.Values.Sum(m=>m.Count)+" метрик. Каталог: "+Root);return;}
  if(DateTime.UtcNow<nextDelivery)return;
  try{var c=Config();if(!c.ContainsKey("secret")){if(!c.ContainsKey("requestId")){c["requestId"]=Guid.NewGuid().ToString();var bytes=new byte[32];using(var rng=RandomNumberGenerator.Create())rng.GetBytes(bytes);c["deviceSecret"]=Protect(Convert.ToBase64String(bytes).TrimEnd('=').Replace('+','-').Replace('/','_'));SaveConfig(c);}var response=Post(c,"/api/register",Obj("token",Unprotect(Get(c,"token")),"name",Get(c,"name",Environment.MachineName),"group",Get(c,"group","Без группы"),"os",Collectors.OS(),"version",Version,"requestId",Get(c,"requestId"),"deviceSecret",Unprotect(Get(c,"deviceSecret"))));c["id"]=response["id"];c["secret"]=Protect(Convert.ToString(response["secret"]));c.Remove("token");c.Remove("requestId");c.Remove("deviceSecret");SaveConfig(c);}
   foreach(var file in Directory.GetFiles(Path.Combine(Root,"queue"),"*.json").OrderBy(x=>x).Take(20)){Dictionary<string,object> p;try{p=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));}catch{File.Delete(file);Log("corrupt queue entry removed");continue;}if(DateTime.Parse(Get(p,"measuredAt"),null,System.Globalization.DateTimeStyles.RoundtripKind).ToUniversalTime()<DateTime.UtcNow.AddDays(-7)){File.Delete(file);continue;}var reply=Post(c,"/api/ingest",p);if(reply.ContainsKey("settings"))settings=(Dictionary<string,object>)reply["settings"];File.Delete(file);}
   failures=0;nextDelivery=DateTime.UtcNow.AddSeconds(2);Atomic(Path.Combine(Root,"public","status.json"),Json.Serialize(Obj("version",Version,"state","В сети","lastSuccess",Iso(),"queue",Directory.GetFiles(Path.Combine(Root,"queue"),"*.json").Length,"server",Get(c,"server"))));
  }catch(Exception e){failures=Math.Min(failures+1,12);nextDelivery=DateTime.UtcNow.AddSeconds(Math.Min(300,Math.Pow(2,failures))+new Random().Next(1,10));Log("delivery "+e.GetType().Name);Atomic(Path.Combine(Root,"public","status.json"),Json.Serialize(Obj("version",Version,"state","Нет связи / ошибка конфигурации","lastAttempt",Iso(),"queue",Directory.GetFiles(Path.Combine(Root,"queue"),"*.json").Length)));}
 }
 public static List<Dictionary<string,object>> Collect(string kind){var output=Run(System.Reflection.Assembly.GetExecutingAssembly().Location,"--collect "+kind,25000);return Json.Deserialize<List<Dictionary<string,object>>>(output);}
 public static void Enqueue(string payload){if(Encoding.UTF8.GetByteCount(payload)>950000){Log("sample exceeds size limit");return;}string q=Path.Combine(Root,"queue");Directory.CreateDirectory(q);Atomic(Path.Combine(q,DateTime.UtcNow.ToString("yyyyMMddHHmmssfff")+"-"+Guid.NewGuid().ToString("N")+".json"),payload);var files=new DirectoryInfo(q).GetFiles("*.json").OrderBy(f=>f.Name).ToList();long size=files.Sum(f=>f.Length);while(files.Count>1500||size>50*1024*1024){var f=files[0];size-=f.Length;f.Delete();files.RemoveAt(0);Log("queue limit: oldest sample dropped");}}
 static int SelfTest(){int n=0;Action<bool,string> check=(ok,name)=>{if(!ok)throw new Exception("FAIL "+name);n++;Console.WriteLine("PASS "+name);};check(Endpoint("https://server.local","/health",false).Scheme=="https","HTTPS");foreach(var x in new[]{"http://server.local","https://u:p@server.local","https://server.local/path","https://server.local?x=1","file:///C:/"}){bool rejected=false;try{Endpoint(x,"/health",false);}catch{rejected=true;}check(rejected,"URL rejection");}check(Unprotect(Protect("test-secret"))=="test-secret","DPAPI roundtrip");var m=Collectors.Read("ram");check(m.Count>0&&m[0]["state"].ToString()=="ok","physical RAM");check(Convert.ToDouble(m[0]["value"])>=0&&Convert.ToDouble(m[0]["value"])<=100,"RAM range");check(Collectors.Read("volume").Count>0,"volumes");bool timeout=false;try{Run(System.Reflection.Assembly.GetExecutingAssembly().Location,"--test-sleep",100);}catch(System.TimeoutException){timeout=true;}check(timeout,"process timeout");check(Collectors.RiskAttributes(Json.Deserialize<Dictionary<string,object>>(@"{""ata_smart_attributes"":{""table"":[{""id"":197,""raw"":{""value"":2}}]}}")),"ATA pending sector risk");check(Collectors.RiskAttributes(Json.Deserialize<Dictionary<string,object>>(@"{""nvme_smart_health_information_log"":{""critical_warning"":1}}")),"NVMe critical warning");check(!Collectors.RiskAttributes(new Dictionary<string,object>()),"Unknown SMART is not fabricated risk");Console.WriteLine(n+" checks passed");return 0;}
}
public static class Collectors {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Auto)]class Memory {public uint length=(uint)Marshal.SizeOf(typeof(Memory));public uint load;public ulong total,available,totalPage,availPage,totalVirtual,availVirtual,extended;}
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GlobalMemoryStatusEx([In,Out]Memory data);
 public static Dictionary<string,object> Metric(string id,string kind,string name,string state,object value,string unit,object details){return Agent.Obj("id",id,"kind",kind,"name",name,"state",state,"value",value,"unit",unit,"source",kind=="smart"?"smartctl":kind=="temperature"||kind=="fan"?"LibreHardwareMonitor":"Windows","measuredAt",Agent.Iso(),"details",details);}
 public static string OS(){using(var k=Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion")){return k==null?Environment.OSVersion.ToString():Convert.ToString(k.GetValue("ProductName"))+" build "+Convert.ToString(k.GetValue("CurrentBuildNumber"));}}
 public static bool IsVirtual(){try{using(var k=Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\BIOS")){string s=Convert.ToString(k.GetValue("SystemManufacturer"))+" "+Convert.ToString(k.GetValue("SystemProductName"));return new[]{"virtual","vmware","qemu","kvm","xen"}.Any(v=>s.ToLowerInvariant().Contains(v));}}catch{return false;}}
 public static List<Dictionary<string,object>> Read(string kind){var result=new List<Dictionary<string,object>>();try{
 if(kind=="ram"){var m=new Memory();if(!GlobalMemoryStatusEx(m)||m.total==0)throw new IOException();result.Add(Metric("ram","ram","Физическая память","ok",(m.total-m.available)*100.0/m.total,"%",Agent.Obj("totalBytes",m.total,"availableBytes",m.available,"usedBytes",m.total-m.available)));}
 else if(kind=="volume"){foreach(var d in DriveInfo.GetDrives().Where(d=>d.DriveType==DriveType.Fixed)){try{long total=d.TotalSize,free=d.TotalFreeSpace;if(total<=0)continue;result.Add(Metric("volume:"+d.Name,"volume",d.Name,"ok",(total-free)*100.0/total,"%",Agent.Obj("totalBytes",total,"freeBytes",free,"usedBytes",total-free)));}catch(UnauthorizedAccessException){result.Add(Metric("volume:"+d.Name,"volume",d.Name,"denied",null,"%",null));}catch{result.Add(Metric("volume:"+d.Name,"volume",d.Name,"error",null,"%",null));}}}
 else if(kind=="sensors")ReadSensors(result);
 else if(kind=="smart")ReadSmart(result);
 }catch(UnauthorizedAccessException){result.Add(Metric(kind+":collector",kind=="sensors"?"temperature":kind,kind,"denied",null,"",null));}catch(Exception e){result.Add(Metric(kind+":collector",kind=="sensors"?"temperature":kind,kind,"error",null,"",e.GetType().Name));}return result;}
 static void ReadSensors(List<Dictionary<string,object>> list){string dll=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"sensors","LibreHardwareMonitorLib.dll");if(!File.Exists(dll)){list.Add(Metric("cpu:unavailable","temperature","Температура CPU","unsupported",null,"°C","Проверенная библиотека датчиков не установлена"));list.Add(Metric("fan:unavailable","fan","Вентиляторы","unsupported",null,"RPM",null));return;}
 // Opt-in adapter: the library and its driver must be qualified by the operator. No fan control.
 var asm=System.Reflection.Assembly.LoadFrom(dll);dynamic pc=Activator.CreateInstance(asm.GetType("LibreHardwareMonitor.Hardware.Computer"));pc.IsCpuEnabled=true;pc.IsMotherboardEnabled=true;try{pc.Open();foreach(dynamic h in pc.Hardware)Walk(h,list);}finally{pc.Close();}if(!list.Any(m=>(string)m["kind"]=="temperature"))list.Add(Metric("cpu:unavailable","temperature","CPU","unsupported",null,"°C",null));if(!list.Any(m=>(string)m["kind"]=="fan"))list.Add(Metric("fan:unavailable","fan","Вентиляторы","unsupported",null,"RPM",null));}
 static void Walk(dynamic h,List<Dictionary<string,object>> list){h.Update();foreach(dynamic s in h.Sensors){string t=s.SensorType.ToString();if(t!="Temperature"&&t!="Fan")continue;bool cpu=h.HardwareType.ToString()=="Cpu";if(t=="Temperature"&&!cpu)continue;float? v=s.Value;list.Add(Metric(s.Identifier.ToString(),t=="Fan"?"fan":"temperature",h.Name+" / "+s.Name,v.HasValue?"ok":"unsupported",v.HasValue?(object)v.Value:null,t=="Fan"?"RPM":"°C",null));}foreach(dynamic sub in h.SubHardware)Walk(sub,list);}
 static void ReadSmart(List<Dictionary<string,object>> list){string exe=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"smartctl.exe");if(!File.Exists(exe)){list.Add(Metric("smart:unavailable","smart","Физические накопители","unsupported",null,"risk","smartctl.exe не установлен; RAID/USB может требовать адаптера"));return;}
 var scan=Agent.Json.Deserialize<Dictionary<string,object>>(Agent.Run(exe,"--scan-open -j",5000));if(!scan.ContainsKey("devices")){list.Add(Metric("smart:unavailable","smart","Накопители","unsupported",null,"risk",scan));return;}
 foreach(Dictionary<string,object> d in ((ArrayList)scan["devices"]).Cast<Dictionary<string,object>>().Take(32)){
 string name=Agent.Get(d,"name"),type=Agent.Get(d,"type");if(!System.Text.RegularExpressions.Regex.IsMatch(name,@"^[/\\.a-zA-Z0-9:_-]+$")||!System.Text.RegularExpressions.Regex.IsMatch(type,@"^[a-zA-Z0-9,+_-]+$"))continue;
 try{var raw=Agent.Json.Deserialize<Dictionary<string,object>>(Agent.Run(exe,"-a -j -d "+type+" "+name,8000,200000));var details=SmartDetails(raw);bool known=raw.ContainsKey("smart_status");int exit=0;if(raw.ContainsKey("smartctl"))exit=Convert.ToInt32(((Dictionary<string,object>)raw["smartctl"])["exit_status"]);bool bad=known&&!Convert.ToBoolean(((Dictionary<string,object>)raw["smart_status"])["passed"]);bad=bad||(exit&248)!=0;bad=bad||RiskAttributes(raw);list.Add(Metric("disk:"+name,"smart",Agent.Get(raw,"model_name",name),(exit&7)!=0?"error":known?"ok":"unsupported",(exit&7)!=0||!known?null:(object)(bad?1:0),"risk",details));}catch(Exception e){list.Add(Metric("disk:"+name,"smart",name,"error",null,"risk",e.GetType().Name));}}
 if(list.Count==0)list.Add(Metric("smart:unavailable","smart","Физические накопители","unsupported",null,"risk",null));}
public static bool RiskAttributes(Dictionary<string,object> raw){
 if(raw.ContainsKey("nvme_smart_health_information_log")){var n=(Dictionary<string,object>)raw["nvme_smart_health_information_log"];foreach(string key in new[]{"critical_warning","media_errors"})if(n.ContainsKey(key)&&Convert.ToDouble(n[key])>0)return true;if(n.ContainsKey("percentage_used")&&Convert.ToDouble(n["percentage_used"])>=100)return true;}
 if(raw.ContainsKey("scsi_grown_defect_list")&&Convert.ToDouble(raw["scsi_grown_defect_list"])>0)return true;
 if(raw.ContainsKey("ata_smart_attributes")){var attrs=(Dictionary<string,object>)raw["ata_smart_attributes"];if(attrs.ContainsKey("table"))foreach(Dictionary<string,object> row in (IEnumerable)attrs["table"]){int id=Convert.ToInt32(row["id"]);if(id!=5&&id!=197&&id!=198)continue;if(row.ContainsKey("raw")){var value=(Dictionary<string,object>)row["raw"];if(value.ContainsKey("value")&&Convert.ToDouble(value["value"])>0)return true;}}}return false;
}
 public static Dictionary<string,object> SmartDetails(Dictionary<string,object> raw){var details=Agent.Obj("model",Agent.Get(raw,"model_name"),"serial",Agent.Get(raw,"serial_number"),"raw",raw);return details;}
}
}






