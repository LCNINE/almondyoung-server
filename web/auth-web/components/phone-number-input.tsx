"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { Input } from "@/components/ui/input";

const cursorPositionFallback = 0;

function stripPatternCharacters(value: string) {
  return value.replace(/\D/g, "");
}

function isUserCharacter(character: string) {
  return /\d/.test(character);
}

function getPhonePattern(value: string) {
  if (value.startsWith("010") || value.length > 10) {
    return "###-####-####";
  }

  return "###-###-####";
}

function format(value: string, pattern: string) {
  if (!pattern) return value;

  const placeholder = "#";
  let endOfValue = 0;
  let characterIndex = 0;

  return [...pattern]
    .map((patternCharacter, index) => {
      const character = value[characterIndex];

      if (!endOfValue) {
        if (index === pattern.length - 1) {
          endOfValue = pattern.length;
        }

        if (character === undefined) {
          endOfValue = pattern.indexOf(placeholder, index);
        }
      }

      if (patternCharacter === placeholder) {
        characterIndex += 1;
        return character;
      }

      return patternCharacter;
    })
    .splice(0, endOfValue)
    .join("");
}

type PhoneNumberInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "name" | "value" | "defaultValue"
> & {
  name: string;
  defaultValue?: string;
};

export const PhoneNumberInput = forwardRef<
  HTMLInputElement,
  PhoneNumberInputProps
>(({ defaultValue = "", name, onChange, maxLength, ...props }, ref) => {
  const normalizedDefaultValue = stripPatternCharacters(String(defaultValue)).slice(0, 11);
  const [rawValue, setRawValue] = useState(normalizedDefaultValue);
  const [value, setValue] = useState(
    format(normalizedDefaultValue, getPhonePattern(normalizedDefaultValue)),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const infoRef = useRef({
    cursorPosition: 0,
    endOfSection: false,
  });

  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const { target } = event;
    const { value: inputValue, selectionStart: cursorPosition } = target;
    const didDelete = inputValue.length < value.length;
    const safeCursorPosition = cursorPosition ?? cursorPositionFallback;

    infoRef.current.cursorPosition = safeCursorPosition;

    let nextRawValue = stripPatternCharacters(inputValue).slice(0, 11);

    if (didDelete) {
      const patternCharacterDeleted = !isUserCharacter(
        [...value][safeCursorPosition] ?? "",
      );

      if (patternCharacterDeleted) {
        const firstBit = inputValue.slice(0, safeCursorPosition);
        const rawFirstBit = stripPatternCharacters(firstBit);

        nextRawValue =
          rawFirstBit.slice(0, Math.max(0, rawFirstBit.length - 1)) +
          stripPatternCharacters(inputValue.slice(safeCursorPosition));

        infoRef.current.cursorPosition = Math.max(
          0,
          firstBit.replace(/(\d+)\D+$/, "$1").length - 1,
        );
      }
    }

    const pattern = getPhonePattern(nextRawValue);
    const formattedValue = format(nextRawValue, pattern);

    infoRef.current.endOfSection = false;

    if (!didDelete) {
      const formattedCharacters = [...formattedValue];
      const nextCharacter = formattedCharacters[safeCursorPosition];
      const nextCharacterIsPattern =
        nextCharacter !== undefined && !isUserCharacter(nextCharacter);
      const nextUserCharacterIndex = formattedValue
        .slice(safeCursorPosition)
        .search(/\d/);
      const hasMoreDigitsAhead = nextUserCharacterIndex !== -1;

      infoRef.current.endOfSection =
        nextCharacterIsPattern && !hasMoreDigitsAhead;

      if (
        nextCharacterIsPattern &&
        !isUserCharacter(formattedCharacters[safeCursorPosition - 1] ?? "") &&
        hasMoreDigitsAhead
      ) {
        infoRef.current.cursorPosition =
          safeCursorPosition + nextUserCharacterIndex + 1;
      }
    }

    setRawValue(nextRawValue);
    setValue(formattedValue);
    onChange?.(event);
  }

  useEffect(() => {
    const { cursorPosition, endOfSection } = infoRef.current;

    if (endOfSection) return;

    inputRef.current?.setSelectionRange(cursorPosition, cursorPosition);
  }, [value]);

  return (
    <>
      <input type="hidden" name={name} value={rawValue} />
      <Input
        {...props}
        maxLength={maxLength ?? 13}
        onChange={handleChange}
        ref={inputRef}
        value={value}
      />
    </>
  );
});

PhoneNumberInput.displayName = "PhoneNumberInput";
