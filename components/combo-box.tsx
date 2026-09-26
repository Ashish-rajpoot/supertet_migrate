"use client";

/* ===========================================================
   components/combo-box.tsx - searchable dropdown

   Replaces a native <datalist>, which Android Chrome ignores
   entirely. Typing filters, the list is keyboard-navigable, and
   each option can carry a muted hint (the Hindi name, or
   "already in your bank"). Typing a value that is not in the
   list is still allowed - the box is free text underneath.
   =========================================================== */
import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface ComboOption {
  value: string;
  label?: string;
  sub?: string;
}

export function ComboBox({
  value,
  onChange,
  options,
  placeholder = "Select or type...",
  emptyText = "No match - you can still type your own value.",
  disabled = false,
  id,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const showSub = options.some((o) => o.sub && o.sub !== o.value);

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
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          // Match the typed text against the label *and* its hint, so a
          // Hindi name finds the English topic and vice versa.
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
          <CommandInput
            placeholder={placeholder}
            value={value}
            onValueChange={(next) => {
              // Typing a new value keeps it; picking a row commits it below.
              onChange(next);
            }}
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("size-4", value === o.value ? "opacity-100" : "opacity-0")}
                  />
                  <span className="min-w-0 flex-1 truncate">{o.label || o.value}</span>
                  {showSub && o.sub && o.sub !== o.value ? (
                    <span className="ml-2 max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                      {o.sub}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
