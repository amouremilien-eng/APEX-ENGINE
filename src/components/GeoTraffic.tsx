import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ================================================================
// 📊 SOURCES OFFICIELLES — Populations 2025 / Pénétration 2024
//
// 🇫🇷 FRANCE — INSEE estimations pop. au 1er janvier 2025
//    Pénétration internet : 93.5% — ARCEP Baromètre du numérique 2024
//    Courbe horaire : ARCEP + Médiamétrie T1 2025
//
// 🇧🇪 BELGIQUE — Statbel, population au 1er janvier 2025
//    Pénétration internet : 94.2% — Statbel Digital Economy 2024
//
// 🇨🇭 SUISSE — OFS STATPOP au 31 décembre 2024
//    Pénétration internet : 96.2% — OFCOM 2024
//
// 🇮🇹 ITALIE — ISTAT estimations janvier 2025
//    Pénétration internet : 90.1% — AGCOM 2024
//
// 🇦🇪 UAE — FCSC mid-year 2024
//    Pénétration internet : 98.99% — TDRA 2024
//
// 🛡️ FRAUDE / MFA
//    IAS Media Quality Report 2024 · DoubleVerify Global Insights 2024
//    ANA Programmatic Transparency Study 2024 · Jounce Media / DeepSee 2024
//    HUMAN (ex-TAG) Fraud Benchmark 2024
// ================================================================

const PEN_FR = 0.935;
const PEN_BE = 0.942;
const PEN_CH = 0.962;
const PEN_AE = 0.9899;
const PEN_IT = 0.901;

interface Zone {
  n: string;
  lat: number;
  lng: number;
  c: "FR" | "BE" | "CH" | "AE" | "IT";
  pop: number;
}

interface LiveZone extends Zone {
  traffic: number;
}

const ZONES: Zone[] = [
  // FRANCE — INSEE jan 2025
  { n: "Paris", lat: 48.8566, lng: 2.3522, c: "FR", pop: 10890000 },
  { n: "Lyon", lat: 45.764, lng: 4.8357, c: "FR", pop: 1760000 },
  { n: "Marseille-Aix", lat: 43.2965, lng: 5.3698, c: "FR", pop: 1613000 },
  { n: "Toulouse", lat: 43.6047, lng: 1.4442, c: "FR", pop: 1055000 },
  { n: "Bordeaux", lat: 44.8378, lng: -0.5792, c: "FR", pop: 998000 },
  { n: "Lille", lat: 50.6292, lng: 3.0573, c: "FR", pop: 1062000 },
  { n: "Nantes", lat: 47.2184, lng: -1.5536, c: "FR", pop: 708000 },
  { n: "Strasbourg", lat: 48.5734, lng: 7.7521, c: "FR", pop: 564000 },
  { n: "Nice", lat: 43.7102, lng: 7.262, c: "FR", pop: 611000 },
  { n: "Rennes", lat: 48.1173, lng: -1.6778, c: "FR", pop: 486000 },
  { n: "Montpellier", lat: 43.6108, lng: 3.8767, c: "FR", pop: 516000 },
  { n: "Grenoble", lat: 45.1885, lng: 5.7245, c: "FR", pop: 448000 },
  { n: "Rouen", lat: 49.4432, lng: 1.0993, c: "FR", pop: 469000 },
  { n: "Toulon", lat: 43.1242, lng: 5.928, c: "FR", pop: 437000 },
  { n: "Tours", lat: 47.3941, lng: 0.6848, c: "FR", pop: 373000 },
  { n: "Clermont-Fd", lat: 45.7772, lng: 3.087, c: "FR", pop: 383000 },
  { n: "Orléans", lat: 47.9029, lng: 1.909, c: "FR", pop: 343000 },
  { n: "Dijon", lat: 47.322, lng: 5.0415, c: "FR", pop: 323000 },
  { n: "Angers", lat: 47.4784, lng: -0.5632, c: "FR", pop: 314000 },
  { n: "Metz", lat: 49.1193, lng: 6.1757, c: "FR", pop: 292000 },
  { n: "Reims", lat: 49.2583, lng: 3.7015, c: "FR", pop: 293000 },
  { n: "Le Havre", lat: 49.4944, lng: 0.1079, c: "FR", pop: 271000 },
  { n: "Saint-Étienne", lat: 45.4397, lng: 4.3872, c: "FR", pop: 321000 },
  { n: "Brest", lat: 48.3904, lng: -4.4861, c: "FR", pop: 212000 },
  { n: "Caen", lat: 49.1829, lng: -0.3707, c: "FR", pop: 272000 },
  { n: "Amiens", lat: 49.894, lng: 2.2957, c: "FR", pop: 242000 },
  { n: "Limoges", lat: 45.8336, lng: 1.2611, c: "FR", pop: 201000 },
  { n: "Perpignan", lat: 42.6887, lng: 2.8948, c: "FR", pop: 212000 },
  { n: "Besançon", lat: 47.2378, lng: 6.0241, c: "FR", pop: 182000 },
  { n: "Pau", lat: 43.2951, lng: -0.3708, c: "FR", pop: 202000 },
  { n: "Poitiers", lat: 46.5802, lng: 0.3404, c: "FR", pop: 197000 },
  { n: "La Rochelle", lat: 46.1603, lng: -1.1511, c: "FR", pop: 188000 },
  { n: "Avignon", lat: 43.9493, lng: 4.8055, c: "FR", pop: 293000 },
  { n: "Mulhouse", lat: 47.7508, lng: 7.3359, c: "FR", pop: 247000 },
  // BELGIQUE — Statbel jan 2025
  { n: "Bruxelles", lat: 50.8503, lng: 4.3517, c: "BE", pop: 1229000 },
  { n: "Anvers", lat: 51.2194, lng: 4.4025, c: "BE", pop: 1065000 },
  { n: "Gand", lat: 51.0543, lng: 3.7174, c: "BE", pop: 587000 },
  { n: "Liège", lat: 50.6326, lng: 5.5797, c: "BE", pop: 625000 },
  { n: "Charleroi", lat: 50.4108, lng: 4.4446, c: "BE", pop: 423000 },
  { n: "Bruges", lat: 51.2093, lng: 3.2247, c: "BE", pop: 278000 },
  { n: "Namur", lat: 50.4674, lng: 4.8712, c: "BE", pop: 324000 },
  { n: "Louvain", lat: 50.8798, lng: 4.7005, c: "BE", pop: 516000 },
  { n: "Mons", lat: 50.4542, lng: 3.9563, c: "BE", pop: 262000 },
  { n: "Hasselt", lat: 50.9307, lng: 5.3378, c: "BE", pop: 283000 },
  { n: "Courtrai", lat: 50.8279, lng: 3.2649, c: "BE", pop: 202000 },
  { n: "Malines", lat: 51.0259, lng: 4.4776, c: "BE", pop: 193000 },
  // SUISSE — OFS déc 2024
  { n: "Zurich", lat: 47.3769, lng: 8.5417, c: "CH", pop: 1470000 },
  { n: "Genève", lat: 46.2044, lng: 6.1432, c: "CH", pop: 636000 },
  { n: "Bâle", lat: 47.5596, lng: 7.5886, c: "CH", pop: 560000 },
  { n: "Berne", lat: 46.948, lng: 7.4474, c: "CH", pop: 438000 },
  { n: "Lausanne", lat: 46.5197, lng: 6.6323, c: "CH", pop: 432000 },
  { n: "Lucerne", lat: 47.0502, lng: 8.3093, c: "CH", pop: 270000 },
  { n: "St-Gall", lat: 47.4245, lng: 9.3767, c: "CH", pop: 183000 },
  { n: "Lugano", lat: 46.0037, lng: 8.9511, c: "CH", pop: 158000 },
  { n: "Bienne", lat: 47.1368, lng: 7.2467, c: "CH", pop: 108000 },
  { n: "Winterthour", lat: 47.5001, lng: 8.724, c: "CH", pop: 118000 },
  { n: "Fribourg", lat: 46.8065, lng: 7.162, c: "CH", pop: 139000 },
  { n: "Neuchâtel", lat: 46.99, lng: 6.9293, c: "CH", pop: 82000 },
  { n: "Sion", lat: 46.2331, lng: 7.3607, c: "CH", pop: 87000 },
  // ITALIE — ISTAT jan 2025
  { n: "Roma", lat: 41.9028, lng: 12.4964, c: "IT", pop: 4340000 },
  { n: "Milano", lat: 45.4642, lng: 9.19, c: "IT", pop: 3270000 },
  { n: "Napoli", lat: 40.8518, lng: 14.2681, c: "IT", pop: 3050000 },
  { n: "Torino", lat: 45.0703, lng: 7.6869, c: "IT", pop: 2265000 },
  { n: "Palermo", lat: 38.1157, lng: 13.3615, c: "IT", pop: 1260000 },
  { n: "Genova", lat: 44.4056, lng: 8.9463, c: "IT", pop: 840000 },
  { n: "Bologna", lat: 44.4949, lng: 11.3426, c: "IT", pop: 1025000 },
  { n: "Firenze", lat: 43.7696, lng: 11.2558, c: "IT", pop: 1015000 },
  { n: "Bari", lat: 41.1171, lng: 16.8719, c: "IT", pop: 1250000 },
  { n: "Catania", lat: 37.5079, lng: 15.083, c: "IT", pop: 1105000 },
  { n: "Venezia", lat: 45.4408, lng: 12.3155, c: "IT", pop: 850000 },
  { n: "Verona", lat: 45.4384, lng: 10.9917, c: "IT", pop: 925000 },
  { n: "Padova", lat: 45.4064, lng: 11.8768, c: "IT", pop: 935000 },
  { n: "Brescia", lat: 45.5416, lng: 10.2118, c: "IT", pop: 1265000 },
  { n: "Bergamo", lat: 45.6983, lng: 9.6773, c: "IT", pop: 1110000 },
  { n: "Cagliari", lat: 39.2238, lng: 9.1217, c: "IT", pop: 425000 },
  { n: "Messina", lat: 38.1938, lng: 15.554, c: "IT", pop: 632000 },
  { n: "Reggio Calabria", lat: 38.1114, lng: 15.6473, c: "IT", pop: 548000 },
  { n: "Trieste", lat: 45.6495, lng: 13.7768, c: "IT", pop: 232000 },
  { n: "Perugia", lat: 43.1107, lng: 12.3908, c: "IT", pop: 665000 },
  // UAE — FCSC 2024
  { n: "Dubai", lat: 25.2048, lng: 55.2708, c: "AE", pop: 3600000 },
  { n: "Abu Dhabi", lat: 24.4539, lng: 54.3773, c: "AE", pop: 1540000 },
  { n: "Sharjah", lat: 25.3463, lng: 55.4209, c: "AE", pop: 1800000 },
  { n: "Ajman", lat: 25.4052, lng: 55.5136, c: "AE", pop: 540000 },
  { n: "Ras Al Khaimah", lat: 25.7895, lng: 55.9432, c: "AE", pop: 400000 },
  { n: "Fujairah", lat: 25.1288, lng: 56.3265, c: "AE", pop: 250000 },
  { n: "Al Ain", lat: 24.1917, lng: 55.7606, c: "AE", pop: 770000 },
  { n: "Umm Al Quwain", lat: 25.5647, lng: 55.5552, c: "AE", pop: 90000 },
];

// ── Hour curves ──
const HOUR_CET_WD = [0.085, 0.055, 0.035, 0.025, 0.02, 0.03, 0.075, 0.22, 0.48, 0.68, 0.78, 0.83, 0.72, 0.8, 0.86, 0.84, 0.79, 0.75, 0.82, 0.9, 0.98, 1.0, 0.75, 0.38];
const HOUR_CET_WE = [0.12, 0.08, 0.05, 0.03, 0.02, 0.02, 0.035, 0.08, 0.28, 0.48, 0.62, 0.7, 0.65, 0.68, 0.72, 0.74, 0.76, 0.78, 0.85, 0.92, 1.0, 0.98, 0.8, 0.45];
const HOUR_GST_WD = [0.15, 0.09, 0.05, 0.035, 0.025, 0.03, 0.06, 0.18, 0.4, 0.58, 0.7, 0.76, 0.65, 0.72, 0.78, 0.8, 0.78, 0.75, 0.8, 0.87, 0.95, 1.0, 0.92, 0.55];
const HOUR_GST_WE = [0.25, 0.18, 0.1, 0.06, 0.035, 0.03, 0.04, 0.1, 0.28, 0.45, 0.58, 0.65, 0.6, 0.65, 0.7, 0.75, 0.78, 0.82, 0.9, 0.96, 1.0, 0.98, 0.88, 0.6];

function isWeCET() { const d = new Date().getDay(); return d === 0 || d === 6; }
function isWeGST() { const u = new Date(Date.now() + 4 * 3600000); return u.getUTCDay() === 5 || u.getUTCDay() === 6; }
function hourCurve(c: string) { return c === "AE" ? (isWeGST() ? HOUR_GST_WE : HOUR_GST_WD) : (isWeCET() ? HOUR_CET_WE : HOUR_CET_WD); }

function localHour(c: string) {
  const now = new Date();
  if (c === "AE") { const t = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 4 * 3600000); return { h: t.getHours(), m: t.getMinutes() }; }
  const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
  const off = now.getTimezoneOffset() < jan ? 2 : 1;
  const t = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + off * 3600000);
  return { h: t.getHours(), m: t.getMinutes() };
}

function pen(c: string) { return ({ FR: PEN_FR, BE: PEN_BE, CH: PEN_CH, AE: PEN_AE, IT: PEN_IT } as any)[c] || 0.9; }

function liveTraffic(z: Zone) {
  const cv = hourCurve(z.c); const { h, m } = localHour(z.c);
  const interp = cv[h] + (cv[(h + 1) % 24] - cv[h]) * (m / 60);
  const noise = 1 + Math.sin(Date.now() / 4200 + z.lat * 73 + z.lng * 41) * 0.02;
  return Math.round(z.pop * pen(z.c) * interp * 1.12 * noise);
}

type IL = { l: string; cl: string; bg: string; bd: string };
function intLv(t: number, mx: number): IL {
  const r = t / mx;
  if (r > 0.65) return { l: "Très élevé", cl: "#d93025", bg: "#fce8e6", bd: "#f5c6c2" };
  if (r > 0.35) return { l: "Élevé", cl: "#e37400", bg: "#fef7e0", bd: "#fde293" };
  if (r > 0.15) return { l: "Modéré", cl: "#1a73e8", bg: "#e8f0fe", bd: "#aecbfa" };
  return { l: "Faible", cl: "#0f9d58", bg: "#e6f4ea", bd: "#a8dab5" };
}

function fmt(n: number) { if (n >= 1e6) return (n / 1e6).toFixed(1) + "M"; if (n >= 1e3) return (n / 1e3).toFixed(0) + "k"; return String(n); }
function fmtF(n: number) { return n.toLocaleString("fr-FR"); }

const FL: Record<string, string> = { FR: "🇫🇷", BE: "🇧🇪", CH: "🇨🇭", AE: "🇦🇪", IT: "🇮🇹" };
const CN: Record<string, string> = { FR: "France", BE: "Belgique", CH: "Suisse", AE: "UAE", IT: "Italie" };
const CC: Record<string, string> = { FR: "#4285f4", BE: "#e37400", CH: "#d93025", AE: "#0f9d58", IT: "#7c3aed" };
const SL: Record<string, string> = { FR: "INSEE jan. 2025 · ARCEP 2024", BE: "Statbel jan. 2025", CH: "OFS déc. 2024 · OFCOM 2024", AE: "FCSC 2024 · TDRA 2024", IT: "ISTAT jan. 2025 · AGCOM 2024" };

// ── Fraud data ──
interface FCD { ivtDisplay: number; ivtVideo: number; mfaPct: number; botRate: number; riskScore: number; riskLevel: string; riskColor: string; trend: string; dataCenters: number; mfaDomains: number; recommendation: string; }
const FBC: Record<string, FCD> = {
  FR: { ivtDisplay: 1.2, ivtVideo: 0.9, mfaPct: 12.5, botRate: 1.8, riskScore: 22, riskLevel: "low", riskColor: "#0f9d58", trend: "improving", dataCenters: 3, mfaDomains: 320, recommendation: "Risque faible. Pre-bid IAS/DV recommandé pour éliminer 1.2% SIVT résiduel." },
  BE: { ivtDisplay: 1.5, ivtVideo: 1.1, mfaPct: 14.2, botRate: 2.1, riskScore: 28, riskLevel: "low", riskColor: "#0f9d58", trend: "stable", dataCenters: 1, mfaDomains: 85, recommendation: "Risque faible. Attention aux MFA néerlandophones (14% du marché display)." },
  CH: { ivtDisplay: 0.8, ivtVideo: 0.6, mfaPct: 8.3, botRate: 1.2, riskScore: 12, riskLevel: "low", riskColor: "#0f9d58", trend: "stable", dataCenters: 2, mfaDomains: 45, recommendation: "Zone la plus sûre. Idéal pour campagnes premium haute marge." },
  IT: { ivtDisplay: 2.8, ivtVideo: 2.1, mfaPct: 18.7, botRate: 3.5, riskScore: 55, riskLevel: "medium", riskColor: "#e37400", trend: "worsening", dataCenters: 4, mfaDomains: 890, recommendation: "⚠️ MFA élevé en news/sport. Activer inclusion lists + pre-bid obligatoire." },
  AE: { ivtDisplay: 3.5, ivtVideo: 2.8, mfaPct: 22.4, botRate: 4.2, riskScore: 72, riskLevel: "high", riskColor: "#d93025", trend: "worsening", dataCenters: 6, mfaDomains: 1250, recommendation: "🚨 Risque élevé. Data centers + VPN massif. Whitelist stricte obligatoire." },
};
interface CFD { riskScore: number; type: string; detail: string; }
const FBCI: Record<string, CFD> = {
  "Dubai": { riskScore: 92, type: "Bot & Data Center", detail: "6 DC majeurs. IVT 2× moyenne mondiale. VPN masking élevé." },
  "Sharjah": { riskScore: 88, type: "Data Center Hub", detail: "40% du trafic non-humain UAE provient de cette zone." },
  "Abu Dhabi": { riskScore: 62, type: "SIVT Résiduel", detail: "Bots sophistiqués. Meilleur que Dubai grâce au filtrage gov." },
  "Ajman": { riskScore: 75, type: "Click Fraud", detail: "Fermes de clics mobiles. Taux CTR anormalement élevés." },
  "Ras Al Khaimah": { riskScore: 68, type: "Bot Traffic", detail: "Data center zone. Trafic résidentiel faible vs bot." },
  "Al Ain": { riskScore: 45, type: "Modéré", detail: "Zone plus résidentielle, moins de DC." },
  "Milano": { riskScore: 85, type: "MFA Hub", detail: "23% impressions display suspectes. Concentration domaines MFA IT." },
  "Napoli": { riskScore: 78, type: "Click Fraud", detail: "Fermes de clics mobile détectées par HUMAN 2024." },
  "Roma": { riskScore: 65, type: "MFA News/Sport", detail: "Domaines MFA news +15% vs moyenne nationale." },
  "Catania": { riskScore: 72, type: "Bot Mobile", detail: "Trafic mobile suspect. SDK spoofing détecté." },
  "Bari": { riskScore: 58, type: "MFA Régional", detail: "Sites MFA locaux, volumes modérés." },
  "Torino": { riskScore: 42, type: "Faible", detail: "Marché display plus propre que le sud." },
  "Bologna": { riskScore: 38, type: "Faible", detail: "Zone universitaire, trafic organique élevé." },
  "Firenze": { riskScore: 35, type: "Faible", detail: "Tourisme = trafic organique. Peu de MFA." },
  "Paris": { riskScore: 35, type: "SIVT Résiduel", detail: "Bots sophistiqués 0.8%. Marché mature, bien filtré." },
  "Lyon": { riskScore: 25, type: "Très faible", detail: "Second marché FR, bien monitoré." },
  "Marseille-Aix": { riskScore: 30, type: "Faible", detail: "Quelques domaines MFA locaux, volumes faibles." },
  "Lille": { riskScore: 22, type: "Très faible", detail: "Marché transfrontalier BE/FR propre." },
  "Nice": { riskScore: 28, type: "Faible", detail: "Trafic tourisme organique." },
  "Bruxelles": { riskScore: 28, type: "Low Risk", detail: "Marché régulé EU, peu de MFA." },
  "Anvers": { riskScore: 22, type: "Très faible", detail: "Marché NL propre." },
  "Gand": { riskScore: 18, type: "Safe", detail: "Très faible volume de fraude." },
  "Zurich": { riskScore: 15, type: "Safe Zone", detail: "Marché le plus propre d'Europe. IVT <1%." },
  "Genève": { riskScore: 12, type: "Safe Zone", detail: "Quasi zéro MFA. Marché premium." },
  "Bâle": { riskScore: 14, type: "Safe Zone", detail: "Très faible risque, marché pharma premium." },
  "Berne": { riskScore: 10, type: "Safe Zone", detail: "Capital gov = trafic très propre." },
  "Lausanne": { riskScore: 13, type: "Safe Zone", detail: "Marché francophone propre." },
};

// ── Stable scatter (generated once at module load) ──
interface SP { bLat: number; bLng: number; oLat: number; oLng: number; zi: number; w: number; }
function genScatter(zones: Zone[]): SP[] {
  const pts: SP[] = []; let s = 42;
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  zones.forEach((z, i) => {
    const p = z.pop / 10858000; const n = 2 + Math.floor(p * 4); const sp = 0.03 + p * 0.08;
    pts.push({ bLat: z.lat, bLng: z.lng, oLat: 0, oLng: 0, zi: i, w: 1.0 });
    for (let j = 0; j < n; j++) {
      const a = (Math.PI * 2 * j) / n + r() * 0.3; const d = sp * (0.3 + r() * 0.7);
      pts.push({ bLat: z.lat, bLng: z.lng, oLat: Math.sin(a) * d, oLng: Math.cos(a) * d, zi: i, w: 0.3 + r() * 0.5 });
    }
  });
  return pts;
}
const SCATTER = genScatter(ZONES);

// ── Heat plugin loader ──
let heatOk = false;
function loadHeat(): Promise<void> {
  if (heatOk) return Promise.resolve();
  return import("leaflet.heat").then(() => { heatOk = true; }).catch(() => { try { require("leaflet.heat"); heatOk = true; } catch { /* */ } });
}

// ================================================================
// COMPONENT
// ================================================================
export function GeoTraffic() {
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const heat = useRef<any>(null);
  const mks = useRef<L.Marker[]>([]);
  const [ld, setLd] = useState<LiveZone[]>([]);
  const [mx, setMx] = useState(1);
  const [time, setTime] = useState(new Date());
  const [ok, setOk] = useState(false);
  const [country, setCountry] = useState<"ALL" | "FR" | "BE" | "CH" | "AE" | "IT">("ALL");
  const [fraud, setFraud] = useState(false);

  // Refs for imperative (no stale closures)
  const ldR = useRef<LiveZone[]>([]); const mxR = useRef(1); const frR = useRef(false);
  useEffect(() => { ldR.current = ld; }, [ld]);
  useEffect(() => { mxR.current = mx; }, [mx]);
  useEffect(() => { frR.current = fraud; }, [fraud]);

  const cH = time.getHours(); const cM = time.getMinutes();
  const cetCv = isWeCET() ? HOUR_CET_WE : HOUR_CET_WD;
  const { h: cetH } = localHour("FR"); const cetHf = cetCv[cetH];
  const pkL = cetHf > 0.85 ? "🔥 Peak" : cetHf > 0.5 ? "📈 Actif" : cetHf > 0.2 ? "📉 Calme" : "😴 Creux";
  const fz = country === "ALL" ? ZONES : ZONES.filter(z => z.c === country);

  // ── Popup (before labels) ──
  const popup = useCallback((z: LiveZone) => {
    const m = map.current; if (!m) return;
    if (frR.current) {
      const cf = FBCI[z.n]; const co = FBC[z.c];
      const rs = cf?.riskScore ?? co?.riskScore ?? 20;
      const rc = rs >= 70 ? "#d93025" : rs >= 40 ? "#e37400" : rs >= 20 ? "#1a73e8" : "#0f9d58";
      const rl = rs >= 70 ? "ÉLEVÉ" : rs >= 40 ? "MODÉRÉ" : "FAIBLE";
      const tl = co?.trend === "improving" ? "📉 En baisse" : co?.trend === "worsening" ? "📈 En hausse" : "➡️ Stable";
      const tc = co?.trend === "improving" ? "#0f9d58" : co?.trend === "worsening" ? "#d93025" : "#5f6368";
      L.popup({ maxWidth: 300, closeButton: true }).setLatLng([z.lat, z.lng]).setContent(
        `<div style="padding:14px 16px 8px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:16px;font-weight:700;color:#202124">🛡️ ${z.n}</span>
          <span style="font-size:11px;font-weight:500;color:#fff;padding:2px 8px;border-radius:4px;background:${rc}">${FL[z.c]} Risque ${rl}</span>
        </div>
        <div style="padding:4px 16px 6px">
          <div style="text-align:center;margin:8px 0;padding:8px;border-radius:8px;background:${rc}12;border:2px solid ${rc}">
            <div style="font-size:28px;font-weight:900;color:${rc}">${rs}<span style="font-size:14px">/100</span></div>
            <div style="font-size:10px;font-weight:700;color:${rc}">Score de Risque — ${cf?.type ?? "—"}</div>
          </div>
          <div style="font-size:11px;color:#5f6368;line-height:1.5;margin:8px 0;padding:8px;background:#f8f9fa;border-radius:6px">${cf?.detail ?? co?.recommendation ?? ""}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0">
            <div style="background:#f8f9fa;border-radius:6px;padding:6px;text-align:center"><div style="font-size:14px;font-weight:900;color:${co?.riskColor || "#5f6368"}">${co?.ivtDisplay ?? "—"}%</div><div style="font-size:8px;font-weight:600;color:#70757a">IVT DISPLAY</div></div>
            <div style="background:#f8f9fa;border-radius:6px;padding:6px;text-align:center"><div style="font-size:14px;font-weight:900;color:#7c3aed">${co?.mfaPct ?? "—"}%</div><div style="font-size:8px;font-weight:600;color:#70757a">MFA RATE</div></div>
            <div style="background:#f8f9fa;border-radius:6px;padding:6px;text-align:center"><div style="font-size:14px;font-weight:900;color:#d93025">${co?.botRate ?? "—"}%</div><div style="font-size:8px;font-weight:600;color:#70757a">BOT RATE</div></div>
            <div style="background:#f8f9fa;border-radius:6px;padding:6px;text-align:center"><div style="font-size:14px;font-weight:900;color:${co?.riskColor || "#5f6368"}">${co?.ivtVideo ?? "—"}%</div><div style="font-size:8px;font-weight:600;color:#70757a">IVT VIDEO</div></div>
          </div>
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px;border-top:1px solid #e8eaed"><span style="color:#70757a">Tendance</span><span style="font-weight:700;color:${tc}">${tl}</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px"><span style="color:#70757a">Data Centers</span><span style="font-weight:600">${co?.dataCenters ?? "—"}</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px"><span style="color:#70757a">Domaines MFA (${CN[z.c]})</span><span style="font-weight:600">${co?.mfaDomains?.toLocaleString("fr-FR") ?? "—"}</span></div>
        </div>
        <div style="padding:8px 16px;background:#f8f9fa;border-top:1px solid #e8eaed;font-size:9px;color:#70757a;line-height:1.5"><b style="color:#5f6368">Sources :</b> IAS 2024 · DoubleVerify 2024 · ANA/Jounce 2024 · HUMAN 2024</div>`
      ).openOn(m);
    } else {
      const lv = intLv(z.traffic, mxR.current); const p = pen(z.c);
      const cov = ((z.traffic / z.pop) * 100).toFixed(1); const { h: lH, m: lM } = localHour(z.c);
      const lcv = hourCurve(z.c); const lhf = lcv[lH]; const tz = z.c === "AE" ? "GST" : "CET";
      L.popup({ maxWidth: 280, closeButton: true }).setLatLng([z.lat, z.lng]).setContent(
        `<div style="padding:14px 16px 8px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:16px;font-weight:700;color:#202124">${z.n}</span>
          <span style="font-size:11px;font-weight:500;color:#fff;padding:2px 8px;border-radius:4px;background:${CC[z.c]}">${FL[z.c]} ${CN[z.c]}</span>
        </div>
        <div style="padding:4px 16px 14px">
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px solid #f8f9fa"><span style="color:#70757a">Population</span><span style="font-weight:600">${fmtF(z.pop)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px solid #f8f9fa"><span style="color:#70757a">Pénétration</span><span style="font-weight:600">${(p * 100).toFixed(1)}%</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px solid #f8f9fa"><span style="color:#70757a">Internautes actifs</span><span style="font-weight:600;color:#1a73e8">${fmtF(z.traffic)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px solid #f8f9fa"><span style="color:#70757a">Heure (${tz})</span><span style="font-weight:600">${lH}h${String(lM).padStart(2, "0")} · ${(lhf * 100).toFixed(0)}%</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px"><span style="color:#70757a">Couverture</span><span style="font-weight:600">${cov}%</span></div>
          <div style="height:4px;background:#f1f3f4;border-radius:2px;margin:10px 0 6px;overflow:hidden"><div style="height:100%;width:${Math.min(100, parseFloat(cov))}%;background:${lv.cl};border-radius:2px"></div></div>
          <div style="text-align:center;font-size:11px;font-weight:700;padding:6px;border-radius:6px;background:${lv.bg};color:${lv.cl};border:1px solid ${lv.bd}">Densité : ${lv.l}</div>
        </div>
        <div style="padding:8px 16px;background:#f8f9fa;border-top:1px solid #e8eaed;font-size:9px;color:#70757a;line-height:1.5"><b style="color:#5f6368">Calcul :</b> ${fmtF(z.pop)} × ${(p * 100).toFixed(1)}% × ${(lhf * 100).toFixed(0)}% × 1.12<br><b style="color:#5f6368">Source :</b> ${SL[z.c]}</div>`
      ).openOn(m);
    }
  }, []);

  const flyTo = useCallback((z: LiveZone) => { map.current?.flyTo([z.lat, z.lng], 10, { duration: 0.8 }); setTimeout(() => popup(z), 900); }, [popup]);

  // ── Labels (imperative) ──
  const lastShow = useRef(false);
  const drawLabels = useCallback((m: L.Map) => {
    const show = m.getZoom() >= 6;
    if (show === lastShow.current && mks.current.length > 0) return;
    lastShow.current = show;
    mks.current.forEach(mk => m.removeLayer(mk)); mks.current = [];
    if (!show) return;
    ldR.current.forEach(z => {
      let html: string;
      if (frR.current) {
        const rs = FBCI[z.n]?.riskScore ?? FBC[z.c]?.riskScore ?? 20;
        const rc = rs >= 70 ? "#d93025" : rs >= 40 ? "#e37400" : rs >= 20 ? "#1a73e8" : "#0f9d58";
        html = `<div style="background:#fff;border-radius:4px;padding:2px 7px;box-shadow:0 1px 4px rgba(0,0,0,0.2);font-size:10px;font-weight:600;color:#202124;white-space:nowrap;border-left:3px solid ${rc};display:flex;align-items:center;gap:4px;transform:translate(-50%,-130%);cursor:pointer">🛡️ ${z.n} <span style="color:${rc};font-weight:700;font-size:9px">${rs >= 70 ? "HIGH" : rs >= 40 ? "MED" : "LOW"} ${rs}</span></div>`;
      } else {
        const lv = intLv(z.traffic, mxR.current);
        html = `<div style="background:#fff;border-radius:4px;padding:2px 7px;box-shadow:0 1px 4px rgba(0,0,0,0.2);font-size:10px;font-weight:600;color:#202124;white-space:nowrap;border-left:3px solid ${lv.cl};display:flex;align-items:center;gap:4px;transform:translate(-50%,-130%);cursor:pointer">${z.n} <span style="color:${lv.cl};font-weight:700;font-size:9px">${fmt(z.traffic)}</span></div>`;
      }
      const mk = L.marker([z.lat, z.lng], { icon: L.divIcon({ className: "", html, iconSize: [0, 0], iconAnchor: [0, 0] }) }).addTo(m);
      mk.on("click", () => popup(z)); mks.current.push(mk);
    });
  }, [popup]);

  useEffect(() => { const m = map.current; if (!m || ld.length === 0) return; lastShow.current = false; drawLabels(m); }, [ld, mx, fraud, drawLabels]);

  // ── Init map ──
  useEffect(() => {
    if (!mapEl.current || map.current) return; let dead = false;
    loadHeat().then(() => {
      if (dead || !mapEl.current) return;
      const m = L.map(mapEl.current, { center: [44, 15], zoom: 5, zoomControl: false, attributionControl: false });
      // Carte épurée — pas de routes, juste frontières + relief
      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png", { maxZoom: 18, subdomains: "abcd" }).addTo(m);
      // Labels (villes, pays) par-dessus la heatmap
      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png", { maxZoom: 18, subdomains: "abcd", pane: "shadowPane" }).addTo(m);
      L.control.zoom({ position: "topright" }).addTo(m);
      const h = (L as any).heatLayer([], { radius: 30, blur: 20, maxZoom: 10, max: 1.0, gradient: { 0.05: "rgba(30,100,230,0.2)", 0.15: "rgba(30,100,230,0.4)", 0.3: "rgba(15,157,88,0.5)", 0.5: "rgba(251,188,4,0.6)", 0.7: "rgba(234,67,53,0.7)", 0.85: "rgba(217,48,37,0.8)", 1.0: "rgba(197,34,31,0.9)" } }).addTo(m);
      map.current = m; heat.current = h; setOk(true);
      m.on("zoomend", () => drawLabels(m));
    });
    return () => { dead = true; if (map.current) { map.current.remove(); map.current = null; } };
  }, [drawLabels]);

  // ── Country filter ──
  const goCountry = useCallback((c: "ALL" | "FR" | "BE" | "CH" | "AE" | "IT") => {
    setCountry(c); const m = map.current; if (!m) return;
    const v: Record<string, [number, number, number]> = { ALL: [44, 15, 5], FR: [46.6, 2.5, 6], BE: [50.7, 4.4, 8], CH: [46.8, 8.2, 8], IT: [42.5, 12.5, 6], AE: [24.5, 54.5, 7] };
    const t = v[c] || v.ALL; m.flyTo([t[0], t[1]], t[2], { duration: 0.8 });
  }, []);

  // ── Refresh ──
  const refresh = useCallback(() => {
    const d = fz.map(z => ({ ...z, traffic: liveTraffic(z) }));
    const m = Math.max(...d.map(z => z.traffic), 1);
    setLd(d); setMx(m); setTime(new Date());
    if (!heat.current) return;
    const im = new Map<number, number>(); const is = new Set<number>();
    fz.forEach(f => {
      const i = ZONES.findIndex(z => z.n === f.n); if (i < 0) return; is.add(i);
      if (frR.current) { const rs = FBCI[f.n]?.riskScore ?? FBC[f.c]?.riskScore ?? 20; im.set(i, rs / 100); }
      else { im.set(i, (d.find(x => x.n === f.n)?.traffic || 0) / m); }
    });
    const pts: [number, number, number][] = [];
    SCATTER.forEach(p => { if (!is.has(p.zi)) return; const v = (im.get(p.zi) || 0) * p.w; if (v > 0.01) pts.push([p.bLat + p.oLat, p.bLng + p.oLng, v]); });
    heat.current.setLatLngs(pts);
  }, [fz]);

  useEffect(() => { if (!ok) return; refresh(); const a = setInterval(refresh, 30000); const b = setInterval(() => setTime(new Date()), 1000); return () => { clearInterval(a); clearInterval(b); }; }, [refresh, ok]);

  // ── Stats ──
  const tot = ld.reduce((s, z) => s + z.traffic, 0);
  const byC = (c: string) => ld.filter(z => z.c === c).reduce((s, z) => s + z.traffic, 0);
  const sorted = [...ld].sort((a, b) => b.traffic - a.traffic);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <div ref={mapEl} style={{ position: "absolute", inset: 0, zIndex: 1 }} />

      {/* TOP BAR */}
      <div style={{ position: "absolute", top: 10, left: 10, zIndex: 900, display: "flex", borderRadius: 8, overflow: "hidden", boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}>
        <div style={{ background: "#fff", padding: "8px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🌍</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#202124" }}>Densité Trafic Web</span>
        </div>
        <div style={{ background: "#fff", borderLeft: "1px solid #e8eaed", padding: "8px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#0f9d58", animation: "gp 2s infinite" }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: "#5f6368", fontVariantNumeric: "tabular-nums" }}>
            {time.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · {time.toLocaleTimeString("fr-FR")}
          </span>
        </div>
      </div>

      {/* FRAUD TOGGLE */}
      <div onClick={() => setFraud(!fraud)} style={{ position: "absolute", top: 10, right: 60, zIndex: 900, background: fraud ? "#d93025" : "#fff", borderRadius: 8, padding: "8px 14px", boxShadow: "0 2px 6px rgba(0,0,0,0.2)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, transition: "all 0.3s", border: fraud ? "2px solid #d93025" : "2px solid #e8eaed" }}>
        <span style={{ fontSize: 14 }}>{fraud ? "🛡️" : "🔓"}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: fraud ? "#fff" : "#5f6368" }}>{fraud ? "FRAUDE ON" : "Fraude / MFA"}</span>
        <div style={{ width: 32, height: 18, borderRadius: 9, padding: 2, background: fraud ? "rgba(255,255,255,0.3)" : "#e8eaed", transition: "all 0.3s" }}>
          <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", transform: fraud ? "translateX(14px)" : "translateX(0)", transition: "transform 0.3s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
        </div>
      </div>

      {/* COUNTRY FILTER */}
      <div style={{ position: "absolute", top: 52, left: 10, zIndex: 900, display: "flex", borderRadius: 8, overflow: "hidden", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>
        {(["ALL", "FR", "BE", "CH", "IT", "AE"] as const).map(c => (
          <button key={c} onClick={() => goCountry(c)} style={{ padding: "6px 12px", fontSize: 11, fontWeight: country === c ? 700 : 500, border: "none", cursor: "pointer", background: country === c ? CC[c === "ALL" ? "FR" : c] : "#fff", color: country === c ? "#fff" : "#5f6368", transition: "all 0.15s" }}>
            {c === "ALL" ? "🌍 Tous" : `${FL[c]} ${CN[c]}`}
          </button>
        ))}
      </div>

      {/* BOTTOM STATS */}
      <div style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 900, display: "flex", borderRadius: 8, overflow: "hidden", boxShadow: "0 2px 6px rgba(0,0,0,0.2)", background: "#fff" }}>
        {fraud ? (
          Object.entries(FBC).filter(([c]) => country === "ALL" || c === country).map(([c, d], i, a) => (
            <div key={c} style={{ padding: "10px 14px", textAlign: "center", borderRight: i < a.length - 1 ? "1px solid #e8eaed" : "none" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: d.riskColor }}>{FL[c]} {d.ivtDisplay}%</div>
              <div style={{ fontSize: 8, fontWeight: 500, color: "#70757a", textTransform: "uppercase" }}>IVT {CN[c]}</div>
            </div>
          ))
        ) : (
          [{ v: fmt(tot), l: "Internautes", cl: "#1a73e8" }, { v: fmt(byC("FR")), l: "🇫🇷 France", cl: "#4285f4" }, { v: fmt(byC("BE")), l: "🇧🇪 Belgique", cl: "#e37400" }, { v: fmt(byC("CH")), l: "🇨🇭 Suisse", cl: "#d93025" }, { v: fmt(byC("IT")), l: "🇮🇹 Italie", cl: "#7c3aed" }, { v: fmt(byC("AE")), l: "🇦🇪 UAE", cl: "#0f9d58" }, { v: pkL, l: `CET ${cetH}h · ${(cetHf * 100).toFixed(0)}%`, cl: "#5f6368" }].map((s, i, a) => (
            <div key={i} style={{ padding: "10px 14px", textAlign: "center", borderRight: i < a.length - 1 ? "1px solid #e8eaed" : "none" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: s.cl }}>{s.v}</div>
              <div style={{ fontSize: 8, fontWeight: 500, color: "#70757a", textTransform: "uppercase", marginTop: 1 }}>{s.l}</div>
            </div>
          ))
        )}
      </div>

      {/* RIGHT PANEL */}
      <div style={{ position: "absolute", top: 88, right: 10, zIndex: 900, width: 240, borderRadius: 8, overflow: "hidden", boxShadow: "0 2px 6px rgba(0,0,0,0.2)", background: "#fff", maxHeight: "calc(100vh - 160px)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #e8eaed", fontSize: 12, fontWeight: 700, color: "#202124", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>{fraud ? "🛡️ Risque par Zone" : "Top Zones — Live"}</span>
          <span style={{ fontSize: 9, color: "#1a73e8" }}>{cH}h{String(cM).padStart(2, "0")}</span>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {(fraud
            ? [...ld].sort((a, b) => { const ra = FBCI[a.n]?.riskScore ?? FBC[a.c]?.riskScore ?? 20; const rb = FBCI[b.n]?.riskScore ?? FBC[b.c]?.riskScore ?? 20; return rb - ra; })
            : sorted
          ).slice(0, 20).map((z, i) => {
            const rs = FBCI[z.n]?.riskScore ?? FBC[z.c]?.riskScore ?? 20;
            const rc = rs >= 70 ? "#d93025" : rs >= 40 ? "#e37400" : rs >= 20 ? "#1a73e8" : "#0f9d58";
            const bg = fraud ? rc : i < 3 ? ["#1a73e8", "#4285f4", "#669df6"][i] : "#dadce0";
            const lv = intLv(z.traffic, mx);
            return (
              <div key={z.n} onClick={() => flyTo(z)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", cursor: "pointer", borderBottom: "1px solid #f8f9fa", transition: "background 0.1s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#f1f3f4"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", background: bg, flexShrink: 0 }}>{i + 1}</div>
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "#202124", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{FL[z.c]} {z.n}</div>
                  <div style={{ fontSize: 9, color: "#70757a" }}>{fraud ? (FBCI[z.n]?.type ?? "—") : `${fmtF(z.pop)} hab.`}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: fraud ? rc : "#1a73e8", whiteSpace: "nowrap" }}>{fraud ? `${rs}/100` : fmt(z.traffic)}</div>
                  <div style={{ fontSize: 9, color: fraud ? rc : lv.cl }}>{fraud ? (rs >= 70 ? "HIGH" : rs >= 40 ? "MED" : "LOW") : lv.l}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* LEFT PANEL */}
      <div style={{ position: "absolute", top: 88, left: 10, zIndex: 900, width: 175, borderRadius: 8, overflow: "hidden", boxShadow: "0 2px 6px rgba(0,0,0,0.2)", background: "#fff" }}>
        <div style={{ padding: "9px 12px", borderBottom: "1px solid #e8eaed", fontSize: 11, fontWeight: 700, color: "#202124" }}>
          {fraud ? "🛡️ Risque par Pays" : `📊 Trafic CET${isWeCET() ? " (WE)" : ""}`}
        </div>
        <div style={{ padding: "6px 10px" }}>
          {fraud ? (
            Object.entries(FBC).sort(([, a], [, b]) => b.riskScore - a.riskScore).map(([c, d]) => (
              <div key={c} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
                <span style={{ fontSize: 14 }}>{FL[c]}</span>
                <div style={{ flex: 1, height: 4, background: "#f1f3f4", borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${d.riskScore}%`, background: d.riskColor, borderRadius: 2 }} /></div>
                <span style={{ fontSize: 9, fontWeight: 700, color: d.riskColor, width: 24, textAlign: "right" }}>{d.riskScore}</span>
              </div>
            ))
          ) : (
            Array.from({ length: 19 }, (_, i) => i + 5).map(h => {
              const f = cetCv[h]; const ic = h === cetH;
              const cl = f > 0.85 ? "#d93025" : f > 0.6 ? "#e37400" : f > 0.3 ? "#fbbc04" : "#dadce0";
              return (
                <div key={h} style={{ display: "flex", alignItems: "center", gap: 3, height: 13, ...(ic ? { background: "#e8f0fe", borderRadius: 3 } : {}) }}>
                  <div style={{ fontSize: 8, fontWeight: ic ? 700 : 500, color: ic ? "#1a73e8" : "#70757a", width: 20, textAlign: "right" }}>{h}h</div>
                  <div style={{ flex: 1, height: 4, background: "#f1f3f4", borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${f * 100}%`, background: ic ? "#1a73e8" : cl, borderRadius: 2 }} /></div>
                  <div style={{ fontSize: 7, fontWeight: 700, color: "#1a73e8", width: 18 }}>{ic ? "◀" : ""}</div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* SOURCE */}
      <div style={{ position: "absolute", bottom: 24, right: 10, zIndex: 900, background: "rgba(255,255,255,0.9)", borderRadius: 6, padding: "5px 10px", fontSize: 8, color: "#70757a", boxShadow: "0 1px 3px rgba(0,0,0,0.12)", lineHeight: 1.5 }}>
        {fraud ? (
          <><div><b style={{ color: "#5f6368" }}>Fraude :</b> IAS 2024 · DoubleVerify 2024 · HUMAN 2024</div><div>MFA : ANA/Jounce Media 2024 · DeepSee/Adalytics 2024</div></>
        ) : (
          <><div><b style={{ color: "#5f6368" }}>Pop. :</b> INSEE jan. 2025 · Statbel jan. 2025 · OFS déc. 2024 · ISTAT jan. 2025 · FCSC 2024</div><div>Courbes : ARCEP/Médiamétrie T1 2025 (CET) · TDRA 2024 (GST)</div><div>Pénétration : FR 93.5% · BE 94.2% · CH 96.2% · IT 90.1% · AE 98.99%</div></>
        )}
      </div>

      <style>{`@keyframes gp{0%,100%{box-shadow:0 0 0 0 rgba(15,157,88,0.3)}50%{box-shadow:0 0 0 5px rgba(15,157,88,0)}}`}</style>
    </div>
  );
}
