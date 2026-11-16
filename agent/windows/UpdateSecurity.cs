using System;using System.IO;using System.Text;using System.Collections.Generic;using System.Security.Cryptography;using System.Reflection;using System.Text.RegularExpressions;using System.Web.Script.Serialization;
namespace ContourWatch {
public static class UpdateSecurity {
 public static string PublicKey(){using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("update-public.xml"))using(var reader=new StreamReader(stream))return reader.ReadToEnd();}
 public static string Digest(string file){using(var hash=SHA256.Create())using(var stream=File.OpenRead(file))return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
 public static Dictionary<string,object> Verify(string text,string signature,string platform,string current){return VerifyWithKey(text,signature,platform,current,PublicKey());}
 internal static Dictionary<string,object> VerifyWithKey(string text,string signature,string platform,string current,string key){if(text==null||Encoding.UTF8.GetByteCount(text)>65536||signature==null||signature.Length>1024)throw new InvalidDataException("manifest size");byte[] bytes=Encoding.UTF8.GetBytes(text),sig=Convert.FromBase64String(signature);using(var rsa=new RSACryptoServiceProvider()){rsa.FromXmlString(key);if(!rsa.VerifyData(bytes,CryptoConfig.MapNameToOID("SHA256"),sig))throw new CryptographicException("manifest signature");}
  var manifest=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(text);string version=Convert.ToString(manifest["version"]),tag=Convert.ToString(manifest["tag"]);if(!Regex.IsMatch(version,@"^\d{1,3}\.\d{1,3}\.\d{1,5}$")||!Regex.IsMatch(tag,@"^agent-"+Regex.Escape(version)+@"(?:-pilot\.\d+)?$"))throw new InvalidDataException("release version");
  if(Version.Parse(version)<=Version.Parse(current))return null;DateTime expires=DateTime.Parse(Convert.ToString(manifest["expires"]),null,System.Globalization.DateTimeStyles.RoundtripKind).ToUniversalTime();if(expires<DateTime.UtcNow||expires>DateTime.UtcNow.AddDays(45))throw new InvalidDataException("manifest expiry");
  var artifacts=(Dictionary<string,object>)manifest["artifacts"];var artifact=(Dictionary<string,object>)artifacts[platform];string name=Convert.ToString(artifact["name"]),hash=Convert.ToString(artifact["sha256"]);if(name!="ContourWatch-"+version+"-windows-x64.msi"||!Regex.IsMatch(hash,"^[a-f0-9]{64}$")||Convert.ToInt64(artifact["size"])<1000||Convert.ToInt64(artifact["size"])>100*1024*1024)throw new InvalidDataException("artifact");artifact["version"]=version;artifact["tag"]=tag;return artifact;
 }
 public static string Url(Dictionary<string,object> artifact){return "https://github.com/ServerProIT/ContourWatch/releases/download/"+artifact["tag"]+"/"+artifact["name"];}
}
}
