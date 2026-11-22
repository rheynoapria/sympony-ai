// Settings' icons: Fluent UI System Icons (Microsoft, MIT). The names are the ones the code used with lucide, so a
// file only changes its import. Controls get the Filled glyphs (they take the text colour); a section, card or
// ability gets its Fluent Color icon (`BrandIcon`), or the filled glyph in its own colour where there is none.
import { useId, type CSSProperties, type ComponentType } from "react";
import type { FluentIcon } from "@fluentui/react-icons";
import {
  AccessibilityFilled, AddFilled, AlertBadgeFilled, AlertFilled, AlertOnFilled, AppsFilled, ArchiveFilled, ArrowClockwiseFilled,
  ArrowCounterclockwiseFilled, ArrowDownFilled, ArrowDownloadFilled, ArrowEnterLeftFilled, ArrowSortFilled, ArrowSyncFilled, ArrowUndoFilled, ArrowUpFilled,
  ArrowUploadFilled, BatteryChargeFilled, BluetoothFilled, BoardFilled, BookLetterFilled, BookOpenFilled, BookmarkFilled, BotFilled,
  BrainCircuitFilled, BranchForkFilled, BriefcaseFilled, CalculatorFilled, CalendarAddFilled, CalendarCheckmarkFilled, CalendarClockFilled, CalendarDataBarFilled,
  CalendarFilled, CalendarLtrFilled, ChatBubblesQuestionFilled, ChatMultipleFilled, CheckboxCheckedFilled, CheckmarkCircleFilled, CheckmarkFilled, ChevronDownFilled,
  ChevronRightFilled, ChevronUpFilled, ClipboardFilled, ClockFilled, CloudFilled, CodeFilled, ColorFilled, CopyFilled,
  CubeFilled, CursorClickFilled, CursorFilled, DatabaseArrowUpFilled, DeleteFilled, DeveloperBoardFilled, DismissFilled, DocumentAddFilled,
  DocumentArrowDownFilled, DocumentArrowUpFilled, DocumentFilled, DocumentImageFilled, DocumentJavascriptFilled, DocumentTextFilled, DoorArrowRightFilled, EditFilled,
  EmojiSmileSlightFilled, ErrorCircleFilled, EyeFilled, FlashFilled, FolderAddFilled, FolderArrowRightFilled, FolderFilled, FolderOpenFilled,
  GaugeFilled, GiftFilled, GlobeFilled, GridFilled, HardDriveFilled, HatGraduationFilled, HeartPulseFilled, HomeFilled,
  HourglassHalfFilled, ImageFilled, InfoFilled, KeyFilled, KeyboardFilled, LiveFilled, LocalLanguageFilled, LocationFilled,
  LockClosedFilled, LockOpenFilled, MailFilled, MicFilled, MicSparkleFilled, MusicNote2Filled, NoteFilled, NotepadFilled,
  OpenFilled, OptionsFilled, PanelBottomFilled, PanelTopContractFilled, PauseCircleFilled, PenFilled, PersonFilled, PhoneFilled,
  PlayFilled, PlugConnectedFilled, PowerFilled, ProhibitedFilled, PulseFilled, RamFilled, ReOrderDotsVerticalFilled, RocketFilled,
  RulerFilled, SearchFilled, SendFilled, ServerFilled, ShareFilled, ShieldCheckmarkFilled, SignOutFilled, SparkleFilled,
  SplitVerticalFilled, StarFilled, StopFilled, TargetFilled, TemperatureFilled, TextAlignCenterFilled, TextAlignJustifyFilled, TextAlignLeftFilled,
  TextAlignRightFilled, TextboxSettingsFilled, TimerFilled, VideoFilled, WandFilled, WarningFilled, WeatherMoonFilled, WeatherPartlyCloudyDayFilled,
  WeatherSunnyFilled, Wifi1Filled, WindowConsoleFilled, WindowFilled, WrenchFilled,
} from "@fluentui/react-icons";
import { cn } from "@/lib/knowns/utils";

type IconProps = { className?: string; style?: CSSProperties; "aria-hidden"?: boolean | "true" | "false"; "aria-label"?: string };
export type LucideIcon = ComponentType<IconProps>;

/** A filled glyph sized like lucide's (24 px unless the class gives a size). */
function icon(C: FluentIcon): LucideIcon {
  const I = ({ className, ...p }: IconProps) => <C {...p} className={cn(/(^|\s)(size|w|h)-/.test(className ?? "") ? "" : "size-6", "shrink-0", className)} />;
  return I;
}

export const Accessibility = icon(AccessibilityFilled);
export const Activity = icon(PulseFilled);
export const AlertCircle = icon(ErrorCircleFilled);
export const AlertTriangle = icon(WarningFilled);
export const AlignCenter = icon(TextAlignCenterFilled);
export const AlignLeft = icon(TextAlignLeftFilled);
export const AlignRight = icon(TextAlignRightFilled);
export const AppWindow = icon(WindowFilled);
export const Archive = icon(ArchiveFilled);
export const ArrowDown = icon(ArrowDownFilled);
export const ArrowUp = icon(ArrowUpFilled);
export const ArrowUpDown = icon(ArrowSortFilled);
export const AudioLines = icon(TextAlignJustifyFilled);
export const AudioWaveform = icon(PulseFilled);
export const Ban = icon(ProhibitedFilled);
export const BatteryCharging = icon(BatteryChargeFilled);
export const Bell = icon(AlertFilled);
export const BellDot = icon(AlertBadgeFilled);
export const BellRing = icon(AlertOnFilled);
export const Bluetooth = icon(BluetoothFilled);
export const BookA = icon(BookLetterFilled);
export const BookOpen = icon(BookOpenFilled);
export const BookOpenText = icon(BookOpenFilled);
export const Bookmark = icon(BookmarkFilled);
export const Bot = icon(BotFilled);
export const Box = icon(CubeFilled);
export const Boxes = icon(AppsFilled);
export const Brain = icon(BrainCircuitFilled);
export const BrainCircuit = icon(BrainCircuitFilled);
export const Briefcase = icon(BriefcaseFilled);
export const Calculator = icon(CalculatorFilled);
export const Calendar = icon(CalendarFilled);
export const CalendarCheck = icon(CalendarCheckmarkFilled);
export const CalendarClock = icon(CalendarClockFilled);
export const CalendarDays = icon(CalendarLtrFilled);
export const CalendarPlus = icon(CalendarAddFilled);
export const Check = icon(CheckmarkFilled);
export const CheckCircle2 = icon(CheckmarkCircleFilled);
export const CheckSquare = icon(CheckboxCheckedFilled);
export const ChevronDown = icon(ChevronDownFilled);
export const ChevronRight = icon(ChevronRightFilled);
export const ChevronUp = icon(ChevronUpFilled);
export const CircleAlert = icon(ErrorCircleFilled);
export const CirclePause = icon(PauseCircleFilled);
export const Clapperboard = icon(VideoFilled);
export const Clipboard = icon(ClipboardFilled);
export const Clock = icon(ClockFilled);
export const Cloud = icon(CloudFilled);
export const CloudSun = icon(WeatherPartlyCloudyDayFilled);
export const Code2 = icon(CodeFilled);
export const Columns2 = icon(SplitVerticalFilled);
export const Command = icon(KeyboardFilled);
export const Copy = icon(CopyFilled);
export const Cpu = icon(DeveloperBoardFilled);
export const Crosshair = icon(TargetFilled);
export const DatabaseBackup = icon(DatabaseArrowUpFilled);
export const DoorOpen = icon(DoorArrowRightFilled);
export const Download = icon(ArrowDownloadFilled);
export const ExternalLink = icon(OpenFilled);
export const Eye = icon(EyeFilled);
export const File = icon(DocumentFilled);
export const FileCode2 = icon(DocumentJavascriptFilled);
export const FileDown = icon(DocumentArrowDownFilled);
export const FileImage = icon(DocumentImageFilled);
export const FilePlus = icon(DocumentAddFilled);
export const FileText = icon(DocumentTextFilled);
export const FileUp = icon(DocumentArrowUpFilled);
export const Folder = icon(FolderFilled);
export const FolderInput = icon(FolderArrowRightFilled);
export const FolderOpen = icon(FolderOpenFilled);
export const FolderPlus = icon(FolderAddFilled);
export const GanttChart = icon(CalendarDataBarFilled);
export const Gauge = icon(GaugeFilled);
export const Gift = icon(GiftFilled);
export const GitBranch = icon(BranchForkFilled);
export const Globe = icon(GlobeFilled);
export const GraduationCap = icon(HatGraduationFilled);
export const GripVertical = icon(ReOrderDotsVerticalFilled);
export const Hammer = icon(WrenchFilled);
export const HardDrive = icon(HardDriveFilled);
export const HardDriveUpload = icon(HardDriveFilled);
export const HeartPulse = icon(HeartPulseFilled);
export const Home = icon(HomeFilled);
export const Hourglass = icon(HourglassHalfFilled);
export const Image = icon(ImageFilled);
export const Inbox = icon(MailFilled);
export const Info = icon(InfoFilled);
export const KeyRound = icon(KeyFilled);
export const Keyboard = icon(KeyboardFilled);
export const Languages = icon(LocalLanguageFilled);
export const LayoutDashboard = icon(BoardFilled);
export const LayoutGrid = icon(GridFilled);
export const Loader2 = icon(ArrowClockwiseFilled);
export const Lock = icon(LockClosedFilled);
export const LockOpen = icon(LockOpenFilled);
export const LogIn = icon(ArrowEnterLeftFilled);
export const LogOut = icon(SignOutFilled);
export const MapPin = icon(LocationFilled);
export const MemoryStick = icon(RamFilled);
export const MessageCircleHeart = icon(ChatBubblesQuestionFilled);
export const MessagesSquare = icon(ChatMultipleFilled);
export const Mic = icon(MicFilled);
export const MicVocal = icon(MicSparkleFilled);
export const MonitorPlay = icon(VideoFilled);
export const Moon = icon(WeatherMoonFilled);
export const MoonStar = icon(WeatherMoonFilled);
export const MousePointer2 = icon(CursorFilled);
export const MousePointerClick = icon(CursorClickFilled);
export const Music = icon(MusicNote2Filled);
export const Palette = icon(ColorFilled);
export const PanelBottom = icon(PanelBottomFilled);
export const PanelTopClose = icon(PanelTopContractFilled);
export const PanelsTopLeft = icon(BoardFilled);
export const PenLine = icon(PenFilled);
export const Pencil = icon(EditFilled);
export const Play = icon(PlayFilled);
export const Plug = icon(PlugConnectedFilled);
export const Plus = icon(AddFilled);
export const Power = icon(PowerFilled);
export const Radio = icon(LiveFilled);
export const RefreshCw = icon(ArrowSyncFilled);
export const Rocket = icon(RocketFilled);
export const RotateCcw = icon(ArrowCounterclockwiseFilled);
export const RotateCw = icon(ArrowClockwiseFilled);
export const Ruler = icon(RulerFilled);
export const ScrollText = icon(NotepadFilled);
export const Search = icon(SearchFilled);
export const Send = icon(SendFilled);
export const Server = icon(ServerFilled);
export const Share2 = icon(ShareFilled);
export const ShieldCheck = icon(ShieldCheckmarkFilled);
export const SlidersHorizontal = icon(OptionsFilled);
export const Smartphone = icon(PhoneFilled);
export const Smile = icon(EmojiSmileSlightFilled);
export const Sparkles = icon(SparkleFilled);
export const Square = icon(StopFilled);
export const SquareTerminal = icon(WindowConsoleFilled);
export const Star = icon(StarFilled);
export const StickyNote = icon(NoteFilled);
export const Sun = icon(WeatherSunnyFilled);
export const Target = icon(TargetFilled);
export const TerminalSquare = icon(WindowConsoleFilled);
export const TextCursorInput = icon(TextboxSettingsFilled);
export const Thermometer = icon(TemperatureFilled);
export const Timer = icon(TimerFilled);
export const Trash2 = icon(DeleteFilled);
export const TriangleAlert = icon(WarningFilled);
export const Undo2 = icon(ArrowUndoFilled);
export const Upload = icon(ArrowUploadFilled);
export const UserRound = icon(PersonFilled);
export const Video = icon(VideoFilled);
export const Wand2 = icon(WandFilled);
export const Wifi = icon(Wifi1Filled);
export const X = icon(DismissFilled);
export const Zap = icon(FlashFilled);

const FILLED: Record<string, LucideIcon> = { Accessibility, Activity, AlertCircle, AlertTriangle, AlignCenter, AlignLeft, AlignRight, AppWindow, Archive, ArrowDown, ArrowUp, ArrowUpDown, AudioLines, AudioWaveform, Ban, BatteryCharging, Bell, BellDot, BellRing, Bluetooth, BookA, BookOpen, BookOpenText, Bookmark, Bot, Box, Boxes, Brain, BrainCircuit, Briefcase, Calculator, Calendar, CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, Check, CheckCircle2, CheckSquare, ChevronDown, ChevronRight, ChevronUp, CircleAlert, CirclePause, Clapperboard, Clipboard, Clock, Cloud, CloudSun, Code2, Columns2, Command, Copy, Cpu, Crosshair, DatabaseBackup, DoorOpen, Download, ExternalLink, Eye, File, FileCode2, FileDown, FileImage, FilePlus, FileText, FileUp, Folder, FolderInput, FolderOpen, FolderPlus, GanttChart, Gauge, Gift, GitBranch, Globe, GraduationCap, GripVertical, Hammer, HardDrive, HardDriveUpload, HeartPulse, Home, Hourglass, Image, Inbox, Info, KeyRound, Keyboard, Languages, LayoutDashboard, LayoutGrid, Loader2, Lock, LockOpen, LogIn, LogOut, MapPin, MemoryStick, MessageCircleHeart, MessagesSquare, Mic, MicVocal, MonitorPlay, Moon, MoonStar, MousePointer2, MousePointerClick, Music, Palette, PanelBottom, PanelTopClose, PanelsTopLeft, PenLine, Pencil, Play, Plug, Plus, Power, Radio, RefreshCw, Rocket, RotateCcw, RotateCw, Ruler, ScrollText, Search, Send, Server, Share2, ShieldCheck, SlidersHorizontal, Smartphone, Smile, Sparkles, Square, SquareTerminal, Star, StickyNote, Sun, Target, TerminalSquare, TextCursorInput, Thermometer, Timer, Trash2, TriangleAlert, Undo2, Upload, UserRound, Video, Wand2, Wifi, X, Zap };

// (the colour icons, bundled as text: `./color/*.svg`)
// (Vite turns the call into the files; under `bun test` there's no glob, and the filled glyphs stand in)
let SVGS: Record<string, string> = {};
try {
  SVGS = import.meta.glob("./color/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
} catch {
  /* tests */
}
const COLOR: Record<string, string> = {"Activity": "data-trending", "AppWindow": "content-view", "Archive": "document-folder", "AudioLines": "mic", "AudioWaveform": "mic", "Bell": "alert", "BellDot": "alert-badge", "BellRing": "alert-urgent", "BookA": "book", "BookOpen": "book-open", "BookOpenText": "book-open", "Bookmark": "bookmark", "Bot": "bot", "Boxes": "puzzle-piece", "Brain": "book-database", "BrainCircuit": "lightbulb-filament", "Briefcase": "briefcase", "Calendar": "calendar", "CalendarCheck": "calendar-checkmark", "CalendarClock": "calendar-clock", "CalendarDays": "calendar", "CalendarPlus": "calendar-edit", "CheckSquare": "checkbox", "Clapperboard": "video", "Clipboard": "clipboard", "Clock": "clock", "Cloud": "cloud", "CloudSun": "weather-sunny-low", "Code2": "code", "Columns2": "board", "DatabaseBackup": "database", "Gauge": "gauge", "Gift": "gift", "GitBranch": "code-block", "Globe": "globe", "Hammer": "wrench", "HeartPulse": "heart", "Home": "home", "Hourglass": "history", "Image": "image", "Inbox": "mail", "LayoutDashboard": "board", "LayoutGrid": "apps", "MapPin": "location-ripple", "MessagesSquare": "chat-multiple", "MessageCircleHeart": "chat", "Mic": "mic", "MicVocal": "mic", "MonitorPlay": "video", "Music": "headphones", "Palette": "paint-brush", "PanelBottom": "content-view", "PanelsTopLeft": "content-view", "PanelTopClose": "content-view", "Plug": "link-multiple", "ScrollText": "notebook", "ShieldCheck": "shield-checkmark", "SlidersHorizontal": "options", "Smartphone": "phone", "Smile": "bot-sparkle", "Sparkles": "star", "Star": "star", "StickyNote": "notebook", "TerminalSquare": "code-block", "SquareTerminal": "code-block", "TextCursorInput": "text-edit-style", "Timer": "clock-alarm", "UserRound": "person", "Video": "video", "Wand2": "design-ideas", "Wifi": "wifi", "Eye": "search-visual", "Lock": "lock-closed", "KeyRound": "lock-shield", "Send": "send", "Server": "database", "Search": "search-sparkle", "Sun": "weather-sunny-low", "Info": "question-circle", "Rocket": "fast-forward-circle", "Languages": "chat-bubbles-question"};

export const hasColor = (name: string) => name in COLOR;

// (each colour icon's own colour: the most vivid stop of its biggest coloured shape; a few set by eye)
const HUE: Record<string, string> = {"alert-badge": "#ffcd0f", "alert-urgent": "#9c6cfe", "alert": "#ffcd0f", "apps": "#36dff1", "board": "#64de89", "book-database": "#3bd5ff", "book-open": "#58aafe", "book": "#2052cb", "bookmark": "#f97dbd", "bot-sparkle": "#9c6cfe", "bot": "#9c6cfe", "briefcase": "#0094f0", "calendar-checkmark": "#e3ffd9", "calendar-clock": "#d1d1ff", "calendar-edit": "#0078d4", "calendar": "#0078d4", "chat-bubbles-question": "#cceaff", "chat-multiple": "#0fafff", "chat": "#cceaff", "checkbox": "#36dff1", "clipboard": "#0094f0", "clock-alarm": "#2764e7", "clock": "#d1d1ff", "cloud": "#0fafff", "code-block": "#e67eea", "code": "#c76efb", "content-view": "#0094f0", "data-trending": "#0fafff", "database": "#29c3ff", "design-ideas": "#ff9532", "document-folder": "#ffd638", "fast-forward-circle": "#e3ffd9", "gauge": "#ff921f", "gift": "#ffcd0f", "globe": "#3bd5ff", "headphones": "#0fafff", "heart": "#f97dbd", "history": "#0fafff", "home": "#ffb357", "image": "#0fafff", "lightbulb-filament": "#ffa43d", "link-multiple": "#36dff1", "location-ripple": "#f97dbd", "lock-closed": "#ffcd0f", "lock-shield": "#1e794a", "mail": "#367af2", "mic": "#0fafff", "notebook": "#d373fc", "options": "#29b4fb", "paint-brush": "#ac80ff", "person": "#9c6cfe", "phone": "#9c6cfe", "puzzle-piece": "#2764e7", "question-circle": "#cceaff", "search-sparkle": "#ffcd0f", "search-visual": "#3dcbff", "send": "#3bd5ff", "shield-checkmark": "#0fafff", "star": "#ffcd0f", "text-edit-style": "#0fafff", "video": "#9c6cfe", "weather-sunny-low": "#ffa342", "wifi": "#8b52f4", "wrench": "#0067bf"};

// (the colour of a filled glyph where Fluent has no colour icon)
const TINT: Record<string, string> = {
  MousePointer2: "#8b5cf6", MousePointerClick: "#06b6d4", MoonStar: "#6366f1", Moon: "#6366f1", Bluetooth: "#3b82f6", BatteryCharging: "#22c55e",
  Radio: "#f97316", Calculator: "#64748b", Command: "#64748b", Cpu: "#0ea5e9", CirclePause: "#f59e0b", DoorOpen: "#14b8a6", Keyboard: "#64748b",
  Ruler: "#a855f7", Zap: "#eab308", Target: "#ef4444", Thermometer: "#ef4444", Accessibility: "#0ea5e9", AppWindow: "#6366f1", Columns2: "#8b5cf6",
};

/** A section's, card's or ability's icon: Fluent Color where there is one, else the filled glyph in `tint`. */
export function BrandIcon({ name, className = "size-5", tint }: { name: string; className?: string; tint?: string }) {
  // (every copy gets its own gradient ids: `url(#…)` finds the first element with that id, and a copy in a closed
  // sidebar group, not drawn, would leave this one blank)
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const raw = COLOR[name] ? SVGS[`./color/${COLOR[name]}.svg`] : undefined;
  const svg = raw?.replaceAll('id="fc-', `id="${uid}-fc-`).replaceAll("url(#fc-", `url(#${uid}-fc-`).replaceAll('href="#fc-', `href="#${uid}-fc-`);
  if (svg) return <span aria-hidden="true" className={cn("inline-block shrink-0 [&>svg]:block [&>svg]:size-full", className)} dangerouslySetInnerHTML={{ __html: svg }} />;
  const Icon = FILLED[name] ?? LayoutGrid;
  return <Icon aria-hidden="true" className={className} style={{ color: tint ?? TINT[name] ?? "#8f7bff" }} />;
}

/** The colour that goes with an icon (for the soft tile behind it): its Fluent Color hue, or its filled glyph's tint. */
export function iconTint(name: string): string {
  return (COLOR[name] && HUE[COLOR[name]]) || TINT[name] || "#8f7bff";
}

/** The `.icon-tile` (index.css) behind an icon takes the icon's own colour from this. */
export const tileStyle = (name: string) => ({ "--ic": iconTint(name) }) as CSSProperties;

export function filledIcon(name: string): LucideIcon | undefined {
  return FILLED[name];
}
