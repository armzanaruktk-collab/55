import { SshProfile } from '../types';

export const ProfileLink = {
  format(p: SshProfile): string {
    const params: string[] = [];
    if (p.method === 'tls') params.push('tls=1');
    if (p.udpgwEnabled) params.push(`udpgw=${p.udpgwPort || 7300}`);
    const q = params.length > 0 ? '?' + params.join('&') : '';
    const user = encodeURIComponent(p.username);
    const pass = encodeURIComponent(p.password || '');
    const name = encodeURIComponent(p.name);
    return `ssh://${user}:${pass}@${p.host}:${p.port}${q}#${name}`;
  },

  parse(line: string): SshProfile | null {
    const t = line.trim();
    if (!t) return null;
    try {
      if (t.startsWith('ssh://')) {
        return this.parseUri(t.substring(6));
      } else {
        return this.parseSimple(t);
      }
    } catch {
      return null;
    }
  },

  parseUri(body: string): SshProfile | null {
    const hashIndex = body.indexOf('#');
    let name = '';
    let rest = body;
    if (hashIndex >= 0) {
      name = decodeURIComponent(body.substring(hashIndex + 1));
      rest = body.substring(0, hashIndex);
    }

    const qIndex = rest.indexOf('?');
    let query = '';
    let main = rest;
    if (qIndex >= 0) {
      query = rest.substring(qIndex + 1);
      main = rest.substring(0, qIndex);
    }

    const atIndex = main.lastIndexOf('@');
    if (atIndex < 0) return null;

    const cred = main.substring(0, atIndex);
    const hp = main.substring(atIndex + 1);

    const colonCred = cred.indexOf(':');
    const user = decodeURIComponent(colonCred >= 0 ? cred.substring(0, colonCred) : cred);
    const pass = colonCred >= 0 ? decodeURIComponent(cred.substring(colonCred + 1)) : '';

    const lastColon = hp.lastIndexOf(':');
    const host = lastColon >= 0 ? hp.substring(0, lastColon) : hp;
    const port = lastColon >= 0 ? parseInt(hp.substring(lastColon + 1), 10) : 22;

    if (!host || !user || isNaN(port) || port < 1 || port > 65535) return null;

    const params = query ? query.split('&') : [];
    const tls = params.includes('tls=1');
    const udpgwParam = params.find(p => p.startsWith('udpgw='));
    const udpgw = udpgwParam ? parseInt(udpgwParam.split('=')[1], 10) : null;

    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `prof_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim() || host,
      host,
      port,
      username: user,
      password: pass,
      method: tls ? 'tls' : 'direct',
      udpgwEnabled: udpgw !== null && !isNaN(udpgw),
      udpgwPort: udpgw && !isNaN(udpgw) ? udpgw : 7300,
    };
  },

  parseSimple(t: string): SshProfile | null {
    const at = t.indexOf('@');
    if (at < 0) return null;
    const hp = t.substring(0, at);
    const up = t.substring(at + 1);

    const hostColon = hp.lastIndexOf(':');
    const host = hostColon >= 0 ? hp.substring(0, hostColon) : hp;
    const port = hostColon >= 0 ? parseInt(hp.substring(hostColon + 1), 10) : 22;

    const userColon = up.indexOf(':');
    const user = userColon >= 0 ? up.substring(0, userColon) : up;
    const pass = userColon >= 0 ? up.substring(userColon + 1) : '';

    if (!host || !user || isNaN(port) || port < 1 || port > 65535) return null;

    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `prof_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: host,
      host,
      port,
      username: user,
      password: pass,
      method: 'direct',
      udpgwEnabled: false,
      udpgwPort: 7300,
    };
  },

  formatSshConfig(p: SshProfile): string {
    return [
      `# GodarmX SSH Profile: ${p.name}`,
      `Host ${p.name.replace(/\s+/g, '_')}`,
      `    HostName ${p.host}`,
      `    Port ${p.port}`,
      `    User ${p.username}`,
      p.privateKey ? `    # IdentityFile ~/.ssh/id_godarmx_${p.name.replace(/\s+/g, '_')}` : `    # Password: ${p.password ? '******' : '(none)'}`,
      `    DynamicForward 127.0.0.1:1080`,
      `    ServerAliveInterval 30`,
      `    ServerAliveCountMax 3`,
      `    StrictHostKeyChecking no`,
    ].join('\n');
  }
};
