using System;using System.IO;using System.Text;using System.Reflection;using System.Collections.Generic;using System.Security.Cryptography;using ContourWatch;
class SmartUpdateTests {
 static void Require(bool ok,string why){if(!ok)throw new Exception(why);}
 static void Reject(Action action,string why){try{action();}catch{return;}throw new Exception("Accepted "+why);}
 static int Main(){try{
  var nvme=Agent.Json.Deserialize<Dictionary<string,object>>(@"{""smart_status"":{""passed"":true},""nvme_smart_health_information_log"":{""percentage_used"":127}}");
  var list=SmartCollector.Parse(nvme,0,"/dev/nvme0");Require(list.Count==2&&list[1]["kind"].ToString()=="disk_wear"&&Convert.ToDouble(list[1]["value"])==127,"NVMe wear >100");
  var ata=Agent.Json.Deserialize<Dictionary<string,object>>(@"{""endurance_used"":{""current_percent"":23},""ata_smart_attributes"":{""table"":[{""id"":202,""value"":77}]}}");Require(SmartCollector.Wear(ata)==23,"canonical ATA endurance");
  ata.Remove("endurance_used");Require(SmartCollector.Wear(ata)==null,"must not guess ATA vendor attributes");
  var unknown=SmartCollector.Parse(new Dictionary<string,object>(),0,"/dev/sda");Require(unknown[1]["value"]==null&&unknown[1]["state"].ToString()=="unsupported","HDD unknown is not zero");
  Require(SmartCollector.Parse(nvme,2,"/dev/nvme0")[1]["value"]==null,"SMART IO error cannot report healthy wear");
  Require(Convert.ToInt32(SmartCollector.Parse(nvme,8,"/dev/nvme0")[0]["value"])==1,"SMART bitmask warning");
  var method=typeof(UpdateSecurity).GetMethod("VerifyWithKey",BindingFlags.Static|BindingFlags.NonPublic);using(var rsa=new RSACryptoServiceProvider(2048)){rsa.PersistKeyInCsp=false;
   Func<string,string> sign=message=>Convert.ToBase64String(rsa.SignData(Encoding.UTF8.GetBytes(message),CryptoConfig.MapNameToOID("SHA256")));
   Func<string,string,string,object> verify=(message,signature,current)=>method.Invoke(null,new object[]{message,signature,"windows-x64",current,rsa.ToXmlString(false)});
   var manifest=Agent.Obj("version","0.2.1","tag","agent-0.2.1","expires",DateTime.UtcNow.AddDays(2).ToString("o"),"artifacts",Agent.Obj("windows-x64",Agent.Obj("name","ContourWatch-0.2.1-windows-x64.msi","size",2000,"sha256",new string('a',64))));
   string text=Agent.Json.Serialize(manifest),sig=sign(text);Require(verify(text,sig,"0.2.0")!=null,"valid release");Require(verify(text,sig,"0.2.1")==null,"no downgrade/reinstall");
   Reject(()=>verify(text.Replace("2000","2001"),sig,"0.2.0"),"tampered manifest");
   manifest["expires"]=DateTime.UtcNow.AddDays(-1).ToString("o");text=Agent.Json.Serialize(manifest);Reject(()=>verify(text,sign(text),"0.2.0"),"expired release");
   manifest["expires"]=DateTime.UtcNow.AddDays(3).ToString("o");((Dictionary<string,object>)((Dictionary<string,object>)manifest["artifacts"])["windows-x64"])["name"]="../../evil.exe";text=Agent.Json.Serialize(manifest);Reject(()=>verify(text,sign(text),"0.2.0"),"arbitrary artifact path");
   Reject(()=>UpdateSecurity.Verify(text,sign(text),"windows-x64","0.2.0"),"untrusted signing key");
  }
  Console.WriteLine("PASS NVMe/ATA/HDD wear, SMART failure, pinned signatures, tampering, expiry, downgrade and artifact path");return 0;
 }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}}
}
