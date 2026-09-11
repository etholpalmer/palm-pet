// Shell-level constants. These are the values the pure units are *given*; none of them is
// read from the environment inside a unit, which is what keeps the units testable (B65).

// B65: the zone is a parameter, never read from the device. Fixed for v1.
export const ZONE = 'America/Toronto';

// D9: hard-coded seed categories. An array in a file, no CRUD screen, no table.
// B36: a category IS a tag; one vocabulary, not two.
export const SEED_TAGS = [
  'groceries', 'fuel', 'transit', 'coffee', 'eating out',
  'household', 'health', 'gifts', 'kids', 'other',
];

// B94: the page cannot observe whether iOS actually saved the file, so the stamp records
// what it can honestly know — that a file was prepared.
export const EXPORT_STAMP_KEY = 'palmpet.last_export_prepared';
