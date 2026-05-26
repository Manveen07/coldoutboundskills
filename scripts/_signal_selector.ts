const FRESHNESS_WINDOW_DAYS = 90;

export interface SelectedSignal {
  signal_used: 'new_role' | 'promotion' | 'acquisition' | 'funding' | 'product_launch' | 'press' | 'company_snippet' | 'fallback';
  signal_fact: string | null;
  signal_freshness_days: number;
}

function inWindow(facts: any): boolean {
  if (!facts) return false;
  if (Array.isArray(facts)) {
    return facts.some(f => f?.fact && (f.freshness_days ?? 999) <= FRESHNESS_WINDOW_DAYS);
  }
  return Boolean(facts.fact) && (facts.freshness_days ?? 999) <= FRESHNESS_WINDOW_DAYS;
}

function pickFromArray(arr: any[]): any | null {
  if (!arr || !Array.isArray(arr)) return null;
  const valid = arr.filter(f => f?.fact && (f.freshness_days ?? 999) <= FRESHNESS_WINDOW_DAYS);
  if (!valid.length) return null;
  return valid.sort((a, b) => (a.freshness_days ?? 0) - (b.freshness_days ?? 0))[0];
}

export function selectSignal(companySidecar: any, personSidecar: any | null): SelectedSignal {
  if (personSidecar) {
    if (inWindow(personSidecar.new_role)) {
      return { signal_used: 'new_role', signal_fact: personSidecar.new_role.fact, signal_freshness_days: personSidecar.new_role.freshness_days };
    }
    if (inWindow(personSidecar.promotion)) {
      return { signal_used: 'promotion', signal_fact: personSidecar.promotion.fact, signal_freshness_days: personSidecar.promotion.freshness_days };
    }
  }

  // Amendment 9 — acquisition split from press
  if (inWindow(companySidecar.acquisition)) {
    return { signal_used: 'acquisition', signal_fact: companySidecar.acquisition.fact, signal_freshness_days: companySidecar.acquisition.freshness_days };
  }

  if (inWindow(companySidecar.funding)) {
    return { signal_used: 'funding', signal_fact: companySidecar.funding.fact, signal_freshness_days: companySidecar.funding.freshness_days };
  }

  if (inWindow(companySidecar.product_launch)) {
    return { signal_used: 'product_launch', signal_fact: companySidecar.product_launch.fact, signal_freshness_days: companySidecar.product_launch.freshness_days };
  }

  const press = pickFromArray(companySidecar.press);
  if (press) {
    return { signal_used: 'press', signal_fact: press.fact, signal_freshness_days: press.freshness_days };
  }

  if (companySidecar.company_snippet?.fact) {
    return { signal_used: 'company_snippet', signal_fact: companySidecar.company_snippet.fact, signal_freshness_days: 0 };
  }

  return { signal_used: 'fallback', signal_fact: null, signal_freshness_days: 0 };
}

export function selectSignalWithRotation(
  companySidecar: any,
  personSidecar: any | null,
  usedTypesForCompany: Set<string>
): SelectedSignal {
  // Try in priority order, but skip already-used types
  const priorityOrder: Array<{
    type: SelectedSignal['signal_used'];
    source: 'person' | 'company';
    field: string;
  }> = [
    { type: 'new_role', source: 'person', field: 'new_role' },
    { type: 'promotion', source: 'person', field: 'promotion' },
    { type: 'acquisition', source: 'company', field: 'acquisition' },
    { type: 'funding', source: 'company', field: 'funding' },
    { type: 'product_launch', source: 'company', field: 'product_launch' },
  ];

  for (const slot of priorityOrder) {
    if (usedTypesForCompany.has(slot.type)) continue;
    const source = slot.source === 'person' ? personSidecar : companySidecar;
    if (!source) continue;
    const fact = source[slot.field];
    if (inWindow(fact)) {
      usedTypesForCompany.add(slot.type);
      return { signal_used: slot.type, signal_fact: fact.fact, signal_freshness_days: fact.freshness_days };
    }
  }

  // Press array — pick freshest not-yet-used
  if (!usedTypesForCompany.has('press')) {
    const press = pickFromArray(companySidecar.press);
    if (press) {
      usedTypesForCompany.add('press');
      return { signal_used: 'press', signal_fact: press.fact, signal_freshness_days: press.freshness_days };
    }
  }

  // Snippet (no time decay)
  if (!usedTypesForCompany.has('company_snippet') && companySidecar.company_snippet?.fact) {
    usedTypesForCompany.add('company_snippet');
    return { signal_used: 'company_snippet', signal_fact: companySidecar.company_snippet.fact, signal_freshness_days: 0 };
  }

  // All types used — fall back to default selector (allows reuse — single-lead default)
  return selectSignal(companySidecar, personSidecar);
}
