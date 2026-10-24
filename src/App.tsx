import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Shield,
  Wifi,
  Radio,
  Clock,
  ArrowUp,
  ArrowDown,
  Server,
  Plus,
  Share2,
  Edit2,
  Trash2,
  Copy,
  Terminal,
  Settings as SettingsIcon,
  Download,
  Search,
  CheckCircle2,
  AlertTriangle,
  Play,
  Square,
  ExternalLink,
  ChevronDown,
  Info,
  Lock,
  Zap,
  RefreshCw,
  Eye,
  EyeOff,
  Check
} from 'lucide-react';
import { ConnectionStatus, LogEntry, SshProfile, TrafficStats, AppSettings } from './types';
import { Store } from './data/store';
import { ProfileLink } from './data/profileLink';

const PROTOCOLS: { key: SshProfile['method']; label: string; desc: string }[] = [
  { key: 'direct', label: 'SSH-Direct', desc: 'Standard direct SSH TCP tunnel' },
  { key: 'proxy', label: 'SSH-Proxy', desc: 'SSH through HTTP or SOCKS5 proxy' },
  { key: 'tls', label: 'SSH-TLS', desc: 'SSH wrapped in TLS (SNI bypass)' },
  { key: 'tls-proxy', label: 'SSH-TLS-Proxy', desc: 'TLS tunnel through HTTP CONNECT proxy' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatHms(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function App() {
  const [tab, setTab] = useState<'home' | 'profiles' | 'logs' | 'settings'>('home');
  const [profiles, setProfiles] = useState<SshProfile[]>(() => Store.getProfiles());
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const saved = Store.getSelectedId();
    if (saved && profiles.some(p => p.id === saved)) return saved;
    return profiles[0]?.id || null;
  });
  const [settings, setSettings] = useState<AppSettings>(() => Store.getSettings());

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number>(0);
  const [extraSeconds, setExtraSeconds] = useState<number>(0);

  const [traffic, setTraffic] = useState<TrafficStats>({
    upBps: 0,
    downBps: 0,
    upTotal: 0,
    downTotal: 0,
  });

  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: 'init-1',
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: 'GodarmX SSH Tunnel VPN Engine initialized',
    },
    {
      id: 'init-2',
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: 'SOCKS5 local listener ready on port 1080',
    },
  ]);

  // Dialog states
  const [editingProfile, setEditingProfile] = useState<SshProfile | null>(null);
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [showConfirmDeleteAll, setShowConfirmDeleteAll] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Search & Ping states in Profiles tab
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pings, setPings] = useState<Record<string, string>>({});

  const logsEndRef = useRef<HTMLDivElement>(null);
  const selectedProfile = useMemo(() => profiles.find(p => p.id === selectedId), [profiles, selectedId]);

  // Persist profiles & settings
  const updateProfiles = (newProfiles: SshProfile[]) => {
    setProfiles(newProfiles);
    Store.saveProfiles(newProfiles);
  };

  const updateSelectedId = (id: string | null) => {
    setSelectedId(id);
    Store.saveSelectedId(id);
  };

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    Store.saveSettings(updated);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(current => (current === msg ? null : current));
    }, 3000);
  };

  const addLog = (level: LogEntry['level'], message: string) => {
    const entry: LogEntry = {
      id: `log-${Date.now()}-${Math.random()}`,
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
    };
    setLogs(prev => [...prev.slice(-400), entry]);
  };

  // Timer loop when connected
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (status === 'connected' && connectedAt) {
      interval = setInterval(() => {
        const secs = Math.floor((Date.now() - connectedAt) / 1000);
        setElapsed(secs);

        // Auto disconnect check
        if (settings.autoStopMin > 0) {
          const totalAllowed = settings.autoStopMin * 60 + extraSeconds;
          if (secs >= totalAllowed) {
            handleDisconnect();
            addLog('warn', `Auto-disconnect timer reached (${settings.autoStopMin} min limit). Session closed.`);
            if (settings.showToasts) showToast('Auto-disconnect timer reached');
          }
        }

        // Simulate traffic throughput
        const upStep = Math.floor(Math.random() * 45000) + 12000;
        const downStep = Math.floor(Math.random() * 280000) + 65000;
        setTraffic(prev => ({
          upBps: upStep,
          downBps: downStep,
          upTotal: prev.upTotal + upStep,
          downTotal: prev.downTotal + downStep,
        }));
      }, 1000);
    } else {
      setTraffic(prev => ({ ...prev, upBps: 0, downBps: 0 }));
    }
    return () => clearInterval(interval);
  }, [status, connectedAt, extraSeconds, settings.autoStopMin]);

  // Connect Handler
  const handleConnect = (profileToUse?: SshProfile) => {
    const target = profileToUse || selectedProfile;
    if (!target) {
      showToast('Select or create a profile first');
      return;
    }

    if (settings.vibrate && 'vibrate' in navigator) {
      try { navigator.vibrate(100); } catch (_) {}
    }

    setStatus('connecting');
    addLog('info', `Connecting to ${target.name} [${target.host}:${target.port}] via ${target.method.toUpperCase()}...`);

    if (target.method.startsWith('tls')) {
      addLog('info', `TLS handshake initialized with SNI: ${target.host} (Min TLS: ${settings.minTls})`);
    }
    if (target.method.endsWith('proxy') && target.proxyHost) {
      addLog('info', `Routing through ${target.proxyType?.toUpperCase()} proxy at ${target.proxyHost}:${target.proxyPort}`);
    }

    setTimeout(() => {
      // Simulate successful SSH handshake
      addLog('info', `SSH Version: SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u2`);
      addLog('info', `KEX: curve25519-sha256@libssh.org, Cipher: chacha20-poly1305@openssh.com`);
      addLog('info', `Host Key Fingerprint: SHA256:${Math.random().toString(36).substring(2, 18).toUpperCase()}`);
      addLog('info', `Authenticating as '${target.username}' via ${target.privateKey ? 'publickey' : 'password'}`);

      if (target.udpgwEnabled) {
        addLog('info', `UDPGW forwarder relay enabled on port ${target.udpgwPort || 7300}`);
      }

      addLog('success', `Direct-tcpip tunnel established! Local SOCKS5 active on 127.0.0.1:${settings.socksPort}`);
      addLog('success', `DNS mapped and tunneled securely through SSH server.`);

      setStatus('connected');
      const now = Date.now();
      setConnectedAt(now);
      setElapsed(0);
      setExtraSeconds(0);

      if (settings.showToasts) showToast(`Connected to ${target.name}`);
      if (settings.openLogsOnConnect) setTab('logs');
    }, 1200);
  };

  const handleDisconnect = () => {
    if (settings.vibrate && 'vibrate' in navigator) {
      try { navigator.vibrate([60, 50, 60]); } catch (_) {}
    }
    addLog('warn', `Terminating SSH tunnel session...`);
    addLog('info', `TUN interface released. Total traffic: ↑ ${formatBytes(traffic.upTotal)} | ↓ ${formatBytes(traffic.downTotal)}`);
    setStatus('disconnected');
    setConnectedAt(null);
    setElapsed(0);
    if (settings.showToasts) showToast('Disconnected');
  };

  const handleTestPing = (p: SshProfile) => {
    setPings(prev => ({ ...prev, [p.id]: '...' }));
    addLog('debug', `Testing latency to ${p.host}:${p.port}...`);
    const delay = Math.floor(Math.random() * 85) + 25;
    setTimeout(() => {
      const result = `${delay} ms`;
      setPings(prev => ({ ...prev, [p.id]: result }));
      addLog('info', `Latency to ${p.name} (${p.host}): ${result}`);
    }, delay + 150);
  };

  const handleShareProfile = (p: SshProfile) => {
    const link = ProfileLink.format(p);
    navigator.clipboard.writeText(link).then(() => {
      showToast('Profile link copied to clipboard');
      addLog('info', `Exported profile link: ${p.name}`);
    });
  };

  const handleCopyAll = () => {
    if (profiles.length === 0) return;
    const text = profiles.map(p => ProfileLink.format(p)).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      showToast(`${profiles.length} profiles copied to clipboard`);
      addLog('info', `Exported ${profiles.length} profile links.`);
    });
  };

  // Filtered profiles for search
  const filteredProfiles = useMemo(() => {
    if (!searchQuery.trim()) return profiles;
    const q = searchQuery.toLowerCase();
    return profiles.filter(p => p.name.toLowerCase().includes(q) || p.host.toLowerCase().includes(q) || p.username.toLowerCase().includes(q));
  }, [profiles, searchQuery]);

  return (
    <div className="relative min-h-screen bg-[#0B1F12] text-slate-100 flex flex-col font-sans overflow-x-hidden">
      {/* Background Cyber Glowing Orbs (matching AppBackground in Compose) */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-emerald-500/10 blur-3xl"></div>
        <div className="absolute top-1/3 -left-32 w-80 h-80 rounded-full bg-emerald-400/10 blur-3xl"></div>
        <div className="absolute -bottom-32 right-1/4 w-96 h-96 rounded-full bg-emerald-600/15 blur-3xl"></div>
        <div className="absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:32px_32px] opacity-10"></div>
      </div>

      {/* Toast Banner */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-950/95 border border-emerald-500/60 text-emerald-200 px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-2 text-sm backdrop-blur-md animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Bar */}
      <header className="relative z-10 border-b border-emerald-900/40 bg-[#0A1410]/80 backdrop-blur-md px-4 py-3 sm:px-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-800 p-0.5 shadow-lg shadow-emerald-950/60 flex items-center justify-center">
              <Shield className="w-5 h-5 text-black" />
            </div>
            <div>
              <div className="flex items-center gap-1">
                <span className="font-extrabold text-lg tracking-tight text-white">Godarm</span>
                <span className="font-extrabold text-lg text-emerald-400">X</span>
                <span className="ml-2 text-[10px] tracking-widest font-semibold px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-300 border border-emerald-700/40 uppercase">
                  SSH VPN
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">TUN → hev-socks5 → SSH direct-tcpip</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium ${
              status === 'connected' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
              status === 'connecting' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse' :
              status === 'error' ? 'bg-red-500/20 text-red-300 border border-red-500/40' :
              'bg-slate-800/80 text-slate-400 border border-slate-700/50'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                status === 'connected' ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' :
                status === 'connecting' ? 'bg-amber-400' :
                status === 'error' ? 'bg-red-400' : 'bg-slate-500'
              }`}></span>
              {status.toUpperCase()}
            </span>

            <a
              href="/sshvpn-source-for-github.zip"
              download="sshvpn-source-for-github.zip"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 text-xs font-medium border border-emerald-700/40 transition-colors"
              title="Download original Android source ZIP"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Android ZIP</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 pb-24">
        {/* TAB 1: HOME */}
        {tab === 'home' && (
          <div className="flex flex-col items-center justify-center space-y-6 pt-4 max-w-md mx-auto">
            {/* Visual Logo / Pulse */}
            <div className="relative group">
              <div className={`absolute inset-0 rounded-full blur-2xl transition-all duration-700 ${
                status === 'connected' ? 'bg-emerald-500/30 scale-125' :
                status === 'connecting' ? 'bg-amber-500/30 scale-110 animate-ping' :
                'bg-emerald-900/10 scale-90'
              }`}></div>
              <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-3xl bg-gradient-to-b from-[#163a24] to-[#0A1410] border border-emerald-500/30 shadow-2xl flex flex-col items-center justify-center p-4">
                <Shield className={`w-12 h-12 transition-colors duration-500 ${
                  status === 'connected' ? 'text-emerald-400 drop-shadow-[0_0_12px_#34d399]' :
                  status === 'connecting' ? 'text-amber-400 animate-pulse' :
                  'text-slate-500'
                }`} />
                <span className="mt-2 text-xs font-mono font-bold tracking-wider text-emerald-300/80">
                  {status === 'connected' ? 'SECURED' : 'DISARMED'}
                </span>
              </div>
            </div>

            {/* Profile Selector */}
            <div className="w-full">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Target SSH Server
              </label>
              <div className="relative">
                <select
                  disabled={status === 'connected' || status === 'connecting'}
                  value={selectedId || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    updateSelectedId(id);
                    if (settings.autoConnectOnSelect && status === 'disconnected') {
                      const p = profiles.find(item => item.id === id);
                      if (p) handleConnect(p);
                    }
                  }}
                  className="w-full appearance-none bg-[#12281a] border border-emerald-700/50 hover:border-emerald-500/80 disabled:opacity-60 text-slate-100 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all cursor-pointer pr-10 shadow-lg"
                >
                  {profiles.length === 0 ? (
                    <option value="">No profile found - import or add in Profiles</option>
                  ) : (
                    profiles.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.host}:{p.port}) [{p.method.toUpperCase()}]
                      </option>
                    ))
                  )}
                </select>
                <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400 pointer-events-none" />
              </div>

              {selectedProfile && (
                <div className="mt-2 flex items-center justify-between text-xs text-slate-400 font-mono">
                  <span>Method: <strong className="text-emerald-300">{selectedProfile.method.toUpperCase()}</strong></span>
                  {selectedProfile.udpgwEnabled && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/60 text-[10px]">
                      + UDPGW ({selectedProfile.udpgwPort || 7300})
                    </span>
                  )}
                  {selectedProfile.proxyHost && (
                    <span className="text-slate-400">via {selectedProfile.proxyType?.toUpperCase()}</span>
                  )}
                </div>
              )}
            </div>

            {/* Status and Timer Display */}
            <div className="w-full bg-[#102417]/80 border border-emerald-800/40 rounded-2xl p-5 text-center shadow-xl backdrop-blur-md">
              <div className="text-sm font-medium text-slate-400 mb-1">Tunnel Status</div>
              <div className={`text-2xl font-bold font-mono tracking-tight ${
                status === 'connected' ? 'text-emerald-400' :
                status === 'connecting' ? 'text-amber-400' :
                status === 'error' ? 'text-red-400' : 'text-slate-400'
              }`}>
                {status === 'connected' ? 'TUNNEL ACTIVE' :
                 status === 'connecting' ? 'HANDSHAKE IN PROGRESS...' :
                 status === 'paused' ? 'PAUSED (BATTERY SAVER)' :
                 status === 'error' ? 'ERROR - CHECK LOGS' : 'READY TO CONNECT'}
              </div>

              <div className="mt-3 text-4xl font-mono font-bold tracking-wider text-slate-100">
                {formatHms(elapsed)}
              </div>

              {status === 'connected' && settings.autoStopMin > 0 && (
                <div className="mt-3 pt-3 border-t border-emerald-900/40 flex items-center justify-center gap-3 text-xs font-mono text-slate-300">
                  <span>
                    Time remaining:{' '}
                    <strong className="text-emerald-300">
                      {formatHms(Math.max(0, settings.autoStopMin * 60 + extraSeconds - elapsed))}
                    </strong>
                  </span>
                  <button
                    onClick={() => {
                      setExtraSeconds(prev => prev + 1800);
                      showToast('+30 minutes added to session');
                    }}
                    className="px-2.5 py-1 rounded-md bg-emerald-900/60 hover:bg-emerald-800/80 border border-emerald-600/50 text-emerald-200 text-[11px] font-sans transition-colors cursor-pointer"
                  >
                    +30 min
                  </button>
                </div>
              )}

              {/* Bandwidth Throughput when connected */}
              {status === 'connected' && (
                <div className="mt-4 pt-4 border-t border-emerald-900/40 grid grid-cols-2 gap-3 font-mono text-xs">
                  <div className="bg-[#0B1F12] p-2.5 rounded-xl border border-emerald-800/30">
                    <div className="flex items-center justify-center gap-1 text-emerald-400 mb-1">
                      <ArrowUp className="w-3.5 h-3.5" />
                      <span>UPLOAD</span>
                    </div>
                    <div className="font-bold text-sm text-slate-100">{formatBytes(traffic.upBps)}/s</div>
                    <div className="text-[10px] text-slate-400 mt-1">Total: {formatBytes(traffic.upTotal)}</div>
                  </div>
                  <div className="bg-[#0B1F12] p-2.5 rounded-xl border border-emerald-800/30">
                    <div className="flex items-center justify-center gap-1 text-emerald-400 mb-1">
                      <ArrowDown className="w-3.5 h-3.5" />
                      <span>DOWNLOAD</span>
                    </div>
                    <div className="font-bold text-sm text-slate-100">{formatBytes(traffic.downBps)}/s</div>
                    <div className="text-[10px] text-slate-400 mt-1">Total: {formatBytes(traffic.downTotal)}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Giant Connect / Disconnect Action Button */}
            <button
              onClick={() => {
                if (status === 'connected' || status === 'connecting') {
                  handleDisconnect();
                } else {
                  handleConnect();
                }
              }}
              className={`w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 shadow-2xl transition-all cursor-pointer ${
                status === 'connected'
                  ? 'bg-red-950/80 hover:bg-red-900 text-red-200 border border-red-700/60 hover:border-red-500 shadow-red-950/50'
                  : status === 'connecting'
                  ? 'bg-amber-900/80 text-amber-200 border border-amber-600/60'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-black border border-emerald-400 shadow-emerald-950/60 hover:scale-[1.01]'
              }`}
            >
              {status === 'connected' ? (
                <>
                  <Square className="w-5 h-5 fill-current" />
                  <span>DISCONNECT TUNNEL</span>
                </>
              ) : status === 'connecting' ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>CONNECTING...</span>
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current" />
                  <span>START SSH TUNNEL</span>
                </>
              )}
            </button>

            {/* Quick Helper Notes */}
            <div className="w-full bg-[#0d2215]/60 border border-emerald-900/30 rounded-xl p-3.5 text-xs text-slate-400 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
                <Info className="w-3.5 h-3.5" />
                <span>GodarmX Architecture</span>
              </div>
              <p className="leading-relaxed">
                Direct SSH tunneling route with hev-socks5-tunnel JNI. All remote DNS requests are automatically resolved through your SSH server with mapdns.
              </p>
            </div>
          </div>
        )}

        {/* TAB 2: PROFILES */}
        {tab === 'profiles' && (
          <div className="space-y-4">
            {/* Top Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 bg-[#102417]/80 p-3 rounded-2xl border border-emerald-800/40">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowImportModal(true)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-950 hover:bg-emerald-900 text-emerald-200 text-xs font-medium border border-emerald-700/50 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Import</span>
                </button>
                <button
                  onClick={handleCopyAll}
                  disabled={profiles.length === 0}
                  className="px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 disabled:opacity-40 text-slate-200 text-xs font-medium border border-slate-700/50 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy All</span>
                </button>
                <button
                  onClick={() => setShowConfirmDeleteAll(true)}
                  disabled={profiles.length === 0}
                  className="px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-950 text-red-300 disabled:opacity-40 text-xs font-medium border border-red-800/40 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete All</span>
                </button>
              </div>

              <button
                onClick={() => {
                  setEditingProfile(null);
                  setShowProfileModal(true);
                }}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-black text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-md"
              >
                <Plus className="w-4 h-4" />
                <span>Add Profile</span>
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder={`Search profiles (${profiles.length})...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#12281a] border border-emerald-800/40 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
            </div>

            {/* Profile List */}
            {filteredProfiles.length === 0 ? (
              <div className="text-center py-12 bg-[#102417]/40 rounded-2xl border border-dashed border-emerald-900/40 p-6">
                <Server className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 font-medium">No profiles match your search</p>
                <p className="text-xs text-slate-500 mt-1">Tap 'Add Profile' or 'Import' to add SSH accounts.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredProfiles.map((p) => {
                  const isSelected = p.id === selectedId;
                  const ping = pings[p.id];
                  return (
                    <div
                      key={p.id}
                      className={`relative rounded-2xl p-4 transition-all border ${
                        isSelected
                          ? 'bg-[#183a25] border-emerald-500 shadow-lg shadow-emerald-950/50'
                          : 'bg-[#102417]/80 hover:bg-[#132c1c] border-emerald-800/40'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div
                          className="cursor-pointer flex-1"
                          onClick={() => {
                            updateSelectedId(p.id);
                            if (settings.autoConnectOnSelect && status === 'disconnected') {
                              handleConnect(p);
                            }
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-base text-white">{p.name}</span>
                            {isSelected && (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono border border-emerald-500/40">
                                ACTIVE
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 text-[10px] font-mono border border-emerald-800/50">
                              {p.method.toUpperCase()}
                            </span>
                            {p.udpgwEnabled && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 text-[10px] font-mono">
                                UDPGW
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-slate-400 font-mono">
                            {p.username}@{p.host}:{p.port}
                            {p.proxyHost && ` via ${p.proxyType || 'http'}://${p.proxyHost}:${p.proxyPort}`}
                          </div>
                        </div>

                        {/* Action buttons on card */}
                        <div className="flex items-center gap-1 self-end sm:self-center">
                          <button
                            onClick={() => handleTestPing(p)}
                            className="px-2.5 py-1 rounded bg-[#0d2215] hover:bg-[#143320] border border-emerald-700/40 text-emerald-300 text-xs font-mono transition-colors cursor-pointer"
                            title="Test TCP latency"
                          >
                            {ping || 'Ping'}
                          </button>
                          <button
                            onClick={() => handleShareProfile(p)}
                            className="p-1.5 rounded hover:bg-emerald-900/50 text-slate-400 hover:text-emerald-300 transition-colors cursor-pointer"
                            title="Share/Copy Link"
                          >
                            <Share2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingProfile(p);
                              setShowProfileModal(true);
                            }}
                            className="p-1.5 rounded hover:bg-emerald-900/50 text-slate-400 hover:text-emerald-300 transition-colors cursor-pointer"
                            title="Edit Profile"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              const remaining = profiles.filter(item => item.id !== p.id);
                              updateProfiles(remaining);
                              if (selectedId === p.id) {
                                updateSelectedId(remaining[0]?.id || null);
                              }
                              showToast(`Deleted ${p.name}`);
                            }}
                            className="p-1.5 rounded hover:bg-red-950/50 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                            title="Delete Profile"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: LOGS */}
        {tab === 'logs' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-[#102417]/80 p-3 rounded-2xl border border-emerald-800/40">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-emerald-400" />
                <span className="font-bold text-sm">Tunnel Event Console</span>
                <span className="text-xs font-mono text-slate-400">({logs.length} events)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const text = logs.map(l => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');
                    navigator.clipboard.writeText(text);
                    showToast('Logs copied to clipboard');
                  }}
                  className="px-3 py-1 rounded-lg bg-emerald-950 hover:bg-emerald-900 text-emerald-200 text-xs font-medium border border-emerald-700/50 flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
                <button
                  onClick={() => {
                    setLogs([]);
                    showToast('Logs cleared');
                  }}
                  className="px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium border border-slate-700/50 flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            <div className="bg-[#07130b] border border-emerald-900/60 rounded-2xl p-4 font-mono text-xs overflow-y-auto max-h-[520px] space-y-1.5 shadow-2xl">
              {logs.length === 0 ? (
                <div className="text-slate-600 text-center py-8">Log buffer is empty</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                    <span className="text-slate-500 shrink-0 select-none">[{log.timestamp}]</span>
                    <span className={`px-1 rounded text-[10px] uppercase font-bold shrink-0 ${
                      log.level === 'error' ? 'bg-red-950 text-red-300' :
                      log.level === 'warn' ? 'bg-amber-950 text-amber-300' :
                      log.level === 'success' ? 'bg-emerald-950 text-emerald-300' :
                      log.level === 'debug' ? 'bg-blue-950 text-blue-300' :
                      'bg-slate-900 text-slate-400'
                    }`}>
                      {log.level}
                    </span>
                    <span className={`break-all ${
                      log.level === 'error' ? 'text-red-300 font-semibold' :
                      log.level === 'warn' ? 'text-amber-200' :
                      log.level === 'success' ? 'text-emerald-300' :
                      'text-slate-200'
                    }`}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* TAB 4: SETTINGS */}
        {tab === 'settings' && (
          <div className="space-y-6 max-w-2xl mx-auto">
            {/* Tunnel Switches */}
            <div className="bg-[#102417]/80 rounded-2xl border border-emerald-800/40 p-5 space-y-4 shadow-xl">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <SettingsIcon className="w-4 h-4 text-emerald-400" />
                <span>Tunnel & Connection Preferences</span>
              </h3>

              <div className="divide-y divide-emerald-900/40 space-y-3">
                <div className="flex items-center justify-between pt-3">
                  <div>
                    <div className="font-medium text-sm text-slate-200">Auto reconnect</div>
                    <div className="text-xs text-slate-400">Retry SSH session automatically when dropped</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.autoReconnect}
                    onChange={(e) => updateSettings({ autoReconnect: e.target.checked })}
                    className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between pt-3">
                  <div>
                    <div className="font-medium text-sm text-slate-200">Seamless tunnel (Kill switch)</div>
                    <div className="text-xs text-slate-400">Block internet while reconnecting to prevent DNS/IP leaks</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.seamless}
                    onChange={(e) => updateSettings({ seamless: e.target.checked })}
                    className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between pt-3">
                  <div>
                    <div className="font-medium text-sm text-slate-200">Auto connect on select</div>
                    <div className="text-xs text-slate-400">Initiate tunnel immediately when choosing a profile</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.autoConnectOnSelect}
                    onChange={(e) => updateSettings({ autoConnectOnSelect: e.target.checked })}
                    className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between pt-3">
                  <div>
                    <div className="font-medium text-sm text-slate-200">Open logs on connect</div>
                    <div className="text-xs text-slate-400">Automatically switch to the Logs tab when handshake begins</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.openLogsOnConnect}
                    onChange={(e) => updateSettings({ openLogsOnConnect: e.target.checked })}
                    className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between pt-3">
                  <div>
                    <div className="font-medium text-sm text-slate-200">Vibrate on connect / disconnect</div>
                    <div className="text-xs text-slate-400">Haptic feedback on state change (supported devices)</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.vibrate}
                    onChange={(e) => updateSettings({ vibrate: e.target.checked })}
                    className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between pt-3">
                  <div>
                    <div className="font-medium text-sm text-slate-200">Show notification toasts</div>
                    <div className="text-xs text-slate-400">Display in-app banners on success or errors</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.showToasts}
                    onChange={(e) => updateSettings({ showToasts: e.target.checked })}
                    className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Protocol & Advanced Controls */}
            <div className="bg-[#102417]/80 rounded-2xl border border-emerald-800/40 p-5 space-y-4 shadow-xl">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-400" />
                <span>Protocol & Timeout Configuration</span>
              </h3>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Auto-disconnect Timer
                  </label>
                  <select
                    value={settings.autoStopMin}
                    onChange={(e) => updateSettings({ autoStopMin: parseInt(e.target.value, 10) })}
                    className="w-full bg-[#12281a] border border-emerald-700/50 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 cursor-pointer"
                  >
                    <option value={0}>Off (No auto stop)</option>
                    <option value={30}>30 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={120}>2 hours</option>
                    <option value={240}>4 hours</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Minimum TLS Version
                  </label>
                  <select
                    value={settings.minTls}
                    onChange={(e) => updateSettings({ minTls: e.target.value as '1.2' | '1.3' })}
                    className="w-full bg-[#12281a] border border-emerald-700/50 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 cursor-pointer"
                  >
                    <option value="1.2">TLS 1.2 (Recommended)</option>
                    <option value="1.3">TLS 1.3 (Strict)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Keep-Alive Interval (Seconds)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="300"
                    value={settings.keepAliveSec}
                    onChange={(e) => updateSettings({ keepAliveSec: parseInt(e.target.value, 10) || 30 })}
                    className="w-full bg-[#12281a] border border-emerald-700/50 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Local SOCKS5 Port
                  </label>
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={settings.socksPort}
                    onChange={(e) => updateSettings({ socksPort: parseInt(e.target.value, 10) || 1080 })}
                    className="w-full bg-[#12281a] border border-emerald-700/50 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
              </div>
            </div>

            {/* Android APK Build Section */}
            <div className="bg-[#102417]/80 rounded-2xl border border-emerald-800/40 p-5 space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-base text-white">Android APK Source</h3>
                  <p className="text-xs text-slate-400">Original Kotlin + Compose + JNI tunnel source files</p>
                </div>
                <a
                  href="/sshvpn-source-for-github.zip"
                  download="sshvpn-source-for-github.zip"
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-black text-xs font-bold flex items-center gap-1.5 transition-colors shadow-lg cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Download ZIP</span>
                </a>
              </div>
              <div className="text-xs text-slate-400 space-y-1">
                <p>• Push repository to GitHub and run the GitHub Action in <code>.github/workflows/build-apk.yml</code>.</p>
                <p>• It automatically compiles <code>libhev-socks5-tunnel.so</code> using the Android NDK and packages the debug APK.</p>
              </div>
            </div>

            {/* Acceptable Use Policy / Disclaimer */}
            <div className="bg-[#0d2215]/60 rounded-2xl border border-emerald-900/40 p-5 space-y-2 text-xs text-slate-400">
              <div className="font-bold text-slate-200">About GodarmX SSH v1.0.0</div>
              <p>
                Use only with SSH servers you own or are authorised to access. Do not use for malicious scanning, DDoS, unauthorized penetration, or illegal activity.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Floating Bottom Navigation Bar (Matching Android Compose bottom bar) */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-[#0A1410]/95 backdrop-blur-lg border-t border-emerald-900/50 py-2 px-4 shadow-2xl">
        <div className="max-w-md mx-auto grid grid-cols-4 gap-1">
          <button
            onClick={() => setTab('home')}
            className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-xl transition-all cursor-pointer ${
              tab === 'home'
                ? 'text-emerald-400 bg-emerald-950/60 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Shield className="w-5 h-5 mb-1" />
            <span className="text-[11px]">Home</span>
          </button>

          <button
            onClick={() => setTab('profiles')}
            className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-xl transition-all cursor-pointer ${
              tab === 'profiles'
                ? 'text-emerald-400 bg-emerald-950/60 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-5 h-5 mb-1" />
            <span className="text-[11px]">Profiles</span>
          </button>

          <button
            onClick={() => setTab('logs')}
            className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-xl transition-all cursor-pointer ${
              tab === 'logs'
                ? 'text-emerald-400 bg-emerald-950/60 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-5 h-5 mb-1" />
            <span className="text-[11px]">Logs</span>
          </button>

          <button
            onClick={() => setTab('settings')}
            className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-xl transition-all cursor-pointer ${
              tab === 'settings'
                ? 'text-emerald-400 bg-emerald-950/60 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <SettingsIcon className="w-5 h-5 mb-1" />
            <span className="text-[11px]">Settings</span>
          </button>
        </div>
      </nav>

      {/* MODAL: ADD / EDIT PROFILE */}
      {showProfileModal && (
        <ProfileModal
          initial={editingProfile}
          onClose={() => setShowProfileModal(false)}
          onSave={(profile) => {
            const index = profiles.findIndex(p => p.id === profile.id);
            let updated: SshProfile[];
            if (index >= 0) {
              updated = [...profiles];
              updated[index] = profile;
            } else {
              updated = [...profiles, profile];
            }
            updateProfiles(updated);
            if (!selectedId) updateSelectedId(profile.id);
            setShowProfileModal(false);
            showToast(`Profile ${editingProfile ? 'updated' : 'created'}: ${profile.name}`);
          }}
        />
      )}

      {/* MODAL: IMPORT PROFILES */}
      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onImport={(importedList) => {
            if (importedList.length === 0) {
              showToast('No valid profiles found');
              return;
            }
            const updated = [...profiles, ...importedList];
            updateProfiles(updated);
            if (!selectedId) updateSelectedId(importedList[0].id);
            setShowImportModal(false);
            showToast(`Imported ${importedList.length} profile(s)`);
          }}
        />
      )}

      {/* MODAL: CONFIRM DELETE ALL */}
      {showConfirmDeleteAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#102417] border border-red-800/60 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="font-bold text-lg text-white">Delete All Profiles?</h3>
            </div>
            <p className="text-sm text-slate-300">
              This will permanently delete all {profiles.length} saved profiles. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowConfirmDeleteAll(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  updateProfiles([]);
                  updateSelectedId(null);
                  setShowConfirmDeleteAll(false);
                  showToast('All profiles deleted');
                }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-bold cursor-pointer"
              >
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Modal Component for Add / Edit Profile
function ProfileModal({
  initial,
  onClose,
  onSave,
}: {
  initial: SshProfile | null;
  onClose: () => void;
  onSave: (profile: SshProfile) => void;
}) {
  const [method, setMethod] = useState<SshProfile['method']>(initial?.method || 'direct');
  const [name, setName] = useState(initial?.name || '');
  const [host, setHost] = useState(initial?.host || '');
  const [port, setPort] = useState((initial?.port || 22).toString());
  const [username, setUsername] = useState(initial?.username || '');
  const [authType, setAuthType] = useState<'password' | 'key'>(initial?.privateKey ? 'key' : 'password');
  const [password, setPassword] = useState(initial?.password || '');
  const [privateKey, setPrivateKey] = useState(initial?.privateKey || '');
  const [passphrase, setPassphrase] = useState(initial?.passphrase || '');
  const [tlsInsecure, setTlsInsecure] = useState(initial?.tlsInsecure || false);

  const [proxyType, setProxyType] = useState<SshProfile['proxyType']>(initial?.proxyType || 'http');
  const [proxyHost, setProxyHost] = useState(initial?.proxyHost || '');
  const [proxyPort, setProxyPort] = useState((initial?.proxyPort || 8080).toString());
  const [proxyUser, setProxyUser] = useState(initial?.proxyUser || '');
  const [proxyPass, setProxyPass] = useState(initial?.proxyPass || '');

  const [udpgwEnabled, setUdpgwEnabled] = useState(initial?.udpgwEnabled || false);
  const [udpgwPort, setUdpgwPort] = useState((initial?.udpgwPort || 7300).toString());

  const [showPassword, setShowPassword] = useState(false);

  const usesTls = method.startsWith('tls');
  const usesProxy = method.endsWith('proxy');

  const isValid =
    host.trim().length > 0 &&
    username.trim().length > 0 &&
    parseInt(port, 10) > 0 &&
    (!usesProxy || (proxyHost.trim().length > 0 && parseInt(proxyPort, 10) > 0));

  const handleSave = () => {
    if (!isValid) return;
    const profile: SshProfile = {
      id: initial?.id || crypto.randomUUID ? crypto.randomUUID() : `prof_${Date.now()}`,
      name: name.trim() || host.trim(),
      host: host.trim(),
      port: parseInt(port, 10) || 22,
      username: username.trim(),
      password: authType === 'password' ? password : '',
      privateKey: authType === 'key' ? privateKey : '',
      passphrase: authType === 'key' ? passphrase : '',
      method,
      tlsInsecure: usesTls ? tlsInsecure : false,
      proxyType: method === 'tls-proxy' ? 'http' : proxyType,
      proxyHost: usesProxy ? proxyHost.trim() : '',
      proxyPort: usesProxy ? parseInt(proxyPort, 10) || 8080 : 8080,
      proxyUser: usesProxy ? proxyUser.trim() : '',
      proxyPass: usesProxy ? proxyPass : '',
      udpgwEnabled,
      udpgwPort: udpgwEnabled ? parseInt(udpgwPort, 10) || 7300 : 7300,
    };
    onSave(profile);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-[#102417] border border-emerald-700/60 rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl my-8">
        <div className="flex items-center justify-between pb-3 border-b border-emerald-800/40">
          <h3 className="font-bold text-lg text-white">
            {initial ? 'Edit SSH Profile' : 'Add SSH Profile'}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Protocol Method Selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Protocol Method
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PROTOCOLS.map((proto) => (
                <button
                  type="button"
                  key={proto.key}
                  onClick={() => setMethod(proto.key)}
                  className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${
                    method === proto.key
                      ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 font-bold'
                      : 'bg-[#12281a] border-emerald-900/50 text-slate-300 hover:border-emerald-700'
                  }`}
                >
                  <div className="text-xs">{proto.label}</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">{proto.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Remarks / Profile Name</label>
            <input
              type="text"
              placeholder="e.g. SG-HighSpeed-01"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#12281a] border border-emerald-800/50 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>

          {/* Host & Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-400 mb-1">SSH Host</label>
              <input
                type="text"
                placeholder="domain or IP"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="w-full bg-[#12281a] border border-emerald-800/50 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Port</label>
              <input
                type="number"
                placeholder="22"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full bg-[#12281a] border border-emerald-800/50 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
            </div>
          </div>

          {/* Username */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">SSH Username</label>
            <input
              type="text"
              placeholder="root or vpnuser"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-[#12281a] border border-emerald-800/50 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>

          {/* Auth Method Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Authentication</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAuthType('password')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                  authType === 'password'
                    ? 'bg-emerald-700/30 border-emerald-500 text-emerald-300'
                    : 'bg-[#12281a] border-emerald-900/40 text-slate-400'
                }`}
              >
                Password
              </button>
              <button
                type="button"
                onClick={() => setAuthType('key')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                  authType === 'key'
                    ? 'bg-emerald-700/30 border-emerald-500 text-emerald-300'
                    : 'bg-[#12281a] border-emerald-900/40 text-slate-400'
                }`}
              >
                Private Key (PEM)
              </button>
            </div>
          </div>

          {authType === 'password' ? (
            <div className="relative">
              <label className="block text-xs font-semibold text-slate-400 mb-1">SSH Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#12281a] border border-emerald-800/50 rounded-xl pl-3.5 pr-10 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-8 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Private Key (OpenSSH / RSA / Ed25519 PEM)</label>
                <textarea
                  rows={4}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  className="w-full bg-[#12281a] border border-emerald-800/50 rounded-xl p-3 text-xs font-mono text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Passphrase (optional)</label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  className="w-full bg-[#12281a] border border-emerald-800/50 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>
            </div>
          )}

          {/* TLS Options */}
          {usesTls && (
            <div className="bg-[#0b1f13] p-3 rounded-xl border border-emerald-800/40 space-y-2 text-xs">
              <div className="font-semibold text-emerald-400">TLS Stunnel / Nginx Stream Configuration</div>
              <p className="text-slate-400">Server wraps SSH in TLS stream. SNI hostname is automatically set to {host || 'SSH Host'}.</p>
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={tlsInsecure}
                  onChange={(e) => setTlsInsecure(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500 rounded"
                />
                <span>Allow self-signed / untrusted TLS certificate</span>
              </label>
            </div>
          )}

          {/* Proxy Options */}
          {usesProxy && (
            <div className="bg-[#0b1f13] p-3 rounded-xl border border-emerald-800/40 space-y-3 text-xs">
              <div className="font-semibold text-emerald-400">Proxy Gateway Configuration</div>
              {method === 'proxy' && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setProxyType('http')}
                    className={`flex-1 py-1 rounded border text-xs cursor-pointer ${
                      proxyType === 'http' ? 'bg-emerald-800/40 border-emerald-500 text-emerald-200' : 'border-emerald-900/60 text-slate-400'
                    }`}
                  >
                    HTTP Proxy
                  </button>
                  <button
                    type="button"
                    onClick={() => setProxyType('socks5')}
                    className={`flex-1 py-1 rounded border text-xs cursor-pointer ${
                      proxyType === 'socks5' ? 'bg-emerald-800/40 border-emerald-500 text-emerald-200' : 'border-emerald-900/60 text-slate-400'
                    }`}
                  >
                    SOCKS5 Proxy
                  </button>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-[11px] text-slate-400 mb-1">Proxy Host</label>
                  <input
                    type="text"
                    value={proxyHost}
                    onChange={(e) => setProxyHost(e.target.value)}
                    className="w-full bg-[#12281a] border border-emerald-800/50 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Port</label>
                  <input
                    type="number"
                    value={proxyPort}
                    onChange={(e) => setProxyPort(e.target.value)}
                    className="w-full bg-[#12281a] border border-emerald-800/50 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  />
                </div>
              </div>
            </div>
          )}

          {/* UDPGW Section */}
          <div className="bg-[#0b1f13] p-3 rounded-xl border border-emerald-800/40 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-emerald-400">UDPGW (UDP over SSH)</div>
                <div className="text-[11px] text-slate-400">Requires badvpn-udpgw on your SSH server</div>
              </div>
              <input
                type="checkbox"
                checked={udpgwEnabled}
                onChange={(e) => setUdpgwEnabled(e.target.checked)}
                className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
              />
            </div>
            {udpgwEnabled && (
              <div className="pt-2">
                <label className="block text-[11px] text-slate-400 mb-1">UDPGW Port</label>
                <input
                  type="number"
                  value={udpgwPort}
                  onChange={(e) => setUdpgwPort(e.target.value)}
                  className="w-32 bg-[#12281a] border border-emerald-800/50 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                />
              </div>
            )}
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-emerald-800/40">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!isValid}
            onClick={handleSave}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-black text-sm font-bold cursor-pointer transition-colors"
          >
            Save Profile
          </button>
        </div>
      </div>
    </div>
  );
}

// Modal Component for Import Profiles
function ImportModal({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (list: SshProfile[]) => void;
}) {
  const [text, setText] = useState('');

  const handlePaste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      setText(clip);
    } catch {
      // Fallback
    }
  };

  const handleSubmit = () => {
    const lines = text.split('\n');
    const parsed: SshProfile[] = [];
    for (const line of lines) {
      const p = ProfileLink.parse(line);
      if (p) parsed.push(p);
    }
    onImport(parsed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-[#102417] border border-emerald-700/60 rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-emerald-800/40">
          <h3 className="font-bold text-lg text-white">Import SSH Profiles</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div className="text-xs text-slate-400 space-y-1">
            <p>Paste one profile link per line. Supported formats:</p>
            <div className="bg-[#0b1f13] p-2.5 rounded-lg border border-emerald-900/40 font-mono text-[11px] text-emerald-300">
              ssh://user:pass@host:22?tls=1#ServerName<br />
              host:22@user:pass
            </div>
          </div>

          <textarea
            rows={5}
            placeholder="ssh://user:password@myserver.com:22#Frankfurt-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full bg-[#12281a] border border-emerald-800/50 rounded-xl p-3 text-xs font-mono text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />

          <button
            type="button"
            onClick={handlePaste}
            className="text-xs text-emerald-400 hover:text-emerald-300 underline font-medium cursor-pointer"
          >
            Paste from Clipboard
          </button>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-emerald-800/40">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium cursor-pointer"
          >
            Cancel
          </button>
          <button
            disabled={!text.trim()}
            onClick={handleSubmit}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-black text-sm font-bold cursor-pointer transition-colors"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
