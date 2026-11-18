using System;using System.IO;using System.Drawing;using System.Windows.Forms;
namespace ContourWatch {
 public class DiagnosticWindow:Form {
  readonly TextBox body;readonly Label state;readonly string root;readonly Timer timer;
  public DiagnosticWindow(string directory){root=directory;Text="Контур · логи и диагностика";Width=1000;Height=700;MinimumSize=new Size(600,420);StartPosition=FormStartPosition.CenterScreen;Font=new Font("Segoe UI",10);
   body=new TextBox{Multiline=true,ReadOnly=true,Dock=DockStyle.Fill,ScrollBars=ScrollBars.Both,WordWrap=false,Font=new Font("Consolas",10)};
   state=new Label{Dock=DockStyle.Bottom,Height=42,Padding=new Padding(8),Text="Снимок датчиков и последние записи службы. Секреты и очередь метрик не экспортируются."};
   var tools=new FlowLayoutPanel{Dock=DockStyle.Top,AutoSize=true,Padding=new Padding(8)};var refresh=new Button{Text="Обновить",AutoSize=true};refresh.Click+=(s,e)=>RefreshLog();tools.Controls.Add(refresh);
   var follow=new AgentTheme.AgentCheckBox{Text="Автообновление (5 с)",AutoSize=true,Padding=new Padding(8)};tools.Controls.Add(follow);
   var text=new Button{Text="Сохранить в TXT…",AutoSize=true};text.Click+=(s,e)=>Save(false);tools.Controls.Add(text);var zip=new Button{Text="Сохранить архив ZIP…",AutoSize=true};zip.Click+=(s,e)=>Save(true);tools.Controls.Add(zip);tools.Controls.Add(AgentTheme.Picker(this));
   Controls.Add(body);Controls.Add(state);Controls.Add(tools);AgentTheme.Apply(this);timer=new Timer{Interval=5000};timer.Tick+=(s,e)=>{if(follow.Checked)RefreshLog();};timer.Start();FormClosed+=(s,e)=>timer.Dispose();RefreshLog();
  }
  void RefreshLog(){try{string text=DiagnosticReport.Text(root);if(body.Text!=text)body.Text=text;state.Text="Прочитано локально: "+DateTime.Now.ToString("G")+" · время записей UTC · можно сохранить TXT или ZIP";}catch(Exception e){state.Text="Не удалось прочитать журнал: "+e.GetType().Name;}}
  void Save(bool zip){using(var dialog=new AgentSaveDialog(zip?".zip":".txt")){if(dialog.ShowDialog(this)!=DialogResult.OK)return;try{string temp=dialog.FileName+"."+Guid.NewGuid().ToString("N")+".tmp";try{if(zip)DiagnosticReport.ExportPublic(root,temp);else File.WriteAllText(temp,DiagnosticReport.Text(root),new System.Text.UTF8Encoding(false));if(File.Exists(dialog.FileName))File.Replace(temp,dialog.FileName,null);else File.Move(temp,dialog.FileName);}finally{if(File.Exists(temp))File.Delete(temp);}state.Text="Сохранено: "+dialog.FileName;}catch(Exception e){state.Text="Не удалось сохранить: "+e.GetType().Name;AgentTheme.ShowMessage(this,"Не удалось сохранить файл. Выберите доступную папку.\n"+e.Message,"Контур",MessageBoxButtons.OK,MessageBoxIcon.Warning);}}}
 }
}
