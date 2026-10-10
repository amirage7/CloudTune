using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class CloudTuneExe
{
    internal static string AppRoot;
    internal static Process Worker;
    internal static string UserKey { get { return WindowsIdentity.GetCurrent().User.Value.Replace('-', '_'); } }
    internal static Process StartNode(string action, bool noBrowser)
    {
        var info = new ProcessStartInfo(Path.Combine(AppRoot, "runtime", "node.exe"), "network-bootstrap.js " + action + (noBrowser ? " --no-browser" : ""));
        info.WorkingDirectory = AppRoot; info.UseShellExecute = false; info.CreateNoWindow = true;
        info.RedirectStandardOutput = true; info.RedirectStandardError = true;
        info.StandardOutputEncoding = System.Text.Encoding.UTF8; info.StandardErrorEncoding = System.Text.Encoding.UTF8;
        var child = new Process { StartInfo = info, EnableRaisingEvents = true };
        return child;
    }
    internal static string Prepare()
    {
        string apps = Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CloudTune", "app");
        Directory.CreateDirectory(apps);
        string target = Path.Combine(apps, BuildInfo.Version + "-" + BuildInfo.Hash.Substring(0, 12));
        using (var mutex = new Mutex(false, "Local\\CloudTuneExtract_" + UserKey))
        {
            bool acquired = false;
            try
            {
                try { acquired = mutex.WaitOne(90000); } catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new IOException("另一个 CloudTune 正在准备组件，请稍后重试。");
                string marker = Path.Combine(target, ".complete");
                if (File.Exists(marker) && File.ReadAllText(marker) == BuildInfo.Hash && File.Exists(Path.Combine(target, "runtime", "node.exe")) && File.Exists(Path.Combine(target, "network-bootstrap.js"))) return target;
                string temporary = Path.Combine(apps, ".prepare-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(temporary);
                try
                {
                    using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("CloudTune.Payload"))
                    {
                        if (payload == null) throw new IOException("内置组件缺失，请重新下载完整 EXE。");
                        using (var sha = SHA256.Create())
                        {
                            string hash = BitConverter.ToString(sha.ComputeHash(payload)).Replace("-", "").ToLowerInvariant();
                            if (hash != BuildInfo.Hash) throw new IOException("内置组件校验失败，请重新下载完整 EXE。");
                        }
                        payload.Position = 0;
                        using (var archive = new ZipArchive(payload, ZipArchiveMode.Read))
                        {
                            string prefix = Path.GetFullPath(temporary) + Path.DirectorySeparatorChar;
                            foreach (var entry in archive.Entries)
                            {
                                string destination = Path.GetFullPath(Path.Combine(temporary, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                                if (!destination.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new IOException("组件压缩包路径无效。");
                                if (entry.Name.Length == 0) { Directory.CreateDirectory(destination); continue; }
                                Directory.CreateDirectory(Path.GetDirectoryName(destination));
                                using (var input = entry.Open()) using (var output = File.Create(destination)) input.CopyTo(output);
                            }
                        }
                    }
                    File.WriteAllText(Path.Combine(temporary, ".complete"), BuildInfo.Hash);
                    if (Directory.Exists(target)) Directory.Move(target, Path.Combine(apps, ".previous-" + Guid.NewGuid().ToString("N")));
                    Directory.Move(temporary, target); return target;
                }
                finally { if (Directory.Exists(temporary)) Directory.Delete(temporary, true); }
            }
            finally { if (acquired) mutex.ReleaseMutex(); }
        }
    }
    internal static void Drain(Process child)
    {
        child.OutputDataReceived += delegate { }; child.ErrorDataReceived += delegate { };
        child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine();
    }
    internal static bool Stop()
    {
        using (var stop = StartNode("stop", true))
        {
            Drain(stop); if (!stop.WaitForExit(20000)) return false;
            if (stop.ExitCode != 0) return false;
        }
        return Worker == null || Worker.HasExited || Worker.WaitForExit(15000);
    }
    [STAThread]
    internal static int Main(string[] args)
    {
        try
        {
            if (Array.IndexOf(args, "--extract-only") >= 0) { AppRoot = Prepare(); return 0; }
            if (Array.IndexOf(args, "--stop") >= 0) { AppRoot = Prepare(); return Stop() ? 0 : 1; }
            bool headless = Array.IndexOf(args, "--no-window") >= 0;
            using (var owner = new Mutex(false, "Local\\CloudTuneWindow_" + UserKey))
            {
                bool owns = false;
                if (!headless) { try { owns = owner.WaitOne(0); } catch (AbandonedMutexException) { owns = true; } }
                try
                {
                    if (headless || !owns)
                    {
                        AppRoot = Prepare(); using (Worker = StartNode("start", headless)) { Drain(Worker); Worker.WaitForExit(); return Worker.ExitCode; }
                    }
                    Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false); Application.Run(new LaunchWindow()); return 0;
                }
                finally { if (owns) owner.ReleaseMutex(); }
            }
        }
        catch (Exception error)
        {
            if (args.Length == 0) MessageBox.Show("无法启动 CloudTune：" + error.Message, "CloudTune", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
internal sealed class LaunchWindow : Form
{
    readonly Label status = new Label(); readonly Label help = new Label(); readonly Button open = new Button(); readonly Button exit = new Button(); readonly ProgressBar progress = new ProgressBar();
    bool closing = false; bool allowClose = false; bool ready = false;
    internal LaunchWindow()
    {
        Text = "CloudTune"; ClientSize = new Size(460, 260); FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen; Font = new Font("Microsoft YaHei UI", 10);
        var title = new Label { Text = "CloudTune", Font = new Font(Font.FontFamily, 20, FontStyle.Bold), Location = new Point(24, 20), AutoSize = true };
        status.SetBounds(24, 75, 412, 35); status.Text = "正在准备组件，首次打开需要稍等…";
        progress.SetBounds(24, 112, 412, 5); progress.Style = ProgressBarStyle.Marquee;
        help.SetBounds(24, 134, 412, 53); help.Text = "启动后会自动打开网页。音乐与登录记录保存在此电脑。";
        open.SetBounds(24, 202, 190, 36); open.Text = "打开音乐网页"; open.Enabled = false;
        exit.SetBounds(246, 202, 190, 36); exit.Text = "退出 CloudTune";
        Controls.AddRange(new Control[] { title, status, progress, help, open, exit });
        open.Click += delegate { Task.Run(delegate { using (var p = CloudTuneExe.StartNode("start", false)) { CloudTuneExe.Drain(p); p.WaitForExit(10000); } }); };
        exit.Click += delegate { Close(); }; FormClosing += Closing;
        Shown += async delegate
        {
            try { CloudTuneExe.AppRoot = await Task.Run(() => CloudTuneExe.Prepare()); if (IsDisposed) return; Launch(); }
            catch (Exception e) { if (!IsDisposed) { progress.Visible = false; status.Text = "准备失败，请重新下载完整 EXE。"; help.Text = e.Message; } }
        };
    }
    void Ui(Action action) { if (!IsDisposed && IsHandleCreated) try { BeginInvoke(action); } catch (InvalidOperationException) { } }
    void Launch()
    {
        CloudTuneExe.Worker = CloudTuneExe.StartNode("start", false);
        DataReceivedEventHandler output = delegate(object sender, DataReceivedEventArgs args)
        {
            if (args.Data == null) return;
            if (args.Data.StartsWith("浏览器地址：")) Ui(delegate { ready = true; status.Text = "已启动，正在浏览器中使用 CloudTune"; help.Text = "关闭网页不会退出应用。使用结束时关闭本窗口即可。"; progress.Visible = false; open.Enabled = true; });
            if (args.Data.StartsWith("启动/停止失败：")) Ui(delegate { status.Text = "启动失败"; help.Text = args.Data; progress.Visible = false; });
        };
        CloudTuneExe.Worker.OutputDataReceived += output; CloudTuneExe.Worker.ErrorDataReceived += output;
        CloudTuneExe.Worker.Exited += delegate { Ui(delegate { if (closing) return; if (CloudTuneExe.Worker.ExitCode == 0) { allowClose = true; Close(); } else { progress.Visible = false; status.Text = "启动未完成，请退出后重试。"; } }); };
        CloudTuneExe.Worker.Start(); CloudTuneExe.Worker.BeginOutputReadLine(); CloudTuneExe.Worker.BeginErrorReadLine();
    }
    async void Closing(object sender, FormClosingEventArgs e)
    {
        if (allowClose || CloudTuneExe.Worker == null || CloudTuneExe.Worker.HasExited) return;
        e.Cancel = true; if (closing) return; closing = true; exit.Enabled = open.Enabled = false; status.Text = "正在停止，保留音乐与登录记录…";
        bool stopped = false;
        try { stopped = await Task.Run(delegate { for (int i = 0; i < 100 && !ready && !CloudTuneExe.Worker.HasExited; i++) Thread.Sleep(100); return CloudTuneExe.Stop(); }); }
        catch (Exception error) { help.Text = "停止失败：" + error.Message; }
        if (stopped) { allowClose = true; Close(); }
        else { closing = false; exit.Enabled = true; open.Enabled = ready; status.Text = "尚未停止，请稍后再点退出。"; }
    }
}
