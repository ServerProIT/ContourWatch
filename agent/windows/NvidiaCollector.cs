using System;using System.Runtime.InteropServices;using System.IO;using System.Collections.Generic;using System.Globalization;using System.Text;
namespace ContourWatch {
 public static class NvidiaCollector {
 // NVAPI Thermal Settings v2 (nvapi.h). Read only the GPU-die target.
 [StructLayout(LayoutKind.Sequential)]
 struct ThermalSensor { public int controller,min,max,current,target; }
 [StructLayout(LayoutKind.Sequential)]
 struct ThermalSettings {
  public uint version,count;
  [MarshalAs(UnmanagedType.ByValArray,SizeConst=3)] public ThermalSensor[] sensors;
 }
 [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
 [DllImport("nvapi64.dll",CallingConvention=CallingConvention.Cdecl,EntryPoint="nvapi_QueryInterface")]
 static extern IntPtr Query(uint id);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Initialize();
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Enumerate([Out,MarshalAs(UnmanagedType.LPArray,SizeConst=64)]IntPtr[] handles,out int count);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int GetTemperature(IntPtr gpu,int index,ref ThermalSettings settings);
 [StructLayout(LayoutKind.Sequential)]
 struct LoadDomain {public uint present,percent;}
 [StructLayout(LayoutKind.Sequential)]
 struct LoadSettings {
  public uint version,flags;
  [MarshalAs(UnmanagedType.ByValArray,SizeConst=8)] public LoadDomain[] domains;
 }
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int GetLoad(IntPtr gpu,ref LoadSettings load);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int GetFan(IntPtr gpu,out uint rpm);
 static Dictionary<string,object> NvMetric(int index,string suffix,string kind,string title,string unit,double value){
  var row=Collectors.Metric("nvapi:"+index+":"+suffix,kind,"NVIDIA GPU "+(index+1)+" / "+title,"ok",value,unit,null);
  row["source"]="NVIDIA NVAPI";
  return row;
 }
 static T Api<T>(uint id) where T:class{
  IntPtr address=Query(id);
  return address==IntPtr.Zero?null:Marshal.GetDelegateForFunctionPointer(address,typeof(T)) as T;
 }
 public static List<Dictionary<string,object>> ReadNvApi(){
  var result=new List<Dictionary<string,object>>();
  if(!File.Exists(Path.Combine(Environment.SystemDirectory,"nvapi64.dll")))return result;
  var initialize=Api<Initialize>(0x0150e828);
  var enumerate=Api<Enumerate>(0xe5ac921f);
  var temperature=Api<GetTemperature>(0xe3640a56);
  var load=Api<GetLoad>(0x60ded2ed);
  var fan=Api<GetFan>(0x5f608315);
  if(initialize==null||enumerate==null||initialize()!=0)return result;
  var handles=new IntPtr[64];
  int count;
  if(enumerate(handles,out count)!=0||count<1||count>handles.Length)return result;
  for(int i=0;i<count;i++){
   var usage=new LoadSettings{version=(uint)Marshal.SizeOf(typeof(LoadSettings))|(1u<<16),domains=new LoadDomain[8]};
   if(load!=null&&load(handles[i],ref usage)==0&&(usage.domains[0].present&1)!=0&&usage.domains[0].percent<=100)
    result.Add(NvMetric(i,"load","gpu_load","Загрузка","%",usage.domains[0].percent));
   uint rpm;
   if(fan!=null&&fan(handles[i],out rpm)==0)result.Add(NvMetric(i,"fan","fan","Вентилятор","RPM",rpm));
   var data=new ThermalSettings{version=(uint)Marshal.SizeOf(typeof(ThermalSettings))|(2u<<16),sensors=new ThermalSensor[3]};
   if(temperature==null||temperature(handles[i],15,ref data)!=0||data.count>3)continue;
   for(int j=0;j<data.count;j++){
    var sensor=data.sensors[j];
    if(sensor.target!=1)continue;
    result.Add(NvMetric(i,"temperature:"+j,"gpu_temperature","Температура","°C",sensor.current));
   }
  }
  return result;
 }
  public static List<string> Csv(string line){var fields=new List<string>();var value=new StringBuilder();bool quote=false;for(int i=0;i<line.Length;i++){char c=line[i];if(c=='"'){if(quote&&i+1<line.Length&&line[i+1]=='"'){value.Append('"');i++;}else quote=!quote;}else if(c==','&&!quote){fields.Add(value.ToString().Trim());value.Clear();}else value.Append(c);}if(quote)throw new FormatException("Unclosed CSV field");fields.Add(value.ToString().Trim());return fields;}
  public static List<Dictionary<string,object>> Parse(string csv){var result=new List<Dictionary<string,object>>();int index=0;foreach(var line in csv.Split(new[]{'\r','\n'},StringSplitOptions.RemoveEmptyEntries)){
   var row=Csv(line);if(row.Count!=7)throw new FormatException("Unexpected nvidia-smi columns");
   double number;string[] kinds={"gpu_temperature","gpu_load","gpu_fan","gpu_memory_used","gpu_memory_total"};string[] units={"°C","%","%","MiB","MiB"};
   for(int j=0;j<5;j++){bool valid=Double.TryParse(row[j+2],NumberStyles.Float,CultureInfo.InvariantCulture,out number)&&!Double.IsNaN(number)&&!Double.IsInfinity(number)&&number>=0;
    var metric=Collectors.Metric("nvidia:"+row[0]+":"+kinds[j],kinds[j],row[1]+" / "+new[]{"Температура GPU","Загрузка GPU","Вентиляторы GPU (%)","Видеопамять занята","Видеопамять всего"}[j],valid?"ok":"unsupported",valid?(object)number:null,units[j],Agent.Obj("hardware",row[1],"pciBusId",row[0],"reason",valid?null:"Показатель не предоставлен драйвером NVIDIA"));metric["source"]="nvidia-smi";result.Add(metric);
   }index++;
  }return result;}
  public static List<Dictionary<string,object>> Read(){string exe=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"nvidia-smi.exe");if(!File.Exists(exe))exe=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),@"NVIDIA Corporation\NVSMI\nvidia-smi.exe");
   if(!File.Exists(exe)){var m=Collectors.Metric("gpu:unavailable","gpu_temperature","Температура NVIDIA GPU","unsupported",null,"°C",Agent.Obj("reason","nvidia-smi не найден. Нужен установленный драйвер NVIDIA; для AMD требуется отдельный GPU-адаптер."));m["source"]="nvidia-smi";return new List<Dictionary<string,object>>{m};}
   var metrics=Parse(Agent.Run(exe,"--query-gpu=pci.bus_id,name,temperature.gpu,utilization.gpu,fan.speed,memory.used,memory.total --format=csv,noheader,nounits",8000,100000));if(metrics.Count==0)throw new IOException("NVIDIA GPU not returned");return metrics;
  }
 }
}
