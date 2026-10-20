// Windows 窗口探测：用 PowerShell 调用 Win32 接口枚举窗口、读取边界、置前，边界均为物理像素。
import { execFile } from 'node:child_process'
import type { Rect, TargetWindow } from '../../shared/types'

const CSHARP_SOURCE = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);

  public static string Esc(string s) {
    StringBuilder b = new StringBuilder();
    foreach (char c in s) {
      if (c == '\\') b.Append("\\\\");
      else if (c == '"') b.Append("\\\"");
      else if (c < 0x20) b.Append("\\u").Append(((int)c).ToString("x4"));
      else b.Append(c);
    }
    return b.ToString();
  }

  public static string Describe(IntPtr h) {
    int len = GetWindowTextLength(h);
    StringBuilder sb = new StringBuilder(len + 1);
    GetWindowText(h, sb, sb.Capacity);
    uint pid; GetWindowThreadProcessId(h, out pid);
    string proc = "";
    try { proc = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
    RECT r;
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) return null;
    string title = Esc(sb.ToString());
    proc = Esc(proc);
    return "{\"hwnd\":\"" + h.ToInt64() + "\",\"pid\":" + pid + ",\"title\":\"" + title + "\",\"processName\":\"" + proc +
      "\",\"rect\":{\"x\":" + r.L + ",\"y\":" + r.T + ",\"width\":" + (r.R - r.L) + ",\"height\":" + (r.B - r.T) + "}}";
  }

  public static bool Usable(IntPtr h) {
    if (!IsWindowVisible(h) || IsIconic(h) || GetWindowTextLength(h) == 0) return false;
    int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4);
    return cloaked == 0;
  }

  public static string ListAll() {
    List<string> items = new List<string>();
    EnumWindows(delegate (IntPtr h, IntPtr p) {
      if (Usable(h)) { string d = Describe(h); if (d != null) items.Add(d); }
      return true;
    }, IntPtr.Zero);
    return "[" + string.Join(",", items.ToArray()) + "]";
  }

  public static string One(long handle) {
    IntPtr h = new IntPtr(handle);
    if (!IsWindow(h)) return "null";
    string d = Describe(h);
    return d == null ? "null" : d;
  }

  public static string Foreground() {
    IntPtr h = GetForegroundWindow();
    return h == IntPtr.Zero ? "null" : One(h.ToInt64());
  }

  public static string Focus(long handle) {
    IntPtr h = new IntPtr(handle);
    if (!IsWindow(h)) return "false";
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    return SetForegroundWindow(h) ? "true" : "false";
  }
}
`

function buildScript(call: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    `Add-Type -TypeDefinition @'\n${CSHARP_SOURCE}\n'@`,
    '[void][Win]::SetProcessDPIAware()',
    `[Console]::Out.Write(${call})`
  ].join('\n')
}

function runPowerShell(call: string, timeoutMs = 15000): Promise<string> {
  if (process.platform !== 'win32') return Promise.reject(new Error('窗口探测仅支持 Windows'))
  const encoded = Buffer.from(buildScript(call), 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`窗口探测失败: ${(stderr || error.message).trim().slice(0, 300)}`))
        else resolve(stdout)
      }
    )
  })
}

interface RawWindow {
  hwnd: string
  pid: number
  title: string
  processName: string
  rect: Rect
}

function toTarget(raw: RawWindow): TargetWindow {
  return { hwnd: raw.hwnd, title: raw.title, processName: raw.processName, rect: raw.rect }
}

function assertHandle(hwnd: string): string {
  if (!/^\d{1,20}$/.test(hwnd)) throw new Error('窗口句柄格式无效')
  return hwnd
}

const MIN_SIDE = 120

export async function listWindows(excludePid: number = process.pid): Promise<TargetWindow[]> {
  const raws = JSON.parse(await runPowerShell('[Win]::ListAll()')) as RawWindow[]
  return raws
    .filter((w) => w.pid !== excludePid && w.rect.width >= MIN_SIDE && w.rect.height >= MIN_SIDE)
    .map(toTarget)
}

export async function getForegroundWindow(): Promise<TargetWindow | null> {
  const raw = JSON.parse(await runPowerShell('[Win]::Foreground()')) as RawWindow | null
  return raw ? toTarget(raw) : null
}

// 读取窗口当前边界；窗口已关闭或最小化返回 null
export async function getWindowInfo(hwnd: string): Promise<TargetWindow | null> {
  const raw = JSON.parse(await runPowerShell(`[Win]::One(${assertHandle(hwnd)})`)) as RawWindow | null
  return raw ? toTarget(raw) : null
}

export async function focusWindow(hwnd: string): Promise<boolean> {
  const out = await runPowerShell(`[Win]::Focus(${assertHandle(hwnd)})`)
  return out.trim() === 'true'
}

// 等待指定毫秒后读取前台窗口，用于让用户切到目标窗口再选取；前台是本应用自己的窗口时返回 null
export async function pickForegroundAfter(delayMs: number): Promise<TargetWindow | null> {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
  const raw = JSON.parse(await runPowerShell('[Win]::Foreground()')) as RawWindow | null
  if (!raw || raw.pid === process.pid) return null
  return toTarget(raw)
}
