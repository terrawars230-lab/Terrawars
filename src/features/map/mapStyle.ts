/**
 * The Nocturne map style.
 *
 * The design prototype fakes the map with an SVG street grid; this is the real
 * thing translated into Google's style schema, so the tiles under the parcels
 * are the same ground the HUD was drawn against.
 *
 * Every colour here is a Nocturne token pre-composited onto the map ground:
 * Google's styler takes flat hex only — no alpha, no `color-mix` — so the
 * design's `rgba(233,233,237,.075)` street over `#0c0d17` is resolved to the
 * hex it produces. That is why these are literals rather than theme reads, and
 * why they are all in this one file: retuning the ground means recomputing the
 * composite, not editing a colour in six places.
 *
 * The other job this does is subtraction. Google's default map is dense with
 * business POIs, transit icons and road shields, all of which compete with the
 * parcels — and the parcels are the product (NFR-03 also thanks us for the
 * missing label layers). What survives is roads, water, parks and place names.
 */

/** The composite base: Nocturne's map ground. */
const GROUND = '#0c0d17';
/** Ground + text @ 7.5% — the design's major streets. */
const ROAD_MAJOR = '#1d1e27';
/** Ground + text @ 4% — minor streets. */
const ROAD_MINOR = '#151620';
/** Ground + the design's river blue @ 16%. */
const WATER = '#181e2e';
/** Ground + the design's park green @ 13%. */
const PARK = '#181f23';
/** Map labels sit at the muted end of the text ramp so parcels stay dominant. */
const LABEL = '#8f909e';
const LABEL_STROKE = '#0c0d17';

export const NOCTURNE_MAP_STYLE = [
  {elementType: 'geometry', stylers: [{color: GROUND}]},
  {elementType: 'labels.text.fill', stylers: [{color: LABEL}]},
  {elementType: 'labels.text.stroke', stylers: [{color: LABEL_STROKE}]},
  // Icon glyphs are removed wholesale: a coloured pin sitting inside a
  // territory polygon reads as part of the game when it is a coffee shop.
  {elementType: 'labels.icon', stylers: [{visibility: 'off'}]},

  {featureType: 'administrative', elementType: 'geometry', stylers: [{visibility: 'off'}]},
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{color: LABEL}],
  },

  // POIs go, parks stay: a park is a place you can actually walk a loop around,
  // so it is game information rather than clutter.
  {featureType: 'poi', stylers: [{visibility: 'off'}]},
  {featureType: 'poi.park', elementType: 'geometry', stylers: [{color: PARK}, {visibility: 'on'}]},

  {featureType: 'road', elementType: 'geometry', stylers: [{color: ROAD_MINOR}]},
  {featureType: 'road', elementType: 'labels', stylers: [{visibility: 'off'}]},
  {featureType: 'road.arterial', elementType: 'geometry', stylers: [{color: ROAD_MAJOR}]},
  {featureType: 'road.highway', elementType: 'geometry', stylers: [{color: ROAD_MAJOR}]},
  // The one road label kept: street names are how a walker plans a route, and
  // they only appear once you are zoomed in far enough for parcels anyway.
  {
    featureType: 'road.arterial',
    elementType: 'labels.text.fill',
    stylers: [{color: LABEL}, {visibility: 'on'}],
  },

  {featureType: 'transit', stylers: [{visibility: 'off'}]},
  {featureType: 'water', elementType: 'geometry', stylers: [{color: WATER}]},
  {featureType: 'water', elementType: 'labels.text.fill', stylers: [{color: LABEL}]},
];
