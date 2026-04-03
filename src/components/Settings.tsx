import { useUserStore, Theme } from "../store/useUserStore";
import { User, Palette, Sparkles } from "lucide-react";
import { cn } from "../utils/cn";

export function Settings() {
  const { user, updateTheme, updateProfile } = useUserStore();

  const themes: { id: Theme; label: string; description: string; preview: string }[] = [
    { 
      id: "salesin", 
      label: "Salesin (Défaut)", 
      description: "Bleu classique & professionnel",
      preview: "bg-gradient-to-br from-blue-500 to-emerald-500" 
    },
    { 
      id: "biggie", 
      label: "Biggie Group", 
      description: "Dégradé bleu-violet corporate",
      preview: "bg-gradient-to-br from-[#6B9BD1] to-[#9B7BC6]" 
    },
    { 
      id: "gamned", 
      label: "Gamned iA", 
      description: "Rouge-rose-violet dynamique",
      preview: "bg-gradient-to-br from-[#E85D5D] via-[#D946A6] to-[#8B46C7]" 
    },
    { 
      id: "light", 
      label: "Clair Minimaliste", 
      description: "Design épuré en noir & blanc",
      preview: "bg-gradient-to-br from-white to-gray-200" 
    },
    { 
      id: "dark", 
      label: "Mode Sombre", 
      description: "Interface sombre pour la nuit",
      preview: "bg-gradient-to-br from-gray-900 to-gray-700" 
    },
  ];

  return (
    <div className="p-8 h-full overflow-y-auto" style={{ backgroundColor: 'rgb(var(--bg-page))' }}>
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'rgb(var(--text-primary))' }}>
            Paramètres du Profil
          </h2>
          <p className="text-sm mt-1" style={{ color: 'rgb(var(--text-secondary))' }}>
            Gérez vos informations personnelles et l'apparence de l'application.
          </p>
        </div>

        <div className="bg-card rounded-2xl shadow-md p-8 space-y-8" style={{ 
          backgroundColor: 'rgb(var(--bg-card))',
          borderColor: 'rgb(var(--border-color))',
          borderWidth: '1px'
        }}>
          
          {/* Profil */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{
                backgroundColor: 'rgb(var(--color-primary) / 0.1)',
                color: 'rgb(var(--color-primary))'
              }}>
                <User className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold" style={{ color: 'rgb(var(--text-primary))' }}>
                Informations Personnelles
              </h3>
            </div>
            
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold mb-2" style={{ color: 'rgb(var(--text-primary))' }}>
                  Nom complet
                </label>
                <input 
                  type="text" 
                  className="w-full text-sm rounded-xl p-3 border focus:ring-2 outline-none transition-all"
                  style={{
                    backgroundColor: 'rgb(var(--bg-page))',
                    borderColor: 'rgb(var(--border-color))',
                    color: 'rgb(var(--text-primary))'
                  }}
                  value={user.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);
                    updateProfile({ name, initials });
                  }}
                />
              </div>
              <div>
                <label className="block text-sm font-bold mb-2" style={{ color: 'rgb(var(--text-primary))' }}>
                  Initiales
                </label>
                <input 
                  type="text" 
                  className="w-full text-sm rounded-xl p-3 border outline-none opacity-70 cursor-not-allowed"
                  style={{
                    backgroundColor: 'rgb(var(--bg-page))',
                    borderColor: 'rgb(var(--border-color))',
                    color: 'rgb(var(--text-primary))'
                  }}
                  value={user.initials}
                  disabled
                />
              </div>
            </div>
          </div>

          <hr style={{ borderColor: 'rgb(var(--border-color))' }} />

          {/* Apparence */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{
                backgroundColor: 'rgb(var(--color-secondary) / 0.1)',
                color: 'rgb(var(--color-secondary))'
              }}>
                <Palette className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold" style={{ color: 'rgb(var(--text-primary))' }}>
                Charte Graphique
              </h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {themes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => updateTheme(t.id)}
                  className={cn(
                    "flex flex-col gap-3 p-5 rounded-2xl border-2 transition-all text-left hover:scale-105",
                    user.theme === t.id 
                      ? "border-current shadow-lg" 
                      : "hover:border-current hover:shadow-md"
                  )}
                  style={{
                    borderColor: user.theme === t.id ? 'rgb(var(--color-primary))' : 'rgb(var(--border-color))',
                    backgroundColor: user.theme === t.id ? 'rgb(var(--color-primary) / 0.05)' : 'rgb(var(--bg-card))'
                  }}
                >
                  <div className={cn("w-full h-24 rounded-xl shadow-md", t.preview)}></div>
                  
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-black" style={{ color: 'rgb(var(--text-primary))' }}>
                        {t.label}
                      </span>
                      {user.theme === t.id && (
                        <Sparkles className="w-4 h-4" style={{ color: 'rgb(var(--color-primary))' }} />
                      )}
                    </div>
                    <p className="text-xs" style={{ color: 'rgb(var(--text-secondary))' }}>
                      {t.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            {/* Aperçu du thème actif */}
            <div className="mt-8 p-6 rounded-xl" style={{
              backgroundColor: 'rgb(var(--bg-page))',
              borderColor: 'rgb(var(--border-color))',
              borderWidth: '1px'
            }}>
              <h4 className="text-sm font-bold mb-4" style={{ color: 'rgb(var(--text-primary))' }}>
                Aperçu du thème sélectionné :
              </h4>
              <div className="flex items-center gap-4">
                <div className="px-4 py-2 rounded-lg font-bold text-white" style={{
                  backgroundColor: 'rgb(var(--color-primary))'
                }}>
                  Bouton Principal
                </div>
                <div className="px-4 py-2 rounded-lg font-bold text-white" style={{
                  backgroundColor: 'rgb(var(--color-secondary))'
                }}>
                  Bouton Secondaire
                </div>
                <div className="px-4 py-2 rounded-lg font-bold" style={{
                  backgroundColor: 'rgb(var(--color-accent) / 0.2)',
                  color: 'rgb(var(--text-primary))'
                }}>
                  Accent
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
