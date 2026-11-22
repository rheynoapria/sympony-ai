// Sympony's YouTube video mode: the tabs of one browser as [[address, title], …] (src-tauri/src/youtube.rs runs
// `osascript -l JavaScript yt_tabs.js <bundle id>` only after macOS allowed Sympony to automate that browser).
function run(argv) {
  var id = String(argv[0] || '');
  try {
    var app = Application(id);
    var urls = app.windows.tabs.url();
    var titles = id === 'com.apple.Safari' ? app.windows.tabs.name() : app.windows.tabs.title();
    // only video tabs go back (youtube.rs pick_tab): small output, and no other tab's address or title leaves here
    var video = /^https?:\/\/((www|m)\.youtube\.com\/watch\?|youtu\.be\/)/;
    var out = [];
    for (var w = 0; w < urls.length; w++)
      for (var t = 0; t < urls[w].length; t++) {
        var u = String(urls[w][t] || '');
        if (video.test(u)) out.push([u, String((titles[w] || [])[t] || '')]);
      }
    return JSON.stringify(out);
  } catch (e) {
    return JSON.stringify({ error: ((e && e.errorNumber) ? e.errorNumber + ' ' : '') + String(e && e.message ? e.message : e) });
  }
}
