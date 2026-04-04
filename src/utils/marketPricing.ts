// src/utils/marketPricing.ts
// Données de marché programmatique — prix CPM par format et pays

interface MarketEntry {
  date: string;
  price: number;
}

// Prix de base CPM (€) par format
const BASE_PRICES: Record<string, number> = {
  "Video Pre-roll": 12.5,
  "Video Mid-roll": 10.8,
  "Display 300x250": 2.4,
  "Display 728x90": 1.8,
  "Display 160x600": 1.6,
  "Native": 5.2,
  "Audio Spot": 8.5,
  "CTV / OTT": 22.0,
  "DOOH": 15.0,
  "Rich Media": 6.8,
  "Skin / Habillage": 18.0,
  "Interstitiel Mobile": 7.5,
};

// Multiplicateurs par pays
const COUNTRY_MULTIPLIERS: Record<string, number> = {
  "France": 1.0,
  "Allemagne": 1.15,
  "UK": 1.35,
  "Espagne": 0.75,
  "Italie": 0.80,
  "Belgique": 0.95,
  "Pays-Bas": 1.05,
  "Suisse": 1.50,
  "USA": 1.60,
  "Canada": 1.20,
  "Brésil": 0.45,
  "Mexique": 0.40,
  "Japon": 1.30,
  "Australie": 1.25,
  "MENA": 0.90,
  "Afrique": 0.35,
};

/**
 * Retourne la liste des formats publicitaires disponibles
 */
export function getAvailableFormats(): string[] {
  return Object.keys(BASE_PRICES);
}

/**
 * Retourne la liste des pays disponibles
 */
export function getAvailableCountries(): string[] {
  return Object.keys(COUNTRY_MULTIPLIERS);
}

/**
 * Retourne le prix CPM actuel pour un format et pays donné
 */
export function getCurrentPrice(format: string, country: string): number {
  const base = BASE_PRICES[format] ?? 5.0;
  const mult = COUNTRY_MULTIPLIERS[country] ?? 1.0;
  // Légère variation aléatoire ±5% pour simuler le marché en temps réel
  const noise = 0.95 + Math.random() * 0.10;
  return Math.round(base * mult * noise * 100) / 100;
}

/**
 * Génère un historique de prix simulé sur N jours
 * Utilise un random walk avec trend et saisonnalité
 */
export function generateMarketHistory(
  format: string,
  country: string,
  days: number = 365
): MarketEntry[] {
  const base = BASE_PRICES[format] ?? 5.0;
  const mult = COUNTRY_MULTIPLIERS[country] ?? 1.0;
  const basePrice = base * mult;

  const history: MarketEntry[] = [];
  let price = basePrice;

  const today = new Date();

  for (let i = days; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);

    // Saisonnalité : Q4 (oct-déc) +15%, été -10%
    const month = d.getMonth();
    let seasonal = 1.0;
    if (month >= 9 && month <= 11) seasonal = 1.15; // Q4 boost
    else if (month >= 5 && month <= 7) seasonal = 0.90; // Summer dip

    // Jour de la semaine : weekends -20%
    const dow = d.getDay();
    const dayFactor = (dow === 0 || dow === 6) ? 0.80 : 1.0;

    // Random walk avec mean-reversion
    const drift = (basePrice * seasonal - price) * 0.03;
    const volatility = basePrice * 0.02 * (Math.random() - 0.5);
    price = Math.max(basePrice * 0.4, price + drift + volatility);
    price *= dayFactor;

    history.push({
      date: d.toISOString().slice(0, 10),
      price: Math.round(price * 100) / 100,
    });
  }

  return history;
}

/**
 * Calcule le RSI (Relative Strength Index) sur une série de prix
 * Période standard = 14
 */
export function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50; // Neutre par défaut

  let gains = 0;
  let losses = 0;

  // Calcul initial
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}
