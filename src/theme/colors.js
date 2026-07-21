// ── Shared accent / semantic tokens ──────────────────────────────────────────
const shared = {
  primary:          '#0EA5E9',
  primaryDark:      '#0284C7',
  accent:           '#0EA5E9',
  accentLight:      '#38BDF8',
  accentForeground: '#FFFFFF',
  sage:             '#10B981',
  amber:            '#F59E0B',
  danger:           '#F43F5E',
  warning:          '#F59E0B',
  success:          '#10B981',
};

// ── Dark palette: "Studio Slate" — deep charcoal + sky blue precision ────────
export const darkColors = {
  ...shared,
  accentSoft:      'rgba(14,165,233,0.18)',
  sageSoft:        'rgba(16,185,129,0.15)',
  amberSoft:       'rgba(245,158,11,0.18)',
  amberForeground: '#FFFFFF',
  dangerSoft:      'rgba(244,63,94,0.16)',
  warningSoft:     'rgba(245,158,11,0.16)',
  successSoft:     'rgba(16,185,129,0.15)',

  background:      '#0A0E14',   // deep ink — near-black with cool blue undertone
  surface:         '#111720',   // elevated ink — primary card/panel background
  surfaceElevated: '#1A2231',   // lifted surface — modals, popovers
  muted:           '#232E40',   // muted fill — chips, input backgrounds

  textPrimary:   '#E8F0F8',   // cool crisp white — high contrast on dark
  textSecondary: '#7A99BB',   // steel blue-grey — secondary readable text
  textTertiary:  '#3D566E',   // dark steel — captions, placeholders
  textInverse:   '#0A0E14',

  border:       '#1E2D3D',   // subtle structural border
  borderStrong: '#2A3F55',   // card edges, strong dividers

  overlay:      'rgba(0,0,0,0.88)',
  overlayLight: 'rgba(0,0,0,0.60)',
};

// ── Light palette: "Cloud" — crisp slate whites + sky blue ───────────────────
export const lightColors = {
  ...shared,
  accentSoft:      'rgba(14,165,233,0.10)',
  sageSoft:        'rgba(16,185,129,0.10)',
  amberSoft:       'rgba(245,158,11,0.12)',
  amberForeground: '#FFFFFF',
  dangerSoft:      'rgba(244,63,94,0.10)',
  warningSoft:     'rgba(245,158,11,0.10)',
  successSoft:     'rgba(16,185,129,0.10)',

  background:      '#F0F4F8',   // cool slate-white — clean, airy base
  surface:         '#FFFFFF',   // pure white cards
  surfaceElevated: '#E8EEF5',   // slightly deeper — elevated modals
  muted:           '#DDE5EF',   // muted fill — inputs, chips

  textPrimary:   '#0D1926',   // near-black slate — strong legibility
  textSecondary: '#3D566E',   // medium steel — body text, labels
  textTertiary:  '#7A99BB',   // light steel — captions, hints
  textInverse:   '#F0F4F8',

  border:       '#C8D8E8',   // cool grey-blue border
  borderStrong: '#A8BDD4',   // strong separators, card edges

  overlay:      'rgba(13,25,38,0.50)',
  overlayLight: 'rgba(13,25,38,0.28)',
};

// Legacy default export — kept for backward-compat during migration
export const colors = darkColors;

// ── 8pt spacing scale ─────────────────────────────────────────────────────────
export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48,
};

// ── Border radii ──────────────────────────────────────────────────────────────
export const radius = {
  sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, full: 999,
};

// ── Typography scale ──────────────────────────────────────────────────────────
export const type = {
  h1:      { fontSize: 36, fontWeight: '800', letterSpacing: -1,   lineHeight: 42 },
  h2:      { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, lineHeight: 34 },
  h3:      { fontSize: 21, fontWeight: '700', lineHeight: 28 },
  h4:      { fontSize: 17, fontWeight: '700', lineHeight: 24 },
  body:    { fontSize: 15, fontWeight: '400', lineHeight: 22 },
  bodyMed: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  bodySm:  { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  label:   { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, lineHeight: 16 },
  caption: { fontSize: 11, fontWeight: '500', lineHeight: 16 },
};

// ── Theme-aware shadow factory ────────────────────────────────────────────────
export const makeShadows = (isDark) => ({
  sm: {
    shadowColor:   isDark ? '#000' : '#0D1926',
    shadowOpacity: isDark ? 0.60  : 0.08,
    shadowRadius:  10,
    shadowOffset:  { width: 0, height: 3 },
    elevation:     5,
  },
  md: {
    shadowColor:   isDark ? '#000' : '#0D1926',
    shadowOpacity: isDark ? 0.72  : 0.12,
    shadowRadius:  28,
    shadowOffset:  { width: 0, height: 10 },
    elevation:     12,
  },
  glow: {
    shadowColor:   '#0EA5E9',
    shadowOpacity: isDark ? 0.65 : 0.28,
    shadowRadius:  22,
    shadowOffset:  { width: 0, height: 5 },
    elevation:     12,
  },
});

// Legacy shadow export (dark)
export const shadow = makeShadows(true);
