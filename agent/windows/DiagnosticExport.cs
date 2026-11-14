using System;using System.IO;using System.IO.Compression;using System.Text;
namespace ContourWatch {
 public static class DiagnosticExport {
  public static void Write(string destination){using(var file=new FileStream(Path.GetFullPath(destination),FileMode.CreateNew,FileAccess.Write))using(var zip=new ZipArchive(file,ZipArchiveMode.Create)){
   foreach(string name in new[]{"agent.log","agent.log.1","agent.log.2","agent.log.3","public/status.json"}){string source=Path.Combine(Agent.Root,name.Replace('/',Path.DirectorySeparatorChar));if(!File.Exists(source)||new FileInfo(source).Length>2097152)continue;using(var input=new FileStream(source,FileMode.Open,FileAccess.Read,FileShare.ReadWrite))using(var output=zip.CreateEntry(name).Open())input.CopyTo(output);}
   using(var writer=new StreamWriter(zip.CreateEntry("manifest.json").Open(),new UTF8Encoding(false)))writer.Write(Agent.Json.Serialize(Agent.Obj("version",Agent.Version,"createdAt",Agent.Iso(),"notice","Contains bounded application logs and public status only. Configuration, tokens, device credentials and queued telemetry are excluded. Review logs before sharing.")));
  }}
 }
}
