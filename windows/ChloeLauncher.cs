// Chloe for Windows: starts the bundled local server (127.0.0.1:3004) and opens
// Chloe in its own Edge/Chrome app window. When that window closes, the server
// this launcher started is stopped as well. Compiled by windows/build-setup.ps1
// with the .NET Framework csc.exe that ships with Windows 10/11.
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("Chloe Assistant")]
[assembly: System.Reflection.AssemblyProduct("Chloe Assistant")]
[assembly: System.Reflection.AssemblyCompany("Berkay Atağ")]
[assembly: System.Reflection.AssemblyCopyright("© 2026 Berkay Atağ · Chloe Assistant")]
[assembly: System.Reflection.AssemblyVersion(ChloeVersion.Value)]
[assembly: System.Reflection.AssemblyFileVersion(ChloeVersion.Value)]

static class ChloeLauncher
{
    const int Port = 3004;
    const string Url = "http://127.0.0.1:3004/";
    const string Title = "Chloe Assistant";

    [STAThread]
    static int Main()
    {
        bool first;
        using (var mutex = new Mutex(true, @"Local\ChloeAssistantLauncher", out first))
        {
            if (!first)
            {
                // Another launcher is already starting the server; just show a window once it is ready.
                if (WaitForChloe(60)) OpenWindow(DataRoot());
                return 0;
            }
            return Run(mutex);
        }
    }

    static string DataRoot()
    {
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Chloe");
        Directory.CreateDirectory(root);
        return root;
    }

    static int Run(Mutex mutex)
    {
        var installDir = AppDomain.CurrentDomain.BaseDirectory;
        var appDir = Path.Combine(installDir, "app");
        var node = Path.Combine(installDir, "runtime", "chloe-node.exe");
        var dataRoot = DataRoot();
        Process server = null;

        if (!IsChloe())
        {
            if (PortInUse())
            {
                Fail("127.0.0.1:" + Port + " portu başka bir uygulama tarafından kullanılıyor. O uygulamayı kapatıp Chloe'yi yeniden aç.");
                return 1;
            }
            if (!File.Exists(node) || !File.Exists(Path.Combine(appDir, "server.js")))
            {
                Fail("Chloe dosyaları eksik. Kurulumu yeniden çalıştır.");
                return 1;
            }
            var logPath = Path.Combine(dataRoot, "server.log");
            var info = new ProcessStartInfo(node, "server.js")
            {
                WorkingDirectory = appDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            info.EnvironmentVariables["PORT"] = Port.ToString();
            info.EnvironmentVariables["HOSTNAME"] = "127.0.0.1";
            info.EnvironmentVariables["NODE_ENV"] = "production";
            info.EnvironmentVariables["NEXT_TELEMETRY_DISABLED"] = "1";
            var log = new StreamWriter(logPath, false) { AutoFlush = true };
            server = Process.Start(info);
            server.OutputDataReceived += (s, e) => { if (e.Data != null) lock (log) log.WriteLine(e.Data); };
            server.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (log) log.WriteLine(e.Data); };
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();

            var deadline = DateTime.UtcNow.AddSeconds(90);
            while (!IsChloe())
            {
                if (server.HasExited || DateTime.UtcNow > deadline)
                {
                    StopTree(server);
                    Fail("Chloe sunucusu başlatılamadı. Ayrıntılar: " + logPath);
                    return 1;
                }
                Thread.Sleep(400);
            }
        }

        var window = OpenWindow(dataRoot);
        mutex.ReleaseMutex();
        // Without a dedicated app window (no Edge/Chrome) the server keeps running
        // for the default browser and is reused on the next launch.
        if (server != null && window != null)
        {
            window.WaitForExit();
            StopTree(server);
        }
        return 0;
    }

    static Process OpenWindow(string dataRoot)
    {
        var browser = FindBrowser();
        if (browser != null)
        {
            var profile = Path.Combine(dataRoot, "window-profile");
            var args = "--app=" + Url + " --user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check --window-size=1440,920";
            try { return Process.Start(new ProcessStartInfo(browser, args) { UseShellExecute = false }); }
            catch { /* fall back to the default browser */ }
        }
        Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });
        return null;
    }

    static string FindBrowser()
    {
        foreach (var exe in new[] { "msedge.exe", "chrome.exe" })
        {
            foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                using (var key = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
                {
                    var path = key == null ? null : key.GetValue(null) as string;
                    if (!string.IsNullOrEmpty(path) && File.Exists(path.Trim('"'))) return path.Trim('"');
                }
            }
        }
        var fallback = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe");
        return File.Exists(fallback) ? fallback : null;
    }

    static bool IsChloe()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(Url);
            request.Timeout = 1500;
            request.Proxy = null;
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
                return response.StatusCode == HttpStatusCode.OK && reader.ReadToEnd().Contains("Chloe");
        }
        catch { return false; }
    }

    static bool WaitForChloe(int seconds)
    {
        var deadline = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < deadline) { if (IsChloe()) return true; Thread.Sleep(400); }
        return false;
    }

    static bool PortInUse()
    {
        try { using (var client = new TcpClient()) { return client.ConnectAsync("127.0.0.1", Port).Wait(500) && client.Connected; } }
        catch { return false; }
    }

    static void StopTree(Process process)
    {
        try
        {
            if (process.HasExited) return;
            // taskkill /T also ends child processes such as the automation browser.
            Process.Start(new ProcessStartInfo("taskkill", "/pid " + process.Id + " /T /F") { CreateNoWindow = true, UseShellExecute = false }).WaitForExit(5000);
        }
        catch { }
    }

    static void Fail(string message)
    {
        MessageBox.Show(message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
