/**
 * places - country names under a point, and place search.
 *
 * Loaded lazily (dynamic import) the first time the user clicks the map or searches, so neither the country
 * shapes (world-atlas, 110m, ~100 KB) nor the names table weigh on the initial page load.
 *
 * Search uses OpenStreetMap's Nominatim service. Its usage policy forbids search-as-you-type, so a query is
 * only sent when the user submits it, and never more than once per second.
 */
import * as d3 from "d3";
import { feature } from "topojson-client";
import countries from "i18n-iso-countries";
import fr from "i18n-iso-countries/langs/fr.json";
import en from "i18n-iso-countries/langs/en.json";
import ja from "i18n-iso-countries/langs/ja.json";
import countriesUrl from "world-atlas/countries-110m.json?url";

countries.registerLocale(fr);
countries.registerLocale(en);
countries.registerLocale(ja);

let shapes = null;

function loadShapes() {
    shapes ??= fetch(countriesUrl).then(r => r.json()).then(topo => feature(topo, topo.objects.countries).features);
    return shapes;
}

/**
 * @returns {Promise<String|null>} the name of the country at [λ, φ] in the given language, or null at sea.
 */
export async function countryAt(coord, lang = "fr") {
    const features = await loadShapes();
    const hit = features.find(f => d3.geoContains(f, coord));
    if (!hit) return null;
    return countries.getName(hit.id, lang) || hit.properties.name;
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
let lastQuery = 0;

/**
 * @returns {Promise<Array>} up to 5 places matching the text: [{name, detail, coord: [λ, φ]}].
 */
export async function searchPlaces(text, lang = "fr") {
    const q = text.trim();
    if (q.length < 2) return [];
    const wait = lastQuery + 1000 - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastQuery = Date.now();
    const url = `${NOMINATIM}?format=jsonv2&limit=5&accept-language=${lang}&q=${encodeURIComponent(q)}`;
    const response = await fetch(url, {headers: {"Accept": "application/json"}});
    if (!response.ok) throw new Error("HTTP " + response.status);
    const results = await response.json();
    return results.map(r => {
        const parts = r.display_name.split(", ");
        return {name: parts[0], detail: parts.slice(1).slice(-2).join(", "), coord: [+r.lon, +r.lat]};
    });
}
