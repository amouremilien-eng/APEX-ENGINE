import { useState } from "react";
import { ProjectData } from "../types";
import { cn } from "../utils/cn";
import { CheckCircle2, Circle } from "lucide-react";

interface OptimizationCycleProps {
  project: ProjectData;
}

export function OptimizationCycle({ project }: OptimizationCycleProps) {
  const [inputType, setInputType] = useState<"elapsed" | "remaining">("elapsed");
  const [dayInput, setDayInput] = useState(1);
  const [dayRemain, setDayRemain] = useState(project.durationDays);

  const maxD = project.durationDays || 30;
  
  let dayForCalculation = 0;
  if (inputType === "elapsed") {
    dayForCalculation = dayInput;
  } else {
    dayForCalculation = maxD - dayRemain;
  }

  let phase = "";
  let actions: string[] = [];

  if (dayForCalculation >= 0 && dayForCalculation <= 3) {
    phase = "PHASE LANCEMENT";
    actions = ["Dayparting", "Pacing Budget", "Répartition", "Bids initiaux"];
  } else if (dayForCalculation >= 4 && dayForCalculation <= 5) {
    phase = "PHASE AJUSTEMENT";
    actions = ["Geoloc", "Blacklist Sites"];
  } else if (dayForCalculation >= 6 && dayForCalculation <= 7) {
    phase = "PHASE CRÉATIVE";
    actions = ["Rotation Créas", "A/B Testing"];
  } else if (dayForCalculation > 7 && dayForCalculation <= 10) {
    phase = "PHASE INVENTAIRE";
    actions = ["Sellers (SSP)", "Device Size", "Whitelist Top"];
  } else if (dayForCalculation > 10 && dayForCalculation <= 15) {
    phase = "PHASE CONSOLIDATION";
    actions = ["Placements ID", "Blacklist V2"];
  } else if (dayForCalculation === 15) {
    phase = "MI-PARCOURS";
    actions = ["Geoloc Ville", "Contexte", "Device/OS"];
  } else if (dayForCalculation >= 20 && dayForCalculation <= 30) {
    phase = "RENTABILITÉ";
    actions = ["Frequency Cap", "Récence", "Test Découverte"];
  } else {
    phase = "CROISIÈRE";
    actions = ["Maintenance Pacing", "Exclusions"];
  }

  return (
    <div className="p-8 h-full overflow-y-auto bg-[#f8f9fa]">
      <div className="max-w-6xl mx-auto space-y-8">
        
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Cycle de Vie & Checklists</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-4">Schéma de Référence</h3>
              <div className="bg-gray-50 rounded-xl overflow-hidden border border-gray-100 flex items-center justify-center p-4 relative min-h-[300px]">
                <img 
                  src="/cycle_opti.png" 
                  alt="Cycle des optimisations" 
                  className="max-w-full h-auto rounded-lg z-10 relative"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const parent = e.currentTarget.parentElement;
                    if (parent) {
                      const fallback = parent.querySelector('.fallback-msg');
                      if (fallback) fallback.classList.remove('hidden');
                    }
                  }} 
                />
                <div className="fallback-msg hidden absolute inset-0 flex flex-col items-center justify-center text-center p-6 z-0">
                  <div className="w-16 h-16 bg-blue-100 text-blue-500 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h4 className="text-gray-900 font-bold mb-2">Image manquante</h4>
                  <p className="text-gray-500 text-sm max-w-sm">
                    Pour afficher votre schéma, renommez l'image que vous venez de m'envoyer en <strong>cycle_opti.png</strong> et placez-la dans le dossier <strong>public/</strong> de votre projet.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-8">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-6">📅 Où en êtes-vous ?</h3>
              
              <div className="flex flex-col gap-2 mb-6">
                <button
                  onClick={() => setInputType("elapsed")}
                  className={cn("px-4 py-3 text-sm font-bold rounded-xl border transition-colors text-left", inputType === "elapsed" ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}
                >
                  📅 Depuis le début (Jours écoulés)
                </button>
                <button
                  onClick={() => setInputType("remaining")}
                  className={cn("px-4 py-3 text-sm font-bold rounded-xl border transition-colors text-left", inputType === "remaining" ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}
                >
                  ⏳ Avant la fin (Jours restants)
                </button>
              </div>

              {inputType === "elapsed" ? (
                <div>
                  <div className="flex justify-between text-sm font-bold text-gray-700 mb-3">
                    <span>Jours écoulés</span>
                    <span className="text-blue-600">{dayInput}</span>
                  </div>
                  <input 
                    type="range" min="0" max={maxD} 
                    value={dayInput}
                    onChange={(e) => setDayInput(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>
              ) : (
                <div>
                  <div className="flex justify-between text-sm font-bold text-gray-700 mb-3">
                    <span>Jours restants</span>
                    <span className="text-blue-600">{dayRemain}</span>
                  </div>
                  <input 
                    type="range" min="0" max={maxD} 
                    value={dayRemain}
                    onChange={(e) => setDayRemain(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                  <p className="text-xs text-gray-500 mt-3 font-medium">👉 Soit le <strong className="text-gray-900">Jour {dayForCalculation}</strong> de la campagne.</p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-4 mb-6 pb-4 border-b border-gray-100">
                <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 font-black text-xl">
                  {dayForCalculation}
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900">{phase}</h3>
                  <p className="text-sm text-gray-500 font-medium">Actions recommandées</p>
                </div>
              </div>

              <div className="space-y-3">
                {actions.map((action, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-4 rounded-xl border border-gray-100 bg-gray-50 hover:bg-blue-50 hover:border-blue-100 transition-colors group cursor-pointer">
                    <CheckCircle2 className="w-5 h-5 text-gray-300 group-hover:text-blue-500 shrink-0 transition-colors" />
                    <span className="font-bold text-gray-700 group-hover:text-blue-700">{action}</span>
                  </div>
                ))}
              </div>
              
              {actions.length === 0 && (
                <div className="text-center py-8 text-gray-500 text-sm font-medium">
                  Aucune action spécifique pour ce jour. Continuez la surveillance.
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
