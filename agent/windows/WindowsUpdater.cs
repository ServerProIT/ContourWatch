using System;using System.IO;using System.Linq;using System.Text;using System.Diagnostics;using System.ServiceProcess;using System.Runtime.InteropServices;using System.Windows.Forms;using ContourWatch;
class WindowsUpdater {
 const string UpgradeCode="{D23A703B-74EC-49A8-8D4D-142F98968502}";
 [DllImport("msi.dll",CharSet=CharSet.Unicode)]static extern uint MsiEnumRelatedProducts(string code,uint reserved,uint index,StringBuilder product);
 [DllImport("msi.dll",CharSet=CharSet.Unicode)]static extern uint MsiGetProductInfo(string product,string property,StringBuilder value,ref uint size);
 static readonly string Root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ContourWatch"),Dest=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"ContourWatch");
 static string Quote(string s){if(s.IndexOfAny(new[]{'"','\r','\n'})>=0)throw new ArgumentException("path");return "\""+s+"\"";}
 static int Msi(string args){using(var p=Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"msiexec.exe"),args){UseShellExecute=false,CreateNoWindow=true})){if(!p.WaitForExit(600000))throw new System.TimeoutException("installer timeout");return p.ExitCode;}}
 static string Product(){var b=new StringBuilder(39);return MsiEnumRelatedProducts(UpgradeCode,0,0,b)==0?b.ToString():null;}
 static string Cached(string product){var b=new StringBuilder(2048);uint size=2048;return product!=null&&MsiGetProductInfo(product,"LocalPackage",b,ref size)==0?b.ToString():null;}
 static void Stop(){try{using(var s=new ServiceController("ContourWatch")){if(s.Status!=ServiceControllerStatus.Stopped){s.Stop();s.WaitForStatus(ServiceControllerStatus.Stopped,TimeSpan.FromSeconds(35));}}}catch(InvalidOperationException){}foreach(var name in new[]{"ContourAgent","ContourSensorWorker","ContourTray"})foreach(var p in Process.GetProcessesByName(name))using(p){try{if(!p.HasExited&&String.Equals(Path.GetFullPath(p.MainModule.FileName),Path.Combine(Dest,name+".exe"),StringComparison.OrdinalIgnoreCase)){p.Kill();p.WaitForExit(5000);}}catch(InvalidOperationException){}}}
 static bool Healthy(string version){var v=Version.Parse(version);version=v.Major+"."+v.Minor+"."+v.Build;int healthy=0;for(int i=0;i<30;i++){System.Threading.Thread.Sleep(2000);try{using(var s=new ServiceController("ContourWatch")){if(s.Status!=ServiceControllerStatus.Running){healthy=0;continue;}}string file=Path.Combine(Root,"public","status.json");var status=new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(file));if(Convert.ToString(status["version"])==version&&File.GetLastWriteTimeUtc(file)>DateTime.UtcNow.AddMinutes(-2)){if(++healthy>=3)return true;}else healthy=0;}catch{healthy=0;}}return false;}
 static void WaitForLauncher(int id){
  Process launcher;
  try{launcher=Process.GetProcessById(id);}catch(ArgumentException){return;}
  using(launcher){if(!launcher.WaitForExit(30000))throw new System.TimeoutException("launcher timeout");}
 }
 [STAThread] static int Main(string[] args){
  int launcher=0;
  bool interactive=args.Length==2&&Int32.TryParse(args[1],out launcher)&&launcher>0;
  if(args.Length!=1&&!interactive)return 2;
  bool restartTray=false;
  int result=Install(args[0],launcher,()=>restartTray=true);
  if(interactive){
   if(restartTray)try{
    string explorer=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),"explorer.exe");
    using(var tray=Process.Start(new ProcessStartInfo(explorer,Quote(Path.Combine(Dest,"ContourTray.exe"))){UseShellExecute=false})){}
   }catch(System.ComponentModel.Win32Exception){}
   string message=result==0?"Агент обновлён или уже работает на актуальной версии.":
    result==3?"Другая проверка или установка ещё выполняется.":
    result==4?"Обновление завершилось ошибкой. Восстановление предыдущей версии не подтверждено.":
    "Обновление не завершилось. Подробности в журнале обновлений агента.";
   MessageBox.Show(message,"Контур · обновления",MessageBoxButtons.OK,result==0?MessageBoxIcon.Information:MessageBoxIcon.Warning);
  }
  return result;
 }
 static int Install(string path,int launcher,Action beforeStop){
  string log=Path.Combine(Root,"updates","updater.log");try{if(launcher>0)WaitForLauncher(launcher);string stage=Path.GetFullPath(path),allowed=Path.GetFullPath(Path.Combine(Root,"updates"))+Path.DirectorySeparatorChar;if(!stage.StartsWith(allowed,StringComparison.OrdinalIgnoreCase)||!System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(stage),"^stage-[a-f0-9]{32}$"))throw new ArgumentException("stage");using(var mutex=new System.Threading.Mutex(false,@"Global\ContourWatchUpdate")){try{if(!mutex.WaitOne(launcher>0?30000:5000))return 3;}catch(System.Threading.AbandonedMutexException){}try{
  string current=FileVersionInfo.GetVersionInfo(Path.Combine(Dest,"ContourAgent.exe")).FileVersion;var artifact=UpdateSecurity.Verify(File.ReadAllText(Path.Combine(stage,"manifest.json")),File.ReadAllText(Path.Combine(stage,"manifest.sig")),"windows-x64",current);if(artifact==null)return 0;string msi=Path.Combine(stage,Convert.ToString(artifact["name"]));if(new FileInfo(msi).Length!=Convert.ToInt64(artifact["size"])||UpdateSecurity.Digest(msi)!=Convert.ToString(artifact["sha256"]))throw new InvalidDataException("payload hash");
  string product=Product(),old=Cached(product),rollback=Path.Combine(stage,"rollback.msi");if(old==null||!File.Exists(old))throw new IOException("A prior MSI installation is required for rollback");File.Copy(old,rollback,true);beforeStop();Stop();int code=Msi("/i "+Quote(msi)+" /qn /norestart");if((code==0||code==3010)&&Healthy(Convert.ToString(artifact["version"]))){File.WriteAllText(log,"Обновление завершено: "+artifact["version"]);return 0;}
  File.WriteAllText(Path.Combine(Root,"updates","blocked-release.txt"),Convert.ToString(artifact["tag"]));Stop();string installed=Product();if(installed!=null&&installed!=product)Msi("/x "+Quote(installed)+" /qn /norestart");int restored=Msi("/i "+Quote(rollback)+" /qn /norestart"+(Product()==product?" REINSTALL=ALL REINSTALLMODE=vomus":""));if((restored!=0&&restored!=3010)||!Healthy(current)){File.WriteAllText(log,"Откат не подтверждён: "+restored);return 4;}File.WriteAllText(log,"Обновление не подтверждено. Откат: "+restored);return 1;
 }finally{mutex.ReleaseMutex();}}}catch(Exception e){try{Directory.CreateDirectory(Path.GetDirectoryName(log));File.WriteAllText(log,"Обновление остановлено: "+e.GetType().Name);}catch{}return 1;}}
}
