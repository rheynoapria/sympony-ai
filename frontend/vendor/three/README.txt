three.js r186 (MIT, see LICENSE), bundled as a classic script that sets window.THREE:
  printf "import * as THREE from './three.module.js';\nwindow.THREE = THREE;\n" > entry.js
  bun build entry.js --format=iife --minify --outfile=three.min.js
Used by frontend/pony.js to render Pony in 3D (falls back to its 2D drawing without it).
