import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldClasses, invalidClasses } from "./Input";

export interface SelectOption { value: string; label: string; disabled?: boolean }

export interface SelectProps extends Omit<React.ComponentProps<"select">, "size"> {
  options: SelectOption[];
  placeholder?: string;
  invalid?: boolean;
  selectSize?: "sm" | "md";
}

export function Select({ options, placeholder, invalid, selectSize = "md", className, ...props }: SelectProps) {
  return (
    <div className={cn("relative w-full", className)}>
      <select
        className={cn(fieldClasses, "appearance-none pr-9", selectSize === "sm" ? "h-8 px-2.5 text-xs" : "h-10 px-3", invalid && invalidClasses)}
        aria-invalid={invalid || undefined}
        {...props}
      >
        {placeholder && <option value="" disabled={props.required}>{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
    </div>
  );
}
