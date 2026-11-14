using System;using System.IO;using System.Linq;using System.Net;using System.IO.Compression;using ContourWatch;
class WindowsCollectorTests {
 static int Main(string[] args){try{
  Agent.ConfigureTls();if(ServicePointManager.SecurityProtocol!=SecurityProtocolType.Tls12)throw new Exception("TLS policy");
  var worker=System.Reflection.Assembly.LoadFrom(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"ContourSensorWorker.exe"));var classify=worker.GetType("SensorWorker").GetMethod("Classify");
  Func<string,string,string,string> kind=(h,t,n)=>(string)classify.Invoke(null,new object[]{h,t,n});
  if(kind("Cpu","Temperature","Tctl/Tdie")!="temperature"||kind("Cpu","Temperature","Distance to TjMax")!=null||kind("SuperIO","Temperature","Motherboard")!=null||kind("Cpu","Load","CPU Total")!="cpu_load"||kind("SuperIO","Fan","CPU Fan")!="fan")throw new Exception("CPU/motherboard sensor classification");
  var metrics=NvidiaCollector.Parse("00000000:01:00.0, NVIDIA GeForce RTX 5070, 48, 12, 0, 512, 12288\n00000000:02:00.0, \"GPU, second\", N/A, N/A, N/A, 10, 100\n");
  if(metrics.Count!=10||metrics[0]["kind"].ToString()!="gpu_temperature")throw new Exception("GPU parse");
  if(Convert.ToDouble(metrics[2]["value"])!=0||metrics[2]["state"].ToString()!="ok")throw new Exception("Stopped fan");
  if(metrics[5]["value"]!=null||metrics[5]["state"].ToString()!="unsupported")throw new Exception("N/A fabricated as zero");
  bool rejected=false;try{NvidiaCollector.Parse("broken csv");}catch(FormatException){rejected=true;}if(!rejected)throw new Exception("Malformed GPU payload");
  Agent.Root=args[0];Directory.CreateDirectory(Agent.Root);Directory.CreateDirectory(Path.Combine(Agent.Root,"queue"));
  File.WriteAllText(Path.Combine(Agent.Root,"config.json"),"DO_NOT_EXPORT_CONFIG_TOKEN");File.WriteAllText(Path.Combine(Agent.Root,"queue","sample.json"),"DO_NOT_EXPORT_QUEUED_DATA");
  AgentLog.Write("warning","test","failure","token=DO_NOT_LOG password=DO_NOT_LOG Authorization: Bearer DO_NOT_LOG {\"secret\":\"DO_NOT_LOG\"}","queue",3,"token","DO_NOT_LOG_FIELD");
  string log=File.ReadAllText(Path.Combine(Agent.Root,"agent.log"));if(log.Contains("DO_NOT_LOG"))throw new Exception("Log redaction");
  var record=Agent.Json.DeserializeObject(log.Trim());if(record==null)throw new Exception("Structured JSON log");
  File.AppendAllText(Path.Combine(Agent.Root,"agent.log"),new string('x',1050000));AgentLog.Write("info","test","rotation","rotation");
  if(!File.Exists(Path.Combine(Agent.Root,"agent.log.1"))||new FileInfo(Path.Combine(Agent.Root,"agent.log")).Length>1048576)throw new Exception("Bounded log rotation");
  string file=Path.Combine(Agent.Root,"diagnostics.zip");DiagnosticExport.Write(file);
  using(var zip=ZipFile.OpenRead(file)){if(zip.Entries.Any(e=>e.FullName.Contains("config")||e.FullName.Contains("queue")))throw new Exception("Private file exported");if(zip.GetEntry("manifest.json")==null||zip.GetEntry("agent.log")==null)throw new Exception("Diagnostic bundle incomplete");}
  Console.WriteLine("PASS TLS policy, NVIDIA parsing, multiple GPUs, N/A, stopped fan, malformed output, JSON logs, redaction and private-file-free diagnostic export");return 0;
 }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}}
}
