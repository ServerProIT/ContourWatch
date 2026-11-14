using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using LibreHardwareMonitor.Hardware;
using ContourWatch;

public class SensorWorker {
 public static string Classify(string hardware,string type,string name){
  bool gpu=hardware.StartsWith("Gpu",StringComparison.Ordinal);
  if(type=="Temperature"&&name.IndexOf("Distance to TjMax",StringComparison.OrdinalIgnoreCase)>=0)return null;
  if(type=="Temperature")return hardware=="Cpu"?"temperature":gpu?"gpu_temperature":null;
  if(type=="Fan")return "fan";
  if(type=="Load"&&hardware=="Cpu"&&name.IndexOf("Total",StringComparison.OrdinalIgnoreCase)>=0)return "cpu_load";
  if(type=="Load"&&gpu&&name.IndexOf("Core",StringComparison.OrdinalIgnoreCase)>=0)return "gpu_load";
  return null;
 }
 public static int Main(){
  Agent.ConfigureConsoleEncoding();
  AppDomain.CurrentDomain.AssemblyResolve+=(sender,eventArgs)=>{string name=new AssemblyName(eventArgs.Name).Name+".dll";string path=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"sensors",name);return File.Exists(path)?Assembly.LoadFrom(path):null;};
  try{Console.Write(Agent.Json.Serialize(Read()));return 0;}catch(Exception e){Console.Write(Agent.Json.Serialize(new[]{Failure("hardware:collector","collector","Аппаратные датчики",e.GetType().Name)}));return 0;}
 }
 static Dictionary<string,object> Failure(string id,string kind,string name,string reason){var m=Collectors.Metric(id,kind,name,"error",null,"",Agent.Obj("reason",reason));m["source"]="LibreHardwareMonitor 0.9.6";return m;}
 [MethodImpl(MethodImplOptions.NoInlining)]
 public static List<Dictionary<string,object>> Read(){
  var result=new List<Dictionary<string,object>>();
  bool driver=LibreHardwareMonitor.PawnIo.PawnIo.IsInstalled;
  // NVIDIA is read by the separate nvidia-smi collector. A native NVML fault
  // in an in-process library must not take CPU/motherboard collection down.
  var pc=new Computer{IsCpuEnabled=true,IsGpuEnabled=false,IsMotherboardEnabled=true};try{
   pc.Open();foreach(var h in pc.Hardware){try{Walk(h,result,driver);}catch(Exception e){result.Add(Failure(h.Identifier.ToString()+":error","collector",h.Name,e.GetType().Name));}}
  }finally{pc.Close();}
  foreach(var pair in new[]{new[]{"temperature","Температура CPU"},new[]{"fan","Вентиляторы"}}){
   if(!result.Any(m=>(string)m["kind"]==pair[0])){
    var m=Collectors.Metric(pair[0]+":unavailable",pair[0],pair[1],"unsupported",null,pair[0]=="fan"?"RPM":"°C",Agent.Obj("reason",!driver&&pair[0]!="gpu_temperature"?"Требуется официальный подписанный PawnIO. Откройте сайт PawnIO из установщика, установите драйвер и перезапустите службу.":"Датчик не предоставлен оборудованием или драйвером","pawnIoInstalled",driver));m["source"]="LibreHardwareMonitor 0.9.6";result.Add(m);
   }
  }
  return result;
 }
 static void Walk(IHardware hardware,List<Dictionary<string,object>> result,bool driver){
  hardware.Update();
  foreach(var sensor in hardware.Sensors){
   string kind=Classify(hardware.HardwareType.ToString(),sensor.SensorType.ToString(),sensor.Name);if(kind==null)continue;
   bool needsDriver=kind=="temperature"||(kind=="fan"&&!hardware.HardwareType.ToString().StartsWith("Gpu"));
   float? value=sensor.Value;bool valid=value.HasValue&&!Single.IsNaN(value.Value)&&!Single.IsInfinity(value.Value)&&(!needsDriver||driver);
   var details=Agent.Obj("hardware",hardware.Name,"hardwareType",hardware.HardwareType.ToString(),"sensorType",sensor.SensorType.ToString(),"pawnIoInstalled",driver,"reason",needsDriver&&!driver?"Требуется официальный подписанный драйвер PawnIO":valid?null:"Датчик недоступен; проверьте драйвер и совместимость платы");
   var metric=Collectors.Metric(sensor.Identifier.ToString(),kind,hardware.Name+" / "+sensor.Name,valid?"ok":"unsupported",valid?(object)value.Value:null,sensor.SensorType==SensorType.Fan?"RPM":sensor.SensorType==SensorType.Load?"%":"°C",details);
   metric["source"]="LibreHardwareMonitor 0.9.6";result.Add(metric);
  }
  foreach(var child in hardware.SubHardware)Walk(child,result,driver);
 }
}
