"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";
import { cn } from "../lib/utils.ts";

export type InputProps = Omit<
  InputPrimitive.Props & React.RefAttributes<HTMLInputElement>,
  "size"
> & {
  size?: "sm" | "default" | "lg" | number;
  unstyled?: boolean;
  nativeInput?: boolean;
};

export function Input({
  className,
  size = "default",
  unstyled = false,
  nativeInput = false,
  style,
  ...props
}: InputProps): React.ReactElement {
  const inputClassName = cn(
    "h-8 w-full min-w-0 rounded-[inherit] px-[calc(--spacing(2.5)-1px)] leading-8 outline-none [transition:background-color_5000000s_ease-in-out_0s] placeholder:text-muted-foreground/64 sm:h-6 sm:leading-6",
    size === "sm" &&
      "h-7 px-[calc(--spacing(2)-1px)] leading-7 sm:h-5.5 sm:leading-5.5",
    size === "lg" && "h-9 leading-9 sm:h-7 sm:leading-7",
    props.type === "search" &&
      "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
    props.type === "file" &&
      "text-muted-foreground file:me-3 file:bg-transparent file:font-medium file:text-foreground file:text-sm",
  );

  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-flex w-full rounded-md border border-transparent bg-surface text-sm text-foreground shadow-[inset_0_1px_2px_--alpha(var(--color-black)/6%),0_0_0_1px_var(--edge)] transition-[box-shadow,background-color] duration-150 ease-smooth hover:shadow-[inset_0_1px_2px_--alpha(var(--color-black)/6%),0_0_0_1px_--alpha(var(--foreground)/16%)] has-focus-visible:shadow-[0_0_0_1.5px_var(--cx-accent),0_0_0_4px_--alpha(var(--cx-accent)/16%)] has-focus-visible:has-aria-invalid:shadow-[0_0_0_1.5px_var(--destructive),0_0_0_4px_--alpha(var(--destructive)/16%)] has-aria-invalid:shadow-[0_0_0_1px_--alpha(var(--destructive)/50%)] has-autofill:bg-foreground/4 has-disabled:opacity-56 sm:text-xs dark:has-autofill:bg-foreground/8",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      {nativeInput ? (
        <input
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          style={typeof style === "function" ? undefined : style}
          {...props}
        />
      ) : (
        <InputPrimitive
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          style={style}
          {...props}
        />
      )}
    </span>
  );
}

export { InputPrimitive };
