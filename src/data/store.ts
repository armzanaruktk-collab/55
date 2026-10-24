import { AppSettings, SshProfile } from '../types';

const PROFILES_KEY = 'godarmx_profiles';
const SELECTED_KEY = 'godarmx_selected';
const SETTINGS_KEY = 'godarmx_settings';

export const DEFAULT_SETTINGS: AppSettings = {
  autoReconnect: true,
  speedNotification: true,
  vibrate: false,
  openLogsOnConnect: false,
  connectAfterBoot: false,
  autoConnectOnSelect: false,
  batterySaver: false,
  seamless: true,
  showToasts: true,
  minTls: '1.2',
  autoStopMin: 0, // 0 = off
  keepAliveSec: 30,
  socksPort: 1080,
};

export const INITIAL_PROFILES: SshProfile[] = [
  {
    id: 'demo-1',
    name: 'SG-Fast01 (Singapore)',
    host: 'sg-ssh1.godarmx.net',
    port: 22,
    username: 'vpnuser',
    password: 'demoPassword123',
    method: 'direct',
    udpgwEnabled: true,
    udpgwPort: 7300,
  },
  {
    id: 'demo-2',
    name: 'US-TLS (New York)',
    host: 'ny-tls.godarmx.net',
    port: 443,
    username: 'fastssh',
    password: 'sshPasswordSecure',
    method: 'tls',
    tlsInsecure: false,
    udpgwEnabled: false,
    udpgwPort: 7300,
  },
  {
    id: 'demo-3',
    name: 'DE-Proxy (Frankfurt HTTP Proxy)',
    host: 'fra.secure-tunnel.io',
    port: 22,
    username: 'armx_user',
    password: 'tunnelSecret!',
    method: 'proxy',
    proxyType: 'http',
    proxyHost: 'proxy-node.secure-tunnel.io',
    proxyPort: 8080,
    proxyUser: 'squid_usr',
    proxyPass: 'squid_pwd',
    udpgwEnabled: true,
    udpgwPort: 7300,
  },
];

export const Store = {
  getProfiles(): SshProfile[] {
    try {
      const data = localStorage.getItem(PROFILES_KEY);
      if (!data) {
        localStorage.setItem(PROFILES_KEY, JSON.stringify(INITIAL_PROFILES));
        return INITIAL_PROFILES;
      }
      return JSON.parse(data);
    } catch {
      return INITIAL_PROFILES;
    }
  },

  saveProfiles(profiles: SshProfile[]): void {
    try {
      localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
    } catch (e) {
      console.error('Failed to save profiles to localStorage', e);
    }
  },

  getSelectedId(): string | null {
    try {
      return localStorage.getItem(SELECTED_KEY);
    } catch {
      return null;
    }
  },

  saveSelectedId(id: string | null): void {
    try {
      if (id) {
        localStorage.setItem(SELECTED_KEY, id);
      } else {
        localStorage.removeItem(SELECTED_KEY);
      }
    } catch (e) {
      console.error('Failed to save selectedId', e);
    }
  },

  getSettings(): AppSettings {
    try {
      const data = localStorage.getItem(SETTINGS_KEY);
      if (!data) return DEFAULT_SETTINGS;
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings: AppSettings): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save settings', e);
    }
  },
};
