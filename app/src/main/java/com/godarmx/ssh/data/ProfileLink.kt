package com.godarmx.ssh.data

import java.net.URLDecoder
import java.net.URLEncoder
import java.util.UUID

/**
 * Import / export of profiles as one-line text.
 *   ssh://user:pass@host:22#Name            (add ?tls=1 for SSH over TLS)
 *   host:22@user:pass                       (common account-list format)
 */
object ProfileLink {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun dec(s: String) = URLDecoder.decode(s, "UTF-8")

    fun format(p: SshProfile): String {
        val params = buildList {
            if (p.method == "tls") add("tls=1")
            if (p.udpgwEnabled) add("udpgw=${p.udpgwPort}")
        }
        val q = if (params.isEmpty()) "" else "?" + params.joinToString("&")
        return "ssh://${enc(p.username)}:${enc(p.password)}@${p.host}:${p.port}$q#${enc(p.name)}"
    }

    fun parse(line: String): SshProfile? {
        val t = line.trim()
        if (t.isEmpty()) return null
        return try {
            if (t.startsWith("ssh://")) parseUri(t.removePrefix("ssh://")) else parseSimple(t)
        } catch (e: Exception) { null }
    }

    private fun parseUri(body: String): SshProfile? {
        val name = body.substringAfter('#', "").let { if (it.isEmpty()) "" else dec(it) }
        val noFrag = body.substringBefore('#')
        val query = noFrag.substringAfter('?', "")
        val main = noFrag.substringBefore('?')
        val at = main.lastIndexOf('@')
        if (at < 0) return null
        val cred = main.substring(0, at)
        val hp = main.substring(at + 1)
        val user = dec(cred.substringBefore(':'))
        val pass = dec(cred.substringAfter(':', ""))
        val host = hp.substringBeforeLast(':', hp)
        val port = if (hp.contains(':')) hp.substringAfterLast(':').toInt() else 22
        if (host.isBlank() || user.isBlank() || port !in 1..65535) return null
        val params = query.split('&')
        val tls = params.any { it == "tls=1" }
        val udpgw = params.firstOrNull { it.startsWith("udpgw=") }?.substringAfter('=')?.toIntOrNull()
        return SshProfile(UUID.randomUUID().toString(), name.ifBlank { host }, host, port, user, pass,
            method = if (tls) "tls" else "direct",
            udpgwEnabled = udpgw != null, udpgwPort = udpgw ?: 7300)
    }

    private fun parseSimple(t: String): SshProfile? {
        val at = t.indexOf('@')
        if (at < 0) return null
        val hp = t.substring(0, at)
        val up = t.substring(at + 1)
        val host = hp.substringBefore(':')
        val port = if (hp.contains(':')) hp.substringAfter(':').toInt() else 22
        val user = up.substringBefore(':')
        val pass = up.substringAfter(':', "")
        if (host.isBlank() || user.isBlank() || port !in 1..65535) return null
        return SshProfile(UUID.randomUUID().toString(), host, host, port, user, pass)
    }
}
