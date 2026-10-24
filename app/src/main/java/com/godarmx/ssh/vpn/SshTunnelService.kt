package com.godarmx.ssh.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.jcraft.jsch.JSch
import com.jcraft.jsch.ProxyHTTP
import com.jcraft.jsch.ProxySOCKS5
import com.jcraft.jsch.Session
import com.jcraft.jsch.SocketFactory
import com.godarmx.ssh.data.SshProfile
import com.godarmx.ssh.data.Store
import hev.htproxy.TProxyService
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509TrustManager

class SshTunnelService : VpnService() {

    companion object {
        const val ACTION_START = "com.godarmx.ssh.START"
        const val ACTION_STOP = "com.godarmx.ssh.STOP"
        const val EXTRA_PROFILE = "profile_id"
        private const val CHANNEL = "vpn"

        fun start(ctx: Context, profileId: String) {
            ContextCompat.startForegroundService(
                ctx,
                Intent(ctx, SshTunnelService::class.java).setAction(ACTION_START)
                    .putExtra(EXTRA_PROFILE, profileId)
            )
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, SshTunnelService::class.java).setAction(ACTION_STOP))
        }
    }

    private var worker: Thread? = null
    @Volatile private var stopping = false
    @Volatile private var session: Session? = null
    private var socks: SocksServer? = null
    private var tun: ParcelFileDescriptor? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Store.init(this)
        if (intent?.action == ACTION_STOP) {
            shutdown()
            return START_NOT_STICKY
        }
        val profile = Store.profiles().find { it.id == intent?.getStringExtra(EXTRA_PROFILE) }
        if (profile == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        startForegroundCompat(profile.name)
        if (worker?.isAlive != true) {
            stopping = false
            worker = Thread { runTunnel(profile) }.also { it.start() }
        }
        return START_NOT_STICKY
    }

    override fun onRevoke() { shutdown() }

    override fun onDestroy() {
        stopping = true
        cleanup()
        super.onDestroy()
    }

    private fun shutdown() {
        stopping = true
        if (worker?.isAlive == true) worker?.interrupt() else cleanup()
    }

    @Volatile private var paused = false
    private var everConnected = false
    private var screenReceiver: BroadcastReceiver? = null

    private fun registerScreenReceiver() {
        if (screenReceiver != null) return
        val r = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                if (!Store.batterySaver) return
                if (i.action == Intent.ACTION_SCREEN_OFF) {
                    paused = true
                    VpnState.status.value = Status.PAUSED
                    try { session?.disconnect() } catch (_: Exception) {}
                } else if (i.action == Intent.ACTION_SCREEN_ON) {
                    paused = false
                }
            }
        }
        val f = IntentFilter().apply { addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_SCREEN_ON) }
        ContextCompat.registerReceiver(this, r, f, ContextCompat.RECEIVER_NOT_EXPORTED)
        screenReceiver = r
    }

    private fun checkTimeout(): Boolean {
        val min = Store.autoStopMin
        val start = VpnState.connectedAt.value
        if (min <= 0 || start <= 0) return false
        val limit = min * 60L + VpnState.extraSec.value
        if ((System.currentTimeMillis() - start) / 1000 >= limit) {
            VpnState.log("Auto-disconnect timer reached")
            stopping = true
            return true
        }
        return false
    }

    private fun runTunnel(profile: SshProfile) {
        VpnState.status.value = Status.CONNECTING
        VpnState.extraSec.value = 0L
        everConnected = false
        paused = false
        val ver = try { packageManager.getPackageInfo(packageName, 0).versionName } catch (_: Exception) { "?" }
        VpnState.log("Running on ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} API ${Build.VERSION.SDK_INT}")
        VpnState.log("App version: GodarmX SSH $ver")
        VpnState.log("Connecting to ${profile.host}:${profile.port} as ${profile.username}")
        registerScreenReceiver()
        val port = Store.socksPort
        try {
            socks = SocksServer(port, if (profile.udpgwEnabled) profile.udpgwPort else 0) { session }.also { it.start() }
            while (!stopping) {
                if (paused) {
                    VpnState.status.value = Status.PAUSED
                    VpnState.log("Paused (screen off)")
                    while (paused && !stopping) Thread.sleep(500)
                    if (stopping) break
                    VpnState.status.value = Status.CONNECTING
                    VpnState.log("Resuming")
                    continue
                }
                try {
                    val s = connectSsh(profile)
                    session = s
                    VpnState.log("SSH connected")
                    if (tun == null && !startTun(port)) {
                        VpnState.status.value = Status.ERROR
                        break
                    }
                    everConnected = true
                    if (VpnState.connectedAt.value == 0L) VpnState.connectedAt.value = System.currentTimeMillis()
                    if (VpnState.status.value != Status.CONNECTED) buzz()
                    VpnState.status.value = Status.CONNECTED
                    while (!stopping && s.isConnected) {
                        Thread.sleep(1000)
                        tick(profile.name)
                        if (checkTimeout()) break
                    }
                    if (stopping) break
                    if (!paused) VpnState.log("SSH session lost")
                } catch (e: InterruptedException) {
                    break
                } catch (e: Exception) {
                    VpnState.log("Error: ${e.message}")
                    if (!everConnected) { VpnState.status.value = Status.ERROR; break }
                }
                try { session?.disconnect() } catch (_: Exception) {}
                session = null
                if (!Store.seamless) stopTun() // let traffic go direct while reconnecting
                if (paused) continue
                if (!Store.autoReconnect) break
                VpnState.status.value = Status.CONNECTING
                VpnState.log("Reconnecting in 3s...")
                try { Thread.sleep(3000) } catch (e: InterruptedException) { break }
            }
        } catch (e: Exception) {
            VpnState.log("Fatal: ${e.message}")
            VpnState.status.value = Status.ERROR
        } finally {
            cleanup()
        }
    }

    private fun stopTun() {
        try { if (TProxyService.TProxyIsRunning()) TProxyService.TProxyStopService() } catch (_: Throwable) {}
        try { tun?.close() } catch (_: Exception) {}
        tun = null
        lastUp = 0; lastDown = 0
    }

    private fun connectSsh(p: SshProfile): Session {
        val jsch = JSch()
        if (p.privateKey.isNotBlank()) {
            jsch.addIdentity(
                "key", p.privateKey.toByteArray(), null,
                p.passphrase.takeIf { it.isNotBlank() }?.toByteArray()
            )
        }
        val s = jsch.getSession(p.username, p.host, p.port)
        if (p.password.isNotBlank()) s.setPassword(p.password)
        s.setConfig("StrictHostKeyChecking", "no") // TODO: pin host keys (see README)
        s.setConfig("PreferredAuthentications", "publickey,password,keyboard-interactive")
        s.setServerAliveInterval(Store.keepAliveSec * 1000)
        s.setServerAliveCountMax(3)
        when (p.method) {
            "proxy" -> {
                if (p.proxyHost.isBlank()) throw IllegalArgumentException("Proxy host is empty")
                if (p.proxyType == "socks5") {
                    s.setProxy(ProxySOCKS5(p.proxyHost, p.proxyPort).also {
                        if (p.proxyUser.isNotBlank()) it.setUserPasswd(p.proxyUser, p.proxyPass)
                    })
                } else {
                    s.setProxy(ProxyHTTP(p.proxyHost, p.proxyPort).also {
                        if (p.proxyUser.isNotBlank()) it.setUserPasswd(p.proxyUser, p.proxyPass)
                    })
                }
                s.setSocketFactory(factory(false, false))
            }
            "tls" -> s.setSocketFactory(factory(true, p.tlsInsecure))
            "tls-proxy" -> {
                if (p.proxyHost.isBlank()) throw IllegalArgumentException("Proxy host is empty")
                s.setSocketFactory(factory(true, p.tlsInsecure, p))
            }
            else -> s.setSocketFactory(factory(false, false))
        }
        s.connect(15000)
        try { VpnState.log("Host key fingerprint: ${s.hostKey.getFingerPrint(jsch)}") } catch (_: Exception) {}
        return s
    }

    private fun factory(tls: Boolean, insecure: Boolean, viaProxy: SshProfile? = null) = object : SocketFactory {
        override fun createSocket(host: String, port: Int): Socket {
            val raw = Socket()
            protect(raw) // keep SSH traffic outside the tunnel
            if (viaProxy != null) {
                raw.connect(InetSocketAddress(viaProxy.proxyHost, viaProxy.proxyPort), 15000)
                httpConnect(raw, host, port, viaProxy)
            } else {
                raw.connect(InetSocketAddress(host, port), 15000)
            }
            if (!tls) return raw
            val sf: SSLSocketFactory = sslFactory(insecure)
            val ssl = sf.createSocket(raw, host, port, true) as SSLSocket // SNI = server host
            val want = if (Store.minTls == "1.3") arrayOf("TLSv1.3") else arrayOf("TLSv1.2", "TLSv1.3")
            val ok = want.filter { it in ssl.supportedProtocols }
            if (ok.isNotEmpty()) ssl.enabledProtocols = ok.toTypedArray()
            ssl.startHandshake()
            return ssl
        }
        override fun getInputStream(socket: Socket) = socket.getInputStream()
        override fun getOutputStream(socket: Socket) = socket.getOutputStream()
    }

    /** Plain HTTP CONNECT through a proxy (standard request, no custom payload). */
    private fun httpConnect(sock: Socket, host: String, port: Int, p: SshProfile) {
        val req = StringBuilder("CONNECT $host:$port HTTP/1.1\r\nHost: $host:$port\r\n")
        if (p.proxyUser.isNotBlank()) {
            val tok = java.util.Base64.getEncoder().encodeToString("${p.proxyUser}:${p.proxyPass}".toByteArray())
            req.append("Proxy-Authorization: Basic $tok\r\n")
        }
        req.append("\r\n")
        sock.getOutputStream().apply { write(req.toString().toByteArray()); flush() }
        val inp = sock.getInputStream()
        val head = StringBuilder()
        while (!head.endsWith("\r\n\r\n")) {
            val b = inp.read()
            if (b < 0 || head.length > 8192) throw java.io.IOException("Proxy closed connection")
            head.append(b.toChar())
        }
        val status = head.lineSequence().first()
        if (!status.contains(" 200")) throw java.io.IOException("Proxy refused: $status")
    }

    private var lastUp = 0L
    private var lastDown = 0L

    private fun tick(name: String) {
        try {
            val st = TProxyService.TProxyGetStats()
            val up = st[1]; val down = st[3]
            val t = Traffic(maxOf(0, up - lastUp), maxOf(0, down - lastDown), up, down)
            lastUp = up; lastDown = down
            VpnState.traffic.value = t
            if (Store.speedNotification) {
                val text = "$name   ↑ ${VpnState.formatBytes(t.upBps)}/s  ↓ ${VpnState.formatBytes(t.downBps)}/s"
                getSystemService(NotificationManager::class.java).notify(1, buildNotification(text))
            }
        } catch (_: Throwable) {}
    }

    private fun buzz() {
        if (!Store.vibrate) return
        try {
            getSystemService(Vibrator::class.java)
                .vibrate(VibrationEffect.createOneShot(150, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (_: Exception) {}
    }

    private fun startTun(socksPort: Int): Boolean {
        val pfd = Builder()
            .setSession("SSH Tunnel")
            .setMtu(8500)
            .addAddress("198.18.0.1", 32)
            .addAddress("fc00::1", 128)
            .addRoute("0.0.0.0", 0)
            .addRoute("::", 0)
            .addDnsServer("198.18.0.2") // answered by hev mapdns, resolved via SSH
            .addDisallowedApplication(packageName)
            .establish()
        if (pfd == null) {
            VpnState.log("VPN permission missing or revoked")
            return false
        }
        tun = pfd
        val conf = File(filesDir, "tproxy.yml")
        conf.writeText(
            """
            tunnel:
              mtu: 8500
              ipv4: 198.18.0.1
              ipv6: 'fc00::1'
            socks5:
              port: $socksPort
              address: 127.0.0.1
              udp: 'udp'
            mapdns:
              address: 198.18.0.2
              port: 53
              network: 100.64.0.0
              netmask: 255.192.0.0
              cache-size: 10000
            misc:
              task-stack-size: 81920
              log-level: warn
            """.trimIndent()
        )
        return try {
            val ok = TProxyService.TProxyStartService(conf.absolutePath, pfd.fd)
            VpnState.log(if (ok) "Tunnel started" else "Tunnel failed to start")
            ok
        } catch (t: Throwable) {
            VpnState.log("Native lib error (libhev-socks5-tunnel.so missing?): ${t.message}")
            false
        }
    }

    private fun cleanup() {
        screenReceiver?.let { try { unregisterReceiver(it) } catch (_: Exception) {} }
        screenReceiver = null
        stopTun()
        try { socks?.stop() } catch (_: Exception) {}
        socks = null
        try { session?.disconnect() } catch (_: Exception) {}
        session = null
        VpnState.connectedAt.value = 0L
        VpnState.traffic.value = Traffic()
        if (VpnState.status.value == Status.CONNECTED || VpnState.status.value == Status.PAUSED) buzz()
        if (VpnState.status.value != Status.ERROR) VpnState.status.value = Status.DISCONNECTED
        VpnState.log("Disconnected")
        try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (_: Exception) {}
        stopSelf()
    }

    private fun buildNotification(text: String): Notification {
        val stopIntent = PendingIntent.getService(
            this, 0, Intent(this, SshTunnelService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle("GodarmX SSH")
            .setContentText(text)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Disconnect", stopIntent).build())
            .build()
    }

    private fun startForegroundCompat(name: String) {
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL, "VPN status", NotificationManager.IMPORTANCE_LOW))
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, 1, buildNotification(name), type)
    }
}
