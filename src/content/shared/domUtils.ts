export function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function isVisible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const styles = window.getComputedStyle(element);
  return styles.display !== "none" && styles.visibility !== "hidden" && element.getClientRects().length > 0;
}

export function isEditable(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (!isVisible(element)) {
    return false;
  }

  const ariaDisabled = element.getAttribute("aria-disabled");
  const disabled = "disabled" in element ? (element as HTMLInputElement | HTMLButtonElement).disabled : false;
  return !disabled && ariaDisabled !== "true";
}

export function hasKeyword(text: string, keywords: string[]): boolean {
  const normalized = normalizeText(text).toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

export function findButtonByKeywords(keywords: string[]): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']"));
  for (const button of buttons) {
    const text = [button.innerText, button.getAttribute("aria-label"), button.getAttribute("data-testid")]
      .filter(Boolean)
      .join(" ");

    if (hasKeyword(text, keywords) && isVisible(button)) {
      return button;
    }
  }

  return null;
}

export function queryFirstBySelectors(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) {
      return element;
    }
  }

  return null;
}

export function queryAllBySelectors(selectors: string[]): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const results: HTMLElement[] = [];

  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
    for (const element of elements) {
      if (seen.has(element)) {
        continue;
      }

      seen.add(element);
      results.push(element);
    }
  }

  return results;
}

export function findTextHeavyElements(selectors: string[], minLength = 48): HTMLElement[] {
  return queryAllBySelectors(selectors)
    .filter((element) => {
      if (!isVisible(element)) {
        return false;
      }

      if (element.closest("form, nav, header, footer, aside, button, [role='button']")) {
        return false;
      }

      return normalizeText(element.textContent).length >= minLength;
    })
    .filter((element, index, elements) => {
      return !elements.some((candidate, candidateIndex) => {
        if (candidateIndex === index) {
          return false;
        }

        return candidate.contains(element);
      });
    });
}
