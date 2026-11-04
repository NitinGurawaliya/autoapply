/**
 * Whether a value has the shape of a standard key: a country or city is a short place name, an email an address, a phone
 * a number, a name has no digits. An answer to another question can end up under a standard key when a label only
 * mentions it: "please select the status that allows you to work in the country..." was filed under `country`, and
 * every later "Country" search box typed "I am a citizen / permanent resident of..." and stopped (4 Nov, Dhanush).
 * Keys not listed here take any value.
 */
const SENTENCE = /\b(i|i'm|am|is|are|was|yes|no|citizen|resident|residency|status|permanent|authori[sz]ed|eligible|visa|sponsor\w*|work|plan)\b/i;

export function fitsKey(key: string, value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  switch (key) {
    case "country":
    case "city":
      return text.length <= 60 && text.split(/\s+/).length <= 6 && !SENTENCE.test(text);
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
    case "phone":
      return (text.match(/\d/g) ?? []).length >= 7 && !/[a-z]{3,}/i.test(text);
    case "first_name":
    case "last_name":
    case "full_name":
      return text.length <= 80 && !/\d/.test(text);
    default:
      return true;
  }
}
