// voice-agents/asha/greetings.ts
// Asha's first line and the recording notice, per language (M3 Decision 10, approved wording).
// The greeting discloses that Asha is an AI, names the business and asks for the shopkeeper by
// name and shop, with no amount: a wrong person hears nothing about the dues.
// ⚠️ Telugu and Hindi wording to be checked by a native speaker before the demo. Names are filled
// in English letters (as stored), so the voice must read them inside Telugu/Hindi text.
import type { Language } from '../../supabase/functions/_shared/schemas/shopkeeper.ts';

export interface GreetingNames {
  readonly shopkeeperName: string;
  readonly shopName: string;
  readonly businessName: string;
}

/** {{…}} are Sarvam agent variables; renderGreeting fills them for the phone page. */
export const GREETINGS: Readonly<Record<Language, string>> = {
  te:
    'నమస్కారం, నేను ఆశ, {{business_name}} తరఫున మాట్లాడుతున్న AI అసిస్టెంట్‌ని. ' +
    'మీరు {{shop_name}} {{shopkeeper_name}} గారేనా?',
  hi:
    'नमस्ते, मैं आशा हूँ, {{business_name}} की तरफ़ से AI असिस्टेंट। ' +
    'क्या मैं {{shop_name}} के {{shopkeeper_name}} जी से बात कर रही हूँ?',
  en:
    "Namaste, I'm Asha, an AI assistant calling for {{business_name}}. " +
    'Am I speaking with {{shopkeeper_name}} garu of {{shop_name}}?',
};

/** Said once identity is confirmed (RBI expectation: tell them the call is recorded). */
export const RECORDING_NOTICES: Readonly<Record<Language, string>> = {
  te: 'ధన్యవాదాలు. ఈ కాల్ రికార్డ్ అవుతోంది. రెండు నిమిషాలు మాట్లాడొచ్చా?',
  hi: 'धन्यवाद। यह कॉल रिकॉर्ड हो रही है। क्या हम दो मिनट बात कर सकते हैं?',
  en: 'Thank you. This call is recorded. Can we talk for two minutes?',
};

export function renderGreeting(language: Language, names: GreetingNames): string {
  const values: Readonly<Record<string, string>> = {
    business_name: names.businessName,
    shop_name: names.shopName,
    shopkeeper_name: names.shopkeeperName,
  };
  return GREETINGS[language].replace(/\{\{(\w+)\}\}/g, function fill(match, name: string) {
    return values[name] ?? match;
  });
}
