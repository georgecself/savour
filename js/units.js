// units.js — shared unit conversion for Savour.
//
// Two tiers:
// 1. Same-family conversions (weight<->weight, volume<->volume) are exact
//    and universal — 1kg is always 1000g regardless of what it's 1kg of.
// 2. Weight<->volume conversions need an ingredient-specific density
//    (gramsPerMl), since a tablespoon of flour and a tablespoon of honey
//    are not the same weight. Where that's not set, conversion simply
//    isn't attempted — no guessing, no false confidence.
//
// "Pinch" is treated as a fixed global approximation (not ingredient-
// specific), since it was never a precise measurement to begin with.

const UNIT_ALIASES = {
  "gram": "g", "grams": "g", "gramme": "g", "grammes": "g",
  "kilogram": "kg", "kilograms": "kg", "kilo": "kg", "kilos": "kg",
  "milligram": "mg", "milligrams": "mg",
  "ounce": "oz", "ounces": "oz",
  "pound": "lb", "pounds": "lb", "lbs": "lb",
  "millilitre": "ml", "millilitres": "ml", "milliliter": "ml", "milliliters": "ml",
  "litre": "l", "litres": "l", "liter": "l", "liters": "l",
  "teaspoon": "tsp", "teaspoons": "tsp", "tsps": "tsp",
  "tablespoon": "tbsp", "tablespoons": "tbsp", "tbsps": "tbsp",
  "cups": "cup",
  "fl oz": "floz", "fluid ounce": "floz", "fluid ounces": "floz",
  "pinches": "pinch", "a pinch": "pinch", "pinch of": "pinch"
};

const WEIGHT_TO_GRAMS = { mg: 0.001, g: 1, kg: 1000, oz: 28.35, lb: 453.59 };
const VOLUME_TO_ML = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 250, floz: 28.4 };
const PINCH_GRAMS = 4;

function normalizeUnit(unit) {
  if (!unit) return "";
  const clean = String(unit).trim().toLowerCase();
  return UNIT_ALIASES[clean] || clean;
}

function unitFamily(unit) {
  const u = normalizeUnit(unit);
  if (u === "pinch") return "pinch";
  if (WEIGHT_TO_GRAMS[u] !== undefined) return "weight";
  if (VOLUME_TO_ML[u] !== undefined) return "volume";
  return "other"; // item, clove, tin, slice, etc — never auto-converted
}

// Converts `quantity` from `fromUnit` to `toUnit`. gramsPerMl is only
// needed when crossing weight<->volume for a specific ingredient — pass
// null/undefined if unknown. Returns null when the conversion isn't
// possible (incompatible units, or missing density data for a
// weight<->volume crossing).
function convertQuantity(quantity, fromUnit, toUnit, gramsPerMl) {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (from === to) return quantity;

  const fromFam = unitFamily(from);
  const toFam = unitFamily(to);

  if (fromFam === "pinch") return convertQuantity(quantity * PINCH_GRAMS, "g", to, gramsPerMl);
  if (toFam === "pinch") {
    const grams = convertQuantity(quantity, from, "g", gramsPerMl);
    return grams === null ? null : grams / PINCH_GRAMS;
  }

  if (fromFam === "weight" && toFam === "weight") {
    return (quantity * WEIGHT_TO_GRAMS[from]) / WEIGHT_TO_GRAMS[to];
  }
  if (fromFam === "volume" && toFam === "volume") {
    return (quantity * VOLUME_TO_ML[from]) / VOLUME_TO_ML[to];
  }
  if (fromFam === "weight" && toFam === "volume") {
    if (!gramsPerMl) return null;
    const grams = quantity * WEIGHT_TO_GRAMS[from];
    return (grams / gramsPerMl) / VOLUME_TO_ML[to];
  }
  if (fromFam === "volume" && toFam === "weight") {
    if (!gramsPerMl) return null;
    const ml = quantity * VOLUME_TO_ML[from];
    return (ml * gramsPerMl) / WEIGHT_TO_GRAMS[to];
  }
  return null;
}
