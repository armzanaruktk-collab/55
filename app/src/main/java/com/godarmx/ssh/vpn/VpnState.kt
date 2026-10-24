package com.godarmx.ssh.vpn

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class Status { DISCONNECTED, CONNECTING, CONNECTED, PAUSED, ERROR }

data class Traffic(val upBps: Long = 0, val downBps: Long = 0, val upTotal: Long = 0, val downTotal: Long = 0)

object VpnState {
    val status = MutableStateFlow(Status.DISCONNECTED)
    val connectedAt = MutableStateFlow(0L)
    val traffic = MutableStateFlow(Traffic())
    /** extra seconds added by the "+30 min" button to the auto-disconnect timer */
    val extraSec = MutableStateFlow(0L)
    val logs = MutableStateFlow<List<String>>(emptyList())

    fun log(msg: String) {
        val t = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
        logs.update { (it + "[$t] $msg").takeLast(500) }
    }

    fun formatBytes(b: Long): String = when {
        b >= 1L shl 30 -> "%.2f GB".format(b / (1L shl 30).toDouble())
        b >= 1L shl 20 -> "%.1f MB".format(b / (1L shl 20).toDouble())
        b >= 1L shl 10 -> "%.0f KB".format(b / 1024.0)
        else -> "$b B"
    }
}
