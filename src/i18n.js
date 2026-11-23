/**
 * i18n - interface strings for the main page.
 *
 * French is the default language, English is kept. The language is chosen from, in order: the "lang" query
 * parameter (?lang=en), the last choice saved in localStorage, then "fr". The Japanese page (/jp) keeps its own
 * hand-written HTML and declares <body data-lang="ja">, which this module leaves untouched.
 *
 * In HTML, an element with data-i18n="key" gets its text replaced, and data-i18n-title="key" sets its tooltip.
 */

export const LANGS = ["fr", "en"];
const DEFAULT_LANG = "fr";
const STORAGE_KEY = "earth.lang";

const STRINGS = {
    fr: {
        "page.title": "earth :: carte animée des vents et de la météo mondiale",
        "page.description": "une carte animée des vents et de la météo mondiale",

        "label.date": "Date",
        "label.data": "Données",
        "label.scale": "Échelle",
        "label.source": "Source",
        "label.time": "Prévision",
        "label.control": "Navigation",
        "label.mode": "Mode",
        "label.height": "Altitude",
        "label.overlay": "Calque",
        "label.animate": "Animation",
        "label.projection": "Projection",
        "label.language": "Langue",

        "menu.title": "menu",
        "nav.now": "Maintenant",
        "nav.now.title": "Conditions actuelles",
        "nav.backwardMore.title": "Reculer d'un jour",
        "nav.backward.title": "Reculer de 3 heures",
        "nav.forward.title": "Avancer de 3 heures",
        "nav.forwardMore.title": "Avancer d'un jour",
        "nav.location.title": "Ma position",
        "nav.grid": "Grille",
        "nav.grid.title": "Afficher la grille de données",
        "time.play.title": "Lire la prévision",
        "time.slider": "Heure de prévision",
        "location.close.title": "Fermer",

        "mode.air": "Air",
        "mode.ocean": "Océan",
        "height.surface": "Sol",
        "height.surface.title": "Surface",

        "overlay.none": "Aucun",
        "overlay.wind": "Vent",
        "overlay.wind.title": "Vitesse du vent",
        "overlay.temp": "Temp",
        "overlay.temp.title": "Température",
        "overlay.rh": "HR",
        "overlay.rh.title": "Humidité relative",
        "overlay.ad": "DA",
        "overlay.ad.title": "Densité de l'air",
        "overlay.wpd": "DPE",
        "overlay.wpd.title": "Densité de puissance éolienne",
        "overlay.tpw": "EPT",
        "overlay.tpw.title": "Eau précipitable totale",
        "overlay.tcw": "ENT",
        "overlay.tcw.title": "Eau nuageuse totale",
        "overlay.mslp": "PNM",
        "overlay.mslp.title": "Pression au niveau de la mer",
        "overlay.rain": "Pluie",
        "overlay.rain.title": "Intensité des précipitations",
        "overlay.snow": "Neige",
        "overlay.snow.title": "Épaisseur de neige",
        "overlay.cape": "CAPE",
        "overlay.cape.title": "CAPE (potentiel orageux)",
        "overlay.clouds": "Nuages",
        "overlay.clouds.title": "Couverture nuageuse",
        "overlay.pm25": "PM2,5",
        "overlay.pm25.title": "Particules fines (PM2,5)",
        "overlay.pm10": "PM10",
        "overlay.pm10.title": "Particules (PM10)",
        "overlay.aod": "AOD",
        "overlay.aod.title": "Épaisseur optique des aérosols",
        "overlay.dust": "Poussières",
        "overlay.dust.title": "Épaisseur optique des poussières",

        "animate.waves": "Vagues",
        "animate.waves.title": "Vagues (GFS-Wave)",
        "animate.currents": "Courants",
        "animate.currents.title": "Courants (échantillon 2014)",
        "overlay.waveHeight": "Hauteur",
        "overlay.waveHeight.title": "Hauteur significative des vagues",
        "overlay.wavePeriod": "Période",
        "overlay.wavePeriod.title": "Période de pic des vagues",
        "overlay.currents": "Courants",
        "overlay.currents.title": "Courants",

        "proj.atlantis": "Atlantis",
        "proj.azimuthal_equidistant": "Azimutale équidistante",
        "proj.conic_equidistant": "Conique équidistante",
        "proj.equirectangular": "Équirectangulaire",
        "proj.orthographic": "Orthographique",
        "proj.stereographic": "Stéréographique",
        "proj.waterman": "Papillon de Waterman",
        "proj.winkel3": "Winkel Tripel",
        "proj.globe3d": "Globe 3D (WebGL)",

        "link.about": "à propos",

        "status.downloading": "Téléchargement…",
        "status.rendering": "Dessin du globe…",
        "status.initializing": "Initialisation…",
        "status.locating": "Recherche de votre position…",
        "status.loading3d": "Chargement de la 3D…",
        "status.serverDown": "Serveur indisponible",
        "status.noData": "Pas de données",

        "date.local": "Locale",
        "date.utc": "UTC",
        "coord.west": "O"
    },
    en: {
        "page.title": "earth :: an animated map of global wind and weather",
        "page.description": "an animated map of global wind and weather",

        "label.date": "Date",
        "label.data": "Data",
        "label.scale": "Scale",
        "label.source": "Source",
        "label.time": "Time",
        "label.control": "Control",
        "label.mode": "Mode",
        "label.height": "Height",
        "label.overlay": "Overlay",
        "label.animate": "Animate",
        "label.projection": "Projection",
        "label.language": "Language",

        "menu.title": "menu",
        "nav.now": "Now",
        "nav.now.title": "Current Conditions",
        "nav.backwardMore.title": "Back one day",
        "nav.backward.title": "Back 3 hours",
        "nav.forward.title": "Forward 3 hours",
        "nav.forwardMore.title": "Forward one day",
        "nav.location.title": "Current Position",
        "nav.grid": "Grid",
        "nav.grid.title": "Toggle Grid",
        "time.play.title": "Play forecast",
        "time.slider": "Forecast time",
        "location.close.title": "Close",

        "mode.air": "Air",
        "mode.ocean": "Ocean",
        "height.surface": "Sfc",
        "height.surface.title": "Surface",

        "overlay.none": "None",
        "overlay.wind": "Wind",
        "overlay.wind.title": "Wind Speed",
        "overlay.temp": "Temp",
        "overlay.temp.title": "Temperature",
        "overlay.rh": "RH",
        "overlay.rh.title": "Relative Humidity",
        "overlay.ad": "AD",
        "overlay.ad.title": "Air Density",
        "overlay.wpd": "WPD",
        "overlay.wpd.title": "Wind Power Density",
        "overlay.tpw": "TPW",
        "overlay.tpw.title": "Total Precipitable Water",
        "overlay.tcw": "TCW",
        "overlay.tcw.title": "Total Cloud Water",
        "overlay.mslp": "MSLP",
        "overlay.mslp.title": "Mean Sea Level Pressure",
        "overlay.rain": "Rain",
        "overlay.rain.title": "Precipitation Rate",
        "overlay.snow": "Snow",
        "overlay.snow.title": "Snow Depth",
        "overlay.cape": "CAPE",
        "overlay.cape.title": "CAPE (thunderstorm potential)",
        "overlay.clouds": "Clouds",
        "overlay.clouds.title": "Total Cloud Cover",
        "overlay.pm25": "PM2.5",
        "overlay.pm25.title": "Fine Particulate Matter (PM2.5)",
        "overlay.pm10": "PM10",
        "overlay.pm10.title": "Particulate Matter (PM10)",
        "overlay.aod": "AOD",
        "overlay.aod.title": "Aerosol Optical Depth",
        "overlay.dust": "Dust",
        "overlay.dust.title": "Dust Optical Depth",

        "animate.waves": "Waves",
        "animate.waves.title": "Waves (GFS-Wave)",
        "animate.currents": "Currents",
        "animate.currents.title": "Currents (2014 sample)",
        "overlay.waveHeight": "Height",
        "overlay.waveHeight.title": "Significant Wave Height",
        "overlay.wavePeriod": "Period",
        "overlay.wavePeriod.title": "Peak Wave Period",
        "overlay.currents": "Currents",
        "overlay.currents.title": "Currents",

        "proj.atlantis": "Atlantis",
        "proj.azimuthal_equidistant": "Azimuthal Equidistant",
        "proj.conic_equidistant": "Conic Equidistant",
        "proj.equirectangular": "Equirectangular",
        "proj.orthographic": "Orthographic",
        "proj.stereographic": "Stereographic",
        "proj.waterman": "Waterman Butterfly",
        "proj.winkel3": "Winkel Tripel",
        "proj.globe3d": "3D Globe (WebGL)",

        "link.about": "about",

        "status.downloading": "Downloading...",
        "status.rendering": "Rendering Globe...",
        "status.initializing": "Initializing...",
        "status.locating": "Finding current position...",
        "status.loading3d": "Loading 3D...",
        "status.serverDown": "Server Down",
        "status.noData": "No Data",

        "date.local": "Local",
        "date.utc": "UTC",
        "coord.west": "W"
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
    return {fr: "fr-FR", en: "en-US", ja: "ja-JP"}[current] || undefined;
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
    root.querySelectorAll("[data-i18n-aria]").forEach(el => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
    root.querySelectorAll("[data-lang-choice]").forEach(el => {
        el.classList.toggle("highlighted", el.dataset.langChoice === current);
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
