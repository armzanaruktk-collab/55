@file:OptIn(ExperimentalMaterial3Api::class)

package com.godarmx.ssh.ui

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.godarmx.ssh.R
import com.godarmx.ssh.data.ProfileLink
import com.godarmx.ssh.data.SshProfile
import com.godarmx.ssh.data.Store
import com.godarmx.ssh.vpn.Status
import com.godarmx.ssh.vpn.Traffic
import com.godarmx.ssh.vpn.VpnState
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.update
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID

@Composable
fun App(onConnect: (SshProfile) -> Unit, onDisconnect: () -> Unit) {
    val ctx = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var tab by remember { mutableIntStateOf(0) }
    val profiles = remember { mutableStateListOf<SshProfile>().also { it.addAll(Store.profiles()) } }
    var selectedId by remember { mutableStateOf(Store.selectedId ?: profiles.firstOrNull()?.id) }
    var editing by remember { mutableStateOf<SshProfile?>(null) }
    var showDialog by remember { mutableStateOf(false) }
    var showImport by remember { mutableStateOf(false) }
    val status by VpnState.status.collectAsState()
    val connectedAt by VpnState.connectedAt.collectAsState()
    val traffic by VpnState.traffic.collectAsState()

    fun persist() { Store.saveProfiles(profiles.toList()); Store.selectedId = selectedId }
    fun toast(m: String) = Toast.makeText(ctx, m, Toast.LENGTH_SHORT).show()

    LaunchedEffect(status) {
        if (status == Status.CONNECTED && Store.openLogsOnConnect) tab = 2
        if (Store.showToasts) when (status) {
            Status.CONNECTED -> toast("Connected")
            Status.ERROR -> toast("Connection failed - see Logs")
            else -> {}
        }
    }
    val idle = status == Status.DISCONNECTED || status == Status.ERROR

    val tabs = listOf(
        "Home" to Icons.Default.Home,
        "Profiles" to Icons.Default.Person,
        "Logs" to Icons.AutoMirrored.Filled.List,
        "Settings" to Icons.Default.Settings
    )

    Box(Modifier.fillMaxSize()) {
    AppBackground()
    Scaffold(
        containerColor = Color.Transparent,
        bottomBar = {
            NavigationBar(containerColor = Color(0xCC0A1410)) {
                tabs.forEachIndexed { i, (label, icon) ->
                    NavigationBarItem(
                        selected = tab == i, onClick = { tab = i },
                        icon = { Icon(icon, contentDescription = label) },
                        label = { Text(label) }
                    )
                }
            }
        },
        floatingActionButton = {
            if (tab == 1) FloatingActionButton(onClick = { editing = null; showDialog = true }) {
                Icon(Icons.Default.Add, contentDescription = "Add")
            }
        }
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (tab) {
                0 -> HomeScreen(
                    profiles = profiles, selectedId = selectedId,
                    onSelect = { id ->
                        selectedId = id; persist()
                        if (Store.autoConnectOnSelect && idle) profiles.find { it.id == id }?.let(onConnect)
                    },
                    status = status, connectedAt = connectedAt, traffic = traffic,
                    onToggle = {
                        if (status == Status.DISCONNECTED || status == Status.ERROR) {
                            val p = profiles.find { it.id == selectedId }
                            if (p == null) toast("Add a profile first") else onConnect(p)
                        } else onDisconnect()
                    }
                )
                1 -> ProfilesScreen(
                    profiles = profiles,
                    selectedId = selectedId,
                    onUse = { selectedId = it.id; persist(); tab = 0; if (Store.autoConnectOnSelect && idle) onConnect(it) },
                    onEdit = { editing = it; showDialog = true },
                    onDelete = { p ->
                        profiles.remove(p)
                        if (selectedId == p.id) selectedId = profiles.firstOrNull()?.id
                        persist()
                    },
                    onShare = {
                        val link = ProfileLink.format(it)
                        clipboard.setText(AnnotatedString(link))
                        ctx.startActivity(Intent.createChooser(
                            Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link), "Share profile"))
                    },
                    onCopyAll = {
                        clipboard.setText(AnnotatedString(profiles.joinToString("\n") { ProfileLink.format(it) }))
                        toast("${profiles.size} profile(s) copied")
                    },
                    onImport = { showImport = true },
                    onDeleteAll = { profiles.clear(); selectedId = null; persist() }
                )
                2 -> LogsScreen()
                else -> SettingsScreen()
            }
        }
    }
    }

    if (showDialog) {
        ProfileDialog(
            initial = editing,
            onDismiss = { showDialog = false },
            onSave = { p ->
                val i = profiles.indexOfFirst { it.id == p.id }
                if (i >= 0) profiles[i] = p else profiles.add(p)
                if (selectedId == null) selectedId = p.id
                persist()
                showDialog = false
            }
        )
    }
    if (showImport) {
        ImportDialog(
            pasteText = { clipboard.getText()?.text ?: "" },
            onDismiss = { showImport = false },
            onImport = { text ->
                val list = text.lines().mapNotNull { ProfileLink.parse(it) }
                if (list.isEmpty()) toast("No valid profile found")
                else {
                    profiles.addAll(list)
                    if (selectedId == null) selectedId = list.first().id
                    persist()
                    toast("Imported ${list.size} profile(s)")
                    showImport = false
                }
            }
        )
    }
}

private fun hms(s: Long) = "%02d:%02d:%02d".format(s / 3600, (s % 3600) / 60, s % 60)

@Composable
fun HomeScreen(
    profiles: List<SshProfile>, selectedId: String?, onSelect: (String) -> Unit,
    status: Status, connectedAt: Long, traffic: Traffic, onToggle: () -> Unit
) {
    val selected = profiles.find { it.id == selectedId }
    var expanded by remember { mutableStateOf(false) }
    val extra by VpnState.extraSec.collectAsState()
    val limitMin = Store.autoStopMin
    val elapsed by produceState(0L, connectedAt, status) {
        while (true) {
            value = if ((status == Status.CONNECTED || status == Status.PAUSED) && connectedAt > 0)
                (System.currentTimeMillis() - connectedAt) / 1000 else 0L
            delay(1000)
        }
    }
    val running = status != Status.DISCONNECTED && status != Status.ERROR
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterVertically)
    ) {
        Logo()
        Box(Modifier.fillMaxWidth()) {
            OutlinedButton(
                onClick = { expanded = true }, modifier = Modifier.fillMaxWidth(), enabled = !running
            ) { Text(selected?.let { "${it.name}  (${it.host})" } ?: "No profile - add or import in Profiles") }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                profiles.forEach {
                    DropdownMenuItem(text = { Text(it.name) }, onClick = { onSelect(it.id); expanded = false })
                }
            }
        }
        selected?.let {
            val m = PROTOCOLS.firstOrNull { x -> x.first == it.method }?.second ?: "SSH-Direct"
            Text(m + if (it.udpgwEnabled) "  +  UDPGW" else "", style = MaterialTheme.typography.bodySmall)
        }
        val (label, color) = when (status) {
            Status.CONNECTED -> "Connected" to Color(0xFF4CAF50)
            Status.CONNECTING -> "Connecting..." to Color(0xFFFFC107)
            Status.PAUSED -> "Paused (screen off)" to Color(0xFF29B6F6)
            Status.ERROR -> "Error - see Logs" to Color(0xFFF44336)
            Status.DISCONNECTED -> "Disconnected" to Color.Gray
        }
        Text(label, color = color, style = MaterialTheme.typography.titleLarge)
        Text(hms(elapsed), fontFamily = FontFamily.Monospace, fontSize = 32.sp)
        if (status == Status.CONNECTED && limitMin > 0) {
            val rem = (limitMin * 60L + extra - elapsed).coerceAtLeast(0)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Time left  ${hms(rem)}", fontFamily = FontFamily.Monospace)
                OutlinedButton(onClick = { VpnState.extraSec.update { it + 1800 } }) { Text("+30 min") }
            }
        }
        if (status == Status.CONNECTED) {
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                Text("↑ ${VpnState.formatBytes(traffic.upBps)}/s", fontFamily = FontFamily.Monospace)
                Text("↓ ${VpnState.formatBytes(traffic.downBps)}/s", fontFamily = FontFamily.Monospace)
            }
            Text(
                "Total  ↑ ${VpnState.formatBytes(traffic.upTotal)}   ↓ ${VpnState.formatBytes(traffic.downTotal)}",
                style = MaterialTheme.typography.bodySmall
            )
        }
        Button(onClick = onToggle, modifier = Modifier.fillMaxWidth().height(56.dp)) {
            Text(if (running) "Disconnect" else "Connect")
        }
    }
}

@Composable
fun ProfilesScreen(
    profiles: List<SshProfile>, selectedId: String?,
    onUse: (SshProfile) -> Unit, onEdit: (SshProfile) -> Unit, onDelete: (SshProfile) -> Unit,
    onShare: (SshProfile) -> Unit, onCopyAll: () -> Unit, onImport: () -> Unit, onDeleteAll: () -> Unit
) {
    val pings = remember { mutableStateMapOf<String, String>() }
    var query by remember { mutableStateOf("") }
    var confirmAll by remember { mutableStateOf(false) }
    fun ping(p: SshProfile) {
        pings[p.id] = "..."
        val host = if (p.method.endsWith("proxy") && p.proxyHost.isNotBlank()) p.proxyHost else p.host
        val port = if (p.method.endsWith("proxy") && p.proxyHost.isNotBlank()) p.proxyPort else p.port
        Thread {
            val t0 = System.nanoTime()
            pings[p.id] = try {
                Socket().use { it.connect(InetSocketAddress(host, port), 5000) }
                "${(System.nanoTime() - t0) / 1_000_000} ms"
            } catch (e: Exception) { "failed" }
        }.start()
    }
    val shown = profiles.filter {
        query.isBlank() || it.name.contains(query, true) || it.host.contains(query, true)
    }
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onImport) { Text("Import") }
            OutlinedButton(onClick = onCopyAll, enabled = profiles.isNotEmpty()) { Text("Copy all") }
            OutlinedButton(onClick = { confirmAll = true }, enabled = profiles.isNotEmpty()) { Text("Delete all") }
        }
        OutlinedTextField(
            query, { query = it }, label = { Text("Search (${profiles.size})") }, singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
        )
        if (shown.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(if (profiles.isEmpty()) "No profiles. Tap + or Import." else "No match.")
            }
        } else LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(shown, key = { it.id }) { p ->
                Card(
                    Modifier.fillMaxWidth(), onClick = { onUse(p) },
                    colors = CardDefaults.cardColors(
                        containerColor = if (p.id == selectedId) Color(0xFF1F3A25) else MaterialTheme.colorScheme.surface
                    )
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(p.name, style = MaterialTheme.typography.titleMedium)
                        Text("${p.username}@${p.host}:${p.port}   [${p.method}]", style = MaterialTheme.typography.bodySmall)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            TextButton(onClick = { ping(p) }) { Text(pings[p.id] ?: "Test") }
                            Spacer(Modifier.weight(1f))
                            IconButton(onClick = { onShare(p) }) { Icon(Icons.Default.Share, "Share") }
                            IconButton(onClick = { onEdit(p) }) { Icon(Icons.Default.Edit, "Edit") }
                            IconButton(onClick = { onDelete(p) }) { Icon(Icons.Default.Delete, "Delete") }
                        }
                    }
                }
            }
        }
    }
    if (confirmAll) {
        AlertDialog(
            onDismissRequest = { confirmAll = false },
            title = { Text("Delete all profiles?") },
            text = { Text("${profiles.size} profile(s) will be removed. This cannot be undone.") },
            confirmButton = { TextButton(onClick = { confirmAll = false; onDeleteAll() }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { confirmAll = false }) { Text("Cancel") } }
        )
    }
}

@Composable
fun ImportDialog(pasteText: () -> String, onDismiss: () -> Unit, onImport: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Import profiles") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("One per line:\nssh://user:pass@host:22#Name\nhost:22@user:pass", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(text, { text = it }, minLines = 4, maxLines = 8, modifier = Modifier.fillMaxWidth())
                TextButton(onClick = { text = pasteText() }) { Text("Paste from clipboard") }
            }
        },
        confirmButton = { TextButton(enabled = text.isNotBlank(), onClick = { onImport(text) }) { Text("Import") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

val PROTOCOLS = listOf(
    "direct" to "SSH-Direct",
    "proxy" to "SSH-Proxy",
    "tls" to "SSH-TLS",
    "tls-proxy" to "SSH-TLS-Proxy"
)

@Composable
private fun Picker(label: String, options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxWidth()) {
        OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
            Text("$label: ${options.firstOrNull { it.first == selected }?.second ?: ""}", Modifier.weight(1f))
            Icon(Icons.Default.ArrowDropDown, null)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (k, v) -> DropdownMenuItem(text = { Text(v) }, onClick = { onSelect(k); open = false }) }
        }
    }
}

@Composable
fun ProfileDialog(initial: SshProfile?, onSave: (SshProfile) -> Unit, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf(initial?.name ?: "") }
    var host by remember { mutableStateOf(initial?.host ?: "") }
    var port by remember { mutableStateOf((initial?.port ?: 22).toString()) }
    var user by remember { mutableStateOf(initial?.username ?: "") }
    var authKey by remember { mutableStateOf(initial?.privateKey?.isNotBlank() == true) }
    var pass by remember { mutableStateOf(initial?.password ?: "") }
    var key by remember { mutableStateOf(initial?.privateKey ?: "") }
    var phrase by remember { mutableStateOf(initial?.passphrase ?: "") }
    var method by remember { mutableStateOf(initial?.method ?: "direct") }
    var insecure by remember { mutableStateOf(initial?.tlsInsecure ?: false) }
    var pType by remember { mutableStateOf(initial?.proxyType ?: "http") }
    var pHost by remember { mutableStateOf(initial?.proxyHost ?: "") }
    var pPort by remember { mutableStateOf((initial?.proxyPort ?: 8080).toString()) }
    var pUser by remember { mutableStateOf(initial?.proxyUser ?: "") }
    var pPass by remember { mutableStateOf(initial?.proxyPass ?: "") }
    var udpOn by remember { mutableStateOf(initial?.udpgwEnabled ?: false) }
    var udpPort by remember { mutableStateOf((initial?.udpgwPort ?: 7300).toString()) }
    val usesTls = method.startsWith("tls")
    val usesProxy = method.endsWith("proxy")
    val valid = host.isNotBlank() && user.isNotBlank() && port.toIntOrNull() in 1..65535 &&
        (!usesProxy || (pHost.isNotBlank() && pPort.toIntOrNull() in 1..65535)) &&
        (!udpOn || udpPort.toIntOrNull() in 1..65535)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "Add SSH profile" else "Edit profile") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Picker("Protocol", PROTOCOLS, method) { method = it }
                OutlinedTextField(name, { name = it }, label = { Text("Remarks") }, singleLine = true)
                OutlinedTextField(host, { host = it.trim() }, label = { Text("SSH Host") }, singleLine = true)
                OutlinedTextField(port, { port = it.filter(Char::isDigit) }, label = { Text("SSH Port") }, singleLine = true)
                OutlinedTextField(user, { user = it.trim() }, label = { Text("SSH Username") }, singleLine = true)

                Picker("Authentication", listOf("pw" to "Password", "key" to "Private key"), if (authKey) "key" else "pw") {
                    authKey = it == "key"
                }
                if (!authKey) {
                    OutlinedTextField(pass, { pass = it }, label = { Text("SSH Password") }, singleLine = true,
                        visualTransformation = PasswordVisualTransformation())
                } else {
                    OutlinedTextField(key, { key = it }, label = { Text("Private key (PEM)") }, minLines = 3, maxLines = 5)
                    OutlinedTextField(phrase, { phrase = it }, label = { Text("Key passphrase (optional)") }, singleLine = true,
                        visualTransformation = PasswordVisualTransformation())
                }

                if (usesTls) {
                    Text("Server must wrap SSH in TLS (stunnel / nginx stream). SNI = SSH host.",
                        style = MaterialTheme.typography.bodySmall)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Allow self-signed certificate", Modifier.weight(1f))
                        Switch(insecure, { insecure = it })
                    }
                }
                if (usesProxy) {
                    if (method == "proxy") {
                        Picker("Proxy type", listOf("http" to "HTTP", "socks5" to "SOCKS5"), pType) { pType = it }
                    } else {
                        Text("TLS through an HTTP CONNECT proxy.", style = MaterialTheme.typography.bodySmall)
                    }
                    OutlinedTextField(pHost, { pHost = it.trim() }, label = { Text("Proxy host") }, singleLine = true)
                    OutlinedTextField(pPort, { pPort = it.filter(Char::isDigit) }, label = { Text("Proxy port") }, singleLine = true)
                    OutlinedTextField(pUser, { pUser = it }, label = { Text("Proxy user (optional)") }, singleLine = true)
                    OutlinedTextField(pPass, { pPass = it }, label = { Text("Proxy password") }, singleLine = true,
                        visualTransformation = PasswordVisualTransformation())
                }

                HorizontalDivider()
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("UDPGW (UDP over SSH)")
                        Text("Needs badvpn-udpgw on your server:\nbadvpn-udpgw --listen-addr 127.0.0.1:7300",
                            style = MaterialTheme.typography.bodySmall)
                    }
                    Switch(udpOn, { udpOn = it })
                }
                if (udpOn) {
                    OutlinedTextField(udpPort, { udpPort = it.filter(Char::isDigit) }, label = { Text("Udpgw Port") }, singleLine = true)
                }
            }
        },
        confirmButton = {
            TextButton(enabled = valid, onClick = {
                onSave(SshProfile(
                    id = initial?.id ?: UUID.randomUUID().toString(),
                    name = name.ifBlank { host }, host = host, port = port.toInt(),
                    username = user,
                    password = if (authKey) "" else pass,
                    privateKey = if (authKey) key else "",
                    passphrase = if (authKey) phrase else "",
                    method = method, tlsInsecure = insecure,
                    proxyType = if (method == "tls-proxy") "http" else pType,
                    proxyHost = pHost, proxyPort = pPort.toIntOrNull() ?: 8080,
                    proxyUser = pUser, proxyPass = pPass,
                    udpgwEnabled = udpOn, udpgwPort = udpPort.toIntOrNull() ?: 7300
                ))
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable
fun LogsScreen() {
    val logs by VpnState.logs.collectAsState()
    val clipboard = LocalClipboardManager.current
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Logs", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            TextButton(onClick = { clipboard.setText(AnnotatedString(logs.joinToString("\n"))) }) { Text("Copy") }
            TextButton(onClick = { VpnState.logs.value = emptyList() }) { Text("Clear") }
        }
        LazyColumn(reverseLayout = true) {
            items(logs.reversed()) { Text(it, fontFamily = FontFamily.Monospace, fontSize = 12.sp) }
        }
    }
}

@Composable
private fun SwitchRow(title: String, desc: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title)
            Text(desc, style = MaterialTheme.typography.bodySmall)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
fun SettingsScreen() {
    val ctx = LocalContext.current
    var auto by remember { mutableStateOf(Store.autoReconnect) }
    var seamless by remember { mutableStateOf(Store.seamless) }
    var autoSel by remember { mutableStateOf(Store.autoConnectOnSelect) }
    var battery by remember { mutableStateOf(Store.batterySaver) }
    var speed by remember { mutableStateOf(Store.speedNotification) }
    var toasts by remember { mutableStateOf(Store.showToasts) }
    var vib by remember { mutableStateOf(Store.vibrate) }
    var logsOn by remember { mutableStateOf(Store.openLogsOnConnect) }
    var boot by remember { mutableStateOf(Store.connectAfterBoot) }
    var minTls by remember { mutableStateOf(Store.minTls) }
    var stopMin by remember { mutableStateOf(Store.autoStopMin) }
    var keep by remember { mutableStateOf(Store.keepAliveSec.toString()) }
    var socks by remember { mutableStateOf(Store.socksPort.toString()) }
    val version = remember { try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName } catch (_: Exception) { "?" } }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("Settings", style = MaterialTheme.typography.titleLarge)
        SwitchRow("Speed in notification", "Show upload/download speed", speed) { speed = it; Store.speedNotification = it }
        SwitchRow("Notifications", "Show a message on connect / error", toasts) { toasts = it; Store.showToasts = it }
        SwitchRow("Auto connect on select", "Connect right after choosing a profile", autoSel) { autoSel = it; Store.autoConnectOnSelect = it }
        SwitchRow("Vibrate", "On connect / disconnect", vib) { vib = it; Store.vibrate = it }
        SwitchRow("Open logs on connect", "Jump to the Logs tab when connected", logsOn) { logsOn = it; Store.openLogsOnConnect = it }
        SwitchRow("Battery saver", "Pause the VPN while the screen is off", battery) { battery = it; Store.batterySaver = it }
        SwitchRow("Seamless tunnel", "Block internet while reconnecting (no leaks)", seamless) { seamless = it; Store.seamless = it }
        SwitchRow("Auto reconnect", "Retry SSH when the session drops", auto) { auto = it; Store.autoReconnect = it }
        SwitchRow("Connect after reboot", "Reconnect the last profile at boot", boot) { boot = it; Store.connectAfterBoot = it }

        Picker("Auto-disconnect timer", listOf("0" to "Off", "30" to "30 min", "60" to "1 hour", "120" to "2 hours", "240" to "4 hours"),
            stopMin.toString()) { stopMin = it.toInt(); Store.autoStopMin = stopMin }
        Picker("Minimum TLS version", listOf("1.2" to "TLS 1.2", "1.3" to "TLS 1.3"), minTls) { minTls = it; Store.minTls = it }
        OutlinedTextField(keep, { v -> keep = v.filter(Char::isDigit); keep.toIntOrNull()?.takeIf { it > 0 }?.let { Store.keepAliveSec = it } },
            label = { Text("Keep-alive interval (seconds)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(socks, { v -> socks = v.filter(Char::isDigit); socks.toIntOrNull()?.takeIf { it in 1024..65535 }?.let { Store.socksPort = it } },
            label = { Text("Local SOCKS5 port (1024-65535)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Text("Timer, TLS, keep-alive and port apply on the next connection. DNS is resolved through the SSH server.",
            style = MaterialTheme.typography.bodySmall)

        HorizontalDivider()
        Text("About", style = MaterialTheme.typography.titleMedium)
        Text("GodarmX SSH  v$version", style = MaterialTheme.typography.bodyMedium)
        Text(
            "Use only with servers you own or are authorised to use. Do not use this app for:\n" +
                "• hacking, cracking or attacking other systems\n" +
                "• fraud, carding or counterfeiting\n" +
                "• illegal content, especially child exploitation\n" +
                "• spam, phishing or scams\n" +
                "• harassing others or stealing trade secrets\n" +
                "• DoS / DDoS attacks",
            style = MaterialTheme.typography.bodySmall
        )
    }
}

@Composable
fun AppBackground() {
    Canvas(Modifier.fillMaxSize()) {
        drawRect(Brush.verticalGradient(listOf(Color(0xFF0B1F12), Color(0xFF123524), Color(0xFF0A1410))))
        val w = size.width
        val h = size.height
        drawCircle(Color(0x334CAF50), radius = w * 0.45f, center = Offset(w * 0.95f, h * 0.08f))
        drawCircle(Color(0x2681C784), radius = w * 0.30f, center = Offset(w * 0.02f, h * 0.45f))
        drawCircle(Color(0x2A2E7D32), radius = w * 0.55f, center = Offset(w * 0.85f, h * 0.92f))
        drawCircle(Color(0x3381C784), radius = w * 0.06f, center = Offset(w * 0.2f, h * 0.15f))
        drawCircle(Color(0x334CAF50), radius = w * 0.04f, center = Offset(w * 0.75f, h * 0.55f))
        drawCircle(Color(0x2681C784), radius = w * 0.08f, center = Offset(w * 0.3f, h * 0.8f))
    }
}

@Composable
fun Logo() {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = "GodarmX", modifier = Modifier.size(112.dp))
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = Color.White)) { append("Godarm") }
                withStyle(SpanStyle(color = Color(0xFF4CAF50))) { append("X") }
            },
            fontSize = 30.sp, fontWeight = FontWeight.Bold
        )
        Text("SSH Tunnel VPN", style = MaterialTheme.typography.bodySmall)
    }
}
