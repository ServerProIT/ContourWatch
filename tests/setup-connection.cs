using System;using System.Reflection;
class SetupConnectionTest {
 static int Main(string[] args){try{var assembly=Assembly.LoadFrom(args[0]);var method=assembly.GetType("Setup").GetMethod("Main",BindingFlags.Static|BindingFlags.NonPublic);var result=(int)method.Invoke(null,new object[]{new[]{"--silent","--check-connection="+args[1]}});Console.WriteLine(result==0?"PASS actual installer TLS health check":"FAIL actual installer health check");return result;}catch(Exception e){Console.Error.WriteLine(e.GetType().Name);return 1;}}
}
