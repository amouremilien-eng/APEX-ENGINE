import { Alert, AlertSeverity } from "../hooks/useAlerts";
import { AlertTriangle, CheckCircle2, Info, AlertCircle, X, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "../utils/cn";

interface AlertsPanelProps {
  alerts: Alert[];
  onDismiss?: (alertId: string) => void;
  compact?: boolean;
}

export function AlertsPanel({ alerts, onDismiss, compact = false }: AlertsPanelProps) {
  if (alerts.length === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <h3 className="font-bold text-emerald-900 mb-1">Tout va bien ! 🎉</h3>
        <p className="text-sm text-emerald-700">
          Aucune alerte détectée. Vos campagnes sont en bonne santé.
        </p>
      </div>
    );
  }

  const severityConfig: Record<AlertSeverity, { 
    icon: any; 
    bgColor: string; 
    borderColor: string; 
    textColor: string;
    iconBg: string;
  }> = {
    danger: {
      icon: AlertCircle,
      bgColor: "bg-red-50",
      borderColor: "border-red-200",
      textColor: "text-red-900",
      iconBg: "bg-red-100 text-red-600"
    },
    warning: {
      icon: AlertTriangle,
      bgColor: "bg-amber-50",
      borderColor: "border-amber-200",
      textColor: "text-amber-900",
      iconBg: "bg-amber-100 text-amber-600"
    },
    info: {
      icon: Info,
      bgColor: "bg-blue-50",
      borderColor: "border-blue-200",
      textColor: "text-blue-900",
      iconBg: "bg-blue-100 text-blue-600"
    },
    success: {
      icon: CheckCircle2,
      bgColor: "bg-emerald-50",
      borderColor: "border-emerald-200",
      textColor: "text-emerald-900",
      iconBg: "bg-emerald-100 text-emerald-600"
    }
  };

  const dangerCount = alerts.filter(a => a.severity === "danger").length;
  const warningCount = alerts.filter(a => a.severity === "warning").length;
  const infoCount = alerts.filter(a => a.severity === "info").length;
  const successCount = alerts.filter(a => a.severity === "success").length;

  if (compact) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-blue-600" />
            Alertes ({alerts.length})
          </h3>
          <div className="flex gap-2 text-xs">
            {dangerCount > 0 && (
              <span className="bg-red-100 text-red-700 px-2 py-1 rounded-full font-bold">
                {dangerCount} 🚨
              </span>
            )}
            {warningCount > 0 && (
              <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-bold">
                {warningCount} ⚠️
              </span>
            )}
            {successCount > 0 && (
              <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-bold">
                {successCount} ✅
              </span>
            )}
          </div>
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {alerts.slice(0, 5).map((alert) => {
            const config = severityConfig[alert.severity];
            const Icon = config.icon;
            
            return (
              <div
                key={alert.id}
                className={cn(
                  "p-3 rounded-lg border transition-all hover:shadow-sm",
                  config.bgColor,
                  config.borderColor
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn("p-1.5 rounded-lg shrink-0", config.iconBg)}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={cn("font-bold text-xs mb-0.5", config.textColor)}>
                      {alert.projectName}
                    </div>
                    <div className="text-xs text-gray-700 line-clamp-1">
                      {alert.message}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {alerts.length > 5 && (
            <div className="text-center text-xs text-gray-500 pt-2">
              + {alerts.length - 5} autre(s) alerte(s)
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-blue-600" />
            </div>
            Alertes Intelligentes
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Détection automatique des anomalies et opportunités
          </p>
        </div>
        <div className="flex gap-3">
          {dangerCount > 0 && (
            <div className="text-center">
              <div className="text-2xl font-black text-red-600">{dangerCount}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Critiques</div>
            </div>
          )}
          {warningCount > 0 && (
            <div className="text-center">
              <div className="text-2xl font-black text-amber-600">{warningCount}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Attention</div>
            </div>
          )}
          {infoCount > 0 && (
            <div className="text-center">
              <div className="text-2xl font-black text-blue-600">{infoCount}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Info</div>
            </div>
          )}
          {successCount > 0 && (
            <div className="text-center">
              <div className="text-2xl font-black text-emerald-600">{successCount}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Succès</div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {alerts.map((alert) => {
          const config = severityConfig[alert.severity];
          const Icon = config.icon;
          
          return (
            <div
              key={alert.id}
              className={cn(
                "p-5 rounded-xl border transition-all hover:shadow-md",
                config.bgColor,
                config.borderColor
              )}
            >
              <div className="flex items-start gap-4">
                <div className={cn("p-3 rounded-xl shrink-0", config.iconBg)}>
                  <Icon className="w-6 h-6" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                        {alert.projectName}
                      </div>
                      <h3 className={cn("font-bold text-lg", config.textColor)}>
                        {alert.title}
                      </h3>
                    </div>
                    {onDismiss && (
                      <button
                        onClick={() => onDismiss(alert.id)}
                        className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  
                  <p className="text-sm text-gray-700 mb-3">
                    {alert.message}
                  </p>

                  {alert.value !== undefined && alert.threshold !== undefined && (
                    <div className="bg-white/50 rounded-lg p-3 mb-3 inline-flex items-center gap-3">
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-0.5">Actuel</div>
                        <div className="text-lg font-black text-gray-900">
                          {alert.value.toFixed(1)}{alert.type.includes('pace') ? '%' : ''}
                        </div>
                      </div>
                      {alert.value > alert.threshold ? (
                        <TrendingUp className="w-5 h-5 text-red-500" />
                      ) : (
                        <TrendingDown className="w-5 h-5 text-emerald-500" />
                      )}
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-0.5">Cible</div>
                        <div className="text-lg font-black text-gray-900">
                          {alert.threshold.toFixed(1)}{alert.type.includes('pace') ? '%' : ''}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {alert.recommendation && (
                    <div className="bg-white/70 border border-gray-200 rounded-lg p-3 mt-3">
                      <div className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                        💡 Recommandation
                      </div>
                      <p className="text-sm text-gray-700">
                        {alert.recommendation}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
