/**
 * i18n - interface strings for the main page.
 *
 * French is the default language, English is kept. The language is chosen from, in order: the "lang" query
 * parameter (?lang=en), the last choice saved in localStorage, then "fr". The Japanese page (/jp) keeps its own
 * hand-written HTML and declares <body data-lang="ja">, which this module leaves untouched.
 *
 * In HTML, an element with data-i18n="key" gets its text replaced, data-i18n-title="key" sets its tooltip,
 * data-i18n-placeholder and data-i18n-aria set the placeholder and aria-label.
 */

export const LANGS = ["fr", "en"];
const DEFAULT_LANG = "fr";
const STORAGE_KEY = "earth.lang";

const STRINGS = {
    fr: {
        "page.title": "earth :: carte animée des vents et de la météo mondiale",
        "page.description": "une carte animée des vents et de la météo mondiale",
        "menu.title": "Afficher ou masquer le menu",
        "tab.layers": "Couches",
        "tab.map": "Carte",
        "tab.settings": "Réglages",
        "group.weather": "Météo",
        "group.air": "Qualité de l'air",
        "group.ocean": "Océan",
        "group.display": "Affichage",
        "group.time": "Heure",
        "label.height": "Altitude",
        "label.projection": "Projection",
        "label.language": "Langue",
        "label.source": "Données",
        "layer.wind": "Vent",
        "layer.wind.title": "Vitesse du vent",
        "layer.temp": "Température",
        "layer.temp.title": "Température",
        "layer.rain": "Pluie",
        "layer.rain.title": "Intensité des précipitations",
        "layer.snow": "Neige",
        "layer.snow.title": "Épaisseur de neige",
        "layer.clouds": "Nuages",
        "layer.clouds.title": "Couverture nuageuse",
        "layer.cape": "Orages",
        "layer.cape.title": "CAPE : énergie disponible pour les orages",
        "layer.mslp": "Pression",
        "layer.mslp.title": "Pression au niveau de la mer",
        "layer.rh": "Humidité",
        "layer.rh.title": "Humidité relative",
        "layer.tpw": "Eau précipitable",
        "layer.tpw.title": "Eau précipitable totale",
        "layer.tcw": "Eau nuageuse",
        "layer.tcw.title": "Eau nuageuse totale",
        "layer.ad": "Densité de l'air",
        "layer.ad.title": "Densité de l'air (en altitude uniquement)",
        "layer.wpd": "Énergie éolienne",
        "layer.wpd.title": "Densité de puissance éolienne (en altitude uniquement)",
        "layer.pm25": "PM2,5",
        "layer.pm25.title": "Particules fines (PM2,5)",
        "layer.pm10": "PM10",
        "layer.pm10.title": "Particules (PM10)",
        "layer.aod": "Aérosols",
        "layer.aod.title": "Épaisseur optique des aérosols",
        "layer.dust": "Poussières",
        "layer.dust.title": "Épaisseur optique des poussières",
        "layer.waves": "Vagues",
        "layer.waves.title": "Hauteur et direction des vagues (GFS-Wave)",
        "layer.wavePeriod": "Période",
        "layer.wavePeriod.title": "Période de pic des vagues",
        "layer.currents": "Courants",
        "layer.currents.title": "Courants océaniques (échantillon 2014)",
        "height.surface": "Sol",
        "height.surface.hint": "surface, 10 m",
        "height.1000": "≈ 100 m",
        "height.850": "≈ 1 500 m",
        "height.700": "≈ 3 000 m",
        "height.500": "≈ 5 500 m",
        "height.250": "≈ 10 000 m, courant-jet",
        "height.70": "≈ 18 000 m",
        "height.10": "≈ 26 000 m, stratosphère",
        "option.overlay": "Calque de couleur",
        "option.timeline": "Frise de prévision",
        "nav.grid.title": "Grille de données",
        "nav.now": "Maintenant",
        "nav.now.title": "Revenir à l'heure actuelle",
        "nav.backward.title": "Pas précédent",
        "nav.forward.title": "Pas suivant",
        "nav.location.title": "Ma position",
        "time.play.title": "Lire la prévision",
        "time.pause.title": "Mettre en pause",
        "time.slider": "Heure de prévision",
        "tool.zoomIn": "Zoom avant",
        "tool.zoomOut": "Zoom arrière",
        "tool.share": "Copier le lien de cette vue",
        "tool.fullscreen": "Plein écran",
        "search.placeholder": "Chercher un lieu…",
        "search.none": "Aucun lieu trouvé",
        "search.error": "Recherche indisponible",
        "location.close.title": "Fermer",
        "legend.units": "Changer d'unité",
        "proj.atlantis": "Atlantis",
        "proj.azimuthal_equidistant": "Azimutale équid.",
        "proj.conic_equidistant": "Conique équid.",
        "proj.equirectangular": "Équirectangulaire",
        "proj.orthographic": "Orthographique",
        "proj.stereographic": "Stéréographique",
        "proj.waterman": "Papillon Waterman",
        "proj.winkel3": "Winkel Tripel",
        "proj.globe3d": "Globe 3D",
        "link.about": "À propos",
        "status.downloading": "Téléchargement…",
        "status.rendering": "Dessin du globe…",
        "status.initializing": "Initialisation…",
        "status.locating": "Recherche de votre position…",
        "status.loading3d": "Chargement de la 3D…",
        "status.serverDown": "Serveur indisponible",
        "status.noData": "Pas de données",
        "status.linkCopied": "Lien copié",
        "date.local": "Locale",
        "date.utc": "UTC",
        "coord.west": "O",
        "wind.from": "{dir}",
        "dir.N": "du nord",
        "dir.NNE": "du nord-nord-est",
        "dir.NE": "du nord-est",
        "dir.ENE": "d'est-nord-est",
        "dir.E": "de l'est",
        "dir.ESE": "d'est-sud-est",
        "dir.SE": "du sud-est",
        "dir.SSE": "du sud-sud-est",
        "dir.S": "du sud",
        "dir.SSW": "du sud-sud-ouest",
        "dir.SW": "du sud-ouest",
        "dir.WSW": "d'ouest-sud-ouest",
        "dir.W": "de l'ouest",
        "dir.WNW": "d'ouest-nord-ouest",
        "dir.NW": "du nord-ouest",
        "dir.NNW": "du nord-nord-ouest"
    },
    en: {
        "page.title": "earth :: an animated map of global wind and weather",
        "page.description": "an animated map of global wind and weather",
        "menu.title": "Show or hide the menu",
        "tab.layers": "Layers",
        "tab.map": "Map",
        "tab.settings": "Settings",
        "group.weather": "Weather",
        "group.air": "Air quality",
        "group.ocean": "Ocean",
        "group.display": "Display",
        "group.time": "Time",
        "label.height": "Height",
        "label.projection": "Projection",
        "label.language": "Language",
        "label.source": "Data",
        "layer.wind": "Wind",
        "layer.wind.title": "Wind speed",
        "layer.temp": "Temperature",
        "layer.temp.title": "Temperature",
        "layer.rain": "Rain",
        "layer.rain.title": "Precipitation rate",
        "layer.snow": "Snow",
        "layer.snow.title": "Snow depth",
        "layer.clouds": "Clouds",
        "layer.clouds.title": "Total cloud cover",
        "layer.cape": "Storms",
        "layer.cape.title": "CAPE: energy available for thunderstorms",
        "layer.mslp": "Pressure",
        "layer.mslp.title": "Mean sea level pressure",
        "layer.rh": "Humidity",
        "layer.rh.title": "Relative humidity",
        "layer.tpw": "Precip. water",
        "layer.tpw.title": "Total precipitable water",
        "layer.tcw": "Cloud water",
        "layer.tcw.title": "Total cloud water",
        "layer.ad": "Air density",
        "layer.ad.title": "Air density (upper levels only)",
        "layer.wpd": "Wind power",
        "layer.wpd.title": "Wind power density (upper levels only)",
        "layer.pm25": "PM2.5",
        "layer.pm25.title": "Fine particulate matter (PM2.5)",
        "layer.pm10": "PM10",
        "layer.pm10.title": "Particulate matter (PM10)",
        "layer.aod": "Aerosols",
        "layer.aod.title": "Aerosol optical depth",
        "layer.dust": "Dust",
        "layer.dust.title": "Dust optical depth",
        "layer.waves": "Waves",
        "layer.waves.title": "Wave height and direction (GFS-Wave)",
        "layer.wavePeriod": "Period",
        "layer.wavePeriod.title": "Peak wave period",
        "layer.currents": "Currents",
        "layer.currents.title": "Ocean currents (2014 sample)",
        "height.surface": "Surface",
        "height.surface.hint": "10 m",
        "height.1000": "≈ 100 m",
        "height.850": "≈ 1,500 m",
        "height.700": "≈ 3,000 m",
        "height.500": "≈ 5,500 m",
        "height.250": "≈ 10,000 m, jet stream",
        "height.70": "≈ 18,000 m",
        "height.10": "≈ 26,000 m, stratosphere",
        "option.overlay": "Color overlay",
        "option.timeline": "Forecast timeline",
        "nav.grid.title": "Data grid",
        "nav.now": "Now",
        "nav.now.title": "Back to current conditions",
        "nav.backward.title": "Previous step",
        "nav.forward.title": "Next step",
        "nav.location.title": "My location",
        "time.play.title": "Play forecast",
        "time.pause.title": "Pause",
        "time.slider": "Forecast time",
        "tool.zoomIn": "Zoom in",
        "tool.zoomOut": "Zoom out",
        "tool.share": "Copy a link to this view",
        "tool.fullscreen": "Full screen",
        "search.placeholder": "Search a place…",
        "search.none": "No place found",
        "search.error": "Search unavailable",
        "location.close.title": "Close",
        "legend.units": "Change units",
        "proj.atlantis": "Atlantis",
        "proj.azimuthal_equidistant": "Azimuthal equid.",
        "proj.conic_equidistant": "Conic equid.",
        "proj.equirectangular": "Equirectangular",
        "proj.orthographic": "Orthographic",
        "proj.stereographic": "Stereographic",
        "proj.waterman": "Waterman butterfly",
        "proj.winkel3": "Winkel Tripel",
        "proj.globe3d": "3D globe",
        "link.about": "About",
        "status.downloading": "Downloading...",
        "status.rendering": "Rendering Globe...",
        "status.initializing": "Initializing...",
        "status.locating": "Finding current position...",
        "status.loading3d": "Loading 3D...",
        "status.serverDown": "Server Down",
        "status.noData": "No Data",
        "status.linkCopied": "Link copied",
        "date.local": "Local",
        "date.utc": "UTC",
        "coord.west": "W",
        "wind.from": "from the {dir}",
        "dir.N": "north",
        "dir.NNE": "north-northeast",
        "dir.NE": "northeast",
        "dir.ENE": "east-northeast",
        "dir.E": "east",
        "dir.ESE": "east-southeast",
        "dir.SE": "southeast",
        "dir.SSE": "south-southeast",
        "dir.S": "south",
        "dir.SSW": "south-southwest",
        "dir.SW": "southwest",
        "dir.WSW": "west-southwest",
        "dir.W": "west",
        "dir.WNW": "west-northwest",
        "dir.NW": "northwest",
        "dir.NNW": "north-northwest"
    }
};

function storage() {
    try { return window.localStorage; } catch { return null; }
}

/** Picks the language from the query string, then the saved choice, then the default. */
export function detectLang(search = globalThis.location?.search ?? "", saved = null) {
    const fromQuery = new URLSearchParams(search).get("lang");
    if (LANGS.includes(fromQuery)) return fromQuery;
    if (saved === null) {
        try { saved = storage()?.getItem(STORAGE_KEY) ?? null; } catch { saved = null; }
    }
    return LANGS.includes(saved) ? saved : DEFAULT_LANG;
}

let current = DEFAULT_LANG;

/** The current language code ("fr", "en", or "ja" on the Japanese page). */
export function lang() {
    return current;
}

/** BCP 47 locale for date formatting. */
export function locale() {
    return {fr: "fr-FR", en: "en-GB", ja: "ja-JP"}[current] || undefined;
}

/** Translates a key in the current language, falling back to English, then to the key itself. */
export function t(key, langCode = current) {
    const table = STRINGS[langCode] || STRINGS.en;
    return table[key] ?? STRINGS.en[key] ?? key;
}

/** Applies data-i18n / data-i18n-title attributes below root. */
export function translatePage(root = document) {
    root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
    root.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    root.querySelectorAll("[data-i18n-aria]").forEach(el => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
    root.querySelectorAll("[data-lang-choice]").forEach(el => {
        el.setAttribute("aria-pressed", String(el.dataset.langChoice === current));
    });
}

/**
 * Sets up the page language. Must run before earth.js reads <body data-lang>. Returns the language in use.
 */
export function initI18n() {
    const body = document.body;
    if (body.dataset.lang === "ja") {  // the hand-written Japanese page
        current = "ja";
        return current;
    }
    current = detectLang();
    body.dataset.lang = current;
    document.documentElement.lang = current;
    document.title = t("page.title");
    document.querySelector('meta[name="description"]')?.setAttribute("content", t("page.description"));
    translatePage();
    document.querySelectorAll("[data-lang-choice]").forEach(el => {
        el.addEventListener("click", () => {
            const choice = el.dataset.langChoice;
            if (choice === current) return;
            try { storage()?.setItem(STORAGE_KEY, choice); } catch { /* private mode: query param still works */ }
            const url = new URL(window.location.href);
            url.searchParams.delete("lang");
            window.location.replace(url.toString());  // reload keeps the #hash (current view)
        });
    });
    return current;
}

export const _STRINGS = STRINGS;  // for tests
