import { 
  LayoutDashboard,
  RefreshCw,
  Briefcase,
  LineChart,
  Save,
  Trash2,
  Settings as SettingsIcon,
  HelpCircle,
  Calendar,
  BarChart3,
  Trophy,
  Globe,
  Brain,
  Banknote
} from "lucide-react";
import { cn } from "../utils/cn";
import { ProjectData } from "../types";
import { UserProfile } from "../store/useUserStore";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  projects: ProjectData[];
  currentProject: ProjectData | null;
  onLoadProject: (id: string) => void;
  onSaveProject: (name: string) => void;
  onDeleteProject: (id: string) => void;
  onCreateNew: () => void;
  user: UserProfile;
  isAdmin?: boolean;
}

const NAV_ITEMS_BASE = [
  { id: "tracking", label: "Suivi Campagne", icon: Calendar, adminOnly: false },
  { id: "cockpit", label: "Marge & Bid Shading", icon: Banknote, adminOnly: false },
  { id: "learning", label: "Learning Engine", icon: Brain, adminOnly: false },
  { id: "cycle", label: "Cycle des Optimisations", icon: RefreshCw, adminOnly: false },
  { id: "portfolio", label: "Portfolio & Performance", icon: Briefcase, adminOnly: false },
  { id: "market", label: "Market Watch", icon: LineChart, adminOnly: false },
  { id: "geotraffic", label: "Geo Traffic", icon: Globe, adminOnly: false },
  { id: "benchmark", label: "Benchmark Intelligence", icon: BarChart3, adminOnly: false },
  { id: "roi", label: "ROI TDesk", icon: Trophy, adminOnly: true },
];

export function Sidebar({
  activeTab,
  setActiveTab,
  currentProject,
  onSaveProject,
  onDeleteProject,
  user,
  isAdmin = false,
}: SidebarProps) {
  const navItems = NAV_ITEMS_BASE.filter(item => !item.adminOnly || isAdmin);

  return (
    <div className="w-64 flex flex-col h-screen shrink-0" style={{
      background: "linear-gradient(180deg, rgba(230,240,255,0.3) 0%, rgba(255,255,255,0.2) 30%, rgba(245,235,255,0.25) 60%, rgba(235,250,245,0.2) 100%)",
      backgroundSize: "100% 300%",
      animation: "sidebarGlow 12s ease-in-out infinite",
      backdropFilter: "blur(40px) saturate(1.8)",
      WebkitBackdropFilter: "blur(40px) saturate(1.8)",
      borderRight: "none",
      boxShadow: "8px 0 32px rgba(0,0,0,0.04)",
    }}>
      <div className="p-5 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.3)" }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm" style={{ background: "rgba(0,0,0,0.65)" }}>
          {user.initials}
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-bold text-lg truncate block" style={{ color: "rgba(0,0,0,0.85)" }}>{user.name}</span>
          {isAdmin && (
            <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: "rgba(0,0,0,0.4)" }}>
              Admin
            </span>
          )}
        </div>
      </div>

      <div className="px-3 py-2 flex-1 overflow-y-auto">
        <div className="mb-2">
          <div className="text-[10px] font-bold mb-2 px-3 uppercase tracking-widest" style={{ color: "rgba(0,0,0,0.25)" }}>Navigation</div>
        </div>

        <div className="mb-6">
          <nav className="space-y-0.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                  activeTab === item.id
                    ? ""
                    : ""
                )}
                style={activeTab === item.id ? {
                  background: "rgba(255,255,255,0.5)",
                  color: "rgba(0,0,0,0.9)",
                  fontWeight: 600,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                  border: "1px solid rgba(255,255,255,0.5)",
                } : {
                  color: "rgba(0,0,0,0.5)",
                  border: "1px solid transparent",
                }}
                onMouseEnter={(e) => { if (activeTab !== item.id) { e.currentTarget.style.background = "rgba(255,255,255,0.3)"; e.currentTarget.style.color = "rgba(0,0,0,0.75)"; }}}
                onMouseLeave={(e) => { if (activeTab !== item.id) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(0,0,0,0.5)"; }}}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
                {item.adminOnly && (
                  <span className="text-[8px] font-black px-1 py-0.5 rounded ml-auto" style={{ background: "rgba(251,191,36,0.15)", color: "#b45309" }}>
                    ADMIN
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {currentProject && (
          <div className="pt-4 space-y-2" style={{ borderTop: "1px solid rgba(255,255,255,0.3)" }}>
            <button
              onClick={() => {
                const name = prompt("Nom de la campagne :", currentProject?.name || "Nouvelle Campagne");
                if (name) onSaveProject(name);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-emerald-700 transition-colors"
              style={{ }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(16,185,129,0.1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <Save className="w-5 h-5" />
              Sauvegarder
            </button>

            <button
              onClick={() => {
                if (confirm("Supprimer cette campagne ?")) {
                  onDeleteProject(currentProject.id);
                }
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 transition-colors"
              style={{ }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <Trash2 className="w-5 h-5" />
              Supprimer
            </button>
          </div>
        )}
      </div>
      
      <div className="p-3 space-y-1" style={{ borderTop: "1px solid rgba(255,255,255,0.3)" }}>
        <div className="text-[10px] font-bold mb-2 px-3 uppercase tracking-widest" style={{ color: "rgba(0,0,0,0.25)" }}>Outils</div>
        
        {[
          { id: "help", icon: HelpCircle, label: "Help Center" },
          { id: "legal", icon: SettingsIcon, label: "Mentions Legales" },
          { id: "settings", icon: SettingsIcon, label: "Settings" },
        ].map(item => (
          <button key={item.id}
            onClick={() => setActiveTab(item.id)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={activeTab === item.id ? {
              background: "rgba(255,255,255,0.5)", color: "rgba(0,0,0,0.9)", fontWeight: 600,
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid rgba(255,255,255,0.5)",
            } : { color: "rgba(0,0,0,0.5)", border: "1px solid transparent" }}
            onMouseEnter={(e) => { if (activeTab !== item.id) { e.currentTarget.style.background = "rgba(255,255,255,0.3)"; e.currentTarget.style.color = "rgba(0,0,0,0.75)"; }}}
            onMouseLeave={(e) => { if (activeTab !== item.id) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(0,0,0,0.5)"; }}}
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
