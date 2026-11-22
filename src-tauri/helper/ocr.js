// Sympony's Eyes, the fallback for windows without names (canvas, pictures of text): the text in a picture of the
// window, read on this Mac by Vision. `osascript -l JavaScript ocr.js <png>` → [[text, x, y, w, h], …] with boxes
// normalized and their origin at the bottom left (src-tauri/src/eyes.rs, services::eyes::spots).
ObjC.import('Vision');
ObjC.import('Foundation');
function run(argv) {
  try {
    const req = $.VNRecognizeTextRequest.alloc.init;
    req.recognitionLevel = 0; // accurate (about 1 s; the first run of a session loads the model)
    req.usesLanguageCorrection = true;
    const h = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(argv[0]), $({}));
    h.performRequestsError($([req]), null);
    const res = req.results;
    const out = [];
    for (let i = 0; i < res.count; i++) {
      const o = res.objectAtIndex(i);
      const c = o.topCandidates(1).objectAtIndex(0);
      const b = o.boundingBox;
      out.push([ObjC.unwrap(c.string), b.origin.x, b.origin.y, b.size.width, b.size.height]);
    }
    return JSON.stringify(out);
  } catch (e) {
    return JSON.stringify({ error: String(e && e.message ? e.message : e) });
  }
}
