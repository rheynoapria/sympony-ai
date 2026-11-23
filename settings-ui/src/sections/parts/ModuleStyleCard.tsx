import { useState } from "react";
import { RotateCcw, SlidersHorizontal } from "@/components/icons";
import { PanelCard } from "@/components/shell/PanelCard";
import { groupIcon } from "@/components/shell/groupIcons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { Slider } from "@/components/ui/knowns/slider";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/knowns/utils";
import type { Settings } from "@/lib/notch";
import {
  activeStyleOption,
  MODULE_STYLES,
  readModulePref,
  readModuleStyles,
  type ModuleSizeMode,
  type ModuleStylePref,
  type ModuleSurfaceOverride,
} from "@/lib/stylelib";

function StyleSchematic({ modId, styleId }: { modId: string; styleId: string }) {
  // Crisp miniature OLED schematic showing each style's true structural layout
  const bg = "#070709";
  const tile = "#17171f";
  const dim = "#383846";
  const fg = "#e4e4ec";
  const green = "#4ade80";
  const sky = "#60a5fa";
  const red = "#ff5a52";
  const amber = "#fbbf24";

  if (modId === "prayer") {
    if (styleId === "timeline") {
      return (
        <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
          <rect width="180" height="68" rx="8" fill={bg} />
          <rect x="10" y="14" width="28" height="4" rx="2" fill={green} />
          <rect x="10" y="23" width="46" height="11" rx="2.5" fill={fg} />
          <rect x="10" y="39" width="32" height="3.5" rx="1.5" fill={dim} />
          <rect x="10" y="48" width="38" height="3" rx="1.5" fill={dim} opacity="0.6" />
          <rect x="74" y="14" width="60" height="3" rx="1.5" fill={dim} />
          <rect x="142" y="12" width="28" height="7" rx="3.5" fill={tile} stroke={dim} strokeWidth="0.7" />
          <line x1="78" y1="38" x2="166" y2="38" stroke={dim} strokeWidth="2" strokeLinecap="round" />
          <line x1="78" y1="38" x2="136" y2="38" stroke={green} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="136" y1="32" x2="136" y2="44" stroke={fg} strokeWidth="1.5" />
          {[78, 100, 122, 144, 166].map((x, idx) => (
            <g key={x}>
              <circle cx={x} cy="38" r={idx === 3 ? 3.5 : 2.5} fill={idx < 3 ? green : idx === 3 ? bg : dim} stroke={idx <= 3 ? green : dim} strokeWidth="1.4" />
              <rect x={x - 7} y="47" width="14" height="3" rx="1.5" fill={idx === 3 ? green : dim} />
              <rect x={x - 6} y="53" width="12" height="2.5" rx="1.2" fill={idx === 3 ? green : fg} opacity={idx < 3 ? 0.5 : 0.85} />
            </g>
          ))}
        </svg>
      );
    }
    if (styleId === "focus") {
      return (
        <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
          <rect width="180" height="68" rx="8" fill={bg} />
          <rect x="10" y="9" width="34" height="3.5" rx="1.5" fill={dim} />
          <rect x="142" y="8" width="28" height="5" rx="2.5" fill={tile} />
          <rect x="48" y="21" width="84" height="16" rx="4" fill={green} />
          {[10, 44, 78, 112, 146].map((x, idx) => (
            <rect key={x} x={x} y="48" width="28" height="12" rx="4" fill={idx === 3 ? "rgba(74,222,128,0.22)" : tile} />
          ))}
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
        <rect width="180" height="68" rx="8" fill={bg} />
        <rect x="6" y="6" width="90" height="56" rx="7" fill={tile} />
        <path d="M16 40 Q51 10 86 40" fill="none" stroke={dim} strokeWidth="1.6" strokeDasharray="2 3" />
        <path d="M16 40 Q42 16 62 28" fill="none" stroke={green} strokeWidth="2.2" />
        <circle cx="62" cy="28" r="3.5" fill={amber} />
        <rect x="14" y="48" width="38" height="8" rx="2" fill={green} />
        <circle cx="80" cy="50" r="7" fill="none" stroke={dim} strokeWidth="1.2" />
        <rect x="101" y="6" width="73" height="44" rx="7" fill={tile} />
        {[12, 20, 28, 36, 44].map((y, idx) => (
          <rect key={y} x="106" y={y} width="63" height="5.5" rx="2" fill={idx === 2 ? "rgba(74,222,128,0.3)" : dim} opacity={idx < 2 ? 0.45 : 0.9} />
        ))}
        <rect x="101" y="53" width="22" height="9" rx="3" fill={tile} />
        <rect x="126" y="53" width="22" height="9" rx="3" fill={tile} />
        <rect x="151" y="53" width="23" height="9" rx="3" fill={tile} />
      </svg>
    );
  }

  if (modId === "home") {
    if (styleId === "strip") {
      return (
        <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
          <rect width="180" height="68" rx="8" fill={bg} />
          <rect x="10" y="16" width="36" height="36" rx="7" fill="#5b6cff" />
          <rect x="54" y="21" width="54" height="6" rx="2" fill={fg} />
          <rect x="54" y="31" width="36" height="4" rx="2" fill={dim} />
          <rect x="54" y="42" width="60" height="3.5" rx="1.8" fill={dim} />
          <rect x="54" y="42" width="34" height="3.5" rx="1.8" fill={fg} />
          <circle cx="132" cy="34" r="5" fill={tile} />
          <circle cx="147" cy="34" r="8" fill={fg} />
          <circle cx="162" cy="34" r="5" fill={tile} />
        </svg>
      );
    }
    if (styleId === "cover") {
      return (
        <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
          <rect width="180" height="68" rx="8" fill={bg} />
          <rect x="10" y="8" width="52" height="52" rx="9" fill="#7c5cff" />
          <rect x="72" y="13" width="80" height="8" rx="2.5" fill={fg} />
          <rect x="72" y="25" width="52" height="4.5" rx="2" fill={dim} />
          <rect x="72" y="37" width="96" height="3.5" rx="1.8" fill={dim} />
          <rect x="72" y="37" width="56" height="3.5" rx="1.8" fill={fg} />
          <circle cx="88" cy="52" r="5" fill={tile} />
          <circle cx="104" cy="52" r="7" fill={fg} />
          <circle cx="120" cy="52" r="5" fill={tile} />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
        <rect width="180" height="68" rx="8" fill={bg} />
        <rect x="8" y="8" width="46" height="46" rx="8" fill="#4361ff" />
        <rect x="62" y="10" width="66" height="7" rx="2" fill={fg} />
        <rect x="62" y="21" width="46" height="4" rx="2" fill={dim} />
        <rect x="62" y="30" width="92" height="10" rx="3" fill={tile} />
        <rect x="62" y="45" width="106" height="3" rx="1.5" fill={dim} />
        <rect x="62" y="45" width="58" height="3" rx="1.5" fill={sky} />
        <circle cx="86" cy="56" r="5" fill={fg} />
        <rect x="134" y="52" width="34" height="8" rx="4" fill={tile} />
      </svg>
    );
  }

  if (modId === "weather") {
    if (styleId === "horizon") {
      return (
        <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
          <rect width="180" height="68" rx="8" fill={bg} />
          <circle cx="20" cy="26" r="7" fill={amber} />
          <rect x="32" y="18" width="28" height="14" rx="3" fill={fg} />
          <rect x="12" y="39" width="44" height="4" rx="2" fill={dim} />
          <rect x="12" y="47" width="36" height="3" rx="1.5" fill={dim} opacity="0.6" />
          {[68, 86, 104, 122, 140, 158].map((x, idx) => (
            <rect key={x} x={x} y="16" width="14" height="38" rx="4" fill={idx === 0 ? "rgba(96,165,250,0.28)" : tile} />
          ))}
        </svg>
      );
    }
    if (styleId === "minimal") {
      return (
        <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
          <rect width="180" height="68" rx="8" fill={bg} />
          <circle cx="28" cy="34" r="11" fill={amber} />
          <rect x="46" y="19" width="46" height="24" rx="5" fill={fg} />
          <rect x="46" y="47" width="40" height="4" rx="2" fill={dim} />
          <line x1="114" y1="14" x2="114" y2="54" stroke={dim} strokeWidth="1" />
          <rect x="122" y="18" width="46" height="4" rx="2" fill={dim} />
          <rect x="122" y="28" width="46" height="4" rx="2" fill={dim} />
          <rect x="122" y="38" width="46" height="4" rx="2" fill={dim} />
          <rect x="122" y="48" width="46" height="4" rx="2" fill={amber} opacity="0.7" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
        <rect width="180" height="68" rx="8" fill={bg} />
        <rect x="6" y="6" width="52" height="56" rx="7" fill={tile} />
        <rect x="12" y="28" width="28" height="14" rx="3" fill={fg} />
        <rect x="63" y="6" width="64" height="56" rx="7" fill={tile} />
        <polyline points="70,44 82,34 94,30 106,36 120,28" fill="none" stroke={amber} strokeWidth="2" />
        <rect x="132" y="6" width="42" height="56" rx="7" fill={tile} />
        {[14, 24, 34, 44].map((y) => (
          <rect key={y} x="138" y={y} width="30" height="4" rx="2" fill={dim} />
        ))}
      </svg>
    );
  }

  if (modId === "calendar") {
    if (styleId === "today") {
      return (
        <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
          <rect width="180" height="68" rx="8" fill={bg} />
          <rect x="12" y="12" width="22" height="4" rx="2" fill={red} />
          <rect x="12" y="20" width="30" height="22" rx="4" fill={red} />
          <rect x="12" y="47" width="38" height="3.5" rx="1.5" fill={dim} />
          <line x1="60" y1="12" x2="60" y2="56" stroke={dim} strokeWidth="1" />
          {[14, 29, 44].map((y, idx) => (
            <g key={y}>
              <rect x="68" y={y} width="100" height="11" rx="4" fill={tile} />
              <rect x="73" y={y + 2} width="2.5" height="7" rx="1" fill={idx === 0 ? sky : idx === 1 ? green : amber} />
            </g>
          ))}
        </svg>
      );
    }
    if (styleId === "week") {
      return (
        <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
          <rect width="180" height="68" rx="8" fill={bg} />
          {[8, 30, 52, 74, 96, 118, 140].map((x, idx) => (
            <rect key={x} x={x} y="8" width="19" height="18" rx="5" fill={idx === 2 ? red : tile} />
          ))}
          <rect x="162" y="8" width="11" height="18" rx="4" fill={dim} />
          <rect x="8" y="32" width="164" height="12" rx="4" fill={tile} />
          <rect x="8" y="48" width="164" height="12" rx="4" fill={tile} />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
        <rect width="180" height="68" rx="8" fill={bg} />
        <rect x="6" y="6" width="64" height="56" rx="7" fill={tile} />
        {[18, 28, 38, 48].map((y) =>
          [12, 21, 30, 39, 48, 57].map((x) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" fill={x === 30 && y === 28 ? red : dim} />
          ))
        )}
        <rect x="76" y="6" width="98" height="56" rx="7" fill={tile} />
        <rect x="82" y="14" width="54" height="5" rx="2" fill={fg} />
        <rect x="82" y="26" width="86" height="11" rx="4" fill={bg} />
        <rect x="82" y="42" width="86" height="11" rx="4" fill={bg} />
      </svg>
    );
  }

  if (modId === "control") {
    if (styleId === "minimal") {
      return (
        <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
          <rect width="180" height="68" rx="8" fill={bg} />
          {[16, 32, 48, 64, 80, 96].map((cx, idx) => (
            <circle key={cx} cx={cx} cy="21" r="6" fill={idx < 2 ? "#4361ff" : idx === 4 ? fg : tile} />
          ))}
          <rect x="112" y="15" width="44" height="12" rx="6" fill={tile} />
          <circle cx="164" cy="21" r="6" fill={tile} />
          <rect x="10" y="38" width="76" height="14" rx="5" fill={tile} />
          <rect x="10" y="38" width="52" height="14" rx="5" fill={fg} />
          <rect x="94" y="38" width="76" height="14" rx="5" fill={tile} />
          <rect x="94" y="38" width="46" height="14" rx="5" fill={fg} />
        </svg>
      );
    }
    if (styleId === "pill") {
      return (
        <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
          <rect width="180" height="68" rx="8" fill={bg} />
          <rect x="6" y="21" width="168" height="26" rx="13" fill={tile} opacity="0.5" />
          {[16, 29, 42, 55].map((cx, idx) => (
            <circle key={cx} cx={cx} cy="34" r="5" fill={idx < 2 ? "#4361ff" : idx === 3 ? amber : dim} />
          ))}
          <rect x="66" y="28" width="38" height="12" rx="5" fill={tile} />
          <rect x="66" y="28" width="25" height="12" rx="5" fill={fg} />
          <rect x="108" y="28" width="38" height="12" rx="5" fill={tile} />
          <rect x="108" y="28" width="22" height="12" rx="5" fill={fg} />
          <circle cx="155" cy="34" r="4.5" fill={green} />
          <circle cx="166" cy="34" r="4.5" fill={dim} />
        </svg>
      );
    }
    if (styleId === "compact") {
      return (
        <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
          <rect width="180" height="68" rx="8" fill={bg} />
          <rect x="8" y="12" width="32" height="20" rx="6" fill={tile} />
          <circle cx="16" cy="22" r="4" fill="#4361ff" />
          <rect x="44" y="12" width="32" height="20" rx="6" fill={tile} />
          <circle cx="52" cy="22" r="4" fill="#4361ff" />
          <rect x="8" y="36" width="32" height="20" rx="6" fill={tile} />
          <circle cx="16" cy="46" r="4" fill={dim} />
          <rect x="44" y="36" width="32" height="20" rx="6" fill={tile} />
          <circle cx="52" cy="46" r="4" fill={amber} />
          <rect x="84" y="12" width="88" height="12" rx="4.5" fill={tile} />
          <rect x="84" y="12" width="56" height="12" rx="4.5" fill={fg} />
          <rect x="84" y="28" width="88" height="12" rx="4.5" fill={tile} />
          <rect x="84" y="28" width="44" height="12" rx="4.5" fill={fg} />
          <rect x="84" y="45" width="50" height="11" rx="5.5" fill={tile} />
          <circle cx="144" cy="50.5" r="5" fill={fg} />
          <circle cx="157" cy="50.5" r="5" fill={tile} />
          <circle cx="168" cy="50.5" r="4" fill={tile} />
        </svg>
      );
    }
    if (styleId === "macos") {
      return (
        <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
          <rect width="180" height="68" rx="8" fill={bg} />
          <rect x="6" y="6" width="56" height="56" rx="8" fill={tile} stroke={dim} strokeWidth="0.7" />
          {[16, 34, 52].map((cy, idx) => (
            <g key={cy}>
              <circle cx="17" cy={cy} r="5" fill={idx === 0 ? "#4361ff" : idx === 1 ? sky : "#8b5cf6"} />
              <rect x="26" y={cy - 3.5} width="26" height="3.2" rx="1.5" fill={fg} />
              <rect x="26" y={cy + 1.5} width="18" height="2.4" rx="1.2" fill={dim} />
            </g>
          ))}
          <rect x="67" y="6" width="60" height="26" rx="7" fill={tile} stroke={dim} strokeWidth="0.7" />
          <rect x="72" y="11" width="22" height="3" rx="1.5" fill={dim} />
          <rect x="72" y="18" width="50" height="9" rx="4" fill={bg} />
          <rect x="72" y="18" width="34" height="9" rx="4" fill={fg} />
          <rect x="67" y="36" width="60" height="26" rx="7" fill={tile} stroke={dim} strokeWidth="0.7" />
          <rect x="72" y="41" width="20" height="3" rx="1.5" fill={dim} />
          <rect x="72" y="48" width="50" height="9" rx="4" fill={bg} />
          <rect x="72" y="48" width="28" height="9" rx="4" fill={fg} />
          <rect x="132" y="6" width="20" height="20" rx="5.5" fill={tile} stroke={dim} strokeWidth="0.7" />
          <circle cx="142" cy="14" r="3.5" fill={amber} />
          <rect x="154" y="6" width="20" height="20" rx="5.5" fill={tile} stroke={dim} strokeWidth="0.7" />
          <circle cx="164" cy="14" r="3.5" fill={fg} />
          <rect x="132" y="29" width="20" height="20" rx="5.5" fill={tile} stroke={dim} strokeWidth="0.7" />
          <circle cx="142" cy="37" r="3.5" fill={dim} />
          <rect x="154" y="29" width="20" height="20" rx="5.5" fill={tile} stroke={dim} strokeWidth="0.7" />
          <circle cx="164" cy="37" r="3.5" fill={green} />
          <rect x="132" y="52" width="42" height="10" rx="4" fill={tile} />
        </svg>
      );
    }
    if (styleId === "mixer") {
      return (
        <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
          <rect width="180" height="68" rx="8" fill={bg} />
          <rect x="6" y="6" width="88" height="38" rx="7" fill={tile} />
          <rect x="11" y="12" width="78" height="11" rx="4.5" fill={bg} />
          <rect x="11" y="12" width="54" height="11" rx="4.5" fill={fg} />
          <rect x="11" y="27" width="78" height="11" rx="4.5" fill={bg} />
          <rect x="11" y="27" width="44" height="11" rx="4.5" fill={fg} />
          <rect x="98" y="6" width="76" height="38" rx="7" fill={tile} />
          <rect x="103" y="15" width="31" height="11" rx="4" fill="rgba(96,165,250,0.34)" />
          <rect x="138" y="15" width="31" height="11" rx="4" fill={bg} />
          <rect x="103" y="29" width="31" height="11" rx="4" fill={bg} />
          <rect x="138" y="29" width="31" height="11" rx="4" fill={bg} />
          {[6, 30, 54, 78, 102, 126, 150].map((x, idx) => (
            <rect key={x} x={x} y="49" width="21" height="12" rx="4.5" fill={idx < 2 ? "#4361ff" : idx === 6 ? green : tile} />
          ))}
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
        <rect width="180" height="68" rx="8" fill={bg} />
        <rect x="6" y="6" width="27" height="26" rx="6" fill={tile} />
        <circle cx="15" cy="14" r="4" fill="#4361ff" />
        <rect x="36" y="6" width="27" height="26" rx="6" fill={tile} />
        <circle cx="45" cy="14" r="4" fill="#4361ff" />
        <rect x="6" y="36" width="27" height="26" rx="6" fill={tile} />
        <rect x="36" y="36" width="27" height="26" rx="6" fill={tile} />
        <rect x="68" y="6" width="16" height="56" rx="6" fill={tile} />
        <rect x="68" y="24" width="16" height="38" rx="6" fill={fg} />
        <rect x="88" y="6" width="16" height="56" rx="6" fill={tile} />
        <rect x="88" y="30" width="16" height="32" rx="6" fill={fg} />
        <rect x="109" y="6" width="65" height="42" rx="6" fill={tile} />
        <rect x="109" y="52" width="20" height="10" rx="4" fill={tile} />
        <rect x="132" y="52" width="20" height="10" rx="4" fill={tile} />
        <rect x="155" y="52" width="19" height="10" rx="4" fill={tile} />
      </svg>
    );
  }

  // Pomodoro
  if (styleId === "digital") {
    return (
      <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
        <rect width="180" height="68" rx="8" fill={bg} />
        <rect x="10" y="15" width="24" height="4" rx="2" fill={red} />
        <rect x="10" y="23" width="56" height="18" rx="4" fill={fg} />
        <rect x="10" y="46" width="44" height="3.5" rx="1.5" fill={dim} />
        <rect x="78" y="14" width="22" height="8" rx="4" fill={red} />
        <rect x="104" y="14" width="22" height="8" rx="4" fill={tile} />
        <rect x="130" y="14" width="22" height="8" rx="4" fill={tile} />
        <rect x="78" y="31" width="90" height="5" rx="2.5" fill={dim} />
        <rect x="78" y="31" width="54" height="5" rx="2.5" fill={red} />
        <rect x="78" y="44" width="42" height="12" rx="5" fill={fg} />
        <rect x="124" y="44" width="26" height="12" rx="5" fill={tile} />
      </svg>
    );
  }
  if (styleId === "strip") {
    return (
      <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
        <rect width="180" height="68" rx="8" fill={bg} />
        <rect x="10" y="20" width="42" height="20" rx="4" fill={fg} />
        <rect x="60" y="24" width="46" height="4" rx="2" fill={dim} />
        <rect x="60" y="34" width="66" height="5" rx="2.5" fill={dim} />
        <rect x="60" y="34" width="38" height="5" rx="2.5" fill={red} />
        <rect x="134" y="25" width="22" height="16" rx="6" fill={fg} />
        <rect x="160" y="25" width="12" height="16" rx="6" fill={tile} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 180 68" className="h-16 w-full rounded-[8px]" aria-hidden="true">
      <rect width="180" height="68" rx="8" fill={bg} />
      <rect x="6" y="6" width="58" height="56" rx="7" fill={tile} />
      <circle cx="35" cy="34" r="18" fill="none" stroke={dim} strokeWidth="3.5" />
      <path d="M35 16 A18 18 0 1 1 20 44" fill="none" stroke={red} strokeWidth="3.5" strokeLinecap="round" />
      <rect x="70" y="6" width="104" height="10" rx="4" fill={tile} />
      <rect x="70" y="20" width="104" height="26" rx="7" fill={tile} />
      <rect x="70" y="50" width="48" height="12" rx="5" fill={fg} />
      <rect x="122" y="50" width="52" height="12" rx="5" fill={tile} />
    </svg>
  );
}

export function ModuleStyleCard({
  moduleId,
  settings,
  set,
}: {
  moduleId: string;
  settings: Settings;
  set: (patch: Settings) => Promise<unknown>;
}) {
  const options = MODULE_STYLES[moduleId] ?? [];
  const pref = readModulePref(settings, moduleId);
  const active = activeStyleOption(settings, moduleId);
  const sizeMode: ModuleSizeMode = pref.size ?? "auto";
  const surfaceMode: ModuleSurfaceOverride = pref.surface ?? "auto";
  const [customOpen, setCustomOpen] = useState<boolean>(sizeMode === "custom");

  const defaultW = Number(settings.expandedWidth) || 660;
  const defaultH = Number(settings.expandedHeightTall) || 268;
  const curW = typeof pref.width === "number" && pref.width > 0 ? pref.width : defaultW;
  const curH = typeof pref.height === "number" && pref.height > 0 ? pref.height : (sizeMode === "fit" ? (active?.height ?? defaultH) : defaultH);

  const hasCustom =
    Boolean(pref.style && options[0] && pref.style !== options[0].id) ||
    (pref.size != null && pref.size !== "auto") ||
    (pref.surface != null && pref.surface !== "auto") ||
    pref.width != null ||
    pref.height != null;

  const updatePref = (patch: Partial<ModuleStylePref>) => {
    const all = readModuleStyles(settings);
    const nextEntry: ModuleStylePref = { ...pref, ...patch };
    void set({
      moduleStyles: {
        ...all,
        [moduleId]: nextEntry,
      },
    });
  };

  const resetModule = () => {
    const all = { ...readModuleStyles(settings) };
    const existing = all[moduleId];
    if (existing?.gridSize) {
      all[moduleId] = { gridSize: existing.gridSize };
    } else {
      delete all[moduleId];
    }
    setCustomOpen(false);
    void set({ moduleStyles: all });
  };

  return (
    <PanelCard
      title={t("Style & Layout")}
      icon={groupIcon("Style & Layout")}
      action={
        hasCustom ? (
          <Button size="xs" variant="ghost" onClick={resetModule}>
            <RotateCcw className="me-1 size-3.5" aria-hidden="true" />
            {t("Reset")}
          </Button>
        ) : undefined
      }
    >
      <div className="divide-y divide-border/80" data-k="moduleStyles">
        {options.length > 0 && (
          <div className="pb-3.5">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-medium text-foreground">{t("Layout style")}</div>
                <p className="text-[12px] text-muted-foreground">
                  {t("Pick a visual layout from the library. Selecting one previews it live in the notch.")}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {options.map((opt) => {
                const on = active?.id === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => updatePref({ style: opt.id })}
                    className={cn(
                      "group flex cursor-pointer flex-col gap-2 rounded-[11px] border p-2.5 text-start transition-all",
                      on
                        ? "border-primary bg-primary/8 ring-1 ring-primary/40"
                        : "border-border bg-muted/25 hover:border-border/90 hover:bg-muted/50"
                    )}
                  >
                    <StyleSchematic modId={moduleId} styleId={opt.id} />
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="truncate text-[12.5px] font-semibold text-foreground">
                          {t(opt.title)}
                        </span>
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {opt.height}px
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {t(opt.sub)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="py-3">
          <SettingsRow
            label={t("Notch size")}
            description={t("Default keeps every notch card the same size. Pick Fit, a preset, or Custom to resize this module.")}
          >
            <div className="flex flex-wrap items-center justify-end gap-2">
              <SegmentedControl
                tone="neutral"
                size="sm"
                aria-label={t("Notch size")}
                value={sizeMode === "custom" ? "auto" : sizeMode}
                options={[
                  { value: "auto", label: t("Default") },
                  ...(options.length > 0 ? [{ value: "fit", label: t("Fit") }] : []),
                  { value: "compact", label: t("Compact") },
                  { value: "standard", label: t("Standard") },
                  { value: "tall", label: t("Tall") },
                ]}
                onValueChange={(next) => {
                  setCustomOpen(false);
                  updatePref({ size: next as ModuleSizeMode });
                }}
              />
              <Button
                size="xs"
                variant={customOpen || sizeMode === "custom" ? "secondary" : "ghost"}
                onClick={() => {
                  const open = !customOpen;
                  setCustomOpen(open);
                  if (open && sizeMode !== "custom") {
                    updatePref({ size: "custom", width: curW, height: curH });
                  }
                }}
              >
                <SlidersHorizontal className="me-1 size-3.5" aria-hidden="true" />
                {t("Custom")}
              </Button>
            </div>
          </SettingsRow>

          {(customOpen || sizeMode === "custom") && (
            <div className="mt-3 grid gap-3 rounded-[10px] border border-border/80 bg-muted/30 p-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium text-foreground">{t("Width")}</span>
                  <span className="font-mono text-[11.5px] text-muted-foreground">{curW} px</span>
                </div>
                <Slider
                  value={curW}
                  min={420}
                  max={780}
                  step={10}
                  size="sm"
                  hideValue
                  aria-label={t("Width")}
                  onValueChange={(v) => updatePref({ size: "custom", width: v, height: curH })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium text-foreground">{t("Height")}</span>
                  <span className="font-mono text-[11.5px] text-muted-foreground">{curH} px</span>
                </div>
                <Slider
                  value={curH}
                  min={116}
                  max={320}
                  step={4}
                  size="sm"
                  hideValue
                  aria-label={t("Height")}
                  onValueChange={(v) => updatePref({ size: "custom", width: curW, height: v })}
                />
              </div>
            </div>
          )}
        </div>

        <div className="pt-3">
          <SettingsRow
            label={t("Card surface")}
            description={t("Follow style uses each layout’s designed OLED look, or override it here.")}
          >
            <SegmentedControl
              tone="neutral"
              size="sm"
              aria-label={t("Card surface")}
              value={surfaceMode}
              options={[
                { value: "auto", label: t("Auto") },
                { value: "oled", label: t("OLED") },
                { value: "borderless", label: t("Borderless") },
                { value: "outline", label: t("Outline") },
                { value: "glass", label: t("Glass") },
              ]}
              onValueChange={(next) => updatePref({ surface: next as ModuleSurfaceOverride })}
            />
          </SettingsRow>
        </div>
      </div>
    </PanelCard>
  );
}
