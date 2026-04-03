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
  Globe
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
  { id: "cockpit", label: "Marge & Bid Shading", icon: LayoutDashboard, adminOnly: false },
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
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-screen shrink-0">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">
          {user.initials}
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-bold text-gray-900 text-lg truncate block">{user.name}</span>
          {isAdmin && (
            <span className="text-[9px] font-black bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
              👑 ADMIN
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-2 flex-1 overflow-y-auto">
        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-400 mb-3 px-3 uppercase tracking-wider">Main Menu</div>
        </div>

        <div className="mb-8">
          <nav className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                  activeTab === item.id
                    ? "bg-blue-50 text-blue-600"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
                {item.adminOnly && (
                  <span className="text-[8px] font-black bg-amber-100 text-amber-600 px-1 py-0.5 rounded ml-auto">
                    ADMIN
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {currentProject && (
          <div className="pt-4 border-t border-gray-100 space-y-2">
            <button
              onClick={() => {
                const name = prompt("Nom de la campagne :", currentProject?.name || "Nouvelle Campagne");
                if (name) onSaveProject(name);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-emerald-600 hover:bg-emerald-50 transition-colors"
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
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-5 h-5" />
              Supprimer
            </button>
          </div>
        )}
      </div>
      
      <div className="p-4 border-t border-gray-200 space-y-1">
        <div className="text-xs font-semibold text-gray-400 mb-3 px-3 uppercase tracking-wider">Settings</div>
        
        <button 
          onClick={() => setActiveTab("help")}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
            activeTab === "help" ? "bg-blue-50 text-blue-600" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
          )}
        >
          <HelpCircle className="w-5 h-5" />
          Help Center
        </button>
        <button 
          onClick={() => setActiveTab("legal")}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
            activeTab === "legal" ? "bg-blue-50 text-blue-600" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
          )}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>
          Mentions Légales
        </button>
        <button 
          onClick={() => setActiveTab("settings")}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
            activeTab === "settings" ? "bg-blue-50 text-blue-600" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
          )}
        >
          <SettingsIcon className="w-5 h-5" />
          Settings
        </button>
      </div>
    </div>
  );
}
