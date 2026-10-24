package com.godarmx.ssh.vpn

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.VpnService
import com.godarmx.ssh.data.Store

/** Optional: reconnect the last used profile after reboot (only if VPN permission was already granted). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        Store.init(context)
        val id = Store.selectedId ?: return
        if (Store.connectAfterBoot && VpnService.prepare(context) == null) {
            SshTunnelService.start(context, id)
        }
    }
}
