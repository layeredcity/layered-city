// Shared media-type glyph paths. Kept out of App.jsx so MapboxMap.jsx — which
// builds its pins as raw DOM, not JSX — can draw the same shapes without a
// circular import back through App.
export const MUSIC_GLYPH_VIEWBOX = '0 0 48 48'
export const MUSIC_GLYPH_PATH = 'M45.5187 3.8627c0 -1.9293 -1.5643 -3.5072 -3.5263 -3.375 -4.9154 0.3314 -15.1165 1.5216 -24.8825 5.8116 -1.9194 0.8432 -3.0713 2.7731 -3.0713 4.8372v8.6489c0 0.0062 0.0001 0.0124 0.0004 0.0187v9.1341c-0.6836 -0.157 -1.3952 -0.24 -2.1256 -0.24 -5.2091 0 -9.434 4.2122 -9.434 9.4109s4.2249 9.4109 9.434 9.4109c5.209 0 9.434 -4.2122 9.434 -9.4109 0 -0.1382 -0.003 -0.2759 -0.0089 -0.4127 0.0049 -0.0281 0.0074 -0.057 0.0074 -0.0866V17.6066c6.6525 -2.3284 12.5931 -3.4611 16.8603 -4.0115v10.0862c-0.6735 -0.1532 -1.374 -0.2339 -2.093 -0.2339 -5.1958 0 -9.4075 4.2136 -9.4075 9.4109s4.2117 9.4109 9.4075 9.4109c5.1957 0 9.4074 -4.2137 9.4074 -9.4109 0 -0.1492 -0.0035 -0.2976 -0.0103 -0.4451 0.0019 -0.0179 0.0028 -0.0359 0.0028 -0.0542V12.6501c0.0037 -0.0245 0.0056 -0.0493 0.0056 -0.0744v-8.713Z'

// Inline SVG markup for the music note, for consumers that need an HTML string
// (map pins). `color` sets the fill via currentColor on the wrapper.
export function musicGlyphMarkup(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" fill="none" viewBox="${MUSIC_GLYPH_VIEWBOX}"><path fill="currentColor" fill-rule="evenodd" d="${MUSIC_GLYPH_PATH}" clip-rule="evenodd"/></svg>`
}
