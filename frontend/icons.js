// Icons: Font Awesome Free 6 (bundled locally in vendor/fontawesome, loaded via its CSS).
const fa = (name, style = 'solid') => `<i class="fa-${style} fa-${name}" aria-hidden="true"></i>`;
window.fa = fa;

window.ICONS = {
  home: fa('house'),
  tray: fa('inbox'),
  stats: fa('gauge-high'),
  gear: fa('gear'),
  play: fa('play'),
  pause: fa('pause'),
  next: fa('forward'),
  prev: fa('backward'),
  shuffle: fa('shuffle'),
  repeat: fa('repeat'),
  repeatOne: `<span class="fa-stack-one">${fa('repeat')}<b>1</b></span>`,
  music: fa('music'),
  camera: fa('camera'),
  video: fa('video'),
  calendar: fa('calendar', 'regular'),
  plus: fa('plus'),
  x: fa('xmark'),
  share: fa('share-from-square'),
  folder: fa('folder-open'),
  copy: fa('copy', 'regular'),
  open: fa('up-right-from-square'),
  trash: fa('trash-can', 'regular'),
  link: fa('link'),
  text: fa('align-left'),
  bolt: fa('bolt'),
  plug: fa('plug'),
  volMute: fa('volume-xmark'),
  volLow: fa('volume-off'),
  volMid: fa('volume-low'),
  volHigh: fa('volume-high'),
  sun: fa('sun'),
  sunDim: fa('sun', 'regular'),
  cpu: fa('microchip'),
  memory: fa('memory'),
  disk: fa('hard-drive'),
  net: fa('wifi'),
  arrowDown: fa('arrow-down'),
  arrowUp: fa('arrow-up'),
  pin: fa('thumbtack'),
  file: fa('file', 'regular'),
};

// Module tab icons.
window.MODULE_ICONS = {
  home: fa('house'),
  calendar: fa('calendar-days'),
  prayer: fa('mosque'),
  control: fa('sliders'),
  shelf: fa('inbox'),
  todo: fa('list-check'),
  notes: fa('note-sticky', 'regular'),
  pomodoro: fa('stopwatch'),
  weather: fa('cloud-sun'),
  health: fa('heart-pulse'),
  screentime: fa('hourglass-half'),
  dayprogress: fa('chart-gantt'),
  bluetooth: fa('bluetooth-b', 'brands'),
  stats: fa('gauge-high'),
  translate: fa('language'),
  chat: fa('wand-magic-sparkles'),
  github: fa('github', 'brands'),
  feed: fa('rss'),
  radio: fa('radio'),
  bookmarks: fa('bookmark'),
  aiusage: fa('gauge'),
  worldclock: fa('earth-asia'),
  teleprompter: fa('scroll'),
  launcher: fa('rocket'),
  notifs: fa('bell'),
};

window.MODULE_TITLES = {
  home: _t('Home'), calendar: _t('Calendar'), prayer: _t('Prayer Times'), control: _t('Control'), shelf: _t('Shelf'), todo: _t('Todo'), notes: _t('Notes'), pomodoro: _t('Pomodoro'),
  weather: _t('Weather'), health: _t('Health'), screentime: _t('Screen Time'), dayprogress: _t('Day Progress'),
  bluetooth: _t('Bluetooth & Wi-Fi'), stats: _t('System'), translate: _t('Translate'), chat: _t('Pony'), github: 'GitHub', feed: _t('Feed & RSS'),
  radio: _t('Radio'),
  bookmarks: _t('Bookmarks'),
  aiusage: _t('AI usage'),
  worldclock: _t('World clock'),
  teleprompter: _t('Teleprompter'),
  launcher: _t('Launcher'),
  notifs: _t('Notifications'),
};
// shorter names where the active tab shows its name
window.MODULE_SHORT = { bluetooth: 'Bluetooth', prayer: _t('Prayer'), feed: _t('Feed') };
// Linux: the Bluetooth & Wi-Fi tab is the Speed test alone (modules/bluetooth.js); a Mac has all three
if (window.SYMPONY_OS === 'linux') {
  window.MODULE_ICONS.bluetooth = fa('gauge-high');
  window.MODULE_TITLES.bluetooth = _t('Speed test');
  window.MODULE_SHORT.bluetooth = _t('Speed test');
}

// WMO weather codes (Open-Meteo) -> icon + label.
window.weatherIcon = (code, day = true) => {
  if (code === 0) return day ? fa('sun') : fa('moon');
  if (code === 1 || code === 2) return day ? fa('cloud-sun') : fa('cloud-moon');
  if (code === 3) return fa('cloud');
  if (code === 45 || code === 48) return fa('smog');
  if (code >= 51 && code <= 57) return fa('cloud-rain');
  if (code >= 61 && code <= 67) return fa('cloud-showers-heavy');
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return fa('snowflake');
  if (code >= 80 && code <= 82) return fa('cloud-sun-rain');
  if (code >= 95) return fa('cloud-bolt');
  return fa('cloud');
};
window.weatherLabel = (code) => ({
  0: _t('Clear|weather'), 1: _t('Mostly clear'), 2: _t('Partly cloudy'), 3: _t('Overcast'), 45: _t('Fog'), 48: _t('Rime fog'),
  51: _t('Light drizzle'), 53: _t('Drizzle'), 55: _t('Heavy drizzle'), 56: _t('Freezing drizzle'), 57: _t('Freezing drizzle'),
  61: _t('Light rain'), 63: _t('Rain'), 65: _t('Heavy rain'), 66: _t('Freezing rain'), 67: _t('Freezing rain'),
  71: _t('Light snow'), 73: _t('Snow'), 75: _t('Heavy snow'), 77: _t('Snow grains'), 80: _t('Rain showers'), 81: _t('Rain showers'),
  82: _t('Violent showers'), 85: _t('Snow showers'), 86: _t('Snow showers'), 95: _t('Thunderstorm'), 96: _t('Thunderstorm, hail'), 99: _t('Thunderstorm, hail'),
}[code] || _t('Cloudy'));

window.DEVICE_ICONS = {
  headphones: fa('headphones'), speaker: fa('volume-high'), mouse: fa('computer-mouse'), keyboard: fa('keyboard'),
  gamepad: fa('gamepad'), phone: fa('mobile-screen'), computer: fa('laptop'), watch: fa('clock'), device: fa('bluetooth-b', 'brands'),
};
