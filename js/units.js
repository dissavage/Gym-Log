/* ════════════════════════════════════
   UNITS — pure conversion between canonical storage units and display units
   Canonical: mass kg · volume ml · distance km · length cm · duration minutes
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const DIMS = {
    mass:     { canonical: 'kg', units: { kg: { factor: 1, label: 'kg', dp: 1 },  lb:   { factor: 0.45359237, label: 'lb', dp: 1 } } },
    volume:   { canonical: 'ml', units: { ml: { factor: 1, label: 'ml', dp: 0 },  floz: { factor: 29.5735295625, label: 'oz', dp: 1 } } },
    distance: { canonical: 'km', units: { km: { factor: 1, label: 'km', dp: 2 },  mi:   { factor: 1.609344, label: 'mi', dp: 2 } } },
    length:   { canonical: 'cm', units: { cm: { factor: 1, label: 'cm', dp: 1 },  in:   { factor: 2.54, label: 'in', dp: 2 } } },
  };

  const SYSTEMS = {
    imperial: { mass: 'lb', volume: 'floz', distance: 'mi', length: 'in' },
    metric:   { mass: 'kg', volume: 'ml',   distance: 'km', length: 'cm' },
  };

  function unitDef(dim, unit) {
    const d = DIMS[dim];
    if (!d) throw new Error(`Unknown dimension: ${dim}`);
    const u = d.units[unit];
    if (!u) throw new Error(`Unknown unit ${unit} for ${dim}`);
    return u;
  }

  // prefs: { mass: 'lb', volume: 'floz', ... } — falls back to canonical
  const unitFor = (dim, prefs) => (prefs && prefs[dim]) || DIMS[dim].canonical;

  function toCanonical(dim, value, unit) {
    if (value == null || isNaN(value)) return null;
    return value * unitDef(dim, unit).factor;
  }

  function fromCanonical(dim, value, unit) {
    if (value == null || isNaN(value)) return null;
    return value / unitDef(dim, unit).factor;
  }

  const label = (dim, prefs) => unitDef(dim, unitFor(dim, prefs)).label;

  // Display value rounded for its unit, trailing zeros dropped: 83.91452 kg → 185 (lb)
  function display(dim, canonical, prefs, dp) {
    const unit = unitFor(dim, prefs);
    const v = fromCanonical(dim, canonical, unit);
    if (v == null) return null;
    const places = dp ?? unitDef(dim, unit).dp;
    const f = 10 ** places;
    return Math.round((v + Number.EPSILON) * f) / f;
  }

  function format(dim, canonical, prefs, dp) {
    const v = display(dim, canonical, prefs, dp);
    if (v == null) return '';
    return `${v.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${label(dim, prefs)}`;
  }

  // Field steps may be per display unit ({ lb: 5, kg: 2.5 }) or a plain number
  function stepFor(field, prefs) {
    const s = field.step;
    if (s == null) return 1;
    if (typeof s === 'number') return s;
    return field.dim ? (s[unitFor(field.dim, prefs)] ?? 1) : 1;
  }

  // A value typed in the display unit → what's stored (unit-less fields store as typed)
  const fieldToCanonical = (field, value, prefs) =>
    (field.dim ? toCanonical(field.dim, value, unitFor(field.dim, prefs)) : value);

  HL.units = { DIMS, SYSTEMS, unitFor, toCanonical, fromCanonical, label, display, format, stepFor, fieldToCanonical };
})(globalThis.HL = globalThis.HL || {});
