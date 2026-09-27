/* ============================================================================
 * A PROPERTY — what its numbers mean, and nothing that touches a database
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-27, specifying the Properties page. Every rule she named that
 * is arithmetic or wording lives here, so the table, the detail panel, the
 * export, the import validator and the tests cannot disagree about a size, an
 * area or what "on hold" is called.
 *
 * ── ⚠️ A MARLA IS NOT 225 SQUARE FEET ─────────────────────────────────────
 * *"The Marla standard must be configurable per project. The system should
 * calculate square feet from the selected project standard instead of globally
 * assuming that every Marla equals 225 square feet."*
 *
 * So the standard is an ARGUMENT here, never a constant. It is 225 across most
 * of Punjab and 272.25 where the older imperial Marla survived; a scheme on the
 * wrong one would show every area 21% out and still look like a number.
 * `crm_project_settings.marla_sqft_standard` holds it (migration 266).
 *
 * ── ⚠️ AND A KANAL IS TWENTY MARLA, WHICH IS NOT A REGIONAL QUESTION ──────
 * That ratio is fixed even where the Marla's footprint is not, so it is the one
 * number in this file that is allowed to be a constant.
 * ========================================================================= */

/** Fixed everywhere: 1 Kanal = 20 Marla. The SQUARE FEET in a Marla vary; this does not. */
export const MARLA_PER_KANAL = 20;

/** What a project is assumed to use when it has not said. Punjab's common standard. */
export const DEFAULT_MARLA_SQFT = 225;

export type PropertyStatus = 'available' | 'reserved' | 'sold' | 'on_hold' | 'blocked' | 'withdrawn';

/* ---------------------------------------------------------------------------
 * Size and area
 * ------------------------------------------------------------------------- */

/**
 * `5` → `5 Marla` · `20` → `1 Kanal` · `45` → `2 Kanal 5 Marla`.
 *
 * ⚠️ Kanal first, because that is how a plot is spoken about here. A sales
 * conversation says "one kanal", never "twenty marla", and a table that says
 * the second makes the reader do the division every time.
 */
export function sizeLabel(marla: number | null | undefined): string {
  if (marla == null || !Number.isFinite(marla) || marla <= 0) return '—';
  const kanal = Math.floor(marla / MARLA_PER_KANAL);
  const rest = Number((marla - kanal * MARLA_PER_KANAL).toFixed(2));
  if (kanal === 0) return `${trim(rest)} Marla`;
  if (rest === 0) return `${kanal} Kanal`;
  return `${kanal} Kanal ${trim(rest)} Marla`;
}

/** Area for a size, at THIS project's standard. Rounded to a whole foot. */
export function areaSqft(marla: number | null | undefined, standard: number): number | null {
  if (marla == null || !Number.isFinite(marla) || marla <= 0) return null;
  if (!Number.isFinite(standard) || standard <= 0) return null;
  return Math.round(marla * standard);
}

/**
 * ⚠️ THE STORED AREA WINS OVER THE COMPUTED ONE, and that is deliberate.
 *
 * A plot sold at 1,125 sq ft was sold at 1,125 sq ft. If the scheme later
 * corrects its standard, recomputing every historic row would silently restate
 * what a buyer agreed to. So the column is the record and the standard is what
 * the FORM multiplies by when somebody types a new size.
 */
export function displayArea(
  stored: number | null | undefined,
  marla: number | null | undefined,
  standard: number,
): number | null {
  if (stored != null && Number.isFinite(stored) && stored > 0) return Math.round(stored);
  return areaSqft(marla, standard);
}

/** `1125` → `1,125 sq ft`. */
export function areaLabel(sqft: number | null | undefined): string {
  return sqft == null ? '—' : `${sqft.toLocaleString('en-US')} sq ft`;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/* ---------------------------------------------------------------------------
 * The area check — the owner's own panel, 2026-09-27
 * ------------------------------------------------------------------------- */

export interface AreaCheck {
  /** marla × the project's standard. */
  readonly fromStandard: number | null;
  /** width × length, as typed. */
  readonly fromDimensions: number | null;
  /** Both known and within tolerance. */
  readonly match: boolean;
  /** How far apart, as a percentage of the standard figure. */
  readonly deltaPct: number | null;
  readonly note: string;
}

/**
 * ⚠️ TWO WAYS OF SAYING THE SAME AREA, CHECKED AGAINST EACH OTHER.
 *
 * The owner's Add-property reference puts this on screen beside the fields:
 * "5 × 225 = 1,125 sq ft" against "25 × 45 = 1,125 sq ft", with a green
 * "Measurements match". It is the single most useful thing on that dialog,
 * because a plot typed as 5 Marla with 30 × 60 dimensions is a DATA ENTRY
 * ERROR that no constraint can catch — both numbers are individually valid,
 * and the mistake only surfaces when a buyer measures the plot.
 *
 * ⚠️ A TOLERANCE, NOT AN EQUALITY. Real plots are sold on rounded frontages:
 * a 10 Marla plot at 225 is 2,250 sq ft, and 30 × 75 is exactly that, but
 * 1 Kanal at 4,500 is commonly drawn 50 × 90 (4,500 ✓) and just as commonly
 * 45 × 100. 2% would reject honest paperwork; 12% catches a transposed digit.
 */
export const AREA_TOLERANCE = 0.12;

export function areaCheck(
  marla: number | null | undefined,
  standard: number,
  widthFt: number | null | undefined,
  lengthFt: number | null | undefined,
): AreaCheck {
  const fromStandard = areaSqft(marla, standard);
  const fromDimensions =
    widthFt != null && lengthFt != null && Number.isFinite(widthFt) && Number.isFinite(lengthFt)
      && widthFt > 0 && lengthFt > 0
      ? Math.round(widthFt * lengthFt)
      : null;

  if (fromStandard === null || fromDimensions === null) {
    return {
      fromStandard,
      fromDimensions,
      match: false,
      deltaPct: null,
      note: 'Enter a size and both dimensions to check them against each other.',
    };
  }

  const delta = Math.abs(fromDimensions - fromStandard) / fromStandard;
  const deltaPct = Math.round(delta * 1000) / 10;
  if (delta <= AREA_TOLERANCE) {
    return { fromStandard, fromDimensions, match: true, deltaPct, note: 'Measurements match' };
  }
  return {
    fromStandard,
    fromDimensions,
    match: false,
    deltaPct,
    note: `These disagree by ${deltaPct}% — check the size or the dimensions.`,
  };
}

/* ---------------------------------------------------------------------------
 * Money
 * ------------------------------------------------------------------------- */

/** `4500000` → `PKR 4,500,000`. Whole rupees; this product never shows paisa. */
export function money(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return `PKR ${Math.round(amount).toLocaleString('en-US')}`;
}

/**
 * `4500000` → `PKR 4.5M`, for the filter labels where a full figure will not fit.
 * ⚠️ Never used where somebody might quote it: a rounded price is a dispute.
 */
export function shortMoney(amount: number): string {
  if (amount >= 10_000_000) return `PKR ${Number((amount / 10_000_000).toFixed(2))}Cr`;
  if (amount >= 100_000) return `PKR ${Number((amount / 1_000_000).toFixed(2))}M`;
  return `PKR ${amount.toLocaleString('en-US')}`;
}

/* ---------------------------------------------------------------------------
 * Availability
 * ------------------------------------------------------------------------- */

export interface StatusLook {
  readonly label: string;
  readonly tone: 'green' | 'amber' | 'red' | 'grey' | 'blue';
  /** What it means, in the words a salesperson would use. Shown on hover. */
  readonly meaning: string;
}

/**
 * ⚠️ ON HOLD AND BLOCKED ARE DIFFERENT ANSWERS to "why can I not sell this?",
 * which is why 265 added two labels rather than one. A hold is the sales team
 * keeping a plot warm; a block is the company taking it off the market.
 *
 * ⚠️ `withdrawn` predates the owner's list (150) and is kept because rows and a
 * booking trigger already reference it. It is not offered in any picker — see
 * `SELECTABLE_STATUSES`.
 */
export const STATUS_LOOK: Readonly<Record<PropertyStatus, StatusLook>> = {
  available: { label: 'Available', tone: 'green', meaning: 'On the market and unsold.' },
  reserved: { label: 'Reserved', tone: 'amber', meaning: 'Held against a booking.' },
  sold: { label: 'Sold', tone: 'red', meaning: 'Sold and no longer available.' },
  on_hold: { label: 'On hold', tone: 'grey', meaning: 'Kept back while somebody decides.' },
  blocked: { label: 'Blocked', tone: 'grey', meaning: 'Taken off the market by the company.' },
  withdrawn: { label: 'Withdrawn', tone: 'grey', meaning: 'Retired from the catalogue.' },
};

/** The five the owner named. `withdrawn` is readable but never offered. */
export const SELECTABLE_STATUSES: readonly PropertyStatus[] = [
  'available',
  'reserved',
  'sold',
  'on_hold',
  'blocked',
];

export function statusLook(status: string | null | undefined): StatusLook {
  return STATUS_LOOK[(status ?? 'available') as PropertyStatus] ?? STATUS_LOOK.available;
}

/* ---------------------------------------------------------------------------
 * The plot's own character
 * ------------------------------------------------------------------------- */

export interface PropertyFlags {
  readonly isCorner?: boolean | null;
  readonly isParkFacing?: boolean | null;
  readonly isMainBoulevard?: boolean | null;
  readonly category?: string | null;
}

/**
 * The three chips under Core information. The reference shows all three at
 * once — `Standard`, `Non-corner`, `Not park-facing` — so a plain plot says so
 * rather than showing nothing and leaving the reader to wonder whether the page
 * simply failed to load them.
 *
 * ⚠️ The reference's first chip is misspelt ("Standazed"). Corrected here,
 * the same way the Performance page's "Sample data" became "Live data": the
 * design is the layout, not the copy.
 */
export function characterChips(p: PropertyFlags): readonly string[] {
  const category = p.category?.trim();
  const first = category && category.length > 0 ? category : 'Standard';
  const all = [
    first,
    p.isCorner ? 'Corner' : 'Non-corner',
    p.isParkFacing ? 'Park facing' : 'Not park-facing',
    ...(p.isMainBoulevard ? ['Main boulevard'] : []),
  ];

  /* ⚠️ DEDUPED, AND NOT ONLY TO KEEP REACT QUIET. A plot whose category IS
     "Corner" would otherwise read `Corner · Corner · Not park-facing` — the
     category and the flag saying the same thing twice. React's duplicate-key
     warning is how this was found in the browser; the display bug is the reason
     it is fixed here rather than by keying on the index. */
  return [...new Set(all)];
}

/* ---------------------------------------------------------------------------
 * Searching and filtering — one implementation, used by the table AND the export
 * ------------------------------------------------------------------------- */

export interface PropertyLike {
  readonly id: string;
  readonly code: string;
  readonly plotNumber: string | null;
  readonly block: string | null;
  readonly kind: string | null;
  readonly projectName: string;
  readonly projectId: string;
  readonly sizeMarla: number | null;
  readonly areaSqft: number | null;
  readonly dimensions: string | null;
  readonly basePrice: number | null;
  readonly premiumCharges: number | null;
  readonly status: string;
  readonly facing: string | null;
  readonly category: string | null;
  readonly isCorner?: boolean | null;
  readonly isParkFacing?: boolean | null;
  readonly isMainBoulevard?: boolean | null;
  readonly updatedAt: string | null;
}

export interface PropertyFilters {
  readonly tab?: 'all' | PropertyStatus;
  readonly search?: string;
  readonly projectId?: string;
  readonly block?: string;
  readonly size?: string;
  readonly kind?: string;
  readonly status?: string;
  readonly priceBand?: string;
  readonly facing?: string;
  readonly category?: string;
}

/** The price bands offered in the filter, in rupees. */
export const PRICE_BANDS: readonly { readonly key: string; readonly label: string; readonly min: number; readonly max: number }[] = [
  { key: 'under-5m', label: 'Under PKR 5M', min: 0, max: 5_000_000 },
  { key: '5m-10m', label: 'PKR 5M – 10M', min: 5_000_000, max: 10_000_000 },
  { key: '10m-20m', label: 'PKR 10M – 20M', min: 10_000_000, max: 20_000_000 },
  { key: 'over-20m', label: 'Over PKR 20M', min: 20_000_000, max: Number.POSITIVE_INFINITY },
];

/**
 * ⚠️ ONE FUNCTION, AND THE EXPORT CALLS IT TOO. The owner asked that
 * "Download template" carry the rows currently filtered — *"the properties that
 * are filtered you can download"*. If the table narrowed the rows one way and
 * the export another, the file would quietly disagree with the screen, which is
 * the worst kind of export bug because nobody checks.
 */
export function filterProperties<T extends PropertyLike>(
  rows: readonly T[],
  f: PropertyFilters,
): readonly T[] {
  const needle = (f.search ?? '').trim().toLowerCase();
  const band = f.priceBand ? PRICE_BANDS.find((b) => b.key === f.priceBand) : undefined;

  return rows.filter((r) => {
    if (f.tab && f.tab !== 'all' && r.status !== f.tab) return false;
    if (f.projectId && f.projectId !== 'all' && r.projectId !== f.projectId) return false;
    if (f.block && f.block !== 'all' && (r.block ?? '') !== f.block) return false;
    if (f.size && f.size !== 'all' && sizeLabel(r.sizeMarla) !== f.size) return false;
    if (f.kind && f.kind !== 'all' && (r.kind ?? '') !== f.kind) return false;
    if (f.status && f.status !== 'all' && r.status !== f.status) return false;
    if (f.facing && f.facing !== 'all' && (r.facing ?? '') !== f.facing) return false;
    if (f.category && f.category !== 'all' && (r.category ?? '') !== f.category) return false;

    if (band) {
      const price = r.basePrice ?? 0;
      if (price < band.min || price >= band.max) return false;
    }

    if (needle) {
      /* ⚠️ Hyphens and spaces are ignored on BOTH sides, so "A101", "a-101"
         and "A 101" all find PROP-A101. A scheme writes a plot number three
         ways and the person searching remembers a fourth. */
      const loose = needle.replace(/[^a-z0-9]+/g, '');
      const hay = [
        r.code, r.plotNumber, r.block, r.kind, r.projectName,
        r.dimensions, r.facing, r.category, sizeLabel(r.sizeMarla),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(needle) && !hay.replace(/[^a-z0-9]+/g, '').includes(loose)) return false;
    }
    return true;
  });
}

/** The five figures on the cards. Computed from the rows on screen, never stored. */
export function countProperties(rows: readonly PropertyLike[]) {
  const total = rows.length;
  const available = rows.filter((r) => r.status === 'available').length;
  const reserved = rows.filter((r) => r.status === 'reserved').length;
  const sold = rows.filter((r) => r.status === 'sold').length;
  const held = rows.filter((r) => r.status === 'on_hold' || r.status === 'blocked').length;
  return {
    total,
    available,
    reserved,
    sold,
    held,
    /** ⚠️ `—`, not `0%`, when there is nothing to divide by. */
    availablePct: total > 0 ? Math.round((available / total) * 1000) / 10 : null,
  };
}

/* ---------------------------------------------------------------------------
 * The import template — one list, used by the downloader AND the parser
 * ------------------------------------------------------------------------- */

export interface TemplateColumn {
  readonly key: string;
  readonly header: string;
  readonly required: boolean;
  readonly example: string;
  readonly note: string;
}

/**
 * ⚠️ THE TEMPLATE AND THE PARSER READ THE SAME LIST. A downloadable template
 * whose columns the importer does not recognise is worse than no template —
 * it is an instruction to make a file that will be rejected.
 */
export const TEMPLATE_COLUMNS: readonly TemplateColumn[] = [
  { key: 'code', header: 'Property ID', required: true, example: 'PROP-A101', note: 'Unique within the project.' },
  { key: 'plotNumber', header: 'Plot / unit number', required: true, example: 'A-101', note: 'As the scheme writes it.' },
  { key: 'block', header: 'Block', required: false, example: 'A', note: '' },
  { key: 'kind', header: 'Property type', required: false, example: 'Residential plot', note: 'Free text.' },
  { key: 'sizeMarla', header: 'Size (Marla)', required: true, example: '5', note: '1 Kanal = 20 Marla.' },
  { key: 'dimensions', header: 'Dimensions', required: false, example: '25 × 45 ft', note: 'Width × length.' },
  { key: 'facing', header: 'Facing', required: false, example: 'North facing', note: '' },
  { key: 'roadWidthFt', header: 'Road width (ft)', required: false, example: '30', note: '' },
  { key: 'category', header: 'Category', required: false, example: 'Corner', note: 'Standard · Corner · Park facing · Boulevard.' },
  { key: 'basePrice', header: 'Base price (PKR)', required: true, example: '4500000', note: 'Whole rupees, digits only.' },
  { key: 'premiumCharges', header: 'Premium charges (PKR)', required: false, example: '0', note: '' },
  { key: 'status', header: 'Status', required: false, example: 'Available', note: 'Available · Reserved · Sold · On hold · Blocked.' },
  { key: 'developmentStatus', header: 'Development status', required: false, example: 'Developed', note: '' },
  { key: 'notes', header: 'Notes', required: false, example: '', note: 'Internal. Never shared with a customer.' },
];

/* ---------------------------------------------------------------------------
 * ⚠️ WHAT A CUSTOMER MAY SEE — the sharing rule, in one place
 * ------------------------------------------------------------------------- */

/**
 * Owner: *"Sharing should provide customer-safe property information only. It
 * must not expose internal notes, lead details, booking payments or
 * administrative history."*
 *
 * ⚠️ AN ALLOW-LIST, NOT A DENY-LIST. A deny-list is wrong the day somebody adds
 * a column: the new field is shared by default and nobody notices until it is
 * in a customer's inbox. This names what MAY leave and drops everything else,
 * so a new column is private until somebody decides otherwise.
 *
 * ⚠️ AND SHARING NEVER RESERVES. The owner said so outright, and it is worth
 * saying in code as well as in prose: nothing in this module writes.
 */
export interface ShareableProperty {
  readonly code: string;
  readonly plotNumber: string | null;
  readonly block: string | null;
  readonly projectName: string;
  readonly kind: string | null;
  readonly size: string;
  readonly area: string;
  readonly dimensions: string | null;
  readonly facing: string | null;
  readonly roadWidthFt: number | null;
  readonly character: readonly string[];
  readonly basePrice: string;
  readonly premiumCharges: string;
  readonly status: string;
}

export function shareable(
  p: PropertyLike & { readonly roadWidthFt?: number | null },
  standard: number,
): ShareableProperty {
  return {
    code: p.code,
    plotNumber: p.plotNumber,
    block: p.block,
    projectName: p.projectName,
    kind: p.kind,
    size: sizeLabel(p.sizeMarla),
    area: areaLabel(displayArea(p.areaSqft, p.sizeMarla, standard)),
    dimensions: p.dimensions,
    facing: p.facing,
    roadWidthFt: p.roadWidthFt ?? null,
    character: characterChips(p),
    basePrice: money(p.basePrice),
    premiumCharges: money(p.premiumCharges ?? 0),
    status: statusLook(p.status).label,
  };
}

/** The share text, as it reaches a customer on WhatsApp or in an email. */
export function shareText(s: ShareableProperty): string {
  const lines = [
    `${s.plotNumber ?? s.code}${s.block ? ` · Block ${s.block}` : ''}`,
    s.projectName,
    '',
    `Type: ${s.kind ?? '—'}`,
    `Size: ${s.size} (${s.area})`,
    s.dimensions ? `Dimensions: ${s.dimensions}` : null,
    s.facing ? `Facing: ${s.facing}` : null,
    s.roadWidthFt ? `Road: ${s.roadWidthFt} ft` : null,
    `Price: ${s.basePrice}`,
    s.premiumCharges !== 'PKR 0' ? `Premium: ${s.premiumCharges}` : null,
    `Availability: ${s.status}`,
  ];
  return lines.filter((l) => l !== null).join('\n');
}
