console.log("🚀 Starting WhatsApp Backend...");
console.log("🔥 ENTRY FILE LOADED");

const express = require("express");
const cors = require("cors");
const QRCode = require("qrcode");
const P = require("pino");
const path = require("path");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// ================= GLOBAL STATE =================
let sock = null;
let currentQR = null;
let isConnected = false;
let isStarting = false;

// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("OK");
});
app.get("/reset", async (req, res) => {
  const fs = require("fs");
  const path = require("path");

  const authPath = path.join(process.cwd(), "auth_info");

  if (fs.existsSync(authPath)) {
    fs.rmSync(authPath, { recursive: true, force: true });
  }

  res.send("Auth reset. Restart app.");
});
// ================= STATUS =================
app.get("/status", (req, res) => {
  res.json({
    connected: isConnected,
    qrAvailable: !!currentQR
  });
});

// ================= QR =================
app.get("/qr", async (req, res) => {
  if (!currentQR) {
    return res.send("<h2>⚠️ No QR available (already connected or not started)</h2>");
  }

  const qrImage = await QRCode.toDataURL(currentQR);

  res.send(`
    <html>
      <body style="text-align:center;margin-top:50px;">
        <h2>Scan WhatsApp QR</h2>
        <img src="${qrImage}" />
      </body>
    </html>
  `);
});

// ================= SEND MESSAGE =================
app.post("/send", async (req, res) => {
  try {
    if (!sock || !isConnected) {
      return res.status(400).json({
        error: "WhatsApp not connected"
      });
    }

    const { phone, message } = req.body;

    await sock.sendMessage(phone + "@s.whatsapp.net", {
      text: message,
    });

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= START WHATSAPP =================
async function startBot() {
  if (isStarting) return;
  isStarting = true;

  try {
    console.log("⚙️ Starting WhatsApp...");

    const AUTH_FOLDER = path.join(process.cwd(), "auth_info");

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: P({ level: "error" }),
    });

    sock.ev.on("connection.update", (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        console.log("📱 QR generated");
        currentQR = qr;
      }

      if (connection === "open") {
        console.log("✅ WhatsApp connected");
        isConnected = true;
        currentQR = null;
      }

      if (connection === "close") {
        isConnected = false;

        const reason = lastDisconnect?.error?.output?.statusCode;
        console.log("❌ Connection closed:", reason);

        // 🔴 CRITICAL: stop infinite restart loop
        if (reason === DisconnectReason.loggedOut) {
          console.log("⚠️ Logged out. Scan QR again.");
          return;
        }

        console.log("🔄 Reconnecting in 5s...");
        setTimeout(() => {
          isStarting = false;
          startBot();
        }, 5000);
      }
    });

    sock.ev.on("creds.update", saveCreds);

  } catch (err) {
    console.log("❌ Bot error:", err.message);
  }
}

// ================= START SERVER FIRST =================
const PORT = process.env.PORT;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Server running on port ${PORT}`);
  
  // 🚀 Start WhatsApp AFTER server is live
  startBot();
});