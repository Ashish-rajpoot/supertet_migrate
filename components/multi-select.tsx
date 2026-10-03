"use client";

/* ===========================================================
   components/multi-select.tsx - checkbox dropdown

   Same shape as ComboBox (searchable, free text, command list)
   but picking several values instead of one:

     - the trigger lists what is currently selected as chips,
       so the whole selection is visible without opening it
     - the list keeps showing EVERY option, with the picked
       ones ticked, rather than collapsing to the selection
     - ticking never closes the panel, so several can be
       toggled in one visit
   =========================================================== */
import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface MultiSelectOption {
  value: string;
  label?: string;
  /** Muted hint shown on the right, e.g. the Hindi name. */
  sub?: string;
}

/** Case-insensitive identity for a value. */
const key = (v: string): string => v.trim().toLowerCase();

export function MultiSelect({
  values,
  onChange,
  options,
  placeholder = "Select any...",
  emptyText = "No match.",
  id,
  ariaLabel,
  /** Shown beside the count in the footer, e.g. "3 subjects". */
  summary,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: MultiSelectOption[];
  placeholder?: string;
  emptyText?: string;
  id?: string;
  ariaLabel?: string;
  summary?: string;
}) {
  const [open, setOpen] = useState(false);
  const showSub = options.some((o) => o.sub && o.sub !== o.value);
  const picked = new Set(values.map(key));

  function toggle(value: string) {
    // Keep the caller's own spelling, just add or drop it.
    onChange(
      picked.has(key(value))
        ? values.filter((v) => key(v) !== key(value))
        : [...values, value]
    );
  }

  function remove(value: string) {
    onChange(values.filter((v) => key(v) !== key(value)));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? placeholder}
          className="h-auto min-h-9 w-full justify-start gap-1.5 py-1.5 font-normal"
        >
          {values.length ? (
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {/* Every selected option is listed here, so the whole choice
                  is readable at a glance without opening the panel. */}
              {values.map((v) => (
                <Badge key={key(v)} variant="secondary" className="max-w-[11rem] gap-1 font-normal">
                  <span className="truncate">{v}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Remove ${v}`}
                    className="cursor-pointer opacity-60 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        remove(v);
                      }
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </Badge>
              ))}
            </span>
          ) : (
            <span className="truncate text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
<PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          // Match the typed text against the label and its hint, so a Hindi
          // name finds the English topic and vice versa.
          filter={(cmdValue, search) => {
            const needle = search.toLowerCase();
            const hit =
              cmdValue.toLowerCase().includes(needle) ||
              (options.find((o) => o.value === cmdValue)?.sub || "")
                .toLowerCase()
                .includes(needle);
            return hit ? 1 : 0;
          }}
        >
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {/* All options stay listed; only the tick marks the picked ones. */}
              {options.map((o) => {
                const on = picked.has(key(o.value));
                return (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    onSelect={() => toggle(o.value)}
                    className="gap-2"
                  >
                    <Checkbox checked={on} className="pointer-events-none" />
                    <span className="min-w-0 flex-1 truncate">{o.label || o.value}</span>
                    {showSub && o.sub && o.sub !== o.value ? (
                      <span className="ml-2 max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                        {o.sub}
                      </span>
                    ) : null}
                    {on ? <Check className="size-4 shrink-0 opacity-70" /> : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {values.length ? (
            <div className="flex items-center justify-between gap-2 border-t p-2">
              <span className="truncate text-xs text-muted-foreground">
                {summary ?? `${values.length} selected`}
              </span>
              <Button variant="ghost" size="sm" onClick={() => onChange([])}>
                Clear
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
