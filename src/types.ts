// ============================================================
// Bloomberg Terminal Ads — Types principaux
// ============================================================

export interface DailyEntry {
  date: string;
  budgetSpent: number;
  cpmRevenue: number;
  marginPct: number;
  kpiActual: number;
  adGroup?: string;
  subCampaign?: string;
  funnelTag?: string;
}

export interface ProjectSnapshot {
  timestamp: string;
  budgetSpent: number;
  marginPct: number;
  cpmCostActuel: number;
  cpmRevenueActual: number;
  actualKpi: number;
  gainRealized: number;
  action: string;
  note?: string;
}

export interface MarginPeriod {
  timestamp: string;
  budgetSpentAtStart: number;
  marginPct: number;
  cpmCostActuel: number;
  cpmRevenueActual: number;
  actualKpi: number;
  gainRealized: number;
  action: string;
  note?: string;
}

export interface ProjectNote {
  id: string;
  timestamp: string;
  text: string;
  author?: string;
}

export interface Anomaly {
  id: string;
  timestamp: string;
  type: string;
  severity: "low" | "medium" | "high";
  description: string;
  value?: number;
  threshold?: number;
}

export interface AlertTriggered {
  id: string;
  timestamp: string;
  type: string;
  condition: string;
  triggered: boolean;
  details?: string;
}

export interface TimingRecommendation {
  id: string;
  timestamp: string;
  type: string;
  action: string;
  timeWindow?: string;
  confidence: number;
  details?: string;
}

export interface FinalBalance {
  totalBudgetSpent: number;
  totalBudgetTotal: number;
  totalGain: number;
  realMarginPct: number;
  finalKpi: number;
  kpiTarget: number;
  kpiVsTarget: number;
  kpiAchieved: boolean;
  totalDays: number;
  completionPacingPct: number;
  avgCpmRevenue: number;
  avgCpmCost: number;
  avgDailySpend: number;
  bestDay?: { date: string; gain: number };
  worstDay?: { date: string; gain: number };
}

export interface LineItem {
  id: string;
  name: string;
  spend?: number;
  cpmRevenue: number;
  marginPct: number;
  kpiActual: number;
  impressions?: number;
  actions?: number;
}

export interface ProjectData {
  id: string;
  name: string;
  status: "active" | "completed" | "archived";

  // Configuration campagne
  currency: string;
  kpiType: "CPA" | "CPV" | "CTR" | "VTR" | "Viewability" | string;
  targetKpi: number;

  // Timeline
  startDate: string;
  endDate: string;
  durationDays: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastModified: number;

  // Budget
  budgetTotal: number;
  budgetSpent: number;

  // CPM & Marge
  inputMode: "Marge %" | "CPM Cost";
  cpmRevenueActual: number;
  cpmCostActuel: number;
  cpmSoldCap: number;
  margeInput: number;
  gainObjective?: number;

  // KPI
  actualKpi: number;

  // Attribution
  uplift?: number;
  attrClick?: number;
  attrView?: number;

  // Line Items
  lineItems: LineItem[];

  // Daily Tracking
  dailyEntries: DailyEntry[];

  // Historique
  history: ProjectSnapshot[];
  marginPeriods?: MarginPeriod[];

  // Tracking mode
  trackingMode?: "global" | "adgroup" | "campaign";
  adGroupList?: string[];
  subCampaignList?: string[];

  // Notes / Anomalies / Alertes
  notes: ProjectNote[];
  anomalies: Anomaly[];
  alertsTriggered: AlertTriggered[];
  timingRecommendations: TimingRecommendation[];

  // Final
  finalBalance?: FinalBalance;
}

// ============================================================
// DEFAULT PROJECT
// ============================================================

export const DEFAULT_PROJECT: ProjectData = {
  id: "",
  name: "Nouvelle Campagne",
  status: "active",

  currency: "EUR",
  kpiType: "CPA",
  targetKpi: 0,

  startDate: new Date().toISOString().split("T")[0],
  endDate: "",
  durationDays: 30,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastModified: Date.now(),

  budgetTotal: 0,
  budgetSpent: 0,

  inputMode: "Marge %",
  cpmRevenueActual: 0,
  cpmCostActuel: 0,
  cpmSoldCap: 0,
  margeInput: 0,

  actualKpi: 0,

  uplift: 3.0,
  attrClick: 0,
  attrView: 0,

  lineItems: [],
  dailyEntries: [],
  history: [],
  marginPeriods: [],

  notes: [],
  anomalies: [],
  alertsTriggered: [],
  timingRecommendations: [],
};
