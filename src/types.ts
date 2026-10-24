export type SshMethod = 'direct' | 'proxy' | 'tls' | 'tls-proxy';
export type ProxyType = 'http' | 'socks5';

export interface SshProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  method: SshMethod;
  tlsInsecure?: boolean;
  proxyType?: ProxyType;
  proxyHost?: string;
  proxyPort?: number;
  proxyUser?: string;
  proxyPass?: string;
  udpgwEnabled?: boolean;
  udpgwPort?: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'paused' | 'error';

export interface TrafficStats {
  upBps: number;
  downBps: number;
  upTotal: number;
  downTotal: number;
}

export interface AppSettings {
  autoReconnect: boolean;
  speedNotification: boolean;
  vibrate: boolean;
  openLogsOnConnect: boolean;
  connectAfterBoot: boolean;
  autoConnectOnSelect: boolean;
  batterySaver: boolean;
  seamless: boolean;
  showToasts: boolean;
  minTls: '1.2' | '1.3';
  autoStopMin: number; // 0 = off, 30, 60, 120, 240
  keepAliveSec: number;
  socksPort: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success' | 'debug';
  message: string;
}
