using System;using System.IO;using System.Linq;using System.Collections;using System.Collections.Generic;using System.Diagnostics;
namespace ContourWatch {
public static class SmartCollector {
 static Dictionary<string,object> Map(Dictionary<string,object> d,string k){object value;return d.TryGetValue(k,out value)?value as Dictionary<string,object>:null;}
 static object Field(Dictionary<string,object> d,string k){object value;return d!=null&&d.TryGetValue(k,out value)?value:null;}
 static double? Percent(object x){if(x==null||x is bool)return null;double n;return Double.TryParse(Convert.ToString(x),System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out n)&&!Double.IsNaN(n)&&!Double.IsInfinity(n)&&n>=0&&n<=255?(double?)n:null;}
 public static double? Wear(Dictionary<string,object> raw){var endurance=Map(raw,"endurance_used");var nvme=Map(raw,"nvme_smart_health_information_log");return Percent(Field(endurance,"current_percent"))??Percent(Field(nvme,"percentage_used"));}
 public static List<Dictionary<string,object>> Parse(Dictionary<string,object> raw,int exit,string device){
  var list=new List<Dictionary<string,object>>();var smart=Map(raw,"smart_status");var nvme=Map(raw,"nvme_smart_health_information_log");bool known=smart!=null&&Field(smart,"passed") is bool;
  bool bad=known&&!Convert.ToBoolean(smart["passed"]);bad=bad||(exit&248)!=0||Collectors.RiskAttributes(raw);double? wear=Wear(raw);
  string state=(exit&7)!=0?"error":known?"ok":"unsupported",diskId="disk:"+device;
  var attrs=new List<object>();var ata=Map(raw,"ata_smart_attributes");var rows=Field(ata,"table") as IEnumerable;if(rows!=null)foreach(var item in rows){var row=item as Dictionary<string,object>;if(row==null||attrs.Count>=64)continue;attrs.Add(Agent.Obj("id",Field(row,"id"),"name",Field(row,"name"),"value",Field(row,"value"),"worst",Field(row,"worst"),"thresh",Field(row,"thresh"),"raw",Field(Map(row,"raw"),"value")));}
  var details=Agent.Obj("model",Agent.Get(raw,"model_name",Agent.Get(raw,"scsi_model_name",device)),"capacityBytes",Field(Map(raw,"user_capacity"),"bytes"),"temperature",Field(Map(raw,"temperature"),"current"),"powerOnHours",Field(Map(raw,"power_on_time"),"hours"),"percentageUsed",wear,"criticalWarning",Field(nvme,"critical_warning"),"mediaErrors",Field(nvme,"media_errors"),"attributes",attrs,"smartctlExit",exit,"wearSource",Map(raw,"endurance_used")!=null?"smartctl endurance_used":nvme!=null?"NVMe percentage_used":"not reported");
  list.Add(Collectors.Metric(diskId,"smart",Convert.ToString(details["model"]),state,state=="ok"?(object)(bad?1:0):null,"risk",details));
  list.Add(Collectors.Metric("wear:"+device,"disk_wear",Convert.ToString(details["model"]),wear.HasValue&&(exit&7)==0?"ok":(exit&7)!=0?"error":"unsupported",wear.HasValue&&(exit&7)==0?(object)wear.Value:null,"%",Agent.Obj("diskId",diskId,"reason",wear.HasValue?null:"Накопитель или контроллер не сообщает процент износа. Для HDD такой процент обычно отсутствует.","sourceField",details["wearSource"])));
  return list;
 }
 public static List<Dictionary<string,object>> Read(){var list=new List<Dictionary<string,object>>();string exe=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"smartctl.exe");if(!File.Exists(exe)){list.Add(Collectors.Metric("smart:unavailable","smart","Физические накопители","unsupported",null,"risk","Отсутствует smartctl.exe. Переустановите агент из полной поставки."));return list;}
  var clock=Stopwatch.StartNew();var scan=Agent.Json.Deserialize<Dictionary<string,object>>(Agent.Run(exe,"--scan-open -j",4000));var devices=Field(scan,"devices") as IEnumerable;if(devices==null){list.Add(Collectors.Metric("smart:unavailable","smart","Накопители","unsupported",null,"risk","Устройства SMART не обнаружены / недоступны контроллеру"));return list;}
  int count=0;foreach(var item in devices){if(++count>32)break;var d=item as Dictionary<string,object>;if(d==null)continue;string name=Agent.Get(d,"name"),type=Agent.Get(d,"type","auto");if(!System.Text.RegularExpressions.Regex.IsMatch(name,@"^[/\\.a-zA-Z0-9:_-]+$")||!System.Text.RegularExpressions.Regex.IsMatch(type,@"^[a-zA-Z0-9,+_-]+$"))continue;
   if(clock.ElapsedMilliseconds>19000){list.Add(Collectors.Metric("disk:"+name,"smart",name,"stale",null,"risk","Превышен общий бюджет опроса SMART. Повтор в следующем цикле."));continue;}
   try{var raw=Agent.Json.Deserialize<Dictionary<string,object>>(Agent.Run(exe,"-a -j -d "+type+" "+name,(int)Math.Min(6000,21000-clock.ElapsedMilliseconds),200000));int exit=Convert.ToInt32(Field(Map(raw,"smartctl"),"exit_status")??0);list.AddRange(Parse(raw,exit,name));}catch(Exception e){list.Add(Collectors.Metric("disk:"+name,"smart",name,"error",null,"risk",Agent.Obj("errorType",e.GetType().Name,"reason","Сбор SMART не завершён; проверьте поддержку диска / RAID / USB контроллера")));}
  }return list;
 }
}
}
