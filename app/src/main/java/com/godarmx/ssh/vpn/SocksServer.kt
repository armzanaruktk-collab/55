package com.godarmx.ssh.vpn

import com.jcraft.jsch.ChannelDirectTCPIP
import com.jcraft.jsch.Session
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketAddress
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.Executors

/**
 * Minimal local SOCKS5 server (CONNECT only). Every connection is forwarded
 * through an SSH "direct-tcpip" channel, which gives us ssh -D behaviour.
 */
class SocksServer(
    private val port: Int,
    private val udpgwPort: Int, // 0 = UDP relay disabled
    private val sessionProvider: () -> Session?
) {
    private var server: ServerSocket? = null
    private val pool = Executors.newCachedThreadPool()
    @Volatile private var running = false
    @Volatile private var lastErrLog = 0L

    fun start() {
        val s = ServerSocket()
        s.reuseAddress = true
        s.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 128)
        server = s
        running = true
        pool.execute {
            while (running) {
                try {
                    val c = s.accept()
                    pool.execute { handle(c) }
                } catch (e: Exception) {
                    if (!running) break
                }
            }
        }
        VpnState.log("SOCKS5 listening on 127.0.0.1:$port")
    }

    fun stop() {
        running = false
        try { server?.close() } catch (_: Exception) {}
        pool.shutdownNow()
    }

    private fun handle(c: Socket) {
        var ch: ChannelDirectTCPIP? = null
        var replied = false
        try {
            c.soTimeout = 15000
            c.tcpNoDelay = true
            val inp = DataInputStream(c.getInputStream())
            val out = c.getOutputStream()
            if (inp.readUnsignedByte() != 5) return
            inp.readFully(ByteArray(inp.readUnsignedByte()))
            out.write(byteArrayOf(5, 0)); out.flush()
            if (inp.readUnsignedByte() != 5) return
            val cmd = inp.readUnsignedByte()
            inp.readUnsignedByte()
            val host = when (inp.readUnsignedByte()) {
                1 -> { val b = ByteArray(4); inp.readFully(b); InetAddress.getByAddress(b).hostAddress!! }
                3 -> { val b = ByteArray(inp.readUnsignedByte()); inp.readFully(b); String(b) }
                4 -> { val b = ByteArray(16); inp.readFully(b); InetAddress.getByAddress(b).hostAddress!! }
                else -> { reply(out, 8); return }
            }
            val dport = inp.readUnsignedShort()
            val session = sessionProvider()
            if (session == null || !session.isConnected) { reply(out, 1); return }
            if (cmd == 3 && udpgwPort > 0) { // UDP ASSOCIATE -> badvpn-udpgw on the SSH server
                replied = true
                handleUdp(c, out, session)
                return
            }
            if (cmd != 1) { reply(out, 7); return }

            val channel = session.openChannel("direct-tcpip") as ChannelDirectTCPIP
            ch = channel
            channel.setHost(host)
            channel.setPort(dport)
            val remoteIn = channel.inputStream
            val remoteOut = channel.outputStream
            channel.connect(10000)
            reply(out, 0)
            replied = true
            c.soTimeout = 0

            val up = pool.submit { copy(inp, remoteOut) }
            copy(remoteIn, out)
            up.cancel(true)
        } catch (e: Exception) {
            val now = System.currentTimeMillis()
            if (now - lastErrLog > 5000) {
                lastErrLog = now
                VpnState.log("Forward error: ${e.message}")
            }
            if (!replied) try { reply(c.getOutputStream(), 5) } catch (_: Exception) {}
        } finally {
            try { ch?.disconnect() } catch (_: Exception) {}
            try { c.close() } catch (_: Exception) {}
        }
    }

    /**
     * UDP over SSH using the badvpn-udpgw protocol. One SSH channel to the server's udpgw port
     * per SOCKS5 UDP association. Frame: [len u16 LE][flags u8][conid u16 LE][ip 4|16][port u16 BE][data].
     * NOTE: written from the protocol description, not yet tested against a live udpgw server.
     */
    private fun handleUdp(c: Socket, out: OutputStream, session: Session) {
        val ds = DatagramSocket(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
        var ch: ChannelDirectTCPIP? = null
        try {
            val channel = session.openChannel("direct-tcpip") as ChannelDirectTCPIP
            ch = channel
            channel.setHost("127.0.0.1")
            channel.setPort(udpgwPort)
            val rin = channel.inputStream
            val rout = channel.outputStream
            channel.connect(10000)
            val lp = ds.localPort
            out.write(byteArrayOf(5, 0, 0, 1, 127, 0, 0, 1, (lp shr 8).toByte(), lp.toByte()))
            out.flush()
            c.soTimeout = 0
            val client = AtomicReference<SocketAddress?>()

            val down = pool.submit {
                try {
                    val din = DataInputStream(rin)
                    while (true) {
                        val len = din.readUnsignedByte() or (din.readUnsignedByte() shl 8)
                        val buf = ByteArray(len)
                        din.readFully(buf)
                        if (len < 3) continue
                        val v6 = (buf[0].toInt() and 8) != 0
                        val alen = if (v6) 16 else 4
                        if (len < 3 + alen + 2) continue
                        val to = client.get() ?: continue
                        val pkt = ByteArrayOutputStream()
                        pkt.write(byteArrayOf(0, 0, 0, if (v6) 4 else 1))
                        pkt.write(buf, 3, alen + 2)
                        pkt.write(buf, 3 + alen + 2, len - (3 + alen + 2))
                        val arr = pkt.toByteArray()
                        ds.send(DatagramPacket(arr, arr.size, to))
                    }
                } catch (_: Exception) {}
            }

            val up = pool.submit {
                try {
                    val conIds = HashMap<String, Int>()
                    var next = 1
                    val buf = ByteArray(65535)
                    while (true) {
                        val dp = DatagramPacket(buf, buf.size)
                        ds.receive(dp)
                        client.set(dp.socketAddress)
                        val d = dp.data
                        val end = dp.offset + dp.length
                        if (dp.length < 10 || d[2].toInt() != 0) continue // fragments not supported
                        var o = dp.offset + 4
                        val ip: ByteArray = when (d[dp.offset + 3].toInt()) {
                            1 -> d.copyOfRange(o, o + 4).also { o += 4 }
                            4 -> d.copyOfRange(o, o + 16).also { o += 16 }
                            3 -> {
                                val l = d[o].toInt() and 0xFF
                                val name = String(d, o + 1, l)
                                o += 1 + l
                                InetAddress.getByName(name).address
                            }
                            else -> continue
                        }
                        val dport = ((d[o].toInt() and 0xFF) shl 8) or (d[o + 1].toInt() and 0xFF)
                        o += 2
                        val dlen = end - o
                        if (dlen < 0) continue
                        val key = ip.joinToString("") { "%02x".format(it) } + ":" + dport
                        val conId = conIds.getOrPut(key) { next.also { next = if (next >= 65535) 1 else next + 1 } }
                        val v6 = ip.size == 16
                        val plen = 3 + ip.size + 2 + dlen
                        val frame = ByteArrayOutputStream(plen + 2)
                        frame.write(plen and 0xFF); frame.write((plen shr 8) and 0xFF)
                        frame.write(if (v6) 8 else 0)
                        frame.write(conId and 0xFF); frame.write((conId shr 8) and 0xFF)
                        frame.write(ip)
                        frame.write((dport shr 8) and 0xFF); frame.write(dport and 0xFF)
                        frame.write(d, o, dlen)
                        rout.write(frame.toByteArray())
                        rout.flush()
                    }
                } catch (_: Exception) {}
            }
            // the association lives as long as the TCP control connection stays open
            try { while (c.getInputStream().read() >= 0) { /* drain */ } } catch (_: Exception) {}
            up.cancel(true); down.cancel(true)
        } catch (e: Exception) {
            VpnState.log("UDPGW error: ${e.message}")
            try { reply(out, 5) } catch (_: Exception) {}
        } finally {
            ds.close()
            try { ch?.disconnect() } catch (_: Exception) {}
        }
    }

    private fun reply(out: OutputStream, code: Int) {
        out.write(byteArrayOf(5, code.toByte(), 0, 1, 0, 0, 0, 0, 0, 0))
        out.flush()
    }

    // flush after every write: SSH channel pipes can otherwise delay data
    private fun copy(src: InputStream, dst: OutputStream) {
        val buf = ByteArray(16384)
        try {
            while (true) {
                val n = src.read(buf)
                if (n < 0) break
                dst.write(buf, 0, n)
                dst.flush()
            }
        } catch (_: Exception) {}
    }
}
