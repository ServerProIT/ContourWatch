using System;using System.IO;using System.Collections.Generic;using System.Globalization;using System.Text;
namespace ContourWatch {
 public static class NvidiaCollector {
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
