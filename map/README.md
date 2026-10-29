# Slop Cities world map

Every city in the [list](../README.md) on a low-poly world map, as a three.js globe (the default view), a flat map (SVG; Patterson by default, Equal Earth in Layers), or both side by side (**Compare**, with the two views linked). Pins open a card with every take on that city; the lineage arcs run from Slop New York to every city built on its code (cities marked *(own engine)* get none; and from Slop Singapore to Kahramanmaraş, which says it adapts both).

Both views use the same ~10k points on the sphere, the same heights and the same facet colours, so the facets match between the flat map and the globe.

## Rebuilding the data

```sh
node map/build/build-cities.mjs   # README.md -> map/data/cities.json (fails if a city has no coordinates)
node map/build/build-grid.mjs     # terrain + coastlines -> map/data/elev.bin.gz
```

Add coordinates for a new city to `COORDS` in `build/build-cities.mjs`. Terrain comes from the [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (zoom 3) and land/lakes from [Natural Earth](https://www.naturalearthdata.com/) 50m; both are downloaded into `build/.cache/`.

Keys: `1` `2` `3` switch Globe / Map / Compare, `/` searches, `M` turns the music on or off, `Esc` clears the selection.

**Music** is lo-fi made live in the browser with Web Audio (`js/music.js`): a slow ii-V-I-vi in F on a soft electric piano, bass, brushed drums on a swing, vinyl crackle and tape wobble. There are no audio files; the comping, fills and melody are drawn at random each bar.
