import { useState } from "react";
import { cn } from "../utils/cn";
import { Shield, FileText, Scale, Lock, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

export function Legal() {
  const [activeSection, setActiveSection] = useState<"mentions" | "cgu" | "confidentialite">("mentions");
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="p-8 h-full overflow-y-auto bg-[#f8f9fa]">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header */}
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Scale className="w-6 h-6 text-blue-600" />
            </div>
            Informations Légales
          </h2>
          <p className="text-gray-500 mt-2">Dernière mise à jour : {today}</p>
        </div>

        {/* Navigation */}
        <div className="flex gap-2 bg-white border border-gray-200 rounded-xl p-1.5 shadow-sm">
          {[
            { id: "mentions", label: "Mentions Légales", icon: FileText },
            { id: "cgu", label: "CGU", icon: Shield },
            { id: "confidentialite", label: "Confidentialité", icon: Lock },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id as any)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold transition-all",
                activeSection === tab.id
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ================================================
            MENTIONS LÉGALES
            ================================================ */}
        {activeSection === "mentions" && (
          <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100 p-6">
              <h3 className="text-lg font-bold text-blue-900 flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Mentions Légales
              </h3>
              <p className="text-sm text-blue-700 mt-1">
                Conformément à l'article 6 de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique
              </p>
            </div>
            <div className="p-8 space-y-8 text-sm text-gray-700 leading-relaxed">
              
              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">1. Éditeur de l'application</h4>
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 space-y-2">
                  <p><strong>Nom de l'application :</strong> Cockpit Yield — Pierre Chartier Trading</p>
                  <p><strong>Éditeur :</strong> Émilien AMOUR</p>
                  <p><strong>Statut :</strong> Application professionnelle à usage interne</p>
                  <p><strong>Contact :</strong> [emilien.amour@gamned.com]</p>
                  <p><strong>Siège social :</strong> [125 Rue de Saussure PARIS 75017]</p>
                </div>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">2. Hébergement</h4>
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 space-y-2">
                  <p><strong>Hébergeur de l'application :</strong> Vercel Inc.</p>
                  <p><strong>Adresse :</strong> 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis</p>
                  <p><strong>Site web :</strong> https://vercel.com</p>
                  <p className="mt-3"><strong>Hébergeur de la base de données :</strong> Supabase Inc.</p>
                  <p><strong>Adresse :</strong> 970 Toa Payoh North #07-04, Singapore 318992</p>
                  <p><strong>Site web :</strong> https://supabase.com</p>
                  <p><strong>Région des données :</strong> Europe (eu-west)</p>
                </div>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">3. Propriété intellectuelle</h4>
                <p>
                  L'ensemble du contenu de cette application (code source, algorithmes, interfaces graphiques, 
                  textes, images, logos, bases de données) est protégé par le droit d'auteur conformément aux 
                  articles L.111-1 et suivants du Code de la Propriété Intellectuelle français.
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-amber-900">Toute reproduction, représentation, modification, publication, 
                    adaptation de tout ou partie des éléments de l'application, quel que soit le moyen ou le procédé utilisé, 
                    est interdite sans l'autorisation écrite préalable de l'éditeur.</p>
                    <p className="text-amber-700 mt-2">
                      Toute exploitation non autorisée constitue une contrefaçon sanctionnée par les articles L.335-2 
                      et suivants du Code de la Propriété Intellectuelle.
                    </p>
                  </div>
                </div>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">4. Données personnelles</h4>
                <p>
                  Les données collectées par l'application sont limitées aux informations nécessaires 
                  à son fonctionnement : identifiant utilisateur, nom, préférences d'affichage, et données 
                  de projets professionnels. Ces données sont stockées de manière sécurisée dans une base 
                  PostgreSQL hébergée par Supabase en Europe.
                </p>
                <p className="mt-3">
                  Conformément au Règlement Général sur la Protection des Données (RGPD) et à la loi 
                  n° 78-17 du 6 janvier 1978 modifiée, vous disposez d'un droit d'accès, de rectification, 
                  de suppression et d'opposition sur vos données personnelles. Pour exercer ces droits, 
                  contactez l'éditeur à l'adresse indiquée ci-dessus.
                </p>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">5. Cookies et stockage local</h4>
                <p>
                  L'application utilise le stockage local du navigateur (localStorage) pour garantir 
                  une expérience utilisateur optimale et un fonctionnement hors-ligne. Aucun cookie 
                  tiers n'est utilisé. Aucune donnée n'est partagée avec des services publicitaires 
                  ou des tiers.
                </p>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">6. Limitation de responsabilité</h4>
                <p>
                  L'éditeur s'efforce de fournir des informations fiables et des calculs précis, mais ne peut 
                  garantir l'exactitude, la complétude ou l'actualité des informations et résultats fournis 
                  par l'application. Les décisions prises sur la base des données de l'application relèvent 
                  de la seule responsabilité de l'utilisateur.
                </p>
                <p className="mt-3">
                  L'application est fournie « en l'état » sans garantie d'aucune sorte. L'éditeur ne saurait 
                  être tenu responsable de tout dommage direct ou indirect résultant de l'utilisation de 
                  l'application.
                </p>
              </section>
            </div>
          </div>
        )}

        {/* ================================================
            CONDITIONS GÉNÉRALES D'UTILISATION
            ================================================ */}
        {activeSection === "cgu" && (
          <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100 p-6">
              <h3 className="text-lg font-bold text-emerald-900 flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Conditions Générales d'Utilisation
              </h3>
              <p className="text-sm text-emerald-700 mt-1">
                En utilisant cette application, vous acceptez les présentes conditions
              </p>
            </div>
            <div className="p-8 space-y-8 text-sm text-gray-700 leading-relaxed">
              
              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">Article 1 — Objet</h4>
                <p>
                  Les présentes Conditions Générales d'Utilisation (ci-après « CGU ») ont pour objet de définir 
                  les modalités et conditions d'utilisation de l'application « Cockpit Yield — Pierre Chartier Trading » 
                  (ci-après « l'Application »), ainsi que les droits et obligations des parties dans ce cadre.
                </p>
                <p className="mt-3">
                  L'Application est un outil professionnel de yield management et d'optimisation de campagnes 
                  publicitaires programmatiques, destiné à un usage strictement interne et professionnel.
                </p>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">Article 2 — Accès à l'Application</h4>
                <p>
                  L'accès à l'Application est réservé aux utilisateurs disposant d'un compte 
                  attribué par l'éditeur. Chaque utilisateur est responsable de la confidentialité de ses 
                  identifiants de connexion et de toute activité réalisée sous son compte.
                </p>
                <p className="mt-3">
                  L'éditeur se réserve le droit de suspendre ou de supprimer tout compte utilisateur 
                  en cas de non-respect des présentes CGU, sans préavis ni indemnité.
                </p>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">Article 3 — Propriété intellectuelle et licence</h4>
                <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-5">
                  <p className="font-bold text-blue-900 mb-3">
                    3.1 — L'intégralité de l'Application, y compris mais sans s'y limiter :
                  </p>
                  <div className="space-y-2 text-blue-800 ml-4">
                    <p>• Le code source et les algorithmes d'optimisation</p>
                    <p>• Les interfaces graphiques et le design</p>
                    <p>• Les modèles de calcul (comparateur de marge, simulateur multi-phases, radar trader, etc.)</p>
                    <p>• La structure de la base de données</p>
                    <p>• La documentation et les textes</p>
                  </div>
                  <p className="font-bold text-blue-900 mt-4">
                    sont la propriété exclusive d'Émilien AMOUR et sont protégés par le droit 
                    d'auteur français et les conventions internationales.
                  </p>
                </div>
                <p className="mt-4">
                  <strong>3.2 —</strong> L'utilisateur bénéficie d'une licence d'utilisation strictement personnelle, 
                  non exclusive, non transférable et révocable, limitée à l'usage professionnel interne 
                  dans le cadre de ses fonctions.
                </p>
                <p className="mt-3">
                  <strong>3.3 —</strong> Est expressément interdit, sans autorisation écrite préalable de l'éditeur :
                </p>
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 mt-3 space-y-2 text-red-800">
                  <p>• La copie, reproduction ou duplication de tout ou partie de l'Application</p>
                  <p>• L'ingénierie inverse (reverse engineering), la décompilation ou le désassemblage</p>
                  <p>• La modification, l'adaptation ou la création d'œuvres dérivées</p>
                  <p>• La distribution, la revente, la sous-licence ou la mise à disposition à des tiers</p>
                  <p>• L'extraction ou la réutilisation des bases de données</p>
                  <p>• La capture d'écran systématique à des fins de reproduction</p>
                  <p>• L'utilisation des algorithmes ou méthodes de calcul dans un autre logiciel</p>
                </div>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">Article 4 — Données utilisateur</h4>
                <p>
                  <strong>4.1 —</strong> Les données de projets et de campagnes saisies par l'utilisateur dans l'Application 
                  restent la propriété de l'utilisateur ou de son employeur.
                </p>
                <p className="mt-3">
                  <strong>4.2 —</strong> L'éditeur s'engage à ne pas exploiter, vendre ou partager les données de 
                  campagnes des utilisateurs à des tiers, sauf obligation légale.
                </p>
                <p className="mt-3">
                  <strong>4.3 —</strong> L'utilisateur est responsable de la sauvegarde de ses données. L'éditeur 
                  met en œuvre des moyens raisonnables pour assurer la persistance des données (synchronisation 
                  cloud via Supabase + cache local), mais ne peut garantir leur intégrité en cas de défaillance 
                  technique.
                </p>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">Article 5 — Confidentialité</h4>
                <p>
                  L'utilisateur reconnaît que l'Application contient des informations confidentielles 
                  (algorithmes, méthodes de calcul, stratégies d'optimisation) constituant un savoir-faire 
                  propriétaire. L'utilisateur s'engage à maintenir la stricte confidentialité de ces éléments 
                  et à ne pas les divulguer à des tiers.
                </p>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">Article 6 — Responsabilité</h4>
                <p>
                  <strong>6.1 —</strong> L'Application est un outil d'aide à la décision. Les recommandations, 
                  projections et calculs fournis ne constituent en aucun cas des conseils financiers ou 
                  des garanties de performance.
                </p>
                <p className="mt-3">
                  <strong>6.2 —</strong> L'utilisateur est seul responsable des décisions d'optimisation prises 
                  sur la base des données fournies par l'Application.
                </p>
                <p className="mt-3">
                  <strong>6.3 —</strong> L'éditeur ne saurait être tenu responsable de pertes financières, 
                  de manque à gagner ou de tout dommage résultant de l'utilisation de l'Application.
                </p>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">Article 7 — Disponibilité</h4>
                <p>
                  L'éditeur s'efforce d'assurer la disponibilité de l'Application 24h/24 et 7j/7, mais 
                  ne peut garantir une disponibilité ininterrompue. L'Application fonctionne en mode 
                  dégradé (hors-ligne) en cas d'indisponibilité des serveurs, grâce au cache local.
                </p>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">Article 8 — Modifications des CGU</h4>
                <p>
                  L'éditeur se réserve le droit de modifier les présentes CGU à tout moment. Les utilisateurs 
                  seront informés des modifications. La poursuite de l'utilisation de l'Application après 
                  modification vaut acceptation des nouvelles CGU.
                </p>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">Article 9 — Droit applicable et juridiction</h4>
                <p>
                  Les présentes CGU sont régies par le droit français. En cas de litige, et après tentative 
                  de résolution amiable, les tribunaux compétents de Paris seront seuls compétents.
                </p>
              </section>
            </div>
          </div>
        )}

        {/* ================================================
            POLITIQUE DE CONFIDENTIALITÉ
            ================================================ */}
        {activeSection === "confidentialite" && (
          <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 border-b border-purple-100 p-6">
              <h3 className="text-lg font-bold text-purple-900 flex items-center gap-2">
                <Lock className="w-5 h-5" />
                Politique de Confidentialité
              </h3>
              <p className="text-sm text-purple-700 mt-1">
                Conformément au RGPD (Règlement UE 2016/679) et à la loi Informatique et Libertés
              </p>
            </div>
            <div className="p-8 space-y-8 text-sm text-gray-700 leading-relaxed">
              
              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">1. Responsable du traitement</h4>
                <p>
                  Le responsable du traitement des données à caractère personnel est Pierre Chartier, 
                  éditeur de l'application Cockpit Yield. Contact : [Votre email professionnel].
                </p>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">2. Données collectées</h4>
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Donnée</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Finalité</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Base légale</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Durée</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="px-4 py-3 font-medium">Identifiant & nom</td>
                        <td className="px-4 py-3">Authentification</td>
                        <td className="px-4 py-3">Exécution du contrat</td>
                        <td className="px-4 py-3">Durée du compte</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-medium">Préférences (thème)</td>
                        <td className="px-4 py-3">Personnalisation</td>
                        <td className="px-4 py-3">Intérêt légitime</td>
                        <td className="px-4 py-3">Durée du compte</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-medium">Données de projets</td>
                        <td className="px-4 py-3">Fonctionnement de l'app</td>
                        <td className="px-4 py-3">Exécution du contrat</td>
                        <td className="px-4 py-3">Jusqu'à suppression</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-medium">Historique d'optimisations</td>
                        <td className="px-4 py-3">Traçabilité</td>
                        <td className="px-4 py-3">Intérêt légitime</td>
                        <td className="px-4 py-3">Jusqu'à suppression</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">3. Stockage et sécurité</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                    <div className="font-bold text-gray-900 mb-2">Stockage local (localStorage)</div>
                    <p className="text-xs">Cache navigateur pour un accès instantané et un fonctionnement hors-ligne. Données chiffrées au niveau du navigateur.</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                    <div className="font-bold text-gray-900 mb-2">Stockage cloud (Supabase)</div>
                    <p className="text-xs">Base PostgreSQL hébergée en Europe (eu-west). Connexion chiffrée TLS. Row Level Security activé.</p>
                  </div>
                </div>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">4. Transferts de données</h4>
                <p>
                  L'hébergement applicatif (Vercel) peut impliquer un transfert temporaire de données 
                  vers les États-Unis. Ce transfert est encadré par les clauses contractuelles types 
                  de la Commission européenne. La base de données (Supabase) est hébergée en Europe.
                </p>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">5. Vos droits (RGPD)</h4>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { right: "Droit d'accès", desc: "Obtenir une copie de vos données" },
                    { right: "Droit de rectification", desc: "Corriger vos données inexactes" },
                    { right: "Droit à l'effacement", desc: "Demander la suppression de vos données" },
                    { right: "Droit à la portabilité", desc: "Recevoir vos données dans un format structuré" },
                    { right: "Droit d'opposition", desc: "Vous opposer au traitement de vos données" },
                    { right: "Droit de limitation", desc: "Limiter le traitement de vos données" },
                  ].map(item => (
                    <div key={item.right} className="bg-purple-50 rounded-lg p-3 border border-purple-100">
                      <div className="font-bold text-purple-900 text-xs">{item.right}</div>
                      <div className="text-xs text-purple-700 mt-1">{item.desc}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-4">
                  Pour exercer ces droits, contactez l'éditeur à [Votre email]. Réponse sous 30 jours.
                  Vous disposez également du droit d'introduire une réclamation auprès de la CNIL 
                  (www.cnil.fr).
                </p>
              </section>

              <section>
                <h4 className="font-black text-gray-900 text-base mb-3">6. Sous-traitants</h4>
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Prestataire</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Service</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Localisation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="px-4 py-3 font-medium">Vercel Inc.</td>
                        <td className="px-4 py-3">Hébergement applicatif</td>
                        <td className="px-4 py-3">États-Unis (CDN mondial)</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-medium">Supabase Inc.</td>
                        <td className="px-4 py-3">Base de données PostgreSQL</td>
                        <td className="px-4 py-3">Europe (eu-west)</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-medium">GitHub Inc.</td>
                        <td className="px-4 py-3">Hébergement du code source</td>
                        <td className="px-4 py-3">États-Unis</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        )}

        {/* Footer légal */}
        <div className="text-center text-xs text-gray-400 pb-8">
          <p>© {new Date().getFullYear()} Pierre Chartier — Cockpit Yield. Tous droits réservés.</p>
          <p className="mt-1">Application protégée par le droit d'auteur — Code de la Propriété Intellectuelle (L.111-1 et suivants)</p>
        </div>
      </div>
    </div>
  );
}
