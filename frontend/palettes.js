// The music colours for a song without album art (Settings → Media → Colors without album art): what the notch paints
// its accent with then (the art tile, visualizer, progress, glow and the Gradient Waves); with album art they always
// come from the art. A solid is one colour three times; a gradient is three. Used by notch.js and settings.js.
window.SYMPONY_PALETTES = {
  // solid
  white: { name: 'White', c: [[245, 245, 247], [245, 245, 247], [245, 245, 247]] },
  blue: { name: 'Blue', c: [[10, 132, 255], [10, 132, 255], [10, 132, 255]] },
  purple: { name: 'Purple', c: [[175, 82, 222], [175, 82, 222], [175, 82, 222]] },
  pink: { name: 'Pink', c: [[255, 55, 95], [255, 55, 95], [255, 55, 95]] },
  green: { name: 'Green', c: [[48, 209, 88], [48, 209, 88], [48, 209, 88]] },
  orange: { name: 'Orange', c: [[255, 159, 10], [255, 159, 10], [255, 159, 10]] },
  // gradients
  ocean: { name: 'Ocean', c: [[99, 102, 241], [59, 130, 246], [45, 212, 191]] },
  aurora: { name: 'Aurora', c: [[139, 92, 246], [34, 211, 238], [52, 211, 153]] },
  sunset: { name: 'Sunset', c: [[244, 114, 182], [251, 146, 60], [250, 204, 21]] },
  fire: { name: 'Fire', c: [[239, 68, 68], [249, 115, 22], [250, 204, 21]] },
  forest: { name: 'Forest', c: [[22, 163, 74], [132, 204, 22], [45, 212, 191]] },
  candy: { name: 'Candy', c: [[236, 72, 153], [168, 85, 247], [96, 165, 250]] },
  neon: { name: 'Neon', c: [[217, 70, 239], [59, 130, 246], [16, 185, 129]] },
};
