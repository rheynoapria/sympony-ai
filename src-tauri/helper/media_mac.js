// Sympony's media helper. src-tauri/src/media.rs runs it with `osascript -l JavaScript` and talks JSON lines on
// stdin/out. Spotify: its AppleScript dictionary. "music": whatever macOS says is playing (MediaRemote: any browser,
// Apple Music, …). osascript is Apple-signed, so it may still read MediaRemote on macOS 15.4+, Sympony itself may not.
ObjC.import('Foundation');
ObjC.import('AppKit');
ObjC.import('stdlib');
$.NSBundle.bundleWithPath('/System/Library/PrivateFrameworks/MediaRemote.framework/').load;
ObjC.bindFunction('MRMediaRemoteSendCommand', ['bool', ['int', 'id']]);
ObjC.bindFunction('MRMediaRemoteSetElapsedTime', ['void', ['double']]);
var MR = $.NSClassFromString('MRNowPlayingRequest');

function isNil(o) { return o === null || o === undefined || (typeof o.isNil === 'function' && o.isNil()); }
function str(v) { return v === null || v === undefined ? '' : String(v); }
function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function opt(f) { try { var v = f(); return v === undefined ? null : v; } catch (e) { return null; } }
function describe(e) { return ((e && e.errorNumber) ? e.errorNumber + ' ' : '') + str(e && e.message ? e.message : e); }

var via = 'pid';
var made = {};
function reach(pid, how) {
  pid = Number(pid) || 0;
  if (!pid) return null;
  var ra = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  if (isNil(ra) || ra.isTerminated || ObjC.unwrap(ra.bundleIdentifier) !== 'com.spotify.client') return null;
  var mode = how || via, key = pid + ':' + mode;
  return made[key] || (made[key] = Application(mode === 'pid' ? pid : 'com.spotify.client'));
}

var song = null;
function spotify(a) {
  var o = { state: str(a.playerState()) };
  if (o.state === 'stopped') return o;
  var t = a.currentTrack;
  o.id = str(opt(function () { return t.id(); }));
  if (!song || song.id !== o.id) {
    song = { id: o.id, title: str(opt(function () { return t.name(); })), artist: str(opt(function () { return t.artist(); })),
      album: str(opt(function () { return t.album(); })), duration: num(opt(function () { return t.duration(); })), art: '' };
  }
  if (!song.art) song.art = str(opt(function () { return t.artworkUrl(); }));
  o.title = song.title; o.artist = song.artist; o.album = song.album; o.duration = song.duration; o.art = song.art;
  o.position = num(opt(function () { return a.playerPosition(); }));
  o.shuffle = opt(function () { return a.shuffling(); });
  o.repeat = opt(function () { return a.repeating(); });
  o.canShuffle = opt(function () { return a.shufflingEnabled(); });
  o.canRepeat = opt(function () { return a.repeatingEnabled(); });
  return o;
}

function readSpotify(pid) {
  try { var a = reach(pid); return a ? spotify(a) : null; } catch (e) {
    if (via !== 'pid' || /-174[34]/.test(describe(e))) return { error: describe(e) };
    try { var a2 = reach(pid, 'id'); var r = a2 ? spotify(a2) : null; via = 'id'; return r; } catch (e2) { return { error: describe(e) }; }
  }
}

// The system's now playing item, with the bundle id of the app that plays it.
var K = 'kMRMediaRemoteNowPlayingInfo';
function nowInfo() {
  var item = MR.localNowPlayingItem;
  var info = isNil(item) ? null : item.nowPlayingInfo;
  return info && !isNil(info) ? info : null;
}
function val(info, k) { var v = info.objectForKey(K + k); return isNil(v) ? null : ObjC.deepUnwrap(v); }
function nowPlaying(spotifyPid) {
  var info = nowInfo();
  var path = MR.localNowPlayingPlayerPath;
  var app = isNil(path) ? '' : str(ObjC.unwrap(path.client.bundleIdentifier));
  if (!info || (app === 'com.spotify.client' && Number(spotifyPid))) return { state: 'stopped' };
  var playing = !!MR.localIsPlaying, elapsed = num(val(info, 'ElapsedTime')), rate = num(val(info, 'PlaybackRate'));
  var ts = info.objectForKey(K + 'Timestamp');
  if (playing && !isNil(ts)) elapsed += -ts.timeIntervalSinceNow * (rate || 1);
  var title = str(val(info, 'Title')), artist = str(val(info, 'Artist'));
  var art = info.objectForKey(K + 'ArtworkData');
  // browsers (Brave, Chrome…) hand out a new ContentItemIdentifier every few seconds for the same song, which made
  // its cover reset and be looked up again each time (media.rs art_key): only the Music app's is kept
  var album = str(val(info, 'Album'));
  var id = (app === 'com.apple.Music' && str(val(info, 'ContentItemIdentifier'))) || title + '|' + artist + '|' + album;
  cur = { id: id, title: title, artist: artist };
  return {
    state: playing ? 'playing' : 'paused', id: id,
    title: title, artist: artist, album: album, app: app, duration: num(val(info, 'Duration')),
    arts: app === 'com.apple.Music' || (!isNil(art) && Number(art.length)) ? 1 : 0, position: elapsed, rate: rate, stream: '', shuffle: null, repeat: null,
  };
}

// Online artwork lookups (iTunes / Deezer) run asynchronously in Rust (`artwork.rs`) so this helper never stalls playback commands.
var cur = {};

var CMD = { play: 0, pause: 1, toggle: 2, next: 4, prev: 5 };
function command(req) {
  if (req.app !== 'spotify') {
    if (req.action === 'seek') { $.MRMediaRemoteSetElapsedTime(Math.max(0, num(req.value))); return { ok: true }; }
    return { ok: req.action in CMD && !!$.MRMediaRemoteSendCommand(CMD[req.action], $()) };
  }
  var a = reach(req.pid);
  if (!a) return { ok: false };
  switch (req.action) {
    case 'toggle': a.playpause(); break;
    case 'play': a.play(); break;
    case 'pause': a.pause(); break;
    case 'next': a.nextTrack(); break;
    case 'prev': a.previousTrack(); break;
    case 'seek': a.playerPosition = Math.max(0, num(req.value)); break;
    case 'shuffle': a.shuffling = !a.shuffling(); break;
    case 'repeat': a.repeating = !a.repeating(); break;
    default: return { ok: false };
  }
  return { ok: true };
}

// the now playing artwork, as the file it came in (JPEG or PNG)
function musicArt(req) {
  var info = nowInfo();
  var data = info && info.objectForKey(K + 'ArtworkData');
  if (isNil(data) || !Number(data.length)) {
    // the Music app: its artwork through AppleScript, as the original helper did (asked only while Music runs)
    if (isNil($.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.apple.Music').firstObject)) {
      return { ok: false, error: 'no artwork' };
    }
    var d = $.NSAppleScript.alloc.initWithSource('tell application id "com.apple.Music" to get raw data of artwork 1 of current track').executeAndReturnError(Ref());
    data = isNil(d) ? null : d.data;
  }
  if (isNil(data) || !Number(data.length)) return { ok: false, error: 'no artwork' };
  return { ok: !!data.writeToFileAtomically(str(req.path), true), bytes: Number(data.length) };
}

function handle(req) {
  if (req.op === 'poll') return { spotify: readSpotify(req.spotify), music: Number(req.music) ? nowPlaying(req.spotify) : null, via: via };
  if (req.op === 'cmd') { try { return command(req); } catch (e) { return { ok: false, error: describe(e) }; } }
  if (req.op === 'art') { try { return musicArt(req); } catch (e) { return { ok: false, error: describe(e) }; } }
  return { error: 'unknown request' };
}

function run() {
  var input = $.NSFileHandle.fileHandleWithStandardInput;
  var output = $.NSFileHandle.fileHandleWithStandardOutput;
  var buf = '';
  for (var served = 0; served < 1500;) {
    var chunk = input.availableData;
    if (!Number(chunk.length)) $.exit(0); // the app is gone (JXA gives the length as a string: "0" is truthy)
    buf += ObjC.unwrap($.NSString.alloc.initWithDataEncoding(chunk, $.NSUTF8StringEncoding));
    var nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      var line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      var reply;
      try { reply = handle(JSON.parse(line)); } catch (e) { reply = { error: describe(e) }; }
      output.writeData($(JSON.stringify(reply) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
      served++;
    }
  }
  $.exit(0);
}
