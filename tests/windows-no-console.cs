using System;using System.IO;using System.Runtime.InteropServices;using ContourWatch;
class NoConsoleRegression {
 [DllImport("kernel32.dll")]static extern bool FreeConsole();
 static int Main(string[] args){FreeConsole();try{Agent.ConfigureConsoleEncoding();File.WriteAllText(args[0],"PASS: no-console startup initialization");return 0;}catch(Exception e){File.WriteAllText(args[0],e.ToString());return 1;}}
}
