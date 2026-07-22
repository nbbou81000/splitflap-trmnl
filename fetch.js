// ============================================================
// SPLIT-FLAP TRMNL — fetch.js
// Récupère la météo (Open-Meteo, gratuit sans clé) et le
// prochain passage visible de l'ISS (n2yo, clé gratuite),
// puis écrit data.json avec des lignes prêtes à afficher.
// Node 20+, zéro dépendance.
// ============================================================

import { writeFileSync } from "node:fs";

// ---- Configuration (via secrets/vars GitHub Actions) ----
const LAT = process.env.LAT || "43.93";      // Albi par défaut
const LON = process.env.LON || "2.15";
const CITY = (process.env.CITY || "ALBI").toUpperCase();
const N2YO_KEY = process.env.N2YO_KEY || ""; // vide = pas d'ISS
const TZ = "Europe/Paris";

// ---- Libellés météo WMO (sans accents, style split-flap) ----
const WMO = [
  [[0], "SOLEIL"],
  [[1, 2], "PEU NUAGEUX"],
  [[3], "COUVERT"],
  [[45, 48], "BROUILLARD"],
  [[51, 53, 55, 56, 57], "BRUINE"],
  [[61, 63, 65, 66, 67], "PLUIE"],
  [[71, 73, 75, 77], "NEIGE"],
  [[80, 81, 82], "AVERSES"],
  [[85, 86], "NEIGE"],
  [[95, 96, 99], "ORAGE"],
];
const wmoLabel = (code) =>
  (WMO.find(([codes]) => codes.includes(code)) || [null, "?"])[1];

// Version courte (max 10 caracteres) pour les petits layouts
const SHORT = {
  "PEU NUAGEUX": "NUAGEUX",
  "BROUILLARD": "BROUILLARD",
};
const shortLabel = (l) => (SHORT[l] || l).slice(0, 10);

// ---- Traduction des points cardinaux n2yo (EN -> FR) ----
const COMPASS = { N: "N", NNE: "NNE", NE: "NE", ENE: "ENE", E: "E",
  ESE: "ESE", SE: "SE", SSE: "SSE", S: "S", SSW: "SSO", SW: "SO",
  WSW: "OSO", W: "O", WNW: "ONO", NW: "NO", NNW: "NNO" };
const frCompass = (c) => COMPASS[c] || c;

// ---- Formatage date/heure Paris ----
function parisParts(utcSeconds) {
  const d = new Date(utcSeconds * 1000);
  const fmt = (opts) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, ...opts }).format(d);
  return {
    date: fmt({ day: "2-digit", month: "2-digit" }),          // 22/07
    time: fmt({ hour: "2-digit", minute: "2-digit" }).replace(":", "H"), // 21H43
  };
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} pour ${url}`);
  return r.json();
}

// ============================================================
// 1) METEO — Open-Meteo
// ============================================================
async function fetchWeather() {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&current=temperature_2m,weather_code,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min&timezone=${encodeURIComponent(TZ)}&forecast_days=1`;
  const j = await getJSON(url);
  const label = wmoLabel(j.current.weather_code);
  return {
    temp: Math.round(j.current.temperature_2m),
    wind: Math.round(j.current.wind_speed_10m),
    tmin: Math.round(j.daily.temperature_2m_min[0]),
    tmax: Math.round(j.daily.temperature_2m_max[0]),
    label,
    label_short: shortLabel(label),
  };
}

// ============================================================
// 2) ISS — n2yo visualpasses (prochain passage VISIBLE)
// ============================================================
async function fetchISS() {
  if (!N2YO_KEY) return null;
  const url =
    `https://api.n2yo.com/rest/v1/satellite/visualpasses/25544/${LAT}/${LON}/150/5/60/&apiKey=${N2YO_KEY}`;
  const j = await getJSON(url);
  const p = j.passes && j.passes[0];
  if (!p) return null;
  const { date, time } = parisParts(p.startUTC);
  return {
    date,
    time,
    dir: `${frCompass(p.startAzCompass)}>${frCompass(p.endAzCompass)}`,
    mag: p.mag,
    duration_min: Math.round(p.duration / 60),
  };
}

// ============================================================
// 3) Construction des lignes split-flap
//    wide = 22 colonnes (full / half_horizontal)
//    narrow = 11 colonnes (half_vertical / quadrant)
//    Chaque mode fournit :
//      full  -> 8 lignes  |  short -> 4 lignes
//    (le centrage horizontal est fait dans le template Liquid)
// ============================================================
function buildLines(w, iss) {
  const meteoWide = {
    full: [
      "METEO " + CITY,
      "",
      `${w.temp}C  ${w.label}`,
      "",
      `MIN ${w.tmin}C  MAX ${w.tmax}C`,
      "",
      `VENT ${w.wind} KM/H`,
      "",
    ],
    short: [
      "METEO " + CITY,
      `${w.temp}C ${w.label}`,
      `MIN ${w.tmin}C MAX ${w.tmax}C`,
      `VENT ${w.wind} KM/H`,
    ],
  };
  const meteoNarrow = {
    full: [
      "METEO",
      CITY.slice(0, 11),
      "",
      `${w.temp}C`,
      w.label_short,
      "",
      `${w.tmin}C > ${w.tmax}C`,
      `VT ${w.wind}KMH`,
    ],
    short: [
      CITY.slice(0, 11),
      `${w.temp}C`,
      w.label_short,
      `${w.tmin}C>${w.tmax}C`,
    ],
  };

  const noIss = { wide: ["ISS", "", "PAS DE PASSAGE", "VISIBLE PREVU"], narrow: ["ISS", "PAS DE", "PASSAGE", "PREVU"] };

  const issWide = iss ? {
    full: [
      "PROCHAINE ISS",
      "",
      `LE ${iss.date} A ${iss.time}`,
      "",
      `${iss.dir}  MAG ${iss.mag}`,
      "",
      `DUREE ${iss.duration_min} MIN`,
      "",
    ],
    short: [
      "PROCHAINE ISS",
      `LE ${iss.date} A ${iss.time}`,
      `${iss.dir} MAG ${iss.mag}`,
      `DUREE ${iss.duration_min} MIN`,
    ],
  } : {
    full: [noIss.wide[0], "", ...noIss.wide.slice(2), "", "", "", ""].slice(0, 8),
    short: noIss.wide,
  };

  const issNarrow = iss ? {
    full: [
      "ISS",
      "",
      iss.date,
      iss.time,
      "",
      iss.dir.slice(0, 11),
      `MAG ${iss.mag}`,
      `${iss.duration_min} MIN`,
    ],
    short: [
      "ISS " + iss.time,
      iss.date,
      iss.dir.slice(0, 11),
      `${iss.duration_min}MIN M${iss.mag}`,
    ],
  } : {
    full: ["ISS", "", ...noIss.narrow.slice(1), "", "", "", ""].slice(0, 8),
    short: noIss.narrow,
  };

  // Mode combiné : moitié météo, moitié ISS
  const bothWide = {
    full: [...meteoWide.short, ...issWide.short],
    short: [meteoWide.short[1], meteoWide.short[3], issWide.short[1], issWide.short[2]],
  };
  const bothNarrow = {
    full: [...meteoNarrow.short, ...issNarrow.short],
    short: [meteoNarrow.short[1], meteoNarrow.short[2], issNarrow.short[0], issNarrow.short[1]],
  };

  return {
    wide: { meteo: meteoWide, iss: issWide, both: bothWide },
    narrow: { meteo: meteoNarrow, iss: issNarrow, both: bothNarrow },
  };
}

// ============================================================
// MAIN
// ============================================================
const weather = await fetchWeather();
let iss = null;
try {
  iss = await fetchISS();
} catch (e) {
  console.warn("ISS indisponible :", e.message);
}

const now = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TZ, day: "2-digit", month: "2-digit",
  hour: "2-digit", minute: "2-digit",
}).format(new Date());

const data = {
  updated_at: now,
  city: CITY,
  weather,
  iss,
  lines: buildLines(weather, iss),
};

writeFileSync("data.json", JSON.stringify(data, null, 2));
console.log("data.json ecrit :", JSON.stringify(data.lines.wide, null, 2));
