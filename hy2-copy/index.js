#!/usr/bin/env node
/**
 * =========================================
 * Hysteria2 over QUIC 自动部署脚本（Node.js）
 * 定时重启：每天北京时间 00:00
 * =========================================
 */

import { execSync, spawn } from "child_process";
import fs from "fs";
import https from "https";
import crypto from "crypto";

// ========== 手动设置 ==========
const PASSWORD = "25jMkAjA"; // Hysteria2 密码
const USER_TAG = "HY2"; // 节点备注

// ========== 基本配置 ==========
const MASQ_DOMAINS = ["www.bing.com"];
const CONFIG_YAML = "config.yaml";
const CERT_PEM = "hy2-cert.pem";
const KEY_PEM = "hy2-key.pem";
const LINK_TXT = "hy2_link.txt";
const HY2_BIN = "./hysteria";

// ========== 工具函数 ==========
const randomPort = () => Math.floor(Math.random() * 40000) + 20000;
const randomSNI = () => MASQ_DOMAINS[Math.floor(Math.random() * MASQ_DOMAINS.length)];
function fileExists(p) { return fs.existsSync(p); }

function execSafe(cmd) {
  try { return execSync(cmd, { encoding: "utf8", stdio: "pipe" }).trim(); }
  catch { return ""; }
}

// ========== 北京时间 00:00 定时 ==========
function scheduleBeijingTimeMidnight(callback) {
  const now = new Date();
  const bj = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const target = new Date(bj);
  target.setHours(24, 0, 0, 0);
  const delay = target - bj;

  console.log(`[Timer] 下次重启：${target.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
  setTimeout(() => {
    callback();
    scheduleBeijingTimeMidnight(callback);
  }, delay);
}

// ========== 获取公网 IP ==========
async function getPublicIP() {
  const urls = [
    "https://api.ipify.org",
    "https://icanhazip.com",
    "https://ifconfig.me"
  ];
  for (const url of urls) {
    try {
      const ip = await new Promise((resolve, reject) => {
        https.get(url, res => {
          let d = "";
          res.on("data", c => d += c);
          res.on("end", () => resolve(d.trim()));
        }).on("error", reject);
      });
      if (ip) return ip;
    } catch {}
  }
  return "127.0.0.1";
}

// ========== 下载文件 ==========
async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) return reject();
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  });
}

// ========== 生成证书 ==========
function generateCert(domain) {
  if (fileExists(CERT_PEM) && fileExists(KEY_PEM)) return;
  execSafe(
    `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
    -keyout ${KEY_PEM} -out ${CERT_PEM} \
    -subj "/CN=${domain}" -days 365 -nodes`
  );
}

// ========== 下载 hysteria ==========
async function checkHysteria() {
  if (fileExists(HY2_BIN)) return;
  console.log("Downloading Hysteria2...");
  const url = "https://github.com/apernet/hysteria/releases/latest/download/hysteria-linux-amd64";
  await downloadFile(url, HY2_BIN);
  fs.chmodSync(HY2_BIN, 0o755);
}

// ========== 生成配置 ==========
function generateConfig(port, domain) {
  const yaml = `
listen: :${port}

tls:
  cert: ${CERT_PEM}
  key: ${KEY_PEM}

auth:
  type: password
  password: ${PASSWORD}

quic:
  congestion_control: bbr
  max_idle_timeout: 30s

bandwidth:
  up: 1 gbps
  down: 1 gbps

ignore_client_bandwidth: true
`;
  fs.writeFileSync(CONFIG_YAML, yaml.trim() + "\n");
}

// ========== 生成链接 ==========
function generateLink(ip, port, domain) {
  const link =
    `hysteria2://${PASSWORD}@${ip}:${port}` +
    `/?sni=${domain}&insecure=1&alpn=h3#${USER_TAG}-${ip}`;
  fs.writeFileSync(LINK_TXT, link);
  console.log("Hysteria2 Link:\n" + link);
}

// ========== 守护运行 ==========
function runLoop() {
  const loop = () => {
    const p = spawn(HY2_BIN, ["server", "-c", CONFIG_YAML], { stdio: "ignore" });
    p.on("exit", () => setTimeout(loop, 5000));
  };
  loop();
}

// ========== 主流程 ==========
async function main() {
  console.log("Hysteria2 自动部署开始");

  scheduleBeijingTimeMidnight(() => process.exit(0));

  const port = randomPort();
  const domain = randomSNI();

  generateCert(domain);
  await checkHysteria();
  generateConfig(port, domain);

  const ip = await getPublicIP();
  generateLink(ip, port, domain);

  runLoop();
}

main();
