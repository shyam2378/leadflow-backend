console.log("🚀 Starting WhatsApp Backend...");

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const P = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

// 🔥 Supabase
const supabase = createClient(
  "https://yemmjnlceuvlfoffjdvb.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllbW1qbmxjZXV2bGZvZmZqZHZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTAwNjcsImV4cCI6MjA5MjYyNjA2N30.Yka6_Q2m09mqYi7e0WrzTC_vX-Oz_rt1XN2lqgTsan4"
);

let sock;
let currentQR = null;

// 🧠 Prevent duplicate processing
const processedMessages = new Set();

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "error" }),
    browser: ["Windows", "Chrome", "120.0.0"],
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      console.log("📱 QR generated");
      currentQR = qr;
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected!");
      currentQR = null;
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Closed:", reason);

      if (reason !== DisconnectReason.loggedOut) {
        setTimeout(startBot, 3000);
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // 📩 MESSAGE HANDLER
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0];
      if (!msg.message) return;
      if (msg.key.fromMe) return;

      const id = msg.key.id;
      if (processedMessages.has(id)) return;
      processedMessages.add(id);

      const sender = msg.key.remoteJid;
      const phone = sender.split("@")[0];

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

      if (!text.trim()) return;

      console.log(`📩 ${phone}: ${text}`);

      // 🔹 Save contact
      let { data: contact } = await supabase
        .from("contacts")
        .select("*")
        .eq("phone", phone)
        .single();

      if (!contact) {
        const { data } = await supabase
          .from("contacts")
          .insert([{ phone }])
          .select()
          .single();

        contact = data;
      }

      // 🔹 Save message
      await supabase.from("messages").insert([
        {
          contact_id: contact?.id,
          message: text,
          direction: "inbound",
        },
      ]);

      // 🔥 Send to n8n
      let replyText = "⚠️ No reply from automation";

      try {
        const res = await axios.post(
          "https://leadflowai.app.n8n.cloud/webhook/whatsapp",
          {
            phone,
            message: text,
          }
        );

        replyText = res.data.reply || replyText;
      } catch (err) {
        console.log("❌ n8n error:", err.message);
      }

      // 🤖 Reply
      await sock.sendMessage(sender, { text: replyText });

      // 🔹 Save outbound message
      await supabase.from("messages").insert([
        {
          contact_id: contact?.id,
          message: replyText,
          direction: "outbound",
        },
      ]);

    } catch (err) {
      console.log("❌ Message error:", err.message);
    }
  });
}

// 🚀 START BOT
startBot();


// ================= API =================

// 🔳 Get QR
const QRCode = require("qrcode");

app.get("/qr", async (req, res) => {
  if (!currentQR) {
    return res.send("✅ Connected (no QR)");
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

// 💬 Send message manually
app.post("/send", async (req, res) => {
  try {
    const { phone, message } = req.body;

    await sock.sendMessage(phone + "@s.whatsapp.net", {
      text: message,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📥 Get messages
app.get("/messages/:phone", async (req, res) => {
  const phone = req.params.phone;

  const { data } = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: true });

  res.json(data);
});

// 👥 Get contacts
app.get("/contacts", async (req, res) => {
  const { data } = await supabase.from("contacts").select("*");
  res.json(data);
});
app.get("/", (req, res) => {
  res.send("✅ WhatsApp Backend Running");
});
// 🌐 START SERVER
app.listen(3000, () => {
  console.log("🌐 API running at http://localhost:3000");
});