// Shanon – instalace pro Windows (Shanon-instalace.exe).
//
// Jeden stejný soubor pro všechny (podepisuje se jednou — scripts/build-station-exe.ps1). Odkaz na instalaci
// (adresa Shanonu + jednorázový párovací kód) si zjistí ze záznamu Windows o původu staženého souboru
// (Zone.Identifier → HostUrl …/api/station/installer/<kód>), jinak z parametru, ze schránky (Shanon ho tam při
// kliknutí na Nainstalovat zkopíruje), nebo se na něj zeptá.
// Stáhne instalační skript z téhož Shanonu (src/station/stanice.ps1 s adresou, kódem a ikonou) a spustí ho
// skrytě; okno ukazuje průběh, závěrečnou zprávu ukáže skript.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;

[assembly: AssemblyTitle("Shanon - instalace")]
[assembly: AssemblyDescription("Shanon pro Windows: zástupce aplikace a tisk bez dialogu")]
[assembly: AssemblyProduct("Shanon")]
[assembly: AssemblyCompany("Shanon")]
[assembly: AssemblyCopyright("Shanon")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class ShanonSetup
{
    static readonly Regex Link = new Regex(@"(https?://[^\s/]+)/api/station/installer/(shp\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,})", RegexOptions.IgnoreCase);
    const string Title = "Shanon";

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

    /// <summary>záznam o původu staženého souboru (alternativní datový proud NTFS)</summary>
    static string ReadZone(string path)
    {
        try
        {
            SafeFileHandle h = CreateFile(path + ":Zone.Identifier", 0x80000000, 1, IntPtr.Zero, 3, 0, IntPtr.Zero);
            if (h.IsInvalid) return "";
            using (FileStream fs = new FileStream(h, FileAccess.Read))
            using (StreamReader r = new StreamReader(fs)) return r.ReadToEnd();
        }
        catch { return ""; }
    }

    static Icon AppIcon()
    {
        try { return Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { return null; }
    }

    static string Clip()
    {
        try { return Clipboard.ContainsText() ? Clipboard.GetText() : ""; } catch { return ""; }
    }

    /// <summary>zeptat se na odkaz na instalaci (soubor bez záznamu o původu)</summary>
    static string AskLink()
    {
        Form f = new Form();
        f.Text = Title;
        f.Icon = AppIcon();
        f.FormBorderStyle = FormBorderStyle.FixedDialog;
        f.MaximizeBox = false;
        f.MinimizeBox = false;
        f.StartPosition = FormStartPosition.CenterScreen;
        f.ClientSize = new Size(460, 130);
        f.Font = new Font("Segoe UI", 9.5f);
        Label l = new Label();
        l.Text = "Vložte odkaz na instalaci ze Shanonu — najdete ho u staženého souboru v prohlížeči (Ctrl+J):";
        l.SetBounds(14, 12, 432, 36);
        TextBox t = new TextBox();
        t.SetBounds(14, 52, 432, 24);
        Button ok = new Button();
        ok.Text = "Pokračovat";
        ok.DialogResult = DialogResult.OK;
        ok.SetBounds(256, 90, 100, 28);
        Button cancel = new Button();
        cancel.Text = "Zrušit";
        cancel.DialogResult = DialogResult.Cancel;
        cancel.SetBounds(362, 90, 84, 28);
        f.Controls.AddRange(new Control[] { l, t, ok, cancel });
        f.AcceptButton = ok;
        f.CancelButton = cancel;
        return f.ShowDialog() == DialogResult.OK ? t.Text.Trim() : null;
    }

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
        string source = args.Length > 0 ? string.Join(" ", args) : ReadZone(Application.ExecutablePath);
        Match m = Link.Match(source);
        if (!m.Success) m = Link.Match(Clip());
        if (!m.Success)
        {
            string typed = AskLink();
            if (typed == null) return 1;
            m = Link.Match(typed);
            if (!m.Success)
            {
                MessageBox.Show("Tohle není odkaz na instalaci Shanonu.", Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }
        }
        string url = m.Groups[1].Value;
        string code = m.Groups[2].Value;

        Form f = new Form();
        f.Text = Title;
        f.Icon = AppIcon();
        f.FormBorderStyle = FormBorderStyle.FixedDialog;
        f.MaximizeBox = false;
        f.StartPosition = FormStartPosition.CenterScreen;
        f.ClientSize = new Size(380, 96);
        f.Font = new Font("Segoe UI", 10f);
        Label label = new Label();
        label.Text = "Instaluji Shanon…";
        label.SetBounds(18, 16, 344, 24);
        ProgressBar bar = new ProgressBar();
        bar.Style = ProgressBarStyle.Marquee;
        bar.SetBounds(18, 50, 344, 18);
        f.Controls.Add(label);
        f.Controls.Add(bar);

        string error = null;
        int exit = 0;
        Thread work = new Thread(() =>
        {
            string tmp = Path.Combine(Path.GetTempPath(), "shanon-setup-" + Guid.NewGuid().ToString("N") + ".ps1");
            try
            {
                using (WebClient wc = new WebClient()) wc.DownloadFile(url + "/api/station/installer/" + code + "/setup.ps1", tmp);
                ProcessStartInfo psi = new ProcessStartInfo(
                    Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"),
                    "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + tmp + "\"");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                Process p = Process.Start(psi);
                p.WaitForExit();
                exit = p.ExitCode;
            }
            catch (WebException e)
            {
                HttpWebResponse r = e.Response as HttpWebResponse;
                error = r != null && r.StatusCode == HttpStatusCode.NotFound
                    ? "Odkaz na instalaci už neplatí (platí 3 dny a jen jednou). V Shanonu klikněte znovu na Nainstalovat."
                    : "Shanon není dostupný: " + e.Message;
                exit = 2;
            }
            catch (Exception e)
            {
                error = e.Message;
                exit = 2;
            }
            finally
            {
                try { File.Delete(tmp); } catch { }
            }
            f.BeginInvoke(new Action(f.Close));
        });
        work.IsBackground = true;
        f.Shown += (s, e) => work.Start();
        Application.Run(f);
        if (error != null) MessageBox.Show("Instalace se nepovedla.\n\n" + error, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
        return exit;
    }
}
