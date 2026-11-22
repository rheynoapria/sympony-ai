import type { Opt, Row } from "../rows/types.ts";

export const TODO_KEYS: readonly string[] = [
  "todoSyncGoogleClientId",
  "todoSyncMsClientId",
];

export const POMODORO_KEYS: readonly string[] = ["timerPresets"];
export const CALENDAR_KEYS: readonly string[] = ["icsFeeds", "localEvents"];
export const WEATHER_KEYS: readonly string[] = ["weatherLocation"];
export const PRAYER_KEYS: readonly string[] = [
  "prayerList",
  "prayerLocation",
  "prayerKemenag",
  "adhanOn",
  "adhanFile",
  "adhanFajrFile",
  "adhanVolume",
];

export const PRAYER_METHODS: readonly Opt[] = [
  ["auto", "Automatic: the authority for your location"],
  ["20", "Kemenag RI (Indonesia)"],
  ["17", "JAKIM (Malaysia)"],
  ["11", "MUIS (Singapore)"],
  ["13", "Diyanet (Türkiye)"],
  ["4", "Umm al-Qura (Makkah)"],
  ["3", "Muslim World League"],
  ["2", "ISNA (North America)"],
  ["5", "Egyptian General Authority of Survey"],
  ["1", "University of Islamic Sciences, Karachi"],
  ["16", "Dubai"],
  ["8", "Gulf Region"],
  ["9", "Kuwait"],
  ["10", "Qatar"],
  ["12", "UOIF (France)"],
  ["14", "Spiritual Administration of Muslims of Russia"],
  ["21", "Morocco"],
  ["23", "Jordan"],
  ["18", "Tunisia"],
  ["19", "Algeria"],
  ["22", "Portugal"],
];

export const TODO_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "Give a task a time with the clock button (or end it with 15m, 2h or 14:30) and Sympony counts it down in the closed notch and alerts when it’s due. In the same picker, <b>Repeat</b> makes it come back on the days and at the time you choose: tick it off and the next one appears. Pony can set them too (“ingetin minum obat tiap hari jam 8”).",
  },
  {
    t: "select",
    k: "todoLateMinutes",
    label: "Mark late tasks as done",
    sub: "This long past its time, a task is ticked off by itself and moves to Done (open it there to bring it back); a repeating one comes back for its next time. For all tasks, except those with their own choice: in the Todo tab’s clock picker, <b>Done if late</b>.",
    options: [
      [0, "Off: keep them until I tick them off"],
      [1, "1 minute after their time"],
      [3, "3 minutes after their time"],
      [5, "5 minutes after their time"],
      [10, "10 minutes after their time"],
      [30, "30 minutes after their time"],
      [60, "1 hour after their time"],
    ],
  },
  {
    t: "select",
    k: "todoSync",
    label: "Sync with",
    sub: "Keeps your tasks here and one list in Microsoft To Do or Google Tasks the same, both ways: new tasks, names, done, due days and deletes. Google Tasks keeps only the day of a due time (Sympony keeps the time); To Do gets the time as a reminder, and a repeat when it fits.",
    options: [
      ["off", "Off"],
      ["microsoft", "Microsoft To Do"],
      ["google", "Google Tasks"],
    ],
  },
  { t: "custom", id: "todoSync" },
  {
    t: "select",
    k: "todoSnoozeMinutes",
    label: "Snooze a due task for",
    sub: "When a task is due, the closed notch has a snooze button next to its check: it moves the task this far ahead, and Sympony alerts again then. A repeating task keeps its repeat.",
    options: [
      [5, "5 minutes"],
      [10, "10 minutes"],
      [15, "15 minutes"],
      [30, "30 minutes"],
      [60, "1 hour"],
    ],
  },
  {
    t: "range",
    k: "todoTrashDays",
    label: "Keep deleted tasks in Trash for",
    min: 1,
    max: 30,
    step: 1,
    unit: "days",
  },
];

export const POMODORO_ROWS: readonly Row[] = [
  { t: "range", k: "pomoWork", label: "Focus", min: 5, max: 90, step: 5, unit: "min" },
  { t: "range", k: "pomoShort", label: "Short break", min: 1, max: 30, step: 1, unit: "min" },
  { t: "range", k: "pomoLong", label: "Long break", min: 5, max: 60, step: 5, unit: "min" },
  {
    t: "range",
    k: "pomoCycles",
    label: "Focus sessions before a long break",
    min: 2,
    max: 8,
    step: 1,
    unit: "",
  },
  { t: "toggle", k: "pomoAutoBreak", label: "Start breaks automatically" },
  { t: "toggle", k: "pomoAutoWork", label: "Start focus automatically after a break" },
  {
    t: "toggle",
    k: "pomoSound",
    label: "Completion sound",
    sub: "The Timer’s too. Quiet while Windows’ Do not disturb is on.",
  },
  { t: "h2", text: "Background sound" },
  {
    t: "select",
    k: "focusSound",
    label: "Sound while you focus",
    sub: "Fades in while a focus session runs and out when it’s paused or ends. Made by Sympony itself, nothing is downloaded. The headphones button in the Pomodoro tab changes it too.",
    options: [
      ["off", "Off"],
      ["white", "White noise"],
      ["pink", "Pink noise"],
      ["brown", "Brown noise"],
      ["rain", "Rain"],
      ["waves", "Ocean waves"],
      ["wind", "Wind"],
      ["fire", "Fireplace"],
    ],
  },
  {
    t: "range",
    k: "focusSoundVolume",
    label: "Volume",
    sub: "Changing the sound or its volume plays it for a few seconds.",
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
  },
  {
    t: "toggle",
    k: "focusSoundBreaks",
    label: "Keep playing in breaks",
    sub: "Off: it fades out when a break starts and comes back with the next focus session.",
  },
  { t: "h2", text: "Timer" },
  {
    t: "custom",
    id: "timerPresets",
    label: "Presets",
    sub: "The lengths under the Timer’s wheel, in minutes (1 to 600, up to 8). A click on one there sets the wheel.",
    spot: "timer",
  },
  {
    t: "toggle",
    k: "timerRemember",
    label: "Remember the last duration",
    sub: "The Timer’s wheel opens at the length you last started. Off: at the first preset.",
  },
  {
    t: "toggle",
    k: "timerThenBreak",
    label: "Start a break after the timer",
    sub: "When the Timer ends, Pomodoro’s short break starts (unless a Pomodoro is running).",
  },
];

export const HEALTH_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "Desk wellbeing: three daily rings for breaks, water and mindful minutes. Stepping away from your PC for 5 minutes, or locking it for 2, counts as a break. Nothing leaves this PC.",
  },
  { t: "toggle", k: "healthEnabled", label: "Track health" },
  {
    t: "range",
    k: "healthWaterGoal",
    label: "Water goal",
    min: 2,
    max: 16,
    step: 1,
    unit: "glasses",
  },
  {
    t: "range",
    k: "healthBreakGoal",
    label: "Break goal",
    min: 1,
    max: 16,
    step: 1,
    unit: "breaks",
  },
  {
    t: "range",
    k: "healthMindfulGoal",
    label: "Mindful minutes goal",
    min: 1,
    max: 30,
    step: 1,
    unit: "min",
  },
  { t: "h2", text: "Reminders" },
  { t: "toggle", k: "healthBreakReminders", label: "Remind me to take a break" },
  {
    t: "range",
    k: "healthBreakInterval",
    label: "After working continuously for",
    min: 15,
    max: 120,
    step: 5,
    unit: "min",
  },
  {
    t: "toggle",
    k: "healthWaterReminders",
    label: "Remind me to drink water",
    sub: "Sympony chimes and shows “Time for a glass of water” with today’s count. Counted while you’re at the PC, from the last glass you logged. Click it to open Health and add the glass. Reminders stop once the day’s goal is reached and start again the next day.",
  },
  {
    t: "range",
    k: "healthWaterInterval",
    label: "Water reminder every",
    min: 5,
    max: 180,
    step: 5,
    unit: "min",
  },
  {
    t: "toggle",
    k: "healthEyeBreaks",
    label: "20-20-20 eye breaks",
    sub: "Now and then (Eye break every, below), the screen dims and asks you to look 20 feet away for a moment. Skip anytime with Esc.",
  },
  {
    t: "range",
    k: "healthEyeInterval",
    label: "Eye break every",
    min: 10,
    max: 60,
    step: 5,
    unit: "min",
  },
  {
    t: "range",
    k: "healthEyeDuration",
    label: "Eye break length",
    min: 10,
    max: 60,
    step: 5,
    unit: "s",
  },
];

export const SCREENTIME_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "Counts time in the foreground app (idle time excluded) and app switches. Browser tabs are categorised by their title. Data stays in <code>screentime.json</code> on this PC (35 days).",
  },
  { t: "toggle", k: "screenTimeEnabled", label: "Track screen time" },
  {
    t: "range",
    k: "screenTimeIdle",
    label: "Stop counting after idle",
    min: 30,
    max: 600,
    step: 30,
    unit: "s",
  },
  {
    t: "list",
    k: "screenTimeExcluded",
    label: "Excluded apps",
    sub: "Comma-separated .exe names, e.g. keepass.exe, steam.exe",
  },
];

export const DAYPROGRESS_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "One timeline for today, from when you wake up to bedtime, with calendar events and completed tasks.",
  },
  { t: "time", k: "wakeTime", label: "Day starts" },
  { t: "time", k: "bedTime", label: "Bedtime" },
];

export const BLUETOOTH_ROWS: readonly Row[] = [
  {
    t: "toggle",
    k: "bluetoothEnabled",
    label: "Bluetooth devices & battery",
    sub: "Shows a device when it connects or disconnects, and when its battery runs low",
  },
  {
    t: "range",
    k: "bluetoothLowBattery",
    label: "Low battery alert at",
    min: 5,
    max: 50,
    step: 5,
    unit: "%",
  },
  { t: "custom", id: "btDevices" },
];

export const CALENDAR_ROWS: readonly Row[] = [
  { t: "toggle", k: "calendarEnabled", label: "Show calendar" },
  {
    t: "range",
    k: "meetingReminderMinutes",
    label: "Meeting reminder",
    sub: "Sympony pops up this many minutes before an event (0 = off)",
    min: 0,
    max: 30,
    step: 1,
    unit: "min",
  },
  { t: "h2", text: "Subscribed calendars (iCal / .ics)" },
  {
    t: "lead",
    html: "<b>Google Calendar:</b> Settings → your calendar → <i>Integrate calendar</i> → copy <i>Secret address in iCal format</i>.",
  },
  {
    t: "lead",
    html: "<b>Outlook.com / Microsoft 365:</b> Settings → Calendar → Shared calendars → <i>Publish a calendar</i> → copy the ICS link.",
  },
  {
    t: "lead",
    html: "<b>iCloud:</b> share the calendar as <i>Public Calendar</i> and copy the webcal:// link.",
  },
  {
    t: "custom",
    id: "icsFeeds",
    label: "Subscribed calendars (iCal / .ics)",
  },
  { t: "h2", text: "Local events" },
  {
    t: "custom",
    id: "localEvents",
    label: "Local events",
  },
];

export const WEATHER_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "Live forecast from <b>Open-Meteo</b>, free and with no API key needed. Only the city's coordinates are sent.",
  },
  { t: "toggle", k: "weatherEnabled", label: "Show weather" },
  { t: "custom", id: "wxLocation", label: "Location" },
  {
    t: "toggle",
    k: "locationAuto",
    label: "Use my current location",
    sub: "Follows this Mac: when it is more than 2 km from the city above, that becomes the new city. Picking a city turns this off.",
    unset: true,
  },
  { t: "custom", id: "locate", label: "Detect my location" },
  {
    t: "select",
    k: "weatherUnit",
    label: "Units",
    options: [
      ["c", "°C, km/h"],
      ["f", "°F, mph"],
    ],
    unset: "c",
  },
];

export const PRAYER_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "Reminders for the five daily prayers where you are. In Indonesia Sympony uses the official <b>Kemenag RI</b> schedule for your regency or city, the same table mosques use. Elsewhere the times come from <b>Aladhan</b> with the method of your country’s authority (JAKIM, MUIS, Diyanet, Umm al-Qura, ISNA…).",
  },
  {
    t: "toggle",
    k: "prayerEnabled",
    label: "Prayer time reminders",
    sub: "A countdown in the closed Sympony before each prayer, and a reminder when it’s time",
  },
  { t: "custom", id: "prayerToday" },
  { t: "h2", text: "Location" },
  {
    t: "custom",
    id: "prayerCity",
    label: "City",
    also: [["Kemenag regency / city", "kemenag"]],
  },
  { t: "custom", id: "locate", label: "Detect my location" },
  { t: "h2", text: "Calculation" },
  {
    t: "select",
    k: "prayerMethod",
    label: "Method",
    options: [...PRAYER_METHODS],
    unset: "auto",
  },
  {
    t: "select",
    k: "prayerSchool",
    label: "Asr",
    options: [
      ["standard", "Standard (Shafi’i, Maliki, Hanbali)"],
      ["hanafi", "Hanafi"],
    ],
    unset: "standard",
  },
  { t: "h2", text: "Reminders" },
  {
    t: "select",
    k: "prayerBefore",
    label: "Count down before each prayer",
    sub: "Shown in the closed Sympony",
    options: [
      [0, "Off"],
      [5, "5 minutes"],
      [10, "10 minutes"],
      [15, "15 minutes"],
      [30, "30 minutes"],
    ],
    unset: 10,
  },
  {
    t: "toggle",
    k: "prayerSound",
    label: "Sound when it’s time",
    unset: true,
  },
  { t: "toggle", k: "prayerList.fajr", label: "Subuh · Fajr", unset: true },
  {
    t: "toggle",
    k: "prayerList.sunrise",
    label: "Terbit · Sunrise (Syuruq)",
    sub: "The end of Subuh’s time: a countdown and a short reminder (the chime, never the adhan)",
    unset: true,
  },
  { t: "toggle", k: "prayerList.dhuhr", label: "Dzuhur · Dhuhr", unset: true },
  { t: "toggle", k: "prayerList.asr", label: "Ashar · Asr", unset: true },
  { t: "toggle", k: "prayerList.maghrib", label: "Maghrib", unset: true },
  { t: "toggle", k: "prayerList.isha", label: "Isya · Isha", unset: true },
  { t: "h2", text: "Adhan" },
  {
    t: "custom",
    id: "adhan",
    label: "Play the adhan when it’s time",
    sub: "Sympony doesn’t come with a recording: choose your own audio file (MP3, M4A, WAV, OGG…). Without one, this stays off. It plays for the prayers ticked above, in place of the chime, and the closed Sympony shows a stop button meanwhile.",
    also: [
      ["Subuh adhan (optional)", "fajr"],
      ["Volume", "volume"],
    ],
  },
  {
    t: "toggle",
    k: "adhanPauseMedia",
    label: "Pause music during the adhan",
    sub: "Music and videos that are playing pause while the adhan plays and continue after it.",
    unset: true,
  },
  {
    t: "lead",
    html: "Only the city’s coordinates (or its Kemenag code) are sent to get the times. A month of times is kept on this PC, so the reminders keep working offline. The Dashboard has a Prayer times widget too.",
  },
];
