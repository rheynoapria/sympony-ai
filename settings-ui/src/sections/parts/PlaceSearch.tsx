import { useEffect, useRef, useState, type ReactNode } from "react";
import { MapPin, Search } from "@/components/icons";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/knowns/utils";
import { nextIndex } from "./logic";

const INPUT_CLASS =
  "h-8 w-44 rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25";

export interface PlaceSearchProps<T> {
  find: (q: string) => Promise<T[]>;
  label: (x: T) => ReactNode;
  pick: (x: T) => void;
  placeholder: string;
  noMatch?: string;
  ariaLabel?: string;
  before?: ReactNode;
  dataK?: string;
  rowLabel?: ReactNode;
  rowSub?: ReactNode;
}

export function PlaceSearch<T>({
  find,
  label,
  pick,
  placeholder,
  noMatch,
  ariaLabel,
  before,
  dataK,
  rowLabel,
  rowSub,
}: PlaceSearchProps<T>) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<T[]>([]);
  const [at, setAt] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  const cancelSuggest = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    seqRef.current += 1;
  };

  const closeSuggest = () => {
    cancelSuggest();
    setSuggestions([]);
    setAt(-1);
  };

  useEffect(() => () => cancelSuggest(), []);

  const choose = (item: T) => {
    closeSuggest();
    setResults(null);
    setError(null);
    inputRef.current?.blur();
    pick(item);
  };

  const runSearch = async () => {
    closeSuggest();
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const found = await find(query);
      setResults(Array.isArray(found) ? found : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const handleChange = (val: string) => {
    setQuery(val);
    const trimmed = val.trim();
    if (trimmed.length < 3) {
      closeSuggest();
      return;
    }
    cancelSuggest();
    const n = seqRef.current;
    timerRef.current = window.setTimeout(async () => {
      try {
        const found = await find(trimmed);
        if (n !== seqRef.current) return;
        setSuggestions(Array.isArray(found) ? found.slice(0, 6) : []);
        setAt(-1);
      } catch {
        if (n !== seqRef.current) return;
        setSuggestions([]);
        setAt(-1);
      }
    }, 350);
  };

  const controls = (
    <div className="flex flex-wrap items-center gap-1.5" data-k={dataK}>
      {before}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          aria-label={ariaLabel ?? placeholder}
          placeholder={placeholder}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={closeSuggest}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              closeSuggest();
              return;
            }
            if (e.key === "Enter") {
              if (at >= 0 && suggestions[at] !== undefined) {
                e.preventDefault();
                choose(suggestions[at]);
              } else {
                e.preventDefault();
                void runSearch();
              }
              return;
            }
            if (
              suggestions.length === 0 ||
              (e.key !== "ArrowDown" && e.key !== "ArrowUp")
            ) {
              return;
            }
            e.preventDefault();
            setAt((prev) => nextIndex(prev, suggestions.length, e.key as "ArrowDown" | "ArrowUp"));
          }}
          className={INPUT_CLASS}
        />
        {suggestions.length > 0 && (
          <div
            role="listbox"
            onMouseDown={(e) => e.preventDefault()}
            className="absolute start-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-4rem)] overflow-hidden rounded-[var(--control-radius)] border border-border bg-popover p-1 shadow-lg"
          >
            {suggestions.map((item, i) => (
              <button
                key={i}
                type="button"
                role="option"
                aria-selected={i === at}
                onClick={() => choose(item)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-start text-[12.5px] transition-colors",
                  i === at
                    ? "bg-primary/12 text-foreground"
                    : "text-foreground/90 hover:bg-muted"
                )}
              >
                <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{label(item)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant="secondary"
        icon={<Search className="size-3.5" />}
        aria-label={t("Search")}
        onClick={() => void runSearch()}
      />
    </div>
  );

  const resultsBox = (searching || error !== null || results !== null) && (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {searching && (
        <span className="text-[12.5px] text-muted-foreground">{t("Searching…")}</span>
      )}
      {error && <span className="text-[12.5px] text-destructive">{error}</span>}
      {results && results.length === 0 && (
        <span className="text-[12.5px] text-muted-foreground">
          {noMatch ?? t("No matches")}
        </span>
      )}
      {results &&
        results.map((item, i) => (
          <button
            key={i}
            type="button"
            onClick={() => choose(item)}
            className="inline-flex items-center gap-1.5 rounded-[var(--control-radius)] border border-border bg-muted/40 px-2.5 py-1 text-[12.5px] text-foreground transition-colors hover:border-primary/40 hover:bg-muted"
          >
            <MapPin className="size-3 shrink-0 text-muted-foreground" />
            <span>{label(item)}</span>
          </button>
        ))}
    </div>
  );

  if (rowLabel !== undefined) {
    return (
      <div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium">{rowLabel}</div>
            {rowSub && (
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                {rowSub}
              </p>
            )}
          </div>
          <div className="min-w-0">{controls}</div>
        </div>
        {resultsBox}
      </div>
    );
  }

  return (
    <div>
      {controls}
      {resultsBox}
    </div>
  );
}
