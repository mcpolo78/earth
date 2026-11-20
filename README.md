earth (fork modernisé)
======================

Fork privé de [cambecc/earth](https://github.com/cambecc/earth), la carte animée des vents et de la météo
mondiale, remis à niveau : Vite, modules ES, D3 v7, et un nouveau script de récupération des données GFS.

Démarrer
--------

Prérequis : Node.js 20 ou plus, Python 3.10 ou plus.

    npm install
    python -m pip install -r scripts/requirements.txt
    npm run data          # télécharge les dernières données GFS (environ 20 secondes)
    npm run dev           # puis ouvrir http://localhost:8080

Autres commandes :

    npm run data -- --hours 0-24:3     # prévisions toutes les 3 h sur 24 h (navigation ‹ › dans le menu)
    npm run data -- --run 2026112006   # un run précis (aaaammjjhh)
    npm test                           # tests unitaires (Vitest)
    npm run build && npm run preview   # version de production dans dist/

Sous Windows, si `python` n'est pas trouvé, remplacer par `py` (par exemple `py scripts/fetch_gfs.py`).

Données météo
-------------

`scripts/fetch_gfs.py` lit le [GFS](https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast)
de la NOAA sur le bucket public AWS `noaa-gfs-bdp-pds`. Il ne télécharge que les messages GRIB2 utiles grâce
aux fichiers `.idx` (requêtes HTTP partielles), les décode avec [ecCodes](https://github.com/ecmwf/eccodes),
puis écrit le même format JSON qu'utilisait l'ancien outil Java `grib2json`. La densité de l'air est calculée
à partir de la température (loi des gaz parfaits). Les fichiers produits vont dans `public/data/weather/`,
qui n'est pas versionné.

Ce qui a changé par rapport à l'original
----------------------------------------

* Vite remplace le serveur Express et Grunt ; plus de dépendance chargée depuis un CDN.
* Code en modules ES (`src/`), D3 v3 → D3 v7 (+ d3-geo-projection, d3-geo-polygon), topojson-client.
* underscore, backbone et when.js supprimés : un petit `Emitter` (`src/events.js`) et les Promises natives.
* Le globe se redimensionne avec la fenêtre.
* Tests QUnit remplacés par Vitest (`test/`).

---

*Le texte ci-dessous vient du README d'origine.*

getting map data
----------------

Map data is provided by [Natural Earth](http://www.naturalearthdata.com) but must be converted to
[TopoJSON](https://github.com/mbostock/topojson/wiki) format. We make use of a couple different map scales: a
simplified, larger scale for animation and a more detailed, smaller scale for static display. After installing
[GDAL](http://www.gdal.org/) and TopoJSON (see [here](http://bost.ocks.org/mike/map/#installing-tools)), the
following commands build these files:

    curl "http://www.nacis.org/naturalearth/50m/physical/ne_50m_coastline.zip" -o ne_50m_coastline.zip
    curl "http://www.nacis.org/naturalearth/50m/physical/ne_50m_lakes.zip" -o ne_50m_lakes.zip
    curl "http://www.nacis.org/naturalearth/110m/physical/ne_110m_coastline.zip" -o ne_110m_coastline.zip
    curl "http://www.nacis.org/naturalearth/110m/physical/ne_110m_lakes.zip" -o ne_110m_lakes.zip
    unzip -o ne_\*.zip
    ogr2ogr -f GeoJSON coastline_50m.json ne_50m_coastline.shp
    ogr2ogr -f GeoJSON coastline_110m.json ne_110m_coastline.shp
    ogr2ogr -f GeoJSON -where "scalerank < 4" lakes_50m.json ne_50m_lakes.shp
    ogr2ogr -f GeoJSON -where "scalerank < 2 AND admin='admin-0'" lakes_110m.json ne_110m_lakes.shp
    ogr2ogr -f GeoJSON -simplify 1 coastline_tiny.json ne_110m_coastline.shp
    ogr2ogr -f GeoJSON -simplify 1 -where "scalerank < 2 AND admin='admin-0'" lakes_tiny.json ne_110m_lakes.shp
    topojson -o earth-topo.json coastline_50m.json coastline_110m.json lakes_50m.json lakes_110m.json
    topojson -o earth-topo-mobile.json coastline_110m.json coastline_tiny.json lakes_110m.json lakes_tiny.json
    cp earth-topo*.json <earth-git-repository>/public/data/

font subsetting
---------------

This project uses [M+ FONTS](http://mplus-fonts.sourceforge.jp/). To reduce download size, a subset font is
constructed out of the unique characters utilized by the site. See the `earth/server/font/findChars.js` script
for details. Font subsetting is performed by the [M+Web FONTS Subsetter](http://mplus.font-face.jp/), and
the resulting font is placed in `earth/public/styles`.

[Mono Social Icons Font](http://drinchev.github.io/monosocialiconsfont/) is used for scalable, social networking
icons. This can be subsetted using [Font Squirrel's WebFont Generator](http://www.fontsquirrel.com/tools/webfont-generator).

implementation notes
--------------------

Building this project required solutions to some interesting problems. Here are a few:

   * The GFS grid has a resolution of 1°. Intermediate points are interpolated in the browser using [bilinear
     interpolation](http://en.wikipedia.org/wiki/Bilinear_interpolation). This operation is quite costly.
   * Each type of projection warps and distorts the earth in a particular way, and the degree of distortion must
     be calculated for each point (x, y) to ensure wind particle paths are rendered correctly. For example,
     imagine looking at a globe where a wind particle is moving north from the equator. If the particle starts
     from the center, it will trace a path straight up. However, if the particle starts from the globe's edge,
     it will trace a path that curves toward the pole. [Finite difference approximations](http://gis.stackexchange.com/a/5075/23451)
     are used to estimate this distortion during the interpolation process.
   * The SVG map of the earth is overlaid with an HTML5 Canvas, where the animation is drawn. Another HTML5
     Canvas sits on top and displays the colored overlay. Both canvases must know where the boundaries of the
     globe are rendered by the SVG engine, but this pixel-for-pixel information is difficult to obtain directly
     from the SVG elements. To workaround this problem, the globe's bounding sphere is re-rendered to a
     detached Canvas element, and the Canvas' pixels operate as a mask to distinguish points that lie outside
     and inside the globe's bounds.
   * Most configuration options are persisted in the hash fragment to allow deep linking and back-button
     navigation. I use a [backbone.js Model](http://backbonejs.org/#Model) to represent the configuration.
     Changes to the model persist to the hash fragment (and vice versa) and trigger "change" events which flow to
     other components.
   * Components use [backbone.js Events](http://backbonejs.org/#Events) to trigger changes in other downstream
     components. For example, downloading a new layer produces a new grid, which triggers reinterpolation, which
     in turn triggers a new particle animator. Events flow through the page without much coordination,
     sometimes causing visual artifacts that (usually) quickly disappear.
   * There's gotta be a better way to do this. Any ideas?

inspiration
-----------

The awesome [hint.fm wind map](http://hint.fm/wind/) and [D3.js visualization library](http://d3js.org) provided
the main inspiration for this project.
