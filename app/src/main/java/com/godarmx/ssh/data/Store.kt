package com.godarmx.ssh.data

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/** method: "direct", "proxy" (HTTP/SOCKS5 proxy), "tls" (SSH inside TLS), "tls-proxy" (TLS through an HTTP proxy) */
data class SshProfile(
    val id: String,
    val name: String,
    val host: String,
    val port: Int = 22,
    val username: String,
    val password: String = "",
    val privateKey: String = "",
    val passphrase: String = "",
    val method: String = "direct",
    val tlsInsecure: Boolean = false,
    val proxyType: String = "http",
    val proxyHost: String = "",
    val proxyPort: Int = 8080,
    val proxyUser: String = "",
    val proxyPass: String = "",
    val udpgwEnabled: Boolean = false,
    val udpgwPort: Int = 7300
)

object Store {
    private lateinit var prefs: SharedPreferences

    fun init(c: Context) {
        if (!::prefs.isInitialized) {
            prefs = c.applicationContext.getSharedPreferences("godarmx_ssh", Context.MODE_PRIVATE)
        }
    }

    fun profiles(): List<SshProfile> {
        val arr = JSONArray(prefs.getString("profiles", "[]"))
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            SshProfile(
                id = o.getString("id"), name = o.getString("name"),
                host = o.getString("host"), port = o.optInt("port", 22),
                username = o.getString("username"), password = o.optString("password"),
                privateKey = o.optString("privateKey"), passphrase = o.optString("passphrase"),
                method = o.optString("method", "direct"), tlsInsecure = o.optBoolean("tlsInsecure"),
                proxyType = o.optString("proxyType", "http"), proxyHost = o.optString("proxyHost"),
                proxyPort = o.optInt("proxyPort", 8080), proxyUser = o.optString("proxyUser"),
                proxyPass = o.optString("proxyPass"),
                udpgwEnabled = o.optBoolean("udpgwEnabled"), udpgwPort = o.optInt("udpgwPort", 7300)
            )
        }
    }

    fun saveProfiles(list: List<SshProfile>) {
        val arr = JSONArray()
        list.forEach {
            arr.put(JSONObject().put("id", it.id).put("name", it.name).put("host", it.host)
                .put("port", it.port).put("username", it.username).put("password", it.password)
                .put("privateKey", it.privateKey).put("passphrase", it.passphrase)
                .put("method", it.method).put("tlsInsecure", it.tlsInsecure)
                .put("proxyType", it.proxyType).put("proxyHost", it.proxyHost)
                .put("proxyPort", it.proxyPort).put("proxyUser", it.proxyUser)
                .put("proxyPass", it.proxyPass)
                .put("udpgwEnabled", it.udpgwEnabled).put("udpgwPort", it.udpgwPort))
        }
        prefs.edit().putString("profiles", arr.toString()).apply()
    }

    private fun bool(k: String, d: Boolean) = prefs.getBoolean(k, d)
    private fun setBool(k: String, v: Boolean) = prefs.edit().putBoolean(k, v).apply()

    var selectedId: String?
        get() = prefs.getString("selected", null)
        set(v) { prefs.edit().putString("selected", v).apply() }

    var autoReconnect: Boolean
        get() = bool("auto", true); set(v) = setBool("auto", v)
    var speedNotification: Boolean
        get() = bool("speedNotif", true); set(v) = setBool("speedNotif", v)
    var vibrate: Boolean
        get() = bool("vibrate", false); set(v) = setBool("vibrate", v)
    var openLogsOnConnect: Boolean
        get() = bool("openLogs", false); set(v) = setBool("openLogs", v)
    var connectAfterBoot: Boolean
        get() = bool("boot", false); set(v) = setBool("boot", v)
    var autoConnectOnSelect: Boolean
        get() = bool("autoSelect", false); set(v) = setBool("autoSelect", v)
    var batterySaver: Boolean
        get() = bool("battery", false); set(v) = setBool("battery", v)
    /** true = keep the TUN up (traffic blocked) while SSH reconnects; false = traffic goes direct meanwhile */
    var seamless: Boolean
        get() = bool("seamless", true); set(v) = setBool("seamless", v)
    var showToasts: Boolean
        get() = bool("toasts", true); set(v) = setBool("toasts", v)
    var minTls: String
        get() = prefs.getString("minTls", "1.2") ?: "1.2"
        set(v) { prefs.edit().putString("minTls", v).apply() }
    /** 0 = off */
    var autoStopMin: Int
        get() = prefs.getInt("autoStop", 0)
        set(v) { prefs.edit().putInt("autoStop", v).apply() }

    var keepAliveSec: Int
        get() = prefs.getInt("keepalive", 30)
        set(v) { prefs.edit().putInt("keepalive", v).apply() }

    var socksPort: Int
        get() = prefs.getInt("socks", 1080)
        set(v) { prefs.edit().putInt("socks", v).apply() }
}
